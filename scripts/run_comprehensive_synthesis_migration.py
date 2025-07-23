#!/usr/bin/env python3

import psycopg2
import os
from datetime import datetime

def run_comprehensive_synthesis_migration():
    """
    Run the comprehensive synthesis storage migration
    Creates saved_workflow_syntheses table for storing complete synthesis process data
    """
    
    # Database connection
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    try:
        print("🚀 Starting comprehensive synthesis storage migration...")
        
        # Read the migration SQL file
        migration_file = "supabase/migrations/20250122000001_add_comprehensive_synthesis_storage.sql"
        with open(migration_file, 'r') as f:
            migration_sql = f.read()
        
        print(f"📄 Read migration SQL from {migration_file}")
        
        # Execute the migration
        print("⚡ Executing migration...")
        cursor.execute(migration_sql)
        
        # Commit the changes
        conn.commit()
        print("✅ Migration executed successfully!")
        
        # Verify the table was created
        cursor.execute("""
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'saved_workflow_syntheses'
            ORDER BY ordinal_position;
        """)
        
        columns = cursor.fetchall()
        print(f"\n📋 Created table 'saved_workflow_syntheses' with {len(columns)} columns:")
        for table_name, column_name, data_type in columns:
            print(f"  • {column_name}: {data_type}")
        
        # Check indexes
        cursor.execute("""
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'saved_workflow_syntheses';
        """)
        
        indexes = cursor.fetchall()
        print(f"\n🔍 Created {len(indexes)} indexes:")
        for index_name, index_def in indexes:
            print(f"  • {index_name}")
        
        print(f"\n🎉 Comprehensive synthesis storage migration completed at {datetime.now()}")
        print("📝 This table will store complete workflow synthesis processes including:")
        print("   - Step 1: Context & Setup")
        print("   - Step 2: Identified Workflows") 
        print("   - Step 3: Workflow Boundaries")
        print("   - Steps 4-5: Conversation & Results")
        print("   - Metadata: Models, tokens, duration, timestamps")
        
    except Exception as e:
        print(f"❌ Error running migration: {e}")
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    run_comprehensive_synthesis_migration() 