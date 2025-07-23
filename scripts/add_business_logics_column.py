#!/usr/bin/env python3

import psycopg2
from datetime import datetime

def add_business_logics_column():
    """
    Add business_logics column to raw_timeline_event_annotations table
    Safe migration - only adds one column, doesn't touch other tables
    """
    
    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        database="postgres", 
        user="postgres.eshwntsgsputksqamckh",
        password="dS64xX6mU3E4Sbyc",
        port="5432"
    )
    
    cursor = conn.cursor()
    
    try:
        print("🔄 Starting migration: Add business_logics column")
        print("=" * 80)
        
        # Check if column already exists
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'raw_timeline_event_annotations' 
            AND column_name = 'business_logics'
        """)
        
        existing_column = cursor.fetchone()
        
        if existing_column:
            print("✅ business_logics column already exists - no migration needed")
            return
        
        print("📝 Adding business_logics column to raw_timeline_event_annotations...")
        
        # Add the column
        cursor.execute("""
            ALTER TABLE raw_timeline_event_annotations 
            ADD COLUMN business_logics text
        """)
        
        # Add comment for documentation
        cursor.execute("""
            COMMENT ON COLUMN raw_timeline_event_annotations.business_logics 
            IS 'Business rules or logic governing this event (e.g., "Must verify email before proceeding", "Only available during business hours")'
        """)
        
        conn.commit()
        print("✅ Successfully added business_logics column")
        
        # Verify the column was added
        cursor.execute("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'raw_timeline_event_annotations' 
            AND column_name = 'business_logics'
        """)
        
        verification = cursor.fetchone()
        if verification:
            col_name, data_type, nullable = verification
            print(f"🔍 Verification: {col_name} ({data_type}, nullable: {nullable})")
        else:
            print("❌ Verification failed - column not found after creation")
            
        print("=" * 80)
        print("🎉 Migration completed successfully!")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    add_business_logics_column() 