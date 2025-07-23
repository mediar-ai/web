#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime

def debug_batch_events():
    """Debug why timeline mapping batches are empty"""
    
    # Connect to database
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    # User with detailed workflows
    user_id = "22f84efc-3049-2fb8-22f8-4efc30492fb8"
    
    print(f"🔍 Debugging batch events for user: {user_id}")
    print("=" * 60)
    
    # Get UI tree events (batch boundaries)
    print("📊 Step 1: Getting UI tree events (batch boundaries)...")
    cursor.execute("""
        SELECT id, created_at, event_type
        FROM low_level_events_enriched
        WHERE user_id = %s AND event_type = 'ui_tree'
        ORDER BY created_at DESC 
        LIMIT 5
    """, (user_id,))
    
    ui_tree_events = cursor.fetchall()
    print(f"Found {len(ui_tree_events)} UI tree events:")
    for i, (event_id, created_at, event_type) in enumerate(ui_tree_events):
        print(f"  {i+1}. Event {event_id}: {created_at} ({event_type})")
    
    if len(ui_tree_events) < 2:
        print("❌ Need at least 2 UI tree events for batch analysis")
        return
    
    # Analyze first batch (between first two UI tree events)
    start_time = ui_tree_events[1][1]  # Second newest (older)
    end_time = ui_tree_events[0][1]    # Newest
    
    print(f"\n📦 Step 2: Analyzing batch between:")
    print(f"  Start: {start_time}")
    print(f"  End:   {end_time}")
    
    # Check all events in this time range
    print(f"\n🔍 Step 3: Checking ALL events in time range...")
    cursor.execute("""
        SELECT event_type, COUNT(*) as count
        FROM low_level_events_enriched
        WHERE user_id = %s 
        AND created_at >= %s 
        AND created_at < %s
        GROUP BY event_type
        ORDER BY count DESC
    """, (user_id, start_time, end_time))
    
    event_type_counts = cursor.fetchall()
    total_events = sum(count for _, count in event_type_counts)
    
    print(f"Total events in batch: {total_events}")
    for event_type, count in event_type_counts:
        print(f"  - {event_type}: {count}")
    
    # Check events after filtering (what the endpoint actually gets)
    print(f"\n🔍 Step 4: Checking events AFTER filtering (like endpoint)...")
    cursor.execute("""
        SELECT event_type, COUNT(*) as count
        FROM low_level_events_enriched
        WHERE user_id = %s 
        AND created_at >= %s 
        AND created_at < %s
        AND event_type != 'screenshot_diff'  -- This is the filter in endpoint
        GROUP BY event_type
        ORDER BY count DESC
    """, (user_id, start_time, end_time))
    
    filtered_counts = cursor.fetchall()
    filtered_total = sum(count for _, count in filtered_counts)
    
    print(f"Filtered events in batch: {filtered_total}")
    for event_type, count in filtered_counts:
        print(f"  - {event_type}: {count}")
    
    # Sample a few events to see their structure
    if filtered_total > 0:
        print(f"\n📝 Step 5: Sample events (first 3)...")
        cursor.execute("""
            SELECT id, created_at, event_type, app_name, has_ui_tree
            FROM low_level_events_enriched
            WHERE user_id = %s 
            AND created_at >= %s 
            AND created_at < %s
            AND event_type != 'screenshot_diff'
            ORDER BY created_at ASC
            LIMIT 3
        """, (user_id, start_time, end_time))
        
        sample_events = cursor.fetchall()
        for event_id, created_at, event_type, app_name, has_ui_tree in sample_events:
            print(f"  Event {event_id}: {created_at}")
            print(f"    Type: {event_type}, App: {app_name}, UI Tree: {has_ui_tree}")
    else:
        print("❌ No events found after filtering - this explains the empty batch!")
        
        # Check what got filtered out
        print(f"\n🔍 What got filtered out?")
        cursor.execute("""
            SELECT event_type, COUNT(*) as count
            FROM low_level_events_enriched
            WHERE user_id = %s 
            AND created_at >= %s 
            AND created_at < %s
            AND event_type = 'screenshot_diff'  -- What we filtered OUT
            GROUP BY event_type
        """, (user_id, start_time, end_time))
        
        filtered_out = cursor.fetchall()
        for event_type, count in filtered_out:
            print(f"  Filtered out: {event_type} ({count} events)")
    
    # Check if there are events in a wider time range
    print(f"\n🔍 Step 6: Checking wider time range (±1 hour)...")
    from datetime import timedelta
    wider_start = start_time - timedelta(hours=1)
    wider_end = end_time + timedelta(hours=1)
    
    cursor.execute("""
        SELECT COUNT(*) as count
        FROM low_level_events_enriched
        WHERE user_id = %s 
        AND created_at >= %s 
        AND created_at < %s
        AND event_type != 'screenshot_diff'
    """, (user_id, wider_start, wider_end))
    
    wider_count = cursor.fetchone()[0]
    print(f"Events in wider range (±1h): {wider_count}")
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    debug_batch_events() 