#!/usr/bin/env python3

import requests
import json
import time

def test_single_batch_timeline_mapping():
    """Test a single batch of timeline mapping with the updated enriched view"""
    
    # Use the user requested by the user
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"  # Matt_windows_intel_core_i9 - has 4 detailed workflows + 36 UI trees + 109 analyses
    api_url = "http://localhost:3000/api/analyze-raw-timeline-events"
    
    print(f"🧪 Testing single batch timeline mapping for user: {user_id}")
    print("📊 User has: 4 detailed workflows with components + 36 UI tree events + 109 analysis records")
    print("=" * 60)
    
    payload = {
        "userId": user_id,
        "model": "gemini-2.5-pro"
    }
    
    print("📤 Sending request to analyze-raw-timeline-events endpoint...")
    print(f"Request payload: {json.dumps(payload, indent=2)}")
    print()
    
    try:
        # Make the request with streaming
        response = requests.post(api_url, json=payload, stream=True)
        
        if response.status_code != 200:
            print(f"❌ Request failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return
        
        print("📊 Streaming response:")
        print("-" * 40)
        
        # Process streaming response
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    try:
                        data = json.loads(line_str[6:])  # Remove 'data: ' prefix
                        
                        # Print status updates
                        if 'status' in data:
                            status = data['status']
                            progress = data.get('progress', 0)
                            print(f"[{progress:3.0f}%] {status}")
                            
                            # Print additional data if available
                            if 'data' in data:
                                extra_data = data['data']
                                if 'annotations' in extra_data:
                                    print(f"       💾 Saved {len(extra_data['annotations'])} annotations")
                                if 'totalMappings' in extra_data:
                                    print(f"       📊 Total mappings: {extra_data['totalMappings']}")
                        
                        # Print errors
                        if 'error' in data:
                            print(f"❌ Error: {data['error']}")
                        
                        # Check if completed
                        if data.get('data', {}).get('completed'):
                            print("\n🎉 Analysis completed successfully!")
                            final_data = data['data']
                            print(f"📊 Final Results:")
                            print(f"   - Total mappings: {final_data.get('totalMappings', 0)}")
                            print(f"   - Total batches: {final_data.get('totalBatches', 0)}")
                            if 'annotations' in final_data:
                                print(f"   - Final annotations: {len(final_data['annotations'])}")
                                
                                # Show sample annotation
                                if final_data['annotations']:
                                    sample = final_data['annotations'][0]
                                    print(f"\n📝 Sample annotation:")
                                    print(f"   - Raw event ID: {sample.get('raw_event_id')}")
                                    print(f"   - Confidence: {sample.get('confidence_score', 0):.2f}")
                                    print(f"   - Is workflow related: {sample.get('is_workflow_related')}")
                                    if sample.get('workflow_template_id'):
                                        print(f"   - Template ID: {sample.get('workflow_template_id')}")
                                        print(f"   - Type ID: {sample.get('workflow_type_id')}")
                                        print(f"   - Step ID: {sample.get('workflow_step_id')}")
                            break
                            
                    except json.JSONDecodeError as e:
                        print(f"⚠️  JSON decode error: {e}")
                        print(f"   Raw line: {line_str}")
        
        print("\n✅ Test completed!")
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Request error: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    test_single_batch_timeline_mapping() 