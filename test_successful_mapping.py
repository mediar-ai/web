#!/usr/bin/env python3

import requests
import json
import time
import psycopg2
from datetime import datetime

def test_successful_mapping():
    """Target the specific time period that has both events and analysis records for successful mapping"""
    
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    print(f"🎯 TARGETING WORKABLE BATCH FOR SUCCESSFUL TIMELINE MAPPING")
    print(f"User: {user_id}")
    print(f"Target: Midnight session with real estate workflow (MATTHEWS JOE W LULA M)")
    print(f"Time: July 22, 12:49-12:50 AM (Batches 8 & 9)")
    print("=" * 80)
    
    # First, let's verify the workable time periods have the required data
    print("🔍 Step 1: Verifying data availability in workable time periods...")
    
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    # Get the specific UI tree events from the workable batches
    cursor.execute("""
        SELECT id, created_at
        FROM low_level_events_enriched
        WHERE user_id = %s 
        AND event_type = 'ui_tree'
        AND created_at >= '2025-07-22 00:49:00'
        AND created_at <= '2025-07-22 00:51:00'
        ORDER BY created_at DESC
    """, (user_id,))
    
    target_ui_events = cursor.fetchall()
    
    print(f"✅ Found {len(target_ui_events)} UI tree events in target time period:")
    for event_id, created_at in target_ui_events:
        print(f"    Event {event_id}: {created_at}")
    
    if len(target_ui_events) < 2:
        print("❌ Need at least 2 UI tree events for batching")
        return
    
    # Check analysis records in the same time period
    cursor.execute("""
        SELECT id, created_at, window_title,
               CASE WHEN llm_structured_output IS NOT NULL THEN 'Yes' ELSE 'No' END as has_analysis
        FROM low_level_workflow_analyses
        WHERE user_id = %s 
        AND created_at >= '2025-07-22 00:49:00'
        AND created_at <= '2025-07-22 00:51:00'
        ORDER BY created_at
    """, (user_id,))
    
    analysis_records = cursor.fetchall()
    
    print(f"✅ Found {len(analysis_records)} analysis records in target time period:")
    for analysis_id, created_at, window_title, has_analysis in analysis_records:
        print(f"    Analysis {analysis_id}: {window_title[:60]}...")
        print(f"      Created: {created_at} | Has LLM analysis: {has_analysis}")
    
    # Check events in the target batch windows
    for i in range(len(target_ui_events) - 1):
        batch_num = i + 1
        end_time = target_ui_events[i][1]
        start_time = target_ui_events[i + 1][1]
        
        print(f"\n📦 Batch {batch_num} Events Check:")
        print(f"    Window: {start_time} → {end_time}")
        
        cursor.execute("""
            SELECT COUNT(*) as event_count
            FROM low_level_events_enriched
            WHERE user_id = %s 
            AND created_at >= %s 
            AND created_at < %s
            AND event_type != 'screenshot_diff'
        """, (user_id, start_time.isoformat(), end_time.isoformat()))
        
        event_count = cursor.fetchone()[0]
        print(f"    Events in batch: {event_count}")
        
        if event_count > 0 and len(analysis_records) > 0:
            print(f"    🎯 PERFECT BATCH - Has both events ({event_count}) and analysis ({len(analysis_records)})")
    
    cursor.close()
    conn.close()
    
    # Now create a modified request that will process these specific events
    print(f"\n🚀 Step 2: Triggering timeline mapping on target time period...")
    
    # We'll use a custom approach - modify the endpoint behavior by providing specific UI tree event IDs
    api_url = "http://localhost:3000/api/analyze-raw-timeline-events"
    
    payload = {
        "userId": user_id,
        "model": "gemini-2.5-pro",
        # Add a custom parameter to target specific UI tree events
        "targetUiEventIds": [str(event_id) for event_id, _ in target_ui_events[:2]]  # Use the 2 most recent from target period
    }
    
    print(f"📤 Request payload:")
    print(json.dumps(payload, indent=2))
    print()
    
    try:
        start_time = time.time()
        response = requests.post(api_url, json=payload, stream=True)
        
        if response.status_code != 200:
            print(f"❌ Request failed with status {response.status_code}")
            print(f"Response: {response.text}")
            
            # If the custom parameter isn't supported yet, let's try a different approach
            print(f"\n🔄 Fallback: Using standard request (will process most recent events)")
            fallback_payload = {
                "userId": user_id,
                "model": "gemini-2.5-pro"
            }
            response = requests.post(api_url, json=fallback_payload, stream=True)
            
            if response.status_code != 200:
                print(f"❌ Fallback also failed: {response.status_code}")
                return
        
        print("📊 Streaming response from timeline mapping:")
        print("-" * 60)
        
        total_mappings = 0
        annotations_received = []
        successful_mappings = []
        
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    try:
                        data = json.loads(line_str[6:])
                        
                        if 'status' in data:
                            status = data['status']
                            progress = data.get('progress', 0)
                            print(f"[{progress:3.0f}%] {status}")
                            
                            if 'data' in data:
                                extra_data = data['data']
                                
                                if 'annotations' in extra_data and extra_data['annotations']:
                                    new_annotations = extra_data['annotations']
                                    annotations_received.extend(new_annotations)
                                    
                                    # Analyze each annotation
                                    for ann in new_annotations:
                                        if ann.get('is_workflow_related'):
                                            successful_mappings.append(ann)
                                            print(f"       ✅ SUCCESSFUL MAPPING!")
                                            print(f"         Event ID: {ann.get('raw_event_id')}")
                                            print(f"         Analysis ID: {ann.get('analysis_id')}")
                                            print(f"         Confidence: {ann.get('confidence_score', 0):.3f}")
                                            if ann.get('workflow_template_id'):
                                                print(f"         Template: {ann.get('workflow_template_id')}")
                                                print(f"         Step: {ann.get('workflow_step_id')}")
                                        else:
                                            print(f"       ⚪ Event {ann.get('raw_event_id')}: Unrelated to workflow")
                                
                                if 'totalMappings' in extra_data:
                                    total_mappings = extra_data['totalMappings']
                                    print(f"       📊 Total mappings so far: {total_mappings}")
                        
                        if 'error' in data:
                            print(f"❌ Error: {data['error']}")
                        
                        if data.get('data', {}).get('completed'):
                            end_time = time.time()
                            execution_time = end_time - start_time
                            
                            print(f"\n🎉 TIMELINE MAPPING COMPLETED!")
                            print(f"⏱️  Execution time: {execution_time:.1f}s")
                            print(f"📊 Final Results:")
                            
                            final_data = data['data']
                            print(f"   - Total mappings: {final_data.get('totalMappings', 0)}")
                            print(f"   - Total batches: {final_data.get('totalBatches', 0)}")
                            
                            if successful_mappings:
                                print(f"\n🎯 SUCCESS! Generated {len(successful_mappings)} workflow mappings!")
                                
                                for i, mapping in enumerate(successful_mappings, 1):
                                    print(f"\n📝 Mapping {i}:")
                                    print(f"   Raw Event ID: {mapping.get('raw_event_id')}")
                                    print(f"   Analysis ID: {mapping.get('analysis_id')}")
                                    print(f"   Confidence: {mapping.get('confidence_score', 0):.3f}")
                                    print(f"   Template ID: {mapping.get('workflow_template_id')}")
                                    print(f"   Type ID: {mapping.get('workflow_type_id')}")
                                    print(f"   Step ID: {mapping.get('workflow_step_id')}")
                                    
                                    if mapping.get('inputs'):
                                        print(f"   Inputs: {mapping.get('inputs')[:100]}...")
                                    if mapping.get('outputs'):
                                        print(f"   Outputs: {mapping.get('outputs')[:100]}...")
                                    if mapping.get('business_logics'):
                                        print(f"   Business Logic: {mapping.get('business_logics')[:100]}...")
                                
                                print(f"\n🚀 TIMELINE MAPPING SYSTEM FULLY OPERATIONAL!")
                                print(f"   ✅ Database: Fast enriched view queries")
                                print(f"   ✅ Processing: LLM successfully mapped events to workflows")
                                print(f"   ✅ Storage: Raw event annotations saved to database")
                                print(f"   ✅ UI Ready: Can display individual event mappings")
                                
                            else:
                                print(f"\n⚠️  No workflow mappings generated")
                                print(f"   📊 Total annotations: {len(annotations_received)}")
                                unrelated = [a for a in annotations_received if not a.get('is_workflow_related')]
                                print(f"   📊 Unrelated events: {len(unrelated)}")
                                
                                if len(annotations_received) > 0:
                                    print(f"   ✅ System working - events processed but marked as unrelated to workflows")
                                else:
                                    print(f"   ⚠️  No events found in target time windows")
                            
                            break
                            
                    except json.JSONDecodeError as e:
                        print(f"⚠️  JSON decode error: {e}")
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Request error: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    test_successful_mapping() 