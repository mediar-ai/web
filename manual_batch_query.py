#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime

def main():
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    # Connect to database (same pattern as existing scripts)
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    print(f"🔍 Fetching batch data for user: {user_id}")
    
    # Step 1: Get UI tree events (batch boundaries)
    print("\n📊 Step 1: Getting UI tree events...")
    cursor.execute("""
        SELECT id, created_at
        FROM low_level_events 
        WHERE user_id = %s 
        AND payload->>'payload' IS NOT NULL
        AND payload->'payload'->>'type' = 'ui_tree'
        ORDER BY created_at ASC 
        LIMIT 5
    """, (user_id,))
    
    ui_tree_events = cursor.fetchall()
    print(f"Found {len(ui_tree_events)} UI tree events:")
    for event in ui_tree_events:
        print(f"  - Event {event[0]}: {event[1]}")
    
    if len(ui_tree_events) < 2:
        print("❌ Need at least 2 UI tree events to create a batch")
        return
    
    # Step 2: Get events for first batch
    start_time = ui_tree_events[0][1]  
    end_time = ui_tree_events[1][1]
    
    print(f"\n📦 Step 2: Getting batch events between {start_time} and {end_time}...")
    cursor.execute("""
        SELECT id, created_at, payload
        FROM low_level_events 
        WHERE user_id = %s 
        AND payload->>'payload' IS NOT NULL
        AND payload->'payload'->>'type' != 'screenshot_diff'
        AND created_at >= %s 
        AND created_at < %s
        ORDER BY created_at ASC 
        LIMIT 10
    """, (user_id, start_time, end_time))
    
    batch_events = cursor.fetchall()
    print(f"Found {len(batch_events)} events in first batch:")
    for event in batch_events:
        event_type = event[2].get('payload', {}).get('type', 'unknown')
        print(f"  - Event {event[0]} ({event[1]}): {event_type}")
    
    # Step 3: Get corresponding analysis
    print(f"\n🧠 Step 3: Getting analysis for timestamp {end_time}...")
    cursor.execute("""
        SELECT id, window_title, llm_structured_output
        FROM low_level_workflow_analyses 
        WHERE user_id = %s 
        AND client_timestamp = %s
        LIMIT 1
    """, (user_id, end_time))
    
    analysis = cursor.fetchone()
    if analysis:
        print(f"Found analysis {analysis[0]}:")
        print(f"  - Window: {analysis[1]}")
        print(f"  - Analysis: {json.dumps(analysis[2], indent=2)}")
    else:
        print("❌ No analysis found for this batch")
    
    # Step 4: Show what data would be sent to LLM
    print(f"\n🤖 Step 4: Data that would be sent to LLM...")
    print(f"Batch has {len(batch_events)} events")
    print(f"Analysis available: {'Yes' if analysis else 'No'}")
    
    if batch_events and analysis:
        print(f"✅ This batch is ready for LLM processing")
        
        # Show sample prompt structure
        print(f"\n📝 Sample prompt structure:")
        print(f"- Window: {analysis[1]}")
        print(f"- Events: {len(batch_events)} raw events")
        print(f"- Time range: {start_time} → {end_time}")
        
        # Show confidence score threshold info
        print(f"\n💡 About confidence scores > 0.5:")
        print(f"- LLM will assign 0-1 confidence for each event")
        print(f"- If confidence > 0.5 → event marked as workflow-related")
        print(f"- If confidence ≤ 0.5 → event marked as unrelated")
        print(f"- This creates the binary classification for timeline mapping")
    else:
        print(f"⚠️ This batch cannot be processed (missing events or analysis)")
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    main() 