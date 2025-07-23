#!/usr/bin/env python3
"""
Create a separate metadata table for extracted fields.
This avoids altering the massive low_level_events table.
"""

import psycopg2
from datetime import datetime

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def main():
    print("🚀 Creating Event Metadata Table")
    print(f"⏰ Started at: {datetime.now()}")
    print("=" * 40)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Create metadata table (lightweight, fast)
        table_sql = """
        CREATE TABLE IF NOT EXISTS low_level_events_metadata (
            event_id BIGINT PRIMARY KEY REFERENCES low_level_events(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            app_name TEXT,
            has_ui_tree BOOLEAN DEFAULT FALSE,
            screenshot_timestamp TIMESTAMPTZ,
            extracted_at TIMESTAMPTZ DEFAULT NOW()
        );
        """
        
        print("🔄 Creating low_level_events_metadata table...")
        cursor.execute(table_sql)
        conn.commit()
        print("✅ Metadata table created successfully!")
        
        # Create indexes separately
        indexes = [
            "CREATE INDEX IF NOT EXISTS idx_metadata_event_type ON low_level_events_metadata (event_type);",
            "CREATE INDEX IF NOT EXISTS idx_metadata_app_name ON low_level_events_metadata (app_name) WHERE app_name IS NOT NULL;",
            "CREATE INDEX IF NOT EXISTS idx_metadata_ui_tree ON low_level_events_metadata (has_ui_tree) WHERE has_ui_tree = true;",
            "CREATE INDEX IF NOT EXISTS idx_metadata_screenshot ON low_level_events_metadata (screenshot_timestamp) WHERE screenshot_timestamp IS NOT NULL;"
        ]
        
        print("🔄 Creating indexes...")
        for index_sql in indexes:
            cursor.execute(index_sql)
            conn.commit()
        print("✅ Indexes created successfully!")
        
        # Create a view that joins both tables
        view_sql = """
        CREATE OR REPLACE VIEW low_level_events_enriched AS
        SELECT 
            e.*,
            m.event_type,
            m.app_name,
            m.has_ui_tree,
            m.screenshot_timestamp
        FROM low_level_events e
        LEFT JOIN low_level_events_metadata m ON e.id = m.event_id;
        """
        
        print("🔄 Creating enriched view...")
        cursor.execute(view_sql)
        conn.commit()
        print("✅ Enriched view created successfully!")
        
        print("\n🎉 Setup complete!")
        print("📋 Next steps:")
        print("   1. Update API to use metadata table")
        print("   2. Backfill metadata for existing records")
        print("   3. Query via low_level_events_enriched view")
        
        return True
        
    except Exception as e:
        print(f"❌ Failed: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    success = main()
    if success:
        print("\n✅ Ready to use metadata approach!")
    else:
        print("\n❌ Check errors above") 