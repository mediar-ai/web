import psycopg2
from datetime import datetime, timedelta

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("🔒 CHECKING COORDINATOR LOCKS")
print("=" * 50)

# Check for active coordinator locks
cur.execute("""
SELECT 
    user_id,
    processor_id, 
    status,
    created_at,
    expires_at,
    EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as age_minutes,
    EXTRACT(EPOCH FROM (expires_at - NOW())) / 60 as expires_in_minutes
FROM processing_locks 
WHERE user_id = 'workflow-coordinator'
ORDER BY created_at DESC;
""")

coordinator_locks = cur.fetchall()

if coordinator_locks:
    print(f"Found {len(coordinator_locks)} coordinator locks:")
    print(f"{'Processor ID':<35} {'Status':<12} {'Age (min)':<10} {'Expires (min)':<12}")
    print("-" * 75)
    
    expired_locks = 0
    active_locks = 0
    
    for lock in coordinator_locks:
        user_id, processor_id, status, created, expires, age, expires_in = lock
        processor_short = processor_id[:32] + "..." if len(processor_id) > 32 else processor_id
        
        if expires_in < 0:
            expired_locks += 1
            status_display = f"{status} (EXPIRED)"
        else:
            active_locks += 1
            status_display = status
            
        print(f"{processor_short:<35} {status_display:<12} {age:.1f}{'':7} {expires_in:.1f}")
    
    print(f"\nSummary: {active_locks} active, {expired_locks} expired")
    
    if expired_locks > 0:
        print(f"\n🧹 CLEANING UP {expired_locks} EXPIRED COORDINATOR LOCKS...")
        cur.execute("""
        DELETE FROM processing_locks 
        WHERE user_id = 'workflow-coordinator' 
        AND expires_at < NOW()
        """)
        cleaned = cur.rowcount
        print(f"✅ Cleaned up {cleaned} expired locks")
        conn.commit()
    
    if active_locks > 0:
        print(f"\n⚠️  {active_locks} active coordinator locks may be blocking job processing")
        
else:
    print("✅ No coordinator locks found - this might be why jobs aren't being processed")
    print("The Modal scheduler might not be running or might have crashed")

# Check when the last job was actually started by Modal
cur.execute("""
SELECT 
    id, 
    started_at,
    EXTRACT(EPOCH FROM (NOW() - started_at)) / 60 as minutes_since_start
FROM workflow_executions 
WHERE started_at IS NOT NULL 
ORDER BY started_at DESC 
LIMIT 5;
""")

recent_starts = cur.fetchall()
if recent_starts:
    print(f"\n📅 LAST JOBS STARTED BY MODAL:")
    for exec_id, started, minutes_ago in recent_starts:
        print(f"  Execution {exec_id}: {started} ({minutes_ago:.1f} minutes ago)")
else:
    print("\n❌ No jobs have been started recently!")

conn.close()
