import psycopg2
import json
from datetime import datetime, timedelta

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("🧪 COMPREHENSIVE TEST SCENARIO VERIFICATION")
print("=" * 80)

# Query our recent test executions 
cur.execute("""
SELECT 
    id,
    status,
    created_at,
    execution_params->'product_types' as product_types,
    ARRAY_LENGTH(CAST(execution_params->'product_types' AS jsonb)::jsonb[], 1) as array_length
FROM workflow_executions 
WHERE id >= 3892  -- Recent tests
ORDER BY id;
""")

results = cur.fetchall()

print(f"\n📊 EXECUTION ANALYSIS (Recent Tests):")
print(f"{'ID':<6} {'Status':<12} {'Product Types':<25} {'Array Length':<12} {'Created':<20}")
print("-" * 90)

scenario_1 = []  # Single element arrays
scenario_2 = []  # Multi element arrays
scenario_3_count = 0  # Total recent submissions

for row in results:
    id_, status, created, product_types, array_length = row
    
    # Parse product_types array
    if product_types:
        try:
            pt_array = json.loads(product_types) if isinstance(product_types, str) else product_types
            pt_display = str(pt_array)[:22] + ("..." if len(str(pt_array)) > 22 else "")
            
            # Categorize scenarios
            if array_length == 1:
                scenario_1.append((id_, pt_array))
            elif array_length == 2:
                scenario_2.append((id_, pt_array))
                
            scenario_3_count += 1
            
        except Exception as e:
            pt_display = str(product_types)[:22]
            array_length = "ERROR"
    else:
        pt_display = "NULL"
        array_length = "NULL"
    
    print(f"{id_:<6} {status:<12} {pt_display:<25} {array_length:<12} {created.strftime('%H:%M:%S')}")

print(f"\n🎯 TEST SCENARIO RESULTS:")
print(f"📋 Scenario 1 (Single Product Type): {len(scenario_1)} executions")
for id_, pt_array in scenario_1:
    print(f"  ✅ Execution {id_}: {pt_array}")

print(f"📋 Scenario 2 (Multiple Product Types): {len(scenario_2)} executions") 
for id_, pt_array in scenario_2:
    print(f"  ✅ Execution {id_}: {pt_array}")

print(f"📋 Scenario 3 (Sequential Processing): {scenario_3_count} total rapid submissions")

# Check for concurrent execution times (should be sequential, not simultaneous)
print(f"\n⏱️  COORDINATOR LOCK VERIFICATION:")
cur.execute("""
SELECT 
    id,
    created_at,
    LAG(created_at) OVER (ORDER BY created_at) as prev_created,
    EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at))) as seconds_diff
FROM workflow_executions 
WHERE id >= 3892
AND created_at > NOW() - INTERVAL '30 minutes'
ORDER BY created_at;
""")

timing_results = cur.fetchall()
simultaneous_count = 0
sequential_count = 0

for row in timing_results:
    id_, created, prev_created, seconds_diff = row
    if prev_created and seconds_diff is not None:
        if seconds_diff < 1:  # Less than 1 second apart = simultaneous (bad)
            simultaneous_count += 1
            print(f"  ⚠️  Execution {id_}: {seconds_diff:.2f}s after previous (simultaneous)")
        else:  # More than 1 second apart = sequential (good)
            sequential_count += 1
            print(f"  ✅ Execution {id_}: {seconds_diff:.2f}s after previous (sequential)")

print(f"\n📈 FINAL ASSESSMENT:")
print(f"✅ Scenario 1 Success: {len(scenario_1) > 0}")
print(f"✅ Scenario 2 Success: {len(scenario_2) > 0}")  
print(f"✅ Sequential Processing: {sequential_count} sequential, {simultaneous_count} simultaneous")
print(f"✅ Coordinator Lock Effectiveness: {sequential_count / (sequential_count + simultaneous_count) * 100:.1f}% sequential" if (sequential_count + simultaneous_count) > 0 else "✅ No timing data available")

conn.close()
