#!/usr/bin/env python3
"""
Run Multi-Machine Support Migration

This script runs the multi-machine support migration that adds tables and functions
for distributed workflow execution across multiple remote machines.

This script follows the pattern of existing database scripts in this project.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        print("❌ Error: SUPABASE_CONN_STRING environment variable not set.")
        print("Please set it in .env.local file")
        sys.exit(1)
    try:
        conn = psycopg2.connect(conn_string)
        # Don't use autocommit for migration - we want transaction control
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def check_tables_exist(conn):
    """Check if multi-machine tables already exist."""
    print("🔍 Checking if multi-machine tables already exist...")
    
    tables_to_check = [
        'remote_machines',
        'machine_configurations', 
        'workflow_machine_assignments',
        'execution_queue',
        'machine_load_metrics'
    ]
    
    with conn.cursor() as cur:
        existing_tables = []
        
        for table in tables_to_check:
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = %s
                )
            """, (table,))
            
            if cur.fetchone()[0]:
                existing_tables.append(table)
        
        if existing_tables:
            print(f"⚠️  Found existing tables: {', '.join(existing_tables)}")
            response = input("   Continue with migration? This will skip existing tables. (y/N): ")
            if response.lower() != 'y':
                print("❌ Migration aborted by user.")
                sys.exit(1)
            return existing_tables
        else:
            print("✅ No existing multi-machine tables found. Proceeding with full migration.")
            return []

def check_workflow_executions_columns(conn):
    """Check if workflow_executions table has multi-machine columns."""
    print("🔍 Checking workflow_executions table for multi-machine columns...")
    
    columns_to_check = [
        'assigned_machine_id',
        'assignment_reason',
        'machine_assignment_timestamp', 
        'assignment_method'
    ]
    
    with conn.cursor() as cur:
        existing_columns = []
        
        for column in columns_to_check:
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'workflow_executions'
                    AND column_name = %s
                )
            """, (column,))
            
            if cur.fetchone()[0]:
                existing_columns.append(column)
        
        if existing_columns:
            print(f"✅ Found existing columns: {', '.join(existing_columns)}")
        else:
            print("📋 Multi-machine columns not found in workflow_executions. Will add them.")
        
        return existing_columns

def run_migration_file():
    """Run the main migration file."""
    print("🚀 Running multi-machine migration file...")
    
    migration_file = 'supabase/migrations/20250115000000_add_multi_machine_support.sql'
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    try:
        conn = get_db_connection()
        
        # Read the migration file
        with open(migration_file, 'r', encoding='utf-8') as file:
            migration_sql = file.read()
        
        print(f"   📄 Read migration file ({len(migration_sql)} characters)")
        
        # Execute the entire migration as one transaction
        with conn.cursor() as cur:
            try:
                print("   🔄 Executing migration...")
                cur.execute(migration_sql)
                conn.commit()
                print("   ✅ Migration executed successfully!")
            except psycopg2.Error as e:
                conn.rollback()
                error_msg = str(e)
                
                # Check if it's just a "already exists" error for the whole migration
                if 'already exists' in error_msg.lower():
                    print(f"   ⚠️  Some objects already exist: {error_msg[:200]}...")
                    print("   ✅ Migration appears to be already applied!")
                else:
                    print(f"   ❌ Migration error: {error_msg}")
                    raise e
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error running migration: {e}")
        return False

def verify_migration():
    """Verify that the migration was successful."""
    print("🔍 Verifying migration results...")
    
    try:
        conn = get_db_connection()
        
        with conn.cursor() as cur:
            # Check main tables
            tables_to_verify = [
                'remote_machines',
                'machine_configurations',
                'workflow_machine_assignments', 
                'execution_queue',
                'machine_load_metrics'
            ]
            
            print("   📋 Checking tables...")
            missing_tables = []
            for table in tables_to_verify:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    count = cur.fetchone()[0]
                    print(f"     ✅ {table}: exists ({count} rows)")
                except psycopg2.Error:
                    missing_tables.append(table)
                    print(f"     ❌ {table}: missing")
            
            if missing_tables:
                print(f"   ❌ Missing tables: {missing_tables}")
                return False
            
            # Check views
            print("   📊 Checking views...")
            views_to_verify = [
                'available_machines_with_load',
                'workflow_machine_summary'
            ]
            
            missing_views = []
            for view in views_to_verify:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {view}")
                    count = cur.fetchone()[0]
                    print(f"     ✅ {view}: exists ({count} rows)")
                except psycopg2.Error:
                    missing_views.append(view)
                    print(f"     ❌ {view}: missing")
            
            if missing_views:
                print(f"   ❌ Missing views: {missing_views}")
                return False
            
            # Check functions
            print("   🔧 Checking functions...")
            cur.execute("""
                SELECT proname FROM pg_proc 
                WHERE proname IN ('get_optimal_machine_for_workflow', 'update_machine_load_metrics')
                AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            """)
            functions = [row[0] for row in cur.fetchall()]
            
            expected_functions = ['get_optimal_machine_for_workflow', 'update_machine_load_metrics']
            missing_functions = [f for f in expected_functions if f not in functions]
            
            for func in expected_functions:
                if func in functions:
                    print(f"     ✅ {func}: exists")
                else:
                    print(f"     ❌ {func}: missing")
            
            if missing_functions:
                print(f"   ❌ Missing functions: {missing_functions}")
                return False
            
            # Check workflow_executions columns
            print("   📝 Checking workflow_executions columns...")
            cur.execute("""
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'workflow_executions' 
                AND column_name IN ('assigned_machine_id', 'assignment_reason', 'machine_assignment_timestamp', 'assignment_method')
            """)
            columns = [row[0] for row in cur.fetchall()]
            
            expected_columns = ['assigned_machine_id', 'assignment_reason', 'machine_assignment_timestamp', 'assignment_method']
            missing_columns = [c for c in expected_columns if c not in columns]
            
            for col in expected_columns:
                if col in columns:
                    print(f"     ✅ workflow_executions.{col}: exists")
                else:
                    print(f"     ❌ workflow_executions.{col}: missing")
            
            if missing_columns:
                print(f"   ❌ Missing columns: {missing_columns}")
                return False
        
        conn.close()
        print("✅ Migration verification completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Migration verification failed: {e}")
        return False

def display_next_steps():
    """Display next steps after successful migration."""
    print("\n" + "=" * 60)
    print("🎉 MULTI-MACHINE MIGRATION COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    print("\n📋 NEXT STEPS:")
    print("\n1. 🤖 The unified workflow executor is already deployed and handles machine routing:")
    print("   # modal deploy modal_apps/workflow_executor.py (already deployed)")
    
    print("\n2. 🔧 Register Current Machine:")
    print("   # Test first with dry-run")
    print("   python scripts/register_current_machine.py --dry-run")
    print("   # Actually register")
    print("   python scripts/register_current_machine.py")
    
    print("\n3. 🌐 Register Matt's Machine (for testing):")
    print("   curl -X POST http://localhost:3000/api/machines \\")
    print("     -H 'Content-Type: application/json' \\")
    print("     -d '{")
    print('       "name": "Matt Test Machine",')
    print('       "mcp_endpoint": "https://matt-mcp-endpoint.ngrok.app",')
    print('       "management_endpoint": "https://matt-vm-endpoint.ngrok.dev",')
    print('       "machine_type": "windows_vm",')
    print('       "max_concurrent_executions": 1,')
    print('       "priority": 2,')
    print('       "region": "US",')
    print('       "tags": ["test", "secondary"]')
    print("     }'")
    
    print("\n4. 📊 Check Machine Status:")
    print("   curl http://localhost:3000/api/machines?include_load=true")
    
    print("\n5. 🔗 Test Workflow Assignment:")
    print("   # Assign specific workflow to Matt's machine for testing")
    print("   curl -X POST http://localhost:3000/api/workflows/[WORKFLOW_ID]/machines \\")
    print("     -H 'Content-Type: application/json' \\")
    print("     -d '{")
    print('       "machine_assignments": [{')
    print('         "machine_id": 2,')
    print('         "assignment_type": "exclusive",')
    print('         "priority": 1,')
    print('         "reason": "Testing on Matt\'s endpoint"')
    print("       }]")
    print("     }'")
    
    print("\n6. 🏥 Monitor Health:")
    print("   # Check health of all machines")
    print("   curl http://localhost:3000/api/machines?include_load=true")
    
    print("\n🔔 IMPORTANT NOTES:")
    print("• Your current production workflows will continue to work normally")
    print("• The system will default to your current machine until assignments are made")
    print("• Use the APIs to gradually test and assign workflows to different machines")
    print("• Monitor the health endpoints to ensure machines are accessible")

def main():
    """Main function to run the multi-machine migration."""
    print("🚀 Starting Multi-Machine Support Migration...")
    print("=" * 60)
    
    try:
        # Step 1: Check existing state
        conn = get_db_connection()
        existing_tables = check_tables_exist(conn)
        existing_columns = check_workflow_executions_columns(conn)
        conn.close()
        
        # Step 2: Run migration
        if not run_migration_file():
            print("❌ Failed to run migration file. Aborting.")
            sys.exit(1)
        
        # Step 3: Verify migration
        if not verify_migration():
            print("❌ Migration verification failed. Check manually.")
            sys.exit(1)
        
        # Step 4: Display next steps
        display_next_steps()
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 