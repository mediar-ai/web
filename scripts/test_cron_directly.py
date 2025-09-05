#!/usr/bin/env python3

import requests
import json
from datetime import datetime

def test_cron():
    """Test the cron scheduler endpoint directly"""
    
    print("\n" + "="*80)
    print("TESTING CRON SCHEDULER DIRECTLY")
    print("="*80)
    
    url = "https://app.mediar.ai/api/cron/scheduler"
    
    print(f"\nCalling: {url}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    try:
        response = requests.get(url)
        data = response.json()
        
        print(f"\nResponse Status: {response.status_code}")
        print(f"Response Body:")
        print(json.dumps(data, indent=2))
        
        if data.get('executionsTriggered', 0) > 0:
            print(f"\n✅ Triggered {data['executionsTriggered']} workflows!")
        else:
            print(f"\n❌ Found {data.get('totalWorkflows', 0)} workflows but triggered 0")
            
            if data.get('results'):
                print("\nDetailed results:")
                for r in data['results']:
                    print(f"  - {r}")
        
    except Exception as e:
        print(f"\nError: {e}")
    
    print("\n" + "="*80)
    print("CHECKING VERCEL LOGS")
    print("="*80)
    print("\nTo see what's happening, check:")
    print("https://vercel.com/louis030195s-projects/browser-workflow-capture-app/logs")
    print("\nLook for:")
    print("1. 'Triggering execution for workflow' messages")
    print("2. 'Response status' messages")
    print("3. Any error messages")

if __name__ == "__main__":
    test_cron()

