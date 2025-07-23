#!/usr/bin/env python3
"""Detailed investigation of event count discrepancy between database and cache"""

import os
import sys
from datetime import datetime, timedelta

# Get connection string directly
conn_string = "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ psycopg2 module not installed!")
    print("Install with: pip install psycopg2-binary")
    sys.exit(1)

# Use the correct user ID
user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"

print(f"🔌 Connecting to database...")
print(f"📊 Detailed Investigation for user: {user_id}")
print("="*80)

try:
    # Connect to database
    conn = psycopg2.connect(conn_string)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 1. Get current count from session_metadata
    print("\n🗂️  DATABASE COUNTS:")
    print("-" * 40)
    
    cur.execute("""
        SELECT COUNT(*) as total_events
        FROM session_metadata 
        WHERE user_id = %s
    """, (user_id,))
    db_total = cur.fetchone()['total_events']
    print(f"📋 Total events in session_metadata: {db_total:,}")

    # 2. Get event type breakdown
    cur.execute("""
        SELECT event_type, COUNT(*) as count
        FROM session_metadata 
        WHERE user_id = %s
        GROUP BY event_type
        ORDER BY count DESC
    """, (user_id,))
    event_types = cur.fetchall()
    
    print(f"\n📊 Event Type Breakdown:")
    for event_type in event_types:
        print(f"   {event_type['event_type']}: {event_type['count']:,}")

    # 3. Get time range of events
    cur.execute("""
        SELECT 
            MIN(timestamp) as earliest,
            MAX(timestamp) as latest,
            COUNT(*) as total
        FROM session_metadata 
        WHERE user_id = %s
    """, (user_id,))
    time_range = cur.fetchone()
    
    print(f"\n⏰ Time Range:")
    print(f"   Earliest: {time_range['earliest']}")
    print(f"   Latest: {time_range['latest']}")
    print(f"   Total: {time_range['total']:,}")

    # 4. Get recent events (last 24 hours)
    cur.execute("""
        SELECT COUNT(*) as recent_events
        FROM session_metadata 
        WHERE user_id = %s 
        AND timestamp >= NOW() - INTERVAL '24 hours'
    """, (user_id,))
    recent_24h = cur.fetchone()['recent_events']
    print(f"   Last 24h: {recent_24h:,}")

    # 5. Get events by hour for last 24 hours
    cur.execute("""
        SELECT 
            DATE_TRUNC('hour', timestamp) as hour,
            COUNT(*) as count
        FROM session_metadata 
        WHERE user_id = %s 
        AND timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY DATE_TRUNC('hour', timestamp)
        ORDER BY hour DESC
        LIMIT 10
    """, (user_id,))
    hourly_counts = cur.fetchall()
    
    print(f"\n📈 Recent Hourly Activity (last 10 hours):")
    for hour_data in hourly_counts:
        print(f"   {hour_data['hour']}: {hour_data['count']:,} events")

    # 6. Check if there are multiple sessions for this user
    cur.execute("""
        SELECT 
            session_id,
            COUNT(*) as event_count,
            MIN(timestamp) as session_start,
            MAX(timestamp) as session_end
        FROM session_metadata 
        WHERE user_id = %s
        GROUP BY session_id
        ORDER BY event_count DESC
        LIMIT 10
    """, (user_id,))
    sessions = cur.fetchall()
    
    print(f"\n🔗 Top Sessions by Event Count:")
    for session in sessions:
        duration = session['session_end'] - session['session_start']
        print(f"   Session {session['session_id'][:8]}...: {session['event_count']:,} events ({duration})")

    # 7. Check for events with null or problematic data
    cur.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE raw_data IS NULL) as null_raw_data,
            COUNT(*) FILTER (WHERE event_type IS NULL) as null_event_type,
            COUNT(*) FILTER (WHERE timestamp IS NULL) as null_timestamp
        FROM session_metadata 
        WHERE user_id = %s
    """, (user_id,))
    data_quality = cur.fetchone()
    
    print(f"\n🔍 Data Quality Check:")
    print(f"   Total: {data_quality['total']:,}")
    print(f"   Null raw_data: {data_quality['null_raw_data']:,}")
    print(f"   Null event_type: {data_quality['null_event_type']:,}")
    print(f"   Null timestamp: {data_quality['null_timestamp']:,}")

    # 8. Get sample of recent event IDs
    cur.execute("""
        SELECT id, event_type, timestamp
        FROM session_metadata 
        WHERE user_id = %s
        ORDER BY timestamp DESC
        LIMIT 10
    """, (user_id,))
    recent_events = cur.fetchall()
    
    print(f"\n📋 Recent Event IDs (last 10):")
    for event in recent_events:
        print(f"   ID: {event['id']} | Type: {event['event_type']} | Time: {event['timestamp']}")

    print(f"\n" + "="*80)
    print(f"🔍 SUMMARY:")
    print(f"   Database Total: {db_total:,} events")
    print(f"   Browser Cache: ~1,970 events (from interface)")
    print(f"   Discrepancy: {1970 - db_total:,} events")
    print(f"   Recent 24h: {recent_24h:,} events")
    
    if recent_24h > 0:
        print(f"\n💡 HYPOTHESIS:")
        print(f"   The cache includes events that are being continuously")
        print(f"   captured and stored locally but may not all be in the")
        print(f"   database yet, or the cache includes historical events")
        print(f"   from different time periods.")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    if 'conn' in locals():
        conn.close() 