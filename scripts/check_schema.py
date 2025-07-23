#!/usr/bin/env python3
"""Check schema of session_metadata table"""

import psycopg2
from psycopg2.extras import RealDictCursor

# Get connection string directly
conn_string = "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"

print(f"🔌 Connecting to database...")

try:
    # Connect to database
    conn = psycopg2.connect(conn_string)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Check schema of session_metadata table
    print("\n📋 SESSION_METADATA TABLE SCHEMA:")
    print("-" * 50)
    cur.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'session_metadata'
        ORDER BY ordinal_position
    """)
    columns = cur.fetchall()
    
    for col in columns:
        print(f"   {col['column_name']} ({col['data_type']}) - Nullable: {col['is_nullable']}")

    # Get count by user
    print(f"\n📊 EVENT COUNTS BY USER:")
    print("-" * 30)
    cur.execute("""
        SELECT user_id, COUNT(*) as count
        FROM session_metadata
        GROUP BY user_id
        ORDER BY count DESC
        LIMIT 10
    """)
    user_counts = cur.fetchall()
    
    for user in user_counts:
        print(f"   {user['user_id']}: {user['count']:,}")

    # Check our specific user
    print(f"\n🔍 SPECIFIC USER ANALYSIS: {user_id}")
    print("-" * 50)
    cur.execute("""
        SELECT COUNT(*) as total
        FROM session_metadata 
        WHERE user_id = %s
    """, (user_id,))
    total = cur.fetchone()['total']
    print(f"   Total events: {total:,}")

    # Get sample data
    print(f"\n📄 SAMPLE DATA (first 3 rows):")
    print("-" * 40)
    cur.execute("""
        SELECT *
        FROM session_metadata 
        WHERE user_id = %s
        LIMIT 3
    """, (user_id,))
    samples = cur.fetchall()
    
    for i, sample in enumerate(samples, 1):
        print(f"\n   Row {i}:")
        for key, value in sample.items():
            if isinstance(value, str) and len(value) > 100:
                value = value[:100] + "..."
            print(f"     {key}: {value}")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    if 'conn' in locals():
        conn.close() 