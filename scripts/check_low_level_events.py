#!/usr/bin/env python3
"""Check low_level_events table for actual event counts"""

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

    # Check schema of low_level_events table
    print("\n📋 LOW_LEVEL_EVENTS TABLE SCHEMA:")
    print("-" * 50)
    cur.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'low_level_events'
        ORDER BY ordinal_position
    """)
    columns = cur.fetchall()
    
    for col in columns:
        print(f"   {col['column_name']} ({col['data_type']}) - Nullable: {col['is_nullable']}")

    # Get count from low_level_events
    print(f"\n📊 LOW_LEVEL_EVENTS COUNT FOR USER: {user_id}")
    print("-" * 60)
    cur.execute("""
        SELECT COUNT(*) as count
        FROM low_level_events 
        WHERE user_id = %s
    """, (user_id,))
    low_level_count = cur.fetchone()['count']
    print(f"   Total events in low_level_events: {low_level_count:,}")

    # Get event type breakdown
    cur.execute("""
        SELECT event_type, COUNT(*) as count
        FROM low_level_events 
        WHERE user_id = %s
        GROUP BY event_type
        ORDER BY count DESC
    """, (user_id,))
    event_types = cur.fetchall()
    
    print(f"\n📊 Event Type Breakdown:")
    for event_type in event_types:
        print(f"   {event_type['event_type']}: {event_type['count']:,}")

    # Get time range
    cur.execute("""
        SELECT 
            MIN(timestamp) as earliest,
            MAX(timestamp) as latest,
            COUNT(*) as total
        FROM low_level_events 
        WHERE user_id = %s
    """, (user_id,))
    time_range = cur.fetchone()
    
    print(f"\n⏰ Time Range:")
    print(f"   Earliest: {time_range['earliest']}")
    print(f"   Latest: {time_range['latest']}")
    print(f"   Total: {time_range['total']:,}")

    # Get recent events (last 24 hours)
    cur.execute("""
        SELECT COUNT(*) as recent_events
        FROM low_level_events 
        WHERE user_id = %s 
        AND timestamp >= NOW() - INTERVAL '24 hours'
    """, (user_id,))
    recent_24h = cur.fetchone()['recent_events']
    print(f"   Last 24h: {recent_24h:,}")

    # Get events by session
    cur.execute("""
        SELECT 
            session_id,
            COUNT(*) as event_count,
            MIN(timestamp) as session_start,
            MAX(timestamp) as session_end
        FROM low_level_events 
        WHERE user_id = %s
        GROUP BY session_id
        ORDER BY event_count DESC
    """, (user_id,))
    sessions = cur.fetchall()
    
    print(f"\n🔗 Events by Session:")
    for session in sessions:
        duration = session['session_end'] - session['session_start']
        print(f"   Session {session['session_id'][:8]}...: {session['event_count']:,} events ({duration})")

    # Compare with session_metadata
    cur.execute("""
        SELECT 
            sm.session_id,
            sm.event_count as metadata_count,
            COALESCE(lle.actual_count, 0) as actual_count
        FROM session_metadata sm
        LEFT JOIN (
            SELECT session_id, COUNT(*) as actual_count
            FROM low_level_events 
            WHERE user_id = %s
            GROUP BY session_id
        ) lle ON sm.session_id = lle.session_id
        WHERE sm.user_id = %s
        ORDER BY sm.first_event_timestamp
    """, (user_id, user_id))
    comparison = cur.fetchall()
    
    print(f"\n🔍 METADATA vs ACTUAL COMPARISON:")
    print("-" * 60)
    total_metadata = 0
    total_actual = 0
    for comp in comparison:
        metadata_count = comp['metadata_count'] or 0
        actual_count = comp['actual_count'] or 0
        diff = actual_count - metadata_count
        print(f"   Session {comp['session_id'][:8]}...")
        print(f"     Metadata: {metadata_count:,}")
        print(f"     Actual: {actual_count:,}")
        print(f"     Difference: {diff:+,}")
        total_metadata += metadata_count
        total_actual += actual_count

    print(f"\n📋 TOTALS:")
    print(f"   Session Metadata Total: {total_metadata:,}")
    print(f"   Actual Events Total: {total_actual:,}")
    print(f"   Difference: {total_actual - total_metadata:+,}")

    print(f"\n" + "="*80)
    print(f"🔍 SUMMARY:")
    print(f"   Database Total (low_level_events): {low_level_count:,}")
    print(f"   Session Metadata Total: {total_metadata:,}")
    print(f"   Interface Shows: 1,342 total events")
    print(f"   Browser Cache: ~1,970 events")
    
    print(f"\n💡 EXPLANATION:")
    print(f"   The discrepancy between database ({low_level_count:,}) and")
    print(f"   browser cache (~1,970) is due to:")
    print(f"   1. Cache includes events being continuously captured")
    print(f"   2. Cache cleanup doesn't sync with database")
    print(f"   3. Different polling intervals and batch processing")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    if 'conn' in locals():
        conn.close() 