#!/usr/bin/env python3

import requests
import json
import time

def test_single_timeline_batch():
    """
    Test timeline mapping for a single user via direct API call
    """
    
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    model = "gemini-2.5-pro"
    
    print(f"🚀 Testing timeline mapping for user: {user_id}")
    print("=" * 80)
    
    # Call the API endpoint directly
    url = "http://localhost:3000/api/analyze-raw-timeline-events"
    
    payload = {
        "userId": user_id,
        "model": model
    }
    
    print(f"📡 Calling API: {url}")
    print(f"📦 Payload: {json.dumps(payload, indent=2)}")
    print("\n🔄 Starting timeline mapping...")
    
    try:
        # Make the request with streaming enabled
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            stream=True,
            timeout=300  # 5 minute timeout
        )
        
        if response.status_code != 200:
            print(f"❌ API call failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return
        
        print("✅ Connected to streaming API")
        print("-" * 60)
        
        # Process the streaming response
        for line in response.iter_lines():
            if line:
                try:
                    # Parse SSE data
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        data_str = line_str[6:]  # Remove 'data: ' prefix
                        data = json.loads(data_str)
                        
                        # Print progress updates
                        if 'status' in data:
                            status = data['status']
                            progress = data.get('progress', 0)
                            print(f"📊 [{progress:3.0f}%] {status}")
                        
                        if 'error' in data:
                            print(f"❌ Error: {data['error']}")
                            break
                        
                        if 'data' in data:
                            result_data = data['data']
                            if 'totalMappings' in result_data:
                                total_mappings = result_data['totalMappings']
                                total_batches = result_data.get('totalBatches', 0)
                                print(f"🎯 Final Result: {total_mappings} total mappings across {total_batches} batches")
                                break
                        
                        # Look for batch completion with annotations
                        if 'annotations' in data.get('data', {}):
                            annotations = data['data']['annotations']
                            print(f"📝 Batch completed: {len(annotations)} annotations saved")
                            
                            # Show sample annotations
                            if annotations:
                                print("📋 Sample annotations:")
                                for i, annotation in enumerate(annotations[:3]):  # Show first 3
                                    print(f"   [{i+1}] Event {annotation.get('raw_event_id')} -> Analysis {annotation.get('analysis_id')}")
                                    print(f"       Confidence: {annotation.get('confidence_score')}")
                                    print(f"       Template ID: {annotation.get('workflow_template_id')}")
                                    print(f"       Type ID: {annotation.get('workflow_type_id')}")
                                    print(f"       Step ID: {annotation.get('workflow_step_id')}")
                                if len(annotations) > 3:
                                    print(f"       ... and {len(annotations) - 3} more annotations")
                            
                            # Stop after first batch for testing
                            print("\n✅ Single batch test completed successfully!")
                            break
                            
                except json.JSONDecodeError as e:
                    print(f"⚠️ Failed to parse JSON: {line_str}")
                    continue
                except Exception as e:
                    print(f"⚠️ Error processing line: {e}")
                    continue
        
        print("\n" + "=" * 80)
        print("🎉 Timeline mapping test completed!")
        
    except requests.exceptions.Timeout:
        print("❌ Request timed out after 5 minutes")
    except requests.exceptions.ConnectionError:
        print("❌ Could not connect to the API (is the dev server running?)")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    test_single_timeline_batch() 