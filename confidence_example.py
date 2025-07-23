#!/usr/bin/env python3

import psycopg2

def main():
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    # Connect to database
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    print("🎯 Confidence Score > 0.5 Example")
    print("=" * 50)
    
    # Get the real batch data we found
    cursor.execute("""
        SELECT id, created_at, payload->'payload'->>'type' as event_type, payload->'payload' as payload_data
        FROM low_level_events 
        WHERE user_id = %s 
        AND created_at >= '2025-07-22 01:24:20.934000+00:00'
        AND created_at < '2025-07-22 01:24:54.504000+00:00'
        AND payload->'payload'->>'type' != 'screenshot_diff'
        ORDER BY created_at ASC 
        LIMIT 5
    """, (user_id,))
    
    events = cursor.fetchall()
    
    # Get the corresponding analysis
    cursor.execute("""
        SELECT window_title, llm_structured_output
        FROM low_level_workflow_analyses 
        WHERE user_id = %s 
        AND client_timestamp = '2025-07-22 01:24:54.504000+00:00'
    """, (user_id,))
    
    analysis = cursor.fetchone()
    
    print(f"\n📊 REAL BATCH DATA:")
    print(f"Analysis Context: {analysis[0] if analysis else 'No analysis found'}")
    if analysis and analysis[1]:
        step_data = analysis[1]
        print(f"Step Title: {step_data.get('step_title', 'Unknown')}")
        print(f"Step Summary: {step_data.get('step_summary', 'No summary')}")
    
    print(f"\nEvents in this batch:")
    for event in events:
        print(f"  - Event {event[0]}: {event[1]} - {event[2]}")
    
    print(f"\n💡 HOW CONFIDENCE SCORING > 0.5 WOULD WORK:")
    print(f"The LLM analyzes each event and assigns confidence 0-1:")
    
    # Example confidence scores the LLM might assign
    example_scores = [
        ("ui_tree", 0.9, "Clearly marks a workflow step boundary"),
        ("application_switch", 0.7, "Likely part of switching between tools in workflow"),
        ("browser_tab_navigation", 0.8, "Navigating to workflow-related pages"),
        ("mouse", 0.3, "Generic mouse movement, unclear workflow relevance")
    ]
    
    print(f"\n📈 EXAMPLE LLM CONFIDENCE ASSIGNMENTS:")
    workflow_related_count = 0
    unrelated_count = 0
    
    for event_type, confidence, reason in example_scores:
        is_related = confidence > 0.5
        status = "✅ WORKFLOW-RELATED" if is_related else "❌ UNRELATED"
        print(f"  - {event_type}: {confidence:.1f} → {status}")
        print(f"    Reason: {reason}")
        
        if is_related:
            workflow_related_count += 1
        else:
            unrelated_count += 1
    
    print(f"\n📊 FINAL CLASSIFICATION:")
    print(f"  - {workflow_related_count} events with confidence > 0.5 → marked as workflow-related")
    print(f"  - {unrelated_count} events with confidence ≤ 0.5 → marked as unrelated")
    
    print(f"\n💾 DATABASE STORAGE:")
    print(f"Each event gets stored in raw_timeline_event_annotations with:")
    print(f"  - confidence_score: (the actual 0-1 value)")
    print(f"  - is_workflow_related: (true if confidence > 0.5, false otherwise)")
    print(f"  - workflow_step, inputs, outputs: (only filled if confidence > 0.5)")
    print(f"  - unrelated_reason: (only filled if confidence ≤ 0.5)")
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    main() 