#!/usr/bin/env python3
"""
Safe migration runner - applies SQL migrations directly without database resets.
"""

import psycopg2
import os
from datetime import datetime

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def run_migration_file(conn, migration_file, description):
    """Run a single migration file safely."""
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

def check_column_exists(conn, column_name):
    """Check if a column already exists."""
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'low_level_events' 
            AND column_name = %s
        """, (column_name,))
        return cursor.fetchone() is not None
    finally:
        cursor.close()

def main():
    print("🚀 Safe Payload Extraction Migration")
    print(f"⏰ Started at: {datetime.now()}")
    print("=" * 50)
    
    conn = get_connection()
    
    try:
        # Check current state
        print("\n🔍 Checking current database state...")
        
        columns_to_check = ['event_type', 'app_name', 'has_ui_tree', 'screenshot_timestamp']
        existing_columns = []
        
        for col in columns_to_check:
            if check_column_exists(conn, col):
                existing_columns.append(col)
                print(f"   ✅ Column '{col}' already exists")
            else:
                print(f"   ❌ Column '{col}' needs to be added")
        
        # Define migrations
        migrations = [
            ("supabase/migrations/20250117000001_add_event_type_column.sql", "Add event_type column"),
            ("supabase/migrations/20250117000002_add_app_name_column.sql", "Add app_name column"),
            ("supabase/migrations/20250117000003_add_ui_and_screenshot_columns.sql", "Add UI and screenshot columns")
        ]
        
        print(f"\n📊 Running Schema Migrations...")
        print("=" * 40)
        
        # Run migrations
        all_success = True
        for migration_file, description in migrations:
            success = run_migration_file(conn, migration_file, description)
            if not success:
                all_success = False
                break
        
        if not all_success:
            print("\n💥 Migration failed! Check errors above.")
            return False
        
        print(f"\n🎉 Schema migrations completed successfully!")
        print("📋 Next steps:")
        print("   1. Run: python scripts/backfill_extracted_fields.py")
        print("   2. Apply final indexes migration")
        
        return True
        
    except Exception as e:
        print(f"💥 Fatal error: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    success = main()
    if success:
        print("\n✅ Ready for backfill phase!")
    else:
        print("\n❌ Migration failed - check errors above") 