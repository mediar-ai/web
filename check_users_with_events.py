import psycopg2
import json

# Connect to database
conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

# Query for users with low-level events
cur.execute("""
SELECT 
    user_id,
    COUNT(*) as event_count,
    MAX(created_at) as latest_event
FROM low_level_events 
GROUP BY user_id 
ORDER BY event_count DESC 
LIMIT 10;
""")

results = cur.fetchall()

print("🔍 USERS WITH LOW-LEVEL EVENTS:")
print("=" * 80)
print(f"{'User ID':<40} {'Event Count':<12} {'Latest Event':<20}")
print("-" * 80)

for row in results:
    user_id, event_count, latest_event = row
    latest_str = latest_event.strftime("%Y-%m-%d %H:%M:%S") if latest_event else "N/A"
    print(f"{user_id:<40} {event_count:<12} {latest_str:<20}")

cur.close()
conn.close() 