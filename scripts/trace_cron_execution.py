#!/usr/bin/env python3

import requests
import json
from datetime import datetime

def trace_cron():
    """Trace exactly what happens when cron is called"""
    
    print("\n" + "="*80)
    print("TRACING CRON EXECUTION FLOW")
    print("="*80)
    
    # Call the production cron endpoint
    url = "https://app.mediar.ai/api/cron/scheduler"
    
    print(f"\nCalling: POST {url}")
    print(f"Time: {datetime.utcnow().strftime('%H:%M:%S')} UTC")
    
    response = requests.post(url)
    result = response.json()
    
    print(f"\nResponse: {json.dumps(result, indent=2)}")
    
    print("\n" + "="*80)
    print("ANALYSIS:")
    print("="*80)
    
    if result.get('totalWorkflows', 0) == 0:
        print("❌ No workflows found by cron scheduler")
        print("\nPossible issues:")
        print("1. Workflows don't have status='active' or 'deployed'")
        print("2. Workflows don't have cron_enabled=true")
        print("3. Workflows don't have cron_expression set")
    elif result.get('executionsTriggered', 0) == 0:
        print("❌ Workflows found but NOT triggered")
        print(f"   Total workflows checked: {result.get('totalWorkflows')}")
        print("\nPossible issues:")
        print("1. Cron expression doesn't match current time")
        print("2. Workflow already executed this minute")
        print("3. shouldExecuteAt() function returning false")
        print("4. Concurrent execution limit reached")
    else:
        print(f"✅ Triggered {result.get('executionsTriggered')} workflows")
    
    # Check what Vercel sees
    print("\n" + "="*80)
    print("WHAT VERCEL SEES:")
    print("="*80)
    print("\nWhen Vercel calls GET /api/cron/scheduler:")
    print("1. Next.js receives the GET request")
    print("2. The GET handler returns health check (not triggering workflows)")
    print("\nWhen someone calls POST /api/cron/scheduler:")
    print("1. Next.js receives the POST request")
    print("2. The POST handler checks and triggers workflows")
    
    print("\n⚠️  WAIT - VERCEL IS CALLING GET, NOT POST!")
    print("\nThe logs show:")
    print("  GET 200 /api/cron/scheduler (from Vercel)")
    print("  POST 200 /api/cron/scheduler (from manual tests)")
    
    print("\n❌ THE PROBLEM:")
    print("Vercel cron is calling GET (health check)")
    print("But workflows only trigger on POST!")
    
    print("\n✅ THE FIX:")
    print("Change vercel.json to use POST method!")


if __name__ == "__main__":
    trace_cron()
