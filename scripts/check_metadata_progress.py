#!/usr/bin/env python3

import psycopg2
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def check_progress():
    # Database connection
    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        database="postgres", 
        user="postgres.eshwntsgsputksqamckh",
        password="***REMOVED***",
        port="5432"
    )
    
    cursor = conn.cursor()
    
    try:
        # Check if metadata table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'low_level_events_metadata'
            );
        """)
        table_exists = cursor.fetchone()[0]
        
        if not table_exists:
            print("❌ Metadata table doesn't exist yet")
            return
            
        print("✅ Metadata table exists")
        
        # Check total events
        cursor.execute("SELECT COUNT(*) FROM low_level_events")
        total_events = cursor.fetchone()[0]
        
        # Check processed events  
        cursor.execute("SELECT COUNT(*) FROM low_level_events_metadata")
        processed_events = cursor.fetchone()[0]
        
        # Calculate progress
        progress_percent = (processed_events / total_events * 100) if total_events > 0 else 0
        
        print(f"📊 Backfill Progress:")
        print(f"   Total events: {total_events:,}")
        print(f"   Processed: {processed_events:,}")
        print(f"   Progress: {progress_percent:.1f}%")
        print(f"   Remaining: {total_events - processed_events:,}")
        
        if progress_percent > 10:
            print("✅ Enough data available for testing!")
        else:
            print("⏳ Still processing...")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    check_progress() 