#!/usr/bin/env python3

import psycopg2
import time

def time_query(cursor, description, query, params=None):
    """Time a database query and return results."""
    print(f"\n⏱️  {description}")
    start_time = time.time()
    try:
        cursor.execute(query, params)
        results = cursor.fetchall()
        elapsed = time.time() - start_time
        print(f"✅ {elapsed:.2f}s - {len(results)} results")
        return results
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"❌ {elapsed:.2f}s - Error: {e}")
        return []

def main():
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    # Connect to database
    print("🔗 Connecting to database...")
    start_time = time.time()
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    elapsed = time.time() - start_time
    print(f"✅ Connected in {elapsed:.2f}s")
    
    # Test 1: Basic count query
    time_query(cursor, "Test 1: Count total events for user", 
        "SELECT COUNT(*) FROM low_level_events WHERE user_id = %s", (user_id,))
    
    # Test 2: Count UI tree events
    time_query(cursor, "Test 2: Count UI tree events", 
        "SELECT COUNT(*) FROM low_level_events WHERE user_id = %s AND payload->'payload'->>'type' = 'ui_tree'", (user_id,))
    
    # Test 3: Get 3 recent UI tree events
    results = time_query(cursor, "Test 3: Get 3 recent UI tree events", 
        "SELECT id, created_at FROM low_level_events WHERE user_id = %s AND payload->'payload'->>'type' = 'ui_tree' ORDER BY created_at DESC LIMIT 3", (user_id,))
    
    if len(results) >= 2:
        # Use the two most recent UI tree events for batch testing
        end_time = results[0][1]    # Most recent
        start_time = results[1][1]  # Second most recent
        
        print(f"\n📦 Using time range: {start_time} → {end_time}")
        
        # Test 4: Count events in batch
        time_query(cursor, "Test 4: Count events in small batch", 
            "SELECT COUNT(*) FROM low_level_events WHERE user_id = %s AND created_at >= %s AND created_at < %s", 
            (user_id, start_time, end_time))
        
        # Test 5: Get 5 events from batch
        batch_events = time_query(cursor, "Test 5: Get 5 events from batch", 
            "SELECT id, created_at, payload->'payload'->>'type' as event_type FROM low_level_events WHERE user_id = %s AND created_at >= %s AND created_at < %s ORDER BY created_at ASC LIMIT 5", 
            (user_id, start_time, end_time))
        
        for event in batch_events:
            print(f"  - Event {event[0]} ({event[1]}): {event[2]}")
        
        # Test 6: Check for analysis
        time_query(cursor, "Test 6: Check for corresponding analysis", 
            "SELECT id, window_title FROM low_level_workflow_analyses WHERE user_id = %s AND client_timestamp = %s", 
            (user_id, end_time))
    
    # Test 7: Count total analyses
    time_query(cursor, "Test 7: Count total analyses for user", 
        "SELECT COUNT(*) FROM low_level_workflow_analyses WHERE user_id = %s", (user_id,))
    
    # Test 8: Check what confidence scores look like in existing annotations
    existing_annotations = time_query(cursor, "Test 8: Sample existing timeline annotations", 
        "SELECT raw_event_id, confidence_score, is_workflow_related, workflow_step FROM raw_timeline_event_annotations WHERE user_id = %s LIMIT 5", (user_id,))
    
    if existing_annotations:
        print(f"\n💡 Sample confidence scores:")
        for annotation in existing_annotations:
            confidence = annotation[1]
            is_related = annotation[2]
            step = annotation[3] or 'none'
            print(f"  - Event {annotation[0]}: confidence={confidence:.2f}, related={is_related}, step='{step}'")
        
        # Show the 0.5 threshold in action
        above_threshold = [a for a in existing_annotations if a[1] > 0.5]
        below_threshold = [a for a in existing_annotations if a[1] <= 0.5]
        print(f"\n📊 In this sample:")
        print(f"  - {len(above_threshold)} events with confidence > 0.5 (workflow-related)")
        print(f"  - {len(below_threshold)} events with confidence ≤ 0.5 (unrelated)")
    else:
        print(f"\n📋 No existing timeline annotations found")
    
    cursor.close()
    conn.close()
    print(f"\n🎉 Performance test complete!")

if __name__ == "__main__":
    main() 