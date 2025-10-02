#!/usr/bin/env python3
"""
Check what tables/views exist in the database
"""

import os
import requests

# Get Supabase credentials
SUPABASE_URL = "https://eshwntsgsputksqamckh.supabase.co"
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0")

def check_table_exists(table_name):
    """Check if a table exists and get a sample row"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    url = f"{SUPABASE_URL}/rest/v1/{table_name}"
    params = {
        "select": "*",
        "limit": 1
    }

    try:
        response = requests.get(url, headers=headers, params=params)
        if response.status_code == 200:
            data = response.json()
            return True, len(data), list(data[0].keys()) if data else []
        else:
            return False, response.status_code, response.text[:200]
    except Exception as e:
        return False, 0, str(e)

# Check both table names
tables_to_check = ['workflow_executions', 'remote_executions']

print("Checking database tables...")
print("=" * 60)

for table in tables_to_check:
    exists, result, info = check_table_exists(table)
    print(f"\nTable: {table}")
    if exists:
        print(f"  Status: EXISTS")
        print(f"  Sample rows found: {result}")
        if info:
            print(f"  Columns: {', '.join(info[:10])}")
            if len(info) > 10:
                print(f"           ... and {len(info)-10} more columns")
    else:
        print(f"  Status: DOES NOT EXIST or NO ACCESS")
        print(f"  Error: {info}")

# Also check for the specific execution
print("\n" + "=" * 60)
print("Testing specific queries used in the app:")

# Test workflow_executions query (what main app uses)
url = f"{SUPABASE_URL}/rest/v1/workflow_executions"
params = {"select": "id,status,workflow_id", "limit": 1}
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

response = requests.get(url, headers=headers, params=params)
print(f"\nworkflow_executions query: {response.status_code}")
if response.status_code == 200:
    data = response.json()
    if data:
        print(f"  Sample ID: {data[0].get('id')}")

# Test remote_executions query (what AI chat uses)
url = f"{SUPABASE_URL}/rest/v1/remote_executions"
params = {"select": "*", "limit": 1}
response = requests.get(url, headers=headers, params=params)
print(f"\nremote_executions query: {response.status_code}")
if response.status_code == 200:
    data = response.json()
    if data:
        print(f"  Found data: {len(data)} rows")
else:
    print(f"  Error: {response.text[:200]}")