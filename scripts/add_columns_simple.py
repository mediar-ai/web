#!/usr/bin/env python3
"""
Simple column addition - adds columns one by one with basic ALTER TABLE commands.
"""

import psycopg2
from datetime import datetime

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def add_column_if_not_exists(conn, column_name, column_definition):
    """Add a column if it doesn't exist."""
    cursor = conn.cursor()
    
    try:
        # Check if column exists
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'low_level_events' 
            AND column_name = %s
        """, (column_name,))
        
        if cursor.fetchone():
            print(f"   ✅ Column '{column_name}' already exists - skipping")
            return True
        
        # Add the column
        sql = f"ALTER TABLE low_level_events ADD COLUMN {column_name} {column_definition};"
        print(f"   🔄 Adding column: {sql}")
        
        cursor.execute(sql)
        conn.commit()
        
        print(f"   ✅ Successfully added column '{column_name}'")
        return True
        
    except Exception as e:
        print(f"   ❌ Failed to add column '{column_name}': {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()

def main():
    print("🚀 Simple Column Addition")
    print(f"⏰ Started at: {datetime.now()}")
    print("=" * 40)
    
    conn = get_connection()
    
    try:
        # Define columns to add
        columns = [
            ("event_type", "TEXT"),
            ("app_name", "TEXT"), 
            ("has_ui_tree", "BOOLEAN DEFAULT FALSE"),
            ("screenshot_timestamp", "TIMESTAMPTZ")
        ]
        
        print("\n📊 Adding columns to low_level_events table...")
        
        all_success = True
        for column_name, column_def in columns:
            success = add_column_if_not_exists(conn, column_name, column_def)
            if not success:
                all_success = False
                break
        
        if all_success:
            print(f"\n🎉 All columns added successfully!")
            print("📋 Next step: python scripts/backfill_extracted_fields.py")
        else:
            print(f"\n💥 Some columns failed to add - check errors above")
        
        return all_success
        
    except Exception as e:
        print(f"💥 Fatal error: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    success = main()
    if success:
        print("\n✅ Ready for backfill!")
    else:
        print("\n❌ Check errors above") 