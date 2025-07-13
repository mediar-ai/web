#!/usr/bin/env python3
"""
Removes tags and difficulty_level columns from deployed_workflows table.
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
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def check_columns_exist(conn):
    """Check if tags and difficulty_level columns exist."""
    print("🔍 Checking if columns exist...")
    
    with conn.cursor() as cur:
        # Check for tags column
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows' 
                AND column_name = 'tags'
            );
        """)
        tags_exists = cur.fetchone()[0]
        
        # Check for difficulty_level column
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows' 
                AND column_name = 'difficulty_level'
            );
        """)
        difficulty_exists = cur.fetchone()[0]
        
        return tags_exists, difficulty_exists

def drop_index_if_exists(conn):
    """Drop the index on tags column if it exists."""
    print("🗑️ Dropping index on tags column...")
    
    with conn.cursor() as cur:
        try:
            cur.execute('DROP INDEX IF EXISTS "idx_deployed_workflows_tags";')
            print("   ✅ Index dropped (or didn't exist)")
        except Exception as e:
            print(f"   ⚠️ Warning dropping index: {e}")

def remove_columns(conn):
    """Remove the tags and difficulty_level columns."""
    print("🗑️ Removing columns...")
    
    with conn.cursor() as cur:
        try:
            cur.execute("""
                ALTER TABLE "public"."deployed_workflows"
                DROP COLUMN IF EXISTS tags,
                DROP COLUMN IF EXISTS difficulty_level;
            """)
            print("   ✅ Columns removed successfully")
        except Exception as e:
            print(f"   ❌ Error removing columns: {e}")
            raise

def verify_removal(conn):
    """Verify that the columns have been removed."""
    print("✅ Verifying column removal...")
    
    tags_exists, difficulty_exists = check_columns_exist(conn)
    
    if not tags_exists and not difficulty_exists:
        print("   ✅ Both columns successfully removed")
        return True
    else:
        if tags_exists:
            print("   ❌ 'tags' column still exists")
        if difficulty_exists:
            print("   ❌ 'difficulty_level' column still exists")
        return False

def main():
    print("🚀 Starting migration: Remove tags and difficulty_level columns")
    print("=" * 60)
    
    try:
        # Connect to database
        print("🔌 Connecting to database...")
        conn = get_db_connection()
        print("   ✅ Connected successfully")
        
        # Check current state
        tags_exists, difficulty_exists = check_columns_exist(conn)
        
        if not tags_exists and not difficulty_exists:
            print("   ✅ Migration already completed - columns do not exist")
            return
        
        print(f"   📊 Current state:")
        print(f"      - tags column exists: {tags_exists}")
        print(f"      - difficulty_level column exists: {difficulty_exists}")
        
        # Perform migration
        if tags_exists or difficulty_exists:
            drop_index_if_exists(conn)
            remove_columns(conn)
            
            # Verify the changes
            if verify_removal(conn):
                print("\n🎉 Migration completed successfully!")
                print("📊 Summary:")
                print("   - Removed 'tags' column")
                print("   - Removed 'difficulty_level' column")
                print("   - Dropped associated indexes")
            else:
                print("\n❌ Migration verification failed")
                sys.exit(1)
        
        conn.close()
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 