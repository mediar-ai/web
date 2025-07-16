import psycopg2
from datetime import datetime

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

print("🔧 MANUALLY MARKING EXECUTION 3889 AS FAILED")
print("=" * 50)

# Check current status first
cur.execute("SELECT id, status, started_at FROM workflow_executions WHERE id = 3889")
current = cur.fetchone()
if current:
    print(f"Current status: {current[1]}")
    print(f"Started at: {current[2]}")
else:
    print("❌ Execution 3889 not found")
    exit()

# Mark as failed with appropriate error message
cur.execute("""
UPDATE workflow_executions 
SET 
    status = 'failed',
    completed_at = NOW(),
    error_message = 'Manual intervention: Execution stuck for 93+ minutes, marked as failed'
WHERE id = 3889
RETURNING id, status, completed_at;
""")

result = cur.fetchone()
if result:
    print(f"✅ Execution {result[0]} marked as {result[1]}")
    print(f"✅ Completed at: {result[2]}")
else:
    print("❌ Failed to update execution")

# Commit the changes
conn.commit()
conn.close()

print("\n🎯 Execution 3889 has been manually marked as failed!")
