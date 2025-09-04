#!/usr/bin/env python3

import time
import requests
import json
from datetime import datetime

def wait_for_next_minute():
    """Wait until the next minute starts (second = 0)"""
    while True:
        now = datetime.now()
        if now.second == 0:
            break
        remaining = 60 - now.second
        print(f"Waiting {remaining} seconds for next minute...", end='\r')
        time.sleep(0.1)
    print()

def trigger_cron(port=3000):
    """Manually trigger the cron scheduler"""
    url = f"http://localhost:{port}/api/cron/scheduler"
    
    print(f"Triggering cron scheduler at {datetime.now().strftime('%H:%M:%S')}")
    
    try:
        response = requests.post(url, headers={"Content-Type": "application/json"})
        
        if response.status_code == 200:
            result = response.json()
            print("\nResponse:", json.dumps(result, indent=2))
            
            if result.get('executionsTriggered', 0) > 0:
                print(f"\n✅ SUCCESS! Triggered {result['executionsTriggered']} workflow(s)")
            else:
                print("\n⚠️ No workflows were triggered (may have already run this minute)")
        else:
            print(f"\n❌ Error: HTTP {response.status_code}")
            print(response.text)
            
    except requests.exceptions.ConnectionError:
        print(f"\n❌ Could not connect to localhost:{port}")
        print("Make sure the dev server is running with: npm run dev")
    except Exception as e:
        print(f"\n❌ Error: {e}")

def continuous_trigger(port=3000, interval_minutes=1):
    """Continuously trigger cron every N minutes at second=0"""
    print(f"Starting continuous cron trigger (every {interval_minutes} minute(s))")
    print("Press Ctrl+C to stop\n")
    
    try:
        while True:
            wait_for_next_minute()
            trigger_cron(port)
            
            if interval_minutes > 1:
                # Wait for additional minutes if interval > 1
                for _ in range(interval_minutes - 1):
                    time.sleep(60)
                    
    except KeyboardInterrupt:
        print("\n\nStopped by user")

if __name__ == "__main__":
    import sys
    
    if "--continuous" in sys.argv or "-c" in sys.argv:
        continuous_trigger()
    else:
        # Single trigger
        print("Single cron trigger mode")
        print("Use --continuous or -c for continuous triggering\n")
        
        wait_for_next_minute()
        trigger_cron()
        
        print("\nTo enable automatic cron in production:")
        print("1. Deploy to Vercel: vercel --prod")
        print("2. Vercel will automatically trigger /api/cron/scheduler every minute")
        print("3. Check Vercel Functions logs for execution details")
