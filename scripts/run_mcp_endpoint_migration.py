#!/usr/bin/env python3
"""
Run MCP Endpoint Migration

This script adds the mcp_endpoint column to workflow_executions table for
storing machine-specific MCP endpoints in execution records.

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
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def check_column_exists(conn):
    """Check if mcp_endpoint column already exists."""
    print("🔍 Checking if mcp_endpoint column already exists...")
    
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'workflow_executions'
                AND column_name = 'mcp_endpoint'
            )
        """)
        
        exists = cur.fetchone()[0]
        
        if exists:
            print("⚠️  Column mcp_endpoint already exists in workflow_executions table")
            response = input("   Continue with migration? (y/N): ")
            if response.lower() != 'y':
                print("❌ Migration aborted by user.")
                sys.exit(1)
            return True
        else:
            print("✅ Column mcp_endpoint not found. Proceeding with migration.")
            return False

def run_migration():
    """Run the mcp_endpoint column migration."""
    print("🚀 Running mcp_endpoint migration...")
    
    migration_sql = """
-- Migration: Add mcp_endpoint column to workflow_executions table
-- Created: 2025-01-19
-- Description: Stores the machine's MCP endpoint URL for the execution

-- Add mcp_endpoint column to workflow_executions table
ALTER TABLE public.workflow_executions 
ADD COLUMN IF NOT EXISTS mcp_endpoint text;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_workflow_executions_mcp_endpoint 
ON public.workflow_executions(mcp_endpoint);

-- Add comment for documentation
COMMENT ON COLUMN public.workflow_executions.mcp_endpoint 
IS 'MCP endpoint URL for the assigned machine (e.g., https://mcp-server-1.ngrok.app)';
    """
    
    try:
        conn = get_db_connection()
        
        print(f"   📄 Executing migration SQL...")
        
        with conn.cursor() as cur:
            try:
                print("   🔄 Adding mcp_endpoint column...")
                cur.execute(migration_sql)
                conn.commit()
                print("   ✅ Migration executed successfully!")
            except psycopg2.Error as e:
                conn.rollback()
                error_msg = str(e)
                
                if 'already exists' in error_msg.lower():
                    print(f"   ⚠️  Column already exists: {error_msg[:200]}...")
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
            # Check if column exists
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'workflow_executions'
                    AND column_name = 'mcp_endpoint'
                )
            """)
            
            column_exists = cur.fetchone()[0]
            
            if not column_exists:
                print("   ❌ Column mcp_endpoint was not created!")
                return False
            
            print("   ✅ Column mcp_endpoint exists")
            
            # Check column type
            cur.execute("""
                SELECT data_type 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'workflow_executions'
                AND column_name = 'mcp_endpoint'
            """)
            
            data_type = cur.fetchone()[0]
            print(f"   ✅ Column type: {data_type}")
            
            # Check if index exists
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM pg_indexes 
                    WHERE schemaname = 'public' 
                    AND tablename = 'workflow_executions'
                    AND indexname = 'idx_workflow_executions_mcp_endpoint'
                )
            """)
            
            index_exists = cur.fetchone()[0]
            
            if index_exists:
                print("   ✅ Index idx_workflow_executions_mcp_endpoint exists")
            else:
                print("   ⚠️  Index was not created (this is OK)")
            
            # Test that we can query the new column
            cur.execute("SELECT COUNT(*) FROM workflow_executions WHERE mcp_endpoint IS NULL")
            null_count = cur.fetchone()[0]
            
            cur.execute("SELECT COUNT(*) FROM workflow_executions WHERE mcp_endpoint IS NOT NULL")
            not_null_count = cur.fetchone()[0]
            
            print(f"   📊 Existing executions: {null_count} without endpoint, {not_null_count} with endpoint")
        
        conn.close()
        print("✅ Migration verification completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Migration verification failed: {e}")
        return False

def display_next_steps():
    """Display next steps after successful migration."""
    print("\n" + "=" * 60)
    print("🎉 MCP ENDPOINT MIGRATION COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    print("\n📋 NEXT STEPS:")
    print("\n1. 🚀 Deploy Updated Python Executor:")
    print("   modal deploy modal_apps/workflow_executor.py")
    
    print("\n2. 🧪 Test Execution with New Fields:")
    print("   # Test that new executions get mcp_endpoint populated")
    print("   # Execute a workflow and check the database")
    
    print("\n3. 📊 Verify System Works:")
    print("   # Check that Python executor reads mcp_endpoint from database")
    print("   # Monitor logs for any endpoint-related issues")
    
    print("\n🔔 IMPORTANT NOTES:")
    print("• Existing executions will have NULL mcp_endpoint (this is OK)")
    print("• New executions will get mcp_endpoint populated by JavaScript API")
    print("• Python executor now reads endpoints from database instead of hardcoded values")
    print("• Both /execute and /execute-sync endpoints are already updated")

def main():
    """Main function to run the mcp_endpoint migration."""
    print("🚀 Starting MCP Endpoint Migration...")
    print("=" * 60)
    
    try:
        # Step 1: Check existing state
        conn = get_db_connection()
        column_exists = check_column_exists(conn)
        conn.close()
        
        # Step 2: Run migration
        if not run_migration():
            print("❌ Failed to run migration. Aborting.")
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