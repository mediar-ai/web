#!/usr/bin/env python3

import psycopg2
from datetime import datetime

def fix_synthesis_id_autoincrement():
    """
    Fix the saved_workflow_syntheses table to have an auto-incrementing id column
    """
    
    # Database connection
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    try:
        print("🔧 Starting saved_workflow_syntheses id column fix...")
        
        # Create a sequence for the id column
        print("1. Creating sequence for id column...")
        cursor.execute("""
            CREATE SEQUENCE IF NOT EXISTS saved_workflow_syntheses_id_seq;
        """)
        
        # Set the sequence ownership to the id column
        print("2. Setting sequence ownership...")
        cursor.execute("""
            ALTER SEQUENCE saved_workflow_syntheses_id_seq OWNED BY saved_workflow_syntheses.id;
        """)
        
        # Set the default value for the id column to use the sequence
        print("3. Setting default value for id column...")
        cursor.execute("""
            ALTER TABLE saved_workflow_syntheses ALTER COLUMN id SET DEFAULT nextval('saved_workflow_syntheses_id_seq');
        """)
        
        # Update the sequence to start from a higher value to avoid conflicts
        print("4. Updating sequence starting value...")
        cursor.execute("""
            SELECT setval('saved_workflow_syntheses_id_seq', COALESCE(MAX(id), 0) + 1, false) FROM saved_workflow_syntheses;
        """)
        
        # Commit the changes
        conn.commit()
        
        print("✅ Successfully fixed saved_workflow_syntheses id column!")
        print(f"   - Created sequence: saved_workflow_syntheses_id_seq")
        print(f"   - Set default value for id column")
        print(f"   - Updated sequence starting value")
        
        # Test the fix by checking the column default
        cursor.execute("""
            SELECT column_default 
            FROM information_schema.columns 
            WHERE table_name = 'saved_workflow_syntheses' 
            AND column_name = 'id';
        """)
        
        default_value = cursor.fetchone()[0]
        print(f"✅ Verified: id column default is now: {default_value}")
        
        print(f"\n🎉 Migration completed successfully at {datetime.now()}")
        
    except Exception as e:
        print(f"❌ Error during migration: {e}")
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    fix_synthesis_id_autoincrement() 