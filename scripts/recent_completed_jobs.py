import psycopg2
import json
from datetime import datetime

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("📊 RECENT COMPLETED/FAILED EXECUTIONS (Last 20)")
print("=" * 120)

# Get recent completed/failed executions
cur.execute("""
SELECT 
    id,
    status,
    created_at,
    started_at,
    completed_at,
    EXTRACT(EPOCH FROM (completed_at - COALESCE(started_at, created_at))) / 60 as duration_minutes,
    execution_params->'product_types' as product_types,
    error_message,
    modal_call_id
FROM workflow_executions 
WHERE status IN ('completed', 'failed')
AND completed_at IS NOT NULL
ORDER BY completed_at DESC
LIMIT 20;
""")

results = cur.fetchall()

# Create formatted table
print(f"{'ID':<6} {'Status':<10} {'Duration':<8} {'Product Types':<20} {'Completed':<12} {'Error/Result':<40}")
print("-" * 120)

success_count = 0
failed_count = 0
total_duration = 0
success_duration = 0

for row in results:
    id_, status, created, started, completed, duration, product_types, error, modal_call_id = row
    
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
    
    # Format completion time
    completed_str = completed.strftime('%H:%M:%S') if completed else "N/A"
    
    # Format duration
    duration_str = f"{duration:.1f}m" if duration is not None else "N/A"
    
    # Format error/result
    if status == 'completed':
        result_str = "✅ Success"
        success_count += 1
        if duration:
            success_duration += duration
            total_duration += duration
    else:
        failed_count += 1
        if duration:
            total_duration += duration
        # Truncate long error messages
        if error:
            if len(error) > 38:
                result_str = error[:35] + "..."
            else:
                result_str = error
        else:
            result_str = "❌ Failed (no error msg)"
    
    print(f"{id_:<6} {status:<10} {duration_str:<8} {pt_display:<20} {completed_str:<12} {result_str:<40}")

# Summary statistics
print("\n" + "=" * 120)
print(f"📈 SUMMARY STATISTICS:")
print(f"✅ Successful executions: {success_count}")
print(f"❌ Failed executions: {failed_count}")

if success_count + failed_count > 0:
    success_rate = (success_count / (success_count + failed_count)) * 100
    print(f"📊 Success rate: {success_rate:.1f}%")

if success_count > 0:
    avg_success_duration = success_duration / success_count
    print(f"⏱️  Average success duration: {avg_success_duration:.1f} minutes")

if failed_count > 0:
    failed_duration = total_duration - success_duration
    if failed_duration > 0:
        avg_failed_duration = failed_duration / failed_count
        print(f"⏱️  Average failed duration: {avg_failed_duration:.1f} minutes")

# Check array format patterns
print(f"\n🔍 ARRAY FORMAT ANALYSIS:")
old_format_count = 0
new_format_count = 0

for row in results:
    product_types = row[6]
    if product_types:
        try:
            if isinstance(product_types, str):
                pt_array = json.loads(product_types)
                if isinstance(pt_array, list):
                    new_format_count += 1
                else:
                    old_format_count += 1
            elif isinstance(product_types, list):
                new_format_count += 1
            else:
                old_format_count += 1
        except:
            old_format_count += 1

print(f"✅ New array format: {new_format_count}")
print(f"❌ Old string format: {old_format_count}")

# Time analysis
print(f"\n⏰ TIME ANALYSIS:")
if results:
    latest_completion = results[0][4]  # Most recent completion time
    oldest_completion = results[-1][4]  # Oldest completion time
    time_span = (latest_completion - oldest_completion).total_seconds() / 3600  # hours
    
    print(f"📅 Time span: {time_span:.1f} hours")
    print(f"🕐 Latest completion: {latest_completion.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🕐 Oldest completion: {oldest_completion.strftime('%Y-%m-%d %H:%M:%S')}")
    
    if time_span > 0:
        completion_rate = len(results) / time_span
        print(f"📈 Completion rate: {completion_rate:.1f} jobs/hour")

conn.close()
