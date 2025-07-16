import psycopg2
import json
from datetime import datetime, timedelta

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("📊 RECENT EXECUTION RESULTS ANALYSIS")
print("=" * 60)

# Check completed executions from the last few hours
cur.execute("""
SELECT 
    id,
    status,
    created_at,
    started_at,
    completed_at,
    error_message,
    EXTRACT(EPOCH FROM (completed_at - started_at)) / 60 as duration_minutes,
    execution_params->'product_types' as product_types
FROM workflow_executions 
WHERE completed_at > NOW() - INTERVAL '6 hours'  -- Last 6 hours
AND status IN ('completed', 'failed')
ORDER BY completed_at DESC
LIMIT 20;
""")

completed_results = cur.fetchall()

print(f"{'ID':<6} {'Status':<10} {'Duration':<8} {'Product Types':<15} {'Completed':<12} {'Error':<30}")
print("-" * 95)

success_count = 0
failed_count = 0
total_duration = 0
array_format_errors = 0

for row in completed_results:
    id_, status, created, started, completed, error, duration, product_types = row
    
    # Parse product types to see array structure
    if product_types:
        try:
            if isinstance(product_types, str):
                pt_array = json.loads(product_types)
            else:
                pt_array = product_types
            pt_display = str(pt_array)[:13] + ("..." if len(str(pt_array)) > 13 else "")
        except:
            pt_display = str(product_types)[:13]
    else:
        pt_display = "NULL"
    
    # Count results
    if status == 'completed':
        success_count += 1
        if duration:
            total_duration += duration
    else:
        failed_count += 1
        
    # Check for array format errors
    if error and ('array' in error.lower() or 'type' in error.lower()):
        array_format_errors += 1
    
    duration_str = f"{duration:.1f}m" if duration else "N/A"
    completed_str = completed.strftime('%H:%M:%S') if completed else "N/A"
    error_short = (error[:28] + "...") if error and len(error) > 28 else (error or "")
    
    print(f"{id_:<6} {status:<10} {duration_str:<8} {pt_display:<15} {completed_str:<12} {error_short:<30}")

# Summary statistics
avg_duration = total_duration / success_count if success_count > 0 else 0
success_rate = (success_count / (success_count + failed_count) * 100) if (success_count + failed_count) > 0 else 0

print(f"\n📈 RESULTS SUMMARY (Last 6 hours):")
print(f"✅ Successful: {success_count}")
print(f"❌ Failed: {failed_count}")
print(f"📊 Success Rate: {success_rate:.1f}%")
print(f"⏱️  Average Duration: {avg_duration:.1f} minutes")
print(f"🔧 Array Format Errors: {array_format_errors}")

# Check what's currently blocking processing
print(f"\n🔍 CURRENT PROCESSING STATUS:")
cur.execute("""
SELECT 
    COUNT(*) FILTER (WHERE status = 'queued') as queued_count,
    COUNT(*) FILTER (WHERE status = 'running') as running_count,
    COUNT(*) FILTER (WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes') as stuck_count
FROM workflow_executions 
WHERE status IN ('queued', 'running');
""")

status_counts = cur.fetchone()
queued, running, stuck = status_counts

print(f"📝 Queued jobs: {queued}")
print(f"🔄 Running jobs: {running}")
print(f"⚠️  Stuck jobs (>30min): {stuck}")

if queued > 0:
    print(f"\n⚠️  WARNING: {queued} jobs are queued but not being processed!")
    print("This suggests the Modal scheduler might be blocked or not running.")

conn.close()
