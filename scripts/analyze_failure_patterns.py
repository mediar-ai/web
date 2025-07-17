import psycopg2
import json
from collections import Counter

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("🔍 ANALYZING FAILURE PATTERNS")
print("=" * 50)

# Get recent failed executions with detailed error analysis
cur.execute("""
SELECT 
    id,
    error_message,
    EXTRACT(EPOCH FROM (completed_at - started_at)) / 60 as duration_minutes,
    execution_params->'product_types' as product_types,
    started_at
FROM workflow_executions 
WHERE status = 'failed' 
AND completed_at > NOW() - INTERVAL '6 hours'
ORDER BY completed_at DESC
LIMIT 25;
""")

failed_executions = cur.fetchall()

# Categorize error types
error_categories = Counter()
error_details = []

for exec_id, error_msg, duration, product_types, started in failed_executions:
    if error_msg:
        # Categorize errors
        error_lower = error_msg.lower()
        if 'mcp execution failed' in error_lower:
            if 'no data returned' in error_lower:
                category = "MCP: No data returned"
            elif 'see logs' in error_lower:
                category = "MCP: See logs" 
            else:
                category = "MCP: Other"
        elif 'workflow incomplete' in error_lower:
            category = "Workflow incomplete"
        elif 'unknown error' in error_lower:
            category = "Unknown error"
        elif 'manual intervention' in error_lower:
            category = "Manual intervention"
        else:
            category = "Other"
            
        error_categories[category] += 1
        
        # Parse product types for context
        try:
            if isinstance(product_types, str):
                pt_array = json.loads(product_types)
            else:
                pt_array = product_types
        except:
            pt_array = product_types
            
        error_details.append({
            'id': exec_id,
            'category': category, 
            'duration': duration,
            'product_types': pt_array,
            'started': started,
            'full_error': error_msg[:100] + "..." if len(error_msg) > 100 else error_msg
        })

# Display error category summary
print("📊 ERROR CATEGORIES:")
for category, count in error_categories.most_common():
    print(f"  {category}: {count}")

# Show recent failure details
print(f"\n📋 RECENT FAILURE DETAILS:")
print(f"{'ID':<6} {'Category':<20} {'Duration':<8} {'Product Types':<15} {'Error':<40}")
print("-" * 95)

for error in error_details[:15]:  # Show last 15
    pt_str = str(error['product_types'])[:13] + ("..." if len(str(error['product_types'])) > 13 else "")
    duration_str = f"{error['duration']:.1f}m" if error['duration'] else "N/A"
    
    print(f"{error['id']:<6} {error['category']:<20} {duration_str:<8} {pt_str:<15} {error['full_error']:<40}")

# Check if there's a pattern with product types
print(f"\n🔍 CHECKING PRODUCT TYPE PATTERNS:")
product_type_failures = Counter()
for error in error_details:
    if error['product_types']:
        if isinstance(error['product_types'], list):
            for pt in error['product_types']:
                product_type_failures[pt] += 1
        else:
            product_type_failures[str(error['product_types'])] += 1

for pt, count in product_type_failures.most_common():
    print(f"  {pt}: {count} failures")

# Check timing patterns
recent_hour_failures = sum(1 for error in error_details if error['started'] and error['started'] > datetime.now() - timedelta(hours=1))
print(f"\n⏰ RECENT FAILURES: {recent_hour_failures} in the last hour")

if recent_hour_failures > 10:
    print("⚠️  High failure rate suggests systemic issue!")
elif recent_hour_failures < 3:
    print("✅ Failure rate seems normal")

conn.close()
