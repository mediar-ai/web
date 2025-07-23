#!/usr/bin/env python3
"""
Run Raw Timeline Annotations Migration

This script runs the migration to create the raw_timeline_event_annotations table
for mapping raw events to workflow analyses.

Usage: python scripts/run_raw_timeline_migration.py
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Load environment variables
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

def check_existing_table():
    """Check if the raw_timeline_event_annotations table already exists."""
    print("🔍 Checking if raw_timeline_event_annotations table exists...")
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if table exists
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'raw_timeline_event_annotations'
            );
        """)
        
        exists = cur.fetchone()[0]
        cur.close()
        conn.close()
        
        if exists:
            print("   ⚠️  Table raw_timeline_event_annotations already exists!")
            return True
        else:
            print("   ✅ Table does not exist, migration needed.")
            return False
            
    except Exception as e:
        print(f"   ❌ Error checking table: {e}")
        return False

def run_migration_file():
    """Run the raw timeline annotations migration file."""
    print("🚀 Running raw timeline annotations migration file...")
    
    migration_file = 'supabase/migrations/20250114000000_create_raw_timeline_annotations.sql'
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False
        
    if check_existing_table():
        response = input("   Continue with migration anyway? (y/N): ")
        if response.lower() != 'y':
            print("❌ Migration aborted by user.")
            return False
            
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Read the migration file
        with open(migration_file, 'r', encoding='utf-8') as file:
            migration_sql = file.read()
            
        print(f"   📄 Read migration file ({len(migration_sql)} characters)")
        
        # Execute the entire migration as one transaction
        try:
            print("   🔄 Executing migration...")
            cur.execute(migration_sql)
            conn.commit()
            print("   ✅ Migration executed successfully!")
            
        except psycopg2.Error as e:
            error_msg = str(e).strip()
            if "already exists" in error_msg.lower():
                print("   ✅ Migration appears to be already applied!")
            else:
                print(f"   ❌ Migration error: {error_msg}")
                return False
                
        cur.close()
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
        cur = conn.cursor()
        
        # Check if table was created
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'raw_timeline_event_annotations'
            );
        """)
        table_exists = cur.fetchone()[0]
        print(f"   📋 Table exists: {table_exists}")
        
        if not table_exists:
            print("   ❌ Table was not created!")
            return False
            
        # Check table structure
        cur.execute("""
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'raw_timeline_event_annotations'
            ORDER BY ordinal_position;
        """)
        columns = cur.fetchall()
        print(f"   📋 Table has {len(columns)} columns:")
        
        expected_columns = [
            'id', 'raw_event_id', 'analysis_id', 'is_workflow_related',
            'user_action', 'ui_element_interacted', 'content_change', 
            'timestamp_context', 'unrelated_reason', 'confidence_score',
            'model_used', 'user_id', 'session_id', 'created_at', 'updated_at'
        ]
        
        actual_columns = [col[0] for col in columns]
        for expected in expected_columns:
            if expected in actual_columns:
                print(f"   ✅ Column '{expected}' exists")
            else:
                print(f"   ❌ Column '{expected}' missing!")
                return False
                
        # Check indexes
        cur.execute("""
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'raw_timeline_event_annotations'
            AND schemaname = 'public';
        """)
        indexes = cur.fetchall()
        print(f"   📋 Found {len(indexes)} indexes:")
        for idx in indexes:
            print(f"      - {idx[0]}")
            
        # Check foreign key constraints
        cur.execute("""
            SELECT constraint_name, constraint_type
            FROM information_schema.table_constraints 
            WHERE table_schema = 'public' 
            AND table_name = 'raw_timeline_event_annotations'
            AND constraint_type = 'FOREIGN KEY';
        """)
        fks = cur.fetchall()
        print(f"   📋 Found {len(fks)} foreign key constraints:")
        for fk in fks:
            print(f"      - {fk[0]}")
            
        cur.close()
        conn.close()
        
        print("   ✅ Migration verification completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Error verifying migration: {e}")
        return False

def main():
    """Main function to run the migration."""
    print("🚀 Starting raw timeline annotations migration...")
    print("   This will create the raw_timeline_event_annotations table")
    print("   for mapping raw events to workflow analyses.\n")
    
    # Run migration
    if not run_migration_file():
        print("❌ Migration failed!")
        sys.exit(1)
        
    # Verify migration
    if not verify_migration():
        print("❌ Migration verification failed!")
        sys.exit(1)
        
    print("✅ Migration completed successfully!")
    print("   The raw_timeline_event_annotations table is now ready to use.")

if __name__ == "__main__":
    main() 