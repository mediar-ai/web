#!/usr/bin/env python3
"""
Run Version Number Migration

This script adds the version_number column to workflow_executions table
to track which workflow version was executed.

Based on the pattern of existing database scripts in this project.
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
    """Check if version_number column already exists."""
    print("🔍 Checking if version_number column already exists...")
    
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'workflow_executions' 
            AND column_name = 'version_number'
            AND table_schema = 'public'
        """)
        
        result = cur.fetchone()
        if result:
            print("   ✅ version_number column already exists!")
            return True
        else:
            print("   📋 version_number column not found. Will add it.")
            return False

def run_migration_file():
    """Run the version_number migration file."""
    print("🚀 Running version_number migration file...")
    
    migration_file = 'supabase/migrations/20250117000001_add_version_number_to_executions.sql'
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    try:
        conn = get_db_connection()
        
        # Check if already exists
        if check_column_exists(conn):
            print("   ⚠️  Migration appears to be already applied!")
            conn.close()
            return True
        
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
                
                # Check if it's just a "already exists" error
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
            # Check if column exists
            print("   📋 Checking version_number column...")
            if check_column_exists(conn):
                print("     ✅ version_number column exists")
            else:
                print("     ❌ version_number column missing")
                return False
            
            # Check indexes
            print("   📊 Checking indexes...")
            indexes_to_verify = [
                'idx_workflow_executions_version_number',
                'idx_workflow_executions_workflow_version'
            ]
            
            missing_indexes = []
            for index in indexes_to_verify:
                cur.execute("""
                    SELECT indexname 
                    FROM pg_indexes 
                    WHERE indexname = %s 
                    AND tablename = 'workflow_executions'
                    AND schemaname = 'public'
                """, (index,))
                
                if cur.fetchone():
                    print(f"     ✅ {index}: exists")
                else:
                    missing_indexes.append(index)
                    print(f"     ❌ {index}: missing")
            
            if missing_indexes:
                print(f"   ❌ Missing indexes: {missing_indexes}")
                return False
            
            # Check comment
            print("   📝 Checking column comment...")
            cur.execute("""
                SELECT col_description(c.oid, a.attnum) as comment
                FROM pg_class c
                JOIN pg_attribute a ON c.oid = a.attrelid
                WHERE c.relname = 'workflow_executions'
                AND a.attname = 'version_number'
                AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            """)
            
            result = cur.fetchone()
            if result and result[0]:
                print(f"     ✅ Column comment: {result[0]}")
            else:
                print("     ⚠️  No column comment found")
            
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error verifying migration: {e}")
        return False

def main():
    """Main function to run the migration."""
    print("🚀 Starting version_number column migration...")
    print("=" * 50)
    
    # Run migration
    if not run_migration_file():
        print("❌ Migration failed!")
        sys.exit(1)
    
    # Verify results
    if not verify_migration():
        print("❌ Migration verification failed!")
        sys.exit(1)
    
    print("=" * 50)
    print("✅ Migration completed successfully!")
    print("🎯 The workflow_executions table now has a version_number column")
    print("📋 You can now track which version was used for each execution")

if __name__ == "__main__":
    main() 