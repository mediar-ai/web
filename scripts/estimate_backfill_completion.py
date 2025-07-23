#!/usr/bin/env python3

import psycopg2
import os
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def estimate_completion():
    # Database connection
    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        database="postgres", 
        user="postgres.eshwntsgsputksqamckh",
        password="dS64xX6mU3E4Sbyc",
        port="5432"
    )
    
    cursor = conn.cursor()
    
    try:
        # Check total events
        cursor.execute("SELECT COUNT(*) FROM low_level_events")
        total_events = cursor.fetchone()[0]
        
        # Check processed events  
        cursor.execute("SELECT COUNT(*) FROM low_level_events_metadata")
        processed_events = cursor.fetchone()[0]
        
        # Check processing rate (events added in last hour)
        one_hour_ago = datetime.now() - timedelta(hours=1)
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events_metadata 
            WHERE extracted_at >= %s
        """, (one_hour_ago,))
        recent_processed = cursor.fetchone()[0]
        
        # Calculate progress
        progress_percent = (processed_events / total_events * 100) if total_events > 0 else 0
        remaining = total_events - processed_events
        
        print(f"📊 Backfill Progress Analysis:")
        print(f"   Total events: {total_events:,}")
        print(f"   Processed: {processed_events:,}")
        print(f"   Progress: {progress_percent:.2f}%")
        print(f"   Remaining: {remaining:,}")
        print()
        
        # Processing rate analysis
        print(f"📈 Processing Rate:")
        print(f"   Last hour: {recent_processed:,} events")
        print(f"   Rate: {recent_processed}/hour")
        
        if recent_processed > 0:
            hours_remaining = remaining / recent_processed
            completion_time = datetime.now() + timedelta(hours=hours_remaining)
            
            print(f"   Estimated completion: {completion_time.strftime('%Y-%m-%d %H:%M')}")
            if hours_remaining < 24:
                print(f"   Time remaining: ~{hours_remaining:.1f} hours")
            else:
                print(f"   Time remaining: ~{hours_remaining/24:.1f} days")
        else:
            print("   ⚠️ No recent processing detected - may have stalled")
            
        # Check if we have enough for testing
        if processed_events > 50000:  # 50k events should be enough for testing
            print("\n✅ Sufficient data available for testing with metadata table!")
        elif processed_events > 10000:
            print("\n🔄 Good amount of data for limited testing")
        else:
            print("\n⏳ Still early stages...")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    estimate_completion() 