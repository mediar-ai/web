#!/usr/bin/env python3
"""Find the actual events table and investigate the counts"""

import psycopg2
from psycopg2.extras import RealDictCursor

# Get connection string directly
conn_string = "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"

print(f"🔌 Connecting to database...")

try:
    # Connect to database
    conn = psycopg2.connect(conn_string)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Find all tables that might contain events
    print("\n📋 SEARCHING FOR EVENT TABLES:")
    print("-" * 50)
    cur.execute("""
        SELECT table_name, table_type
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND (table_name LIKE '%event%' OR table_name LIKE '%session%' OR table_name LIKE '%timeline%')
        ORDER BY table_name
    """)
    tables = cur.fetchall()
    
    for table in tables:
        print(f"   {table['table_name']} ({table['table_type']})")

    # Get session metadata totals for our user
    print(f"\n📊 SESSION METADATA TOTALS FOR USER: {user_id}")
    print("-" * 60)
    cur.execute("""
        SELECT 
            session_id,
            event_count,
            first_event_timestamp,
            last_event_timestamp
        FROM session_metadata 
        WHERE user_id = %s
        ORDER BY first_event_timestamp
    """, (user_id,))
    sessions = cur.fetchall()
    
    total_events_from_sessions = 0
    for session in sessions:
        print(f"   Session {session['session_id'][:8]}...: {session['event_count']:,} events")
        print(f"     Period: {session['first_event_timestamp']} to {session['last_event_timestamp']}")
        total_events_from_sessions += session['event_count'] or 0

    print(f"\n   📋 Total events (from session_metadata): {total_events_from_sessions:,}")

    # Check if there's a timeline_events or similar table
    print(f"\n🔍 CHECKING TIMELINE_EVENTS TABLE:")
    print("-" * 40)
    try:
        cur.execute("""
            SELECT COUNT(*) as count
            FROM timeline_events 
            WHERE user_id = %s
        """, (user_id,))
        timeline_count = cur.fetchone()['count']
        print(f"   Timeline events: {timeline_count:,}")

        # Get recent timeline events
        cur.execute("""
            SELECT event_type, COUNT(*) as count
            FROM timeline_events 
            WHERE user_id = %s
            GROUP BY event_type
            ORDER BY count DESC
            LIMIT 10
        """, (user_id,))
        event_types = cur.fetchall()
        
        print(f"\n   Event types in timeline_events:")
        for event_type in event_types:
            print(f"     {event_type['event_type']}: {event_type['count']:,}")

    except Exception as e:
        print(f"   ❌ timeline_events error: {e}")

    # Check raw_timeline_events table if it exists
    print(f"\n🔍 CHECKING RAW_TIMELINE_EVENTS TABLE:")
    print("-" * 40)
    try:
        cur.execute("""
            SELECT COUNT(*) as count
            FROM raw_timeline_events 
            WHERE user_id = %s
        """, (user_id,))
        raw_count = cur.fetchone()['count']
        print(f"   Raw timeline events: {raw_count:,}")

        # Get time range
        cur.execute("""
            SELECT 
                MIN(timestamp) as earliest,
                MAX(timestamp) as latest
            FROM raw_timeline_events 
            WHERE user_id = %s
        """, (user_id,))
        time_range = cur.fetchone()
        print(f"   Time range: {time_range['earliest']} to {time_range['latest']}")

    except Exception as e:
        print(f"   ❌ raw_timeline_events error: {e}")

    print(f"\n" + "="*80)
    print(f"🔍 FINDINGS:")
    print(f"   Session Metadata Total: {total_events_from_sessions:,} events")
    print(f"   Interface Shows: 1,342 total events")
    print(f"   Browser Cache: ~1,970 events")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    if 'conn' in locals():
        conn.close() 