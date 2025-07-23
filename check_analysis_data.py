#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime, timedelta

def check_analysis_data():
    """Check if analysis records exist for timeline mapping"""
    
    # Connect to database
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    # User with detailed workflows
    user_id = "22f84efc-3049-2fb8-22f8-4efc30492fb8"
    
    print(f"🔍 Checking analysis data for user: {user_id}")
    print("=" * 60)
    
    # Get the batch time window we analyzed before
    print("📊 Step 1: Getting UI tree events (batch boundaries)...")
    cursor.execute("""
        SELECT id, created_at, event_type
        FROM low_level_events_enriched
        WHERE user_id = %s AND event_type = 'ui_tree'
        ORDER BY created_at DESC 
        LIMIT 2
    """, (user_id,))
    
    ui_tree_events = cursor.fetchall()
    start_time = ui_tree_events[1][1]  # Second newest (older)
    end_time = ui_tree_events[0][1]    # Newest
    
    print(f"Batch time window:")
    print(f"  Start: {start_time}")
    print(f"  End:   {end_time}")
    
    # Check for analysis records (what the endpoint needs)
    print(f"\n🔍 Step 2: Checking for analysis records...")
    
    # The endpoint uses a 30-minute window around the end time
    time_window = 1800  # 30 minutes in seconds
    before_time = end_time - timedelta(seconds=time_window)
    after_time = end_time + timedelta(seconds=time_window)
    
    print(f"Analysis search window (±30 min from end time):")
    print(f"  Before: {before_time}")
    print(f"  After:  {after_time}")
    
    cursor.execute("""
        SELECT id, created_at, window_title, 
               CASE WHEN llm_structured_output IS NOT NULL THEN 'Yes' ELSE 'No' END as has_analysis
        FROM low_level_workflow_analyses
        WHERE user_id = %s 
        AND created_at >= %s 
        AND created_at <= %s
        ORDER BY created_at ASC
    """, (user_id, before_time.isoformat(), after_time.isoformat()))
    
    analysis_records = cursor.fetchall()
    
    print(f"\nFound {len(analysis_records)} analysis records in search window:")
    for analysis_id, created_at, window_title, has_analysis in analysis_records:
        print(f"  Analysis {analysis_id}: {created_at}")
        print(f"    Window: {window_title}")
        print(f"    Has LLM analysis: {has_analysis}")
    
    if len(analysis_records) == 0:
        print("❌ NO ANALYSIS RECORDS FOUND - This explains why timeline mapping fails!")
        
        # Check if there are ANY analysis records for this user
        print(f"\n🔍 Step 3: Checking ALL analysis records for this user...")
        cursor.execute("""
            SELECT COUNT(*) as total_count,
                   MIN(created_at) as earliest,
                   MAX(created_at) as latest
            FROM low_level_workflow_analyses
            WHERE user_id = %s
        """, (user_id,))
        
        total_analysis = cursor.fetchone()
        total_count, earliest, latest = total_analysis
        
        print(f"Total analysis records for user: {total_count}")
        if total_count > 0:
            print(f"  Earliest: {earliest}")
            print(f"  Latest:   {latest}")
            print(f"\n📊 Analysis records exist but not in the required time window!")
            print(f"💡 This suggests the UI tree events and analysis records are from different time periods.")
        else:
            print(f"❌ No analysis records exist for this user at all!")
    else:
        print("✅ Analysis records found - timeline mapping should work!")
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    check_analysis_data() 