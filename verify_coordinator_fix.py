import psycopg2
import json
from datetime import datetime, timedelta

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("🔍 COORDINATOR LOCK VERIFICATION:")
print("=" * 80)

# Check for active coordinator locks
cur.execute("""
SELECT processor_id, created_at, expires_at
FROM processing_locks 
WHERE user_id = 'workflow-coordinator' 
AND status = 'in_progress' 
AND expires_at > NOW()
ORDER BY created_at DESC
""")

coordinator_locks = cur.fetchall()
print(f"\n📋 Active Coordinator Locks: {len(coordinator_locks)}")
for processor_id, created, expires in coordinator_locks:
    print(f"  🔒 {processor_id[:30]}... (Created: {created.strftime('%H:%M:%S')}, Expires: {expires.strftime('%H:%M:%S')})")

# Check recent executions (last 10 minutes)
cur.execute("""
SELECT 
    id,
    status,
    created_at,
    started_at,
    updated_at,
    execution_params->'product_types' as product_types
FROM workflow_executions 
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
""")

recent_executions = cur.fetchall()
print(f"\n📊 Recent Executions (Last 10 minutes): {len(recent_executions)}")
print("-" * 80)
print(f"{'ID':<4} {'Status':<12} {'Product Types':<20} {'Created':<9} {'Started':<9}")
print("-" * 80)

for row in recent_executions:
    id_, status, created, started, updated, product_types = row
    created_str = created.strftime("%H:%M:%S") if created else "N/A"
    started_str = started.strftime("%H:%M:%S") if started else "N/A"
    product_str = str(product_types)[:18] if product_types else "N/A"
    
    print(f"{id_:<4} {status:<12} {product_str:<20} {created_str:<9} {started_str:<9}")

# Check for concurrent execution pattern (the issue we fixed)
print(f"\n🔍 CONCURRENT EXECUTION ANALYSIS:")
print("=" * 50)

concurrent_groups = []
for i, row1 in enumerate(recent_executions):
    concurrent_in_group = [row1]
    id1, status1, created1, started1 = row1[0], row1[1], row1[2], row1[3]
    
    if not started1:
        continue
        
    for j, row2 in enumerate(recent_executions):
        if i >= j:  # Skip same or already processed
            continue
            
        id2, status2, created2, started2 = row2[0], row2[1], row2[2], row2[3]
        
        if not started2:
            continue
            
        # Check if they started within 5 seconds of each other (concurrent pattern)
        time_diff = abs((started1 - started2).total_seconds())
        if time_diff <= 5:  # Started within 5 seconds = likely concurrent
            if row2 not in concurrent_in_group:
                concurrent_in_group.append(row2)
    
    if len(concurrent_in_group) > 1:
        concurrent_groups.append(concurrent_in_group)

if concurrent_groups:
    print("⚠️  FOUND CONCURRENT EXECUTION GROUPS:")
    for i, group in enumerate(concurrent_groups):
        print(f"\n  Group {i+1}: {len(group)} jobs started concurrently")
        for job in group:
            id_, status, created, started = job[0], job[1], job[2], job[3]
            started_str = started.strftime("%H:%M:%S") if started else "N/A"
            print(f"    - Job {id_}: {status} (started: {started_str})")
else:
    print("✅ NO CONCURRENT EXECUTION DETECTED - Sequential processing working!")

cur.close()
conn.close()
