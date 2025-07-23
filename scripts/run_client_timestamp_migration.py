#!/usr/bin/env python3
"""
Run Client Timestamp Migration

This script adds a dedicated client_timestamp column to the low_level_events table
and creates performance indexes for better timestamp-based queries.

Usage: python scripts/run_client_timestamp_migration.py
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

def main():
    print("🚀 Starting client_timestamp migration...")
    print("   This will add client_timestamp column and indexes to low_level_events table")
    print("   for better performance on timestamp-based queries.")
    print()

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        print("🚀 Running client_timestamp migration...")
        
        # Read and execute migration
        migration_file = 'supabase/migrations/20250114000001_add_client_timestamp_to_low_level_events.sql'
        print(f"📄 Reading migration file: {migration_file}")
        
        with open(migration_file, 'r') as f:
            migration_sql = f.read()
        
        print(f"📄 Read migration file ({len(migration_sql)} characters)")
        print("🔄 Executing migration...")
        
        cur.execute(migration_sql)
        print("✅ Migration executed successfully!")
        
        print()
        print("🔍 Verifying migration results...")
        
        # Check if column was added
        cur.execute("""
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'low_level_events' 
            AND column_name = 'client_timestamp'
        """)
        
        column_info = cur.fetchone()
        if column_info:
            print(f"✅ Column 'client_timestamp' added successfully")
            print(f"   Type: {column_info[1]}, Nullable: {column_info[2]}")
        else:
            print("❌ Column 'client_timestamp' not found!")
            return
        
        # Check indexes
        cur.execute("""
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'low_level_events' 
            AND indexname LIKE '%client_timestamp%'
        """)
        
        indexes = cur.fetchall()
        print(f"📋 Found {len(indexes)} client_timestamp indexes:")
        for idx in indexes:
            print(f"   - {idx[0]}")
        
        # Check data population
        cur.execute("""
            SELECT 
                COUNT(*) as total_events,
                COUNT(client_timestamp) as events_with_timestamp,
                COUNT(CASE WHEN client_timestamp IS NULL THEN 1 END) as events_without_timestamp
            FROM low_level_events
        """)
        
        stats = cur.fetchone()
        if stats:
            print(f"📊 Data population status:")
            print(f"   Total events: {stats[0]}")
            print(f"   Events with client_timestamp: {stats[1]}")
            print(f"   Events without client_timestamp: {stats[2]}")
            
            if stats[2] > 0:
                print(f"⚠️  {stats[2]} events still have NULL client_timestamp")
            else:
                print("✅ All events have client_timestamp populated!")
        
        print()
        print("✅ Migration verification completed successfully!")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

    print("✅ Migration completed successfully!")
    print("   The low_level_events table now has a dedicated client_timestamp column")
    print("   with proper indexes for better performance.")

if __name__ == "__main__":
    main() 