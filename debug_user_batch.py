#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime, timedelta

def debug_user_batch():
    """Debug batch processing for the specific user"""
    
    # Connect to database
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    # Target user
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    print(f"🔍 Debugging batch processing for user: {user_id}")
    print("=" * 60)
    
    # Get UI tree events (batch boundaries) - exactly what the endpoint does
    print("📊 Step 1: Getting UI tree events (like endpoint)...")
    cursor.execute("""
        SELECT id, created_at, payload
        FROM low_level_events_enriched
        WHERE user_id = %s 
        AND event_type = 'ui_tree'
        ORDER BY created_at DESC 
        LIMIT 2
    """, (user_id,))
    
    ui_tree_events = cursor.fetchall()
    
    print(f"Found {len(ui_tree_events)} UI tree events:")
    for i, (event_id, created_at, payload) in enumerate(ui_tree_events):
        print(f"  {i+1}. Event {event_id}: {created_at}")
    
    if len(ui_tree_events) < 2:
        print("❌ Need at least 2 UI tree events")
        return
    
    # Process first batch (like endpoint does)
    start_time = ui_tree_events[1][1]  # Second newest (older)
    end_time = ui_tree_events[0][1]    # Newest
    
    print(f"\n📦 Step 2: Processing batch (endpoint logic):")
    print(f"  Start: {start_time}")
    print(f"  End:   {end_time}")
    
    # Execute the EXACT query the endpoint uses
    print(f"\n🔍 Step 3: Running EXACT endpoint query...")
    print("Query:")
    print("  FROM: low_level_events_enriched")
    print("  WHERE: user_id = %s AND created_at >= %s AND created_at < %s AND event_type != 'screenshot_diff'")
    print("  LIMIT: 50")
    
    cursor.execute("""
        SELECT id, created_at, event_type, app_name, has_ui_tree, payload
        FROM low_level_events_enriched
        WHERE user_id = %s 
        AND created_at >= %s 
        AND created_at < %s
        AND event_type != 'screenshot_diff'
        ORDER BY created_at ASC
        LIMIT 50
    """, (user_id, start_time.isoformat(), end_time.isoformat()))
    
    batch_events = cursor.fetchall()
    
    print(f"\nQuery result: {len(batch_events)} events")
    
    if len(batch_events) == 0:
        print("❌ EMPTY BATCH - This explains why endpoint reports 'No events found'")
        
        # Debug: Check what's in the time range WITHOUT the filter
        print(f"\n🔍 Debug: Check time range WITHOUT filtering...")
        cursor.execute("""
            SELECT event_type, COUNT(*) as count
            FROM low_level_events_enriched
            WHERE user_id = %s 
            AND created_at >= %s 
            AND created_at < %s
            GROUP BY event_type
            ORDER BY count DESC
        """, (user_id, start_time.isoformat(), end_time.isoformat()))
        
        all_events_in_range = cursor.fetchall()
        total_in_range = sum(count for _, count in all_events_in_range)
        
        print(f"All events in time range: {total_in_range}")
        for event_type, count in all_events_in_range:
            print(f"  - {event_type}: {count}")
            
        if total_in_range == 0:
            print("❌ Time range is empty - UI tree events are too close together")
            time_diff = end_time - start_time
            print(f"Time difference: {time_diff.total_seconds()} seconds")
            
            if time_diff.total_seconds() < 60:
                print("💡 UI tree events are less than 1 minute apart - no other events in between")
    else:
        print("✅ Events found in batch:")
        for event_id, created_at, event_type, app_name, has_ui_tree, payload in batch_events:
            print(f"  Event {event_id}: {created_at} - {event_type}")
            print(f"    App: {app_name}, UI Tree: {has_ui_tree}")
        
        # Check if analysis exists for this batch
        print(f"\n🔍 Step 4: Checking for analysis records...")
        time_window = 1800  # 30 minutes in seconds
        before_time = end_time - timedelta(seconds=time_window)
        after_time = end_time + timedelta(seconds=time_window)
        
        cursor.execute("""
            SELECT id, created_at, window_title
            FROM low_level_workflow_analyses
            WHERE user_id = %s 
            AND created_at >= %s 
            AND created_at <= %s
            ORDER BY created_at ASC
            LIMIT 1
        """, (user_id, before_time.isoformat(), after_time.isoformat()))
        
        analysis_records = cursor.fetchall()
        
        if analysis_records:
            analysis_id, analysis_created_at, window_title = analysis_records[0]
            print(f"✅ Analysis found: {analysis_id} - {window_title}")
            print(f"   Created: {analysis_created_at}")
            print("🎯 This batch should proceed to LLM analysis!")
        else:
            print("❌ No analysis record found - this explains why mapping fails")
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    debug_user_batch() 