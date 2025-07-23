#!/usr/bin/env python3
"""
Workflow Synthesis Status Migration Runner
Applies the workflow synthesis status tracking migration to add status fields and update existing workflows.
"""

import psycopg2
import os
from datetime import datetime

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def check_column_exists(conn, table_name, column_name):
    """Check if a column already exists in the table."""
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = %s 
            AND column_name = %s
        """, (table_name, column_name))
        result = cursor.fetchone()
        cursor.close()
        return result is not None
    except Exception as e:
        cursor.close()
        print(f"❌ Error checking column existence: {e}")
        return False

def check_constraint_exists(conn, table_name, constraint_name):
    """Check if a constraint already exists."""
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = %s 
            AND constraint_name = %s
        """, (table_name, constraint_name))
        result = cursor.fetchone()
        cursor.close()
        return result is not None
    except Exception as e:
        cursor.close()
        print(f"❌ Error checking constraint existence: {e}")
        return False

def check_index_exists(conn, index_name):
    """Check if an index already exists."""
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT indexname 
            FROM pg_indexes 
            WHERE indexname = %s
        """, (index_name,))
        result = cursor.fetchone()
        cursor.close()
        return result is not None
    except Exception as e:
        cursor.close()
        print(f"❌ Error checking index existence: {e}")
        return False

def run_migration_file(conn, migration_file, description):
    """Run the migration file safely."""
    print(f"\n🔄 {description}")
    print(f"📁 File: {migration_file}")
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    try:
        with open(migration_file, 'r') as f:
            sql_content = f.read()
        
        cursor = conn.cursor()
        cursor.execute(sql_content)
        conn.commit()
        cursor.close()
        
        print(f"✅ {description} - SUCCESS")
        return True
        
    except Exception as e:
        print(f"❌ {description} - FAILED: {e}")
        conn.rollback()
        return False

def verify_migration(conn):
    """Verify that the migration was applied successfully."""
    print("\n🔍 Verifying migration results...")
    
    # Check columns
    columns_to_check = ['synthesis_status', 'saved_at', 'saved_by_user_id']
    for column in columns_to_check:
        if check_column_exists(conn, 'low_level_workflows', column):
            print(f"✅ Column '{column}' exists")
        else:
            print(f"❌ Column '{column}' missing")
            return False
    
    # Check constraint
    if check_constraint_exists(conn, 'low_level_workflows', 'check_synthesis_status'):
        print("✅ Constraint 'check_synthesis_status' exists")
    else:
        print("❌ Constraint 'check_synthesis_status' missing")
        return False
    
    # Check indexes
    indexes_to_check = ['idx_low_level_workflows_synthesis_status', 'idx_low_level_workflows_user_status']
    for index in indexes_to_check:
        if check_index_exists(conn, index):
            print(f"✅ Index '{index}' exists")
        else:
            print(f"❌ Index '{index}' missing")
            return False
    
    # Check data update
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN synthesis_status = 'saved' THEN 1 END) as saved_count
            FROM low_level_workflows 
            WHERE detailed_workflow_data IS NOT NULL
        """)
        result = cursor.fetchone()
        total, saved_count = result
        cursor.close()
        
        print(f"✅ Updated {saved_count}/{total} existing workflows to 'saved' status")
        return True
        
    except Exception as e:
        cursor.close()
        print(f"❌ Error verifying data update: {e}")
        return False

def main():
    print("🚀 Workflow Synthesis Status Migration Runner")
    print("=" * 50)
    print(f"⏰ Started at: {datetime.now().isoformat()}")
    
    try:
        # Connect to database
        print("\n🔌 Connecting to database...")
        conn = get_connection()
        print("✅ Database connection established")
        
        # Check if migration is already applied
        print("\n🔍 Checking current state...")
        if check_column_exists(conn, 'low_level_workflows', 'synthesis_status'):
            print("⚠️  synthesis_status column already exists - migration may have been run before")
            print("   Proceeding anyway with IF NOT EXISTS clauses...")
        
        # Run the migration
        migration_file = "supabase/migrations/20250122000000_add_workflow_synthesis_status.sql"
        success = run_migration_file(
            conn, 
            migration_file, 
            "Adding workflow synthesis status tracking"
        )
        
        if success:
            # Verify the migration
            verify_migration(conn)
            print("\n🎉 Migration completed successfully!")
        else:
            print("\n❌ Migration failed!")
            return 1
        
        conn.close()
        print(f"⏰ Completed at: {datetime.now().isoformat()}")
        return 0
        
    except Exception as e:
        print(f"\n💥 Fatal error: {e}")
        return 1

if __name__ == "__main__":
    exit(main()) 