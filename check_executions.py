import psycopg2
import json
from datetime import datetime

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

# Query execution records
cur.execute("""
SELECT 
    id,
    status,
    created_at,
    updated_at,
    EXTRACT(EPOCH FROM (updated_at - created_at)) as duration_seconds,
    execution_params->'product_types' as product_types,
    modal_call_id
FROM workflow_executions 
WHERE id BETWEEN 3882 AND 3889
ORDER BY id;
""")

results = cur.fetchall()

print("🔍 EXECUTION ANALYSIS:")
print("=" * 80)
print(f"{'ID':<4} {'Status':<12} {'Duration':<8} {'Product Types':<15} {'Created':<20} {'Updated':<20}")
print("-" * 80)

for row in results:
    id_, status, created, updated, duration, product_types, modal_call_id = row
    duration_str = f"{duration:.1f}s" if duration else "N/A"
    created_str = created.strftime("%H:%M:%S") if created else "N/A"
    updated_str = updated.strftime("%H:%M:%S") if updated else "N/A"
    
    print(f"{id_:<4} {status:<12} {duration_str:<8} {str(product_types):<15} {created_str:<20} {updated_str:<20}")

print("\n📊 TIMING ANALYSIS:")
print("=" * 50)

# Check for overlapping executions
print("\n🔄 CONCURRENT EXECUTION DETECTION:")
for i, row1 in enumerate(results):
    for j, row2 in enumerate(results[i+1:], i+1):
        id1, status1, created1, updated1 = row1[0], row1[1], row1[2], row1[3]
        id2, status2, created2, updated2 = row2[0], row2[1], row2[2], row2[3]
        
        if created1 and updated1 and created2 and updated2:
            # Check if execution windows overlap
            if (created1 <= created2 <= updated1) or (created2 <= created1 <= updated2):
                overlap_start = max(created1, created2)
                overlap_end = min(updated1, updated2)
                overlap_duration = (overlap_end - overlap_start).total_seconds()
                print(f"⚠️  OVERLAP: Executions {id1} and {id2} ran concurrently for {overlap_duration:.1f}s")

cur.close()
conn.close()
