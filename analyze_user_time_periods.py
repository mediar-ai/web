#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime, timedelta

def analyze_user_time_periods():
    """Analyze multiple time periods for the user to find workable timeline mapping batches"""
    
    # Connect to database
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    # Target user
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    print(f"🔍 Comprehensive time period analysis for user: {user_id}")
    print("=" * 80)
    
    # Get ALL UI tree events for this user to analyze different time periods
    print("📊 Step 1: Getting ALL UI tree events...")
    cursor.execute("""
        SELECT id, created_at
        FROM low_level_events_enriched
        WHERE user_id = %s 
        AND event_type = 'ui_tree'
        ORDER BY created_at DESC 
        LIMIT 10  -- Analyze last 10 UI tree events
    """, (user_id,))
    
    ui_tree_events = cursor.fetchall()
    
    print(f"Found {len(ui_tree_events)} UI tree events:")
    for i, (event_id, created_at) in enumerate(ui_tree_events):
        print(f"  {i+1:2d}. Event {event_id}: {created_at}")
    
    if len(ui_tree_events) < 2:
        print("❌ Need at least 2 UI tree events")
        return
    
    # Analyze multiple consecutive time periods
    print(f"\n📦 Step 2: Analyzing consecutive time periods...")
    workable_batches = []
    
    for i in range(len(ui_tree_events) - 1):
        batch_num = i + 1
        end_time = ui_tree_events[i][1]      # Newer event
        start_time = ui_tree_events[i + 1][1] # Older event
        
        print(f"\n--- Batch {batch_num} ---")
        print(f"Time window: {start_time} → {end_time}")
        
        time_diff = end_time - start_time
        print(f"Duration: {time_diff.total_seconds():.0f} seconds ({time_diff.total_seconds()/60:.1f} minutes)")
        
        # Check events in this batch (same query as endpoint)
        cursor.execute("""
            SELECT id, created_at, event_type, app_name, has_ui_tree
            FROM low_level_events_enriched
            WHERE user_id = %s 
            AND created_at >= %s 
            AND created_at < %s
            AND event_type != 'screenshot_diff'
            ORDER BY created_at ASC
        """, (user_id, start_time.isoformat(), end_time.isoformat()))
        
        batch_events = cursor.fetchall()
        
        print(f"Events found: {len(batch_events)}")
        if len(batch_events) > 0:
            event_types = {}
            for event_id, created_at, event_type, app_name, has_ui_tree in batch_events:
                event_types[event_type] = event_types.get(event_type, 0) + 1
            
            print(f"  Event types: {dict(event_types)}")
            
            # Show sample events
            for event_id, created_at, event_type, app_name, has_ui_tree in batch_events[:3]:
                print(f"    {event_id}: {event_type} @ {created_at} (app: {app_name})")
            if len(batch_events) > 3:
                print(f"    ... and {len(batch_events) - 3} more events")
        
        # Check for analysis records in ±30 min window around end time
        time_window = 1800  # 30 minutes
        before_time = end_time - timedelta(seconds=time_window)
        after_time = end_time + timedelta(seconds=time_window)
        
        cursor.execute("""
            SELECT id, created_at, window_title,
                   CASE WHEN llm_structured_output IS NOT NULL THEN 'Yes' ELSE 'No' END as has_analysis
            FROM low_level_workflow_analyses
            WHERE user_id = %s 
            AND created_at >= %s 
            AND created_at <= %s
            ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - %s)))
            LIMIT 3
        """, (user_id, before_time.isoformat(), after_time.isoformat(), end_time.isoformat()))
        
        analysis_records = cursor.fetchall()
        
        print(f"Analysis records (±30min): {len(analysis_records)}")
        if analysis_records:
            for analysis_id, analysis_created_at, window_title, has_analysis in analysis_records:
                time_diff_analysis = abs((analysis_created_at - end_time).total_seconds())
                print(f"    {analysis_id}: {window_title[:50]}...")
                print(f"      Created: {analysis_created_at} (Δ{time_diff_analysis/60:.1f}min)")
                print(f"      Has LLM analysis: {has_analysis}")
        
        # Determine if this batch is workable
        is_workable = len(batch_events) > 0 and len(analysis_records) > 0
        
        if is_workable:
            workable_batches.append({
                'batch_num': batch_num,
                'start_time': start_time,
                'end_time': end_time,
                'event_count': len(batch_events),
                'analysis_count': len(analysis_records),
                'duration_minutes': time_diff.total_seconds() / 60
            })
            print(f"🎯 WORKABLE BATCH - Has both events and analysis!")
        else:
            reasons = []
            if len(batch_events) == 0:
                reasons.append("no events")
            if len(analysis_records) == 0:
                reasons.append("no analysis")
            print(f"❌ Not workable: {', '.join(reasons)}")
    
    # Summary of workable batches
    print(f"\n🎯 Summary: Workable Batches")
    print("=" * 50)
    
    if workable_batches:
        print(f"Found {len(workable_batches)} workable batches:")
        for batch in workable_batches:
            print(f"  Batch {batch['batch_num']}: {batch['event_count']} events, {batch['analysis_count']} analyses")
            print(f"    Duration: {batch['duration_minutes']:.1f} minutes")
            print(f"    Window: {batch['start_time']} → {batch['end_time']}")
        
        # Recommend best batch
        best_batch = max(workable_batches, key=lambda b: b['event_count'] * b['analysis_count'])
        print(f"\n🚀 RECOMMENDED: Batch {best_batch['batch_num']} ({best_batch['event_count']} events × {best_batch['analysis_count']} analyses)")
        
    else:
        print("❌ No workable batches found in recent time periods")
        
        # Check older time periods
        print(f"\n🔍 Checking older time periods...")
        cursor.execute("""
            SELECT id, created_at
            FROM low_level_events_enriched
            WHERE user_id = %s 
            AND event_type = 'ui_tree'
            ORDER BY created_at DESC 
            LIMIT 20 OFFSET 10  -- Get next 20 UI tree events (older)
        """, (user_id,))
        
        older_events = cursor.fetchall()
        print(f"Found {len(older_events)} older UI tree events")
        
        if older_events:
            print(f"Older events range: {older_events[-1][1]} → {older_events[0][1]}")
            
            # Check if there are analysis records in the older time periods
            oldest_time = older_events[-1][1]
            newest_time = older_events[0][1]
            
            cursor.execute("""
                SELECT COUNT(*) as analysis_count,
                       MIN(created_at) as earliest,
                       MAX(created_at) as latest
                FROM low_level_workflow_analyses
                WHERE user_id = %s 
                AND created_at >= %s 
                AND created_at <= %s
            """, (user_id, oldest_time.isoformat(), newest_time.isoformat()))
            
            older_analysis = cursor.fetchone()
            analysis_count, earliest, latest = older_analysis
            
            if analysis_count > 0:
                print(f"💡 Found {analysis_count} analysis records in older time period")
                print(f"   Range: {earliest} → {latest}")
                print(f"🔄 Consider running timeline mapping on older batches")
            else:
                print(f"❌ No analysis records in older time periods either")
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    analyze_user_time_periods() 