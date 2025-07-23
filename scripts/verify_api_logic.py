#!/usr/bin/env python3
"""Verify the exact API logic that returns the total event count"""

import psycopg2
from psycopg2.extras import RealDictCursor

# Get connection string directly
conn_string = "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"

print(f"🔌 Connecting to database...")
print(f"🧪 Replicating API Logic for user: {user_id}")
print("="*80)

try:
    # Connect to database
    conn = psycopg2.connect(conn_string)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # REPLICATE THE EXACT API LOGIC:
    # const { data: totalCountData, error: totalCountError } = await supabaseAdmin
    #   .from('session_metadata')
    #   .select('event_count')
    #   .eq('user_id', userId);
    
    print(f"\n📊 REPLICATING API QUERY:")
    print("-" * 50)
    cur.execute("""
        SELECT event_count
        FROM session_metadata
        WHERE user_id = %s
    """, (user_id,))
    
    session_counts = cur.fetchall()
    
    # REPLICATE THE REDUCE LOGIC:
    # const totalEventCount = totalCountData?.reduce((sum, row) => sum + (row.event_count || 0), 0) || 0;
    
    total_from_api_logic = 0
    print(f"📋 Session Event Counts:")
    for i, row in enumerate(session_counts, 1):
        event_count = row['event_count'] or 0  # Handle null values like || 0 in JS
        total_from_api_logic += event_count
        print(f"   Session {i}: {event_count:,} events")
    
    print(f"\n🔢 API CALCULATION:")
    print(f"   Total from API logic: {total_from_api_logic:,}")

    # Compare with actual counts in low_level_events
    cur.execute("""
        SELECT COUNT(*) as actual_count
        FROM low_level_events
        WHERE user_id = %s
    """, (user_id,))
    actual_count = cur.fetchone()['actual_count']
    
    print(f"   Actual in low_level_events: {actual_count:,}")
    print(f"   Difference: {actual_count - total_from_api_logic:+,}")

    # Check for any sessions with null event_count
    cur.execute("""
        SELECT 
            session_id,
            event_count,
            CASE WHEN event_count IS NULL THEN 'NULL' ELSE 'NOT NULL' END as count_status
        FROM session_metadata
        WHERE user_id = %s
        ORDER BY first_event_timestamp
    """, (user_id,))
    
    sessions_detail = cur.fetchall()
    
    print(f"\n🔍 DETAILED SESSION ANALYSIS:")
    print("-" * 50)
    for session in sessions_detail:
        print(f"   Session {session['session_id'][:8]}...")
        print(f"     event_count: {session['event_count']} ({session['count_status']})")

    # Check if there are any recent updates to session_metadata
    cur.execute("""
        SELECT 
            session_id,
            event_count,
            last_event_timestamp,
            created_at
        FROM session_metadata
        WHERE user_id = %s
        ORDER BY last_event_timestamp DESC
    """, (user_id,))
    
    recent_sessions = cur.fetchall()
    
    print(f"\n⏰ SESSIONS BY LAST EVENT TIME:")
    print("-" * 50)
    for session in recent_sessions:
        print(f"   Session {session['session_id'][:8]}...")
        print(f"     Count: {session['event_count']:,}")
        print(f"     Last Event: {session['last_event_timestamp']}")
        print(f"     Created: {session['created_at']}")

    # Let's also check the current browser interface state
    print(f"\n📱 CURRENT STATE COMPARISON:")
    print("-" * 40)
    print(f"   API Logic Result: {total_from_api_logic:,}")
    print(f"   Interface Shows: 1,342 (from browser)")
    print(f"   Browser Cache: ~1,970 (from IndexedDB)")
    print(f"   Actual DB Count: {actual_count:,}")

    # Final explanation
    print(f"\n💡 EXPLANATION OF DISCREPANCY:")
    print("-" * 50)
    if total_from_api_logic == 1342:
        print(f"   ✅ API logic matches interface (1,342)")
        print(f"   The difference with actual DB count ({actual_count:,}) suggests")
        print(f"   session_metadata event_count may be outdated.")
    elif total_from_api_logic == actual_count:
        print(f"   ✅ API logic matches actual DB count ({actual_count:,})")
        print(f"   The interface showing 1,342 may be using cached data.")
    else:
        print(f"   ❌ API logic ({total_from_api_logic:,}) doesn't match either")
        print(f"   Interface (1,342) or actual DB ({actual_count:,})")

    print(f"\n🏆 CACHE EXPLANATION:")
    print(f"   The browser cache (~1,970) is higher because:")
    print(f"   1. IndexedDB stores events from continuous polling")
    print(f"   2. Cache includes recent events not yet in final DB state")
    print(f"   3. Cache cleanup operates independently from DB sync")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    if 'conn' in locals():
        conn.close() 