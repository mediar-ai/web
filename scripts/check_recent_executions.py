import psycopg2
import json
from datetime import datetime, timedelta

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("🔍 CHECKING RECENT EXECUTION STATUS")
print("=" * 70)

# Check recent executions, especially around 3889
cur.execute("""
SELECT 
    id,
    status,
    created_at,
    started_at,
    completed_at,
    error_message,
    EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - COALESCE(started_at, created_at))) / 60 as duration_minutes,
    execution_params->'product_types' as product_types
FROM workflow_executions 
WHERE id >= 3880  -- Recent executions
ORDER BY id DESC
LIMIT 15;
""")

results = cur.fetchall()

print(f"{'ID':<6} {'Status':<12} {'Duration':<10} {'Product Types':<20} {'Started':<12} {'Completed':<12}")
print("-" * 80)

stuck_count = 0
failed_count = 0
success_count = 0
running_count = 0

for row in results:
    id_, status, created, started, completed, error, duration, product_types = row
    
    # Parse product types
    if product_types:
        try:
            if isinstance(product_types, str):
                pt_array = json.loads(product_types)
            else:
                pt_array = product_types
            pt_display = str(pt_array)[:18] + ("..." if len(str(pt_array)) > 18 else "")
        except:
            pt_display = str(product_types)[:18]
    else:
        pt_display = "NULL"
    
    # Format times
    started_str = started.strftime('%H:%M:%S') if started else "Not Started"
    completed_str = completed.strftime('%H:%M:%S') if completed else "Running"
    duration_str = f"{duration:.1f}m" if duration else "N/A"
    
    # Count status
    if status == 'failed':
        failed_count += 1
    elif status == 'completed':
        success_count += 1
    elif status in ['running', 'queued']:
        running_count += 1
        # Check if stuck (running for more than 30 minutes)
        if duration and duration > 30:
            stuck_count += 1
            status = f"{status} (STUCK)"
    
    print(f"{id_:<6} {status:<12} {duration_str:<10} {pt_display:<20} {started_str:<12} {completed_str:<12}")

print(f"\n📊 SUMMARY:")
print(f"✅ Success: {success_count}")
print(f"❌ Failed: {failed_count}")  
print(f"🔄 Running: {running_count}")
print(f"⚠️  Stuck: {stuck_count}")

# Check specifically execution 3889
print(f"\n🔍 EXECUTION 3889 DETAILS:")
cur.execute("""
SELECT 
    id, status, created_at, started_at, completed_at, error_message,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) / 60 as runtime_minutes
FROM workflow_executions 
WHERE id = 3889;
""")

exec_3889 = cur.fetchone()
if exec_3889:
    id_, status, created, started, completed, error, runtime = exec_3889
    print(f"Status: {status}")
    print(f"Runtime: {runtime:.1f} minutes")
    print(f"Started: {started.strftime('%Y-%m-%d %H:%M:%S') if started else 'Not started'}")
    print(f"Error: {error or 'None'}")
    
    if runtime and runtime > 30:
        print(f"⚠️  STUCK: Running for {runtime:.1f} minutes (>30m threshold)")
else:
    print("❌ Execution 3889 not found")

conn.close()
