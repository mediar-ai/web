#!/usr/bin/env python3
"""Investigate event count discrepancy between database and cache"""

import os
import sys

# Get connection string directly
conn_string = "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

try:
    import psycopg2
except ImportError:
    print("❌ psycopg2 module not installed!")
    print("Install with: pip install psycopg2-binary")
    sys.exit(1)

print(f"🔌 Connecting to database...")

try:
    # Connect to database
    conn = psycopg2.connect(conn_string)
    cur = conn.cursor()

    # First, find all user IDs to identify the correct one
    print("\n🔍 Finding User IDs:")
    cur.execute("""
        SELECT DISTINCT user_id, COUNT(*) as event_count
        FROM low_level_events 
        GROUP BY user_id
        ORDER BY event_count DESC
        LIMIT 10
    """)
    users = cur.fetchall()
    print("   Top users by event count:")
    for user_id, count in users:
        print(f"   - {user_id}: {count} events")

    # Use the specific user that matches the interface (1,333 events ≈ 1,315 shown)
    target_user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    print(f"\n🎯 Investigating user matching interface: {target_user_id}")
    
    print(f"\n📊 Investigating event counts for user: {target_user_id}")
    print("="*60)

    # First, check the structure of session_metadata table
    print("\n🔍 Session Metadata Table Structure:")
    cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'session_metadata'
        ORDER BY ordinal_position
    """)
    columns = cur.fetchall()
    print("   Columns:", [col[0] for col in columns])

    # 1. Check session_metadata event counts (what API uses for totalEventCount)
    print("\n1️⃣ Session Metadata Count (API totalEventCount source):")
    cur.execute("""
        SELECT session_id, event_count, created_at 
        FROM session_metadata 
        WHERE user_id = %s
        ORDER BY created_at DESC
    """, (target_user_id,))
    
    sessions = cur.fetchall()
    total_session_events = 0
    
    if sessions:
        print(f"   Found {len(sessions)} sessions:")
        for session_id, event_count, created_at in sessions:  # Show all since there are only 4
            print(f"   - Session {session_id}: {event_count or 0} events (created: {created_at})")
            total_session_events += event_count or 0
        print(f"   📊 TOTAL from session_metadata: {total_session_events}")
    else:
        print("   ❌ No sessions found in session_metadata")

    # 2. Check actual low_level_events count
    print("\n2️⃣ Actual Low Level Events Count:")
    cur.execute("SELECT COUNT(*) FROM low_level_events WHERE user_id = %s", (target_user_id,))
    actual_event_count = cur.fetchone()[0]
    print(f"   📊 ACTUAL count in low_level_events: {actual_event_count}")

    # 3. Check low_level_events_enriched count
    print("\n3️⃣ Enriched Events Count (API query source):")
    cur.execute("SELECT COUNT(*) FROM low_level_events_enriched WHERE user_id = %s", (target_user_id,))
    enriched_count = cur.fetchone()[0]
    print(f"   📊 COUNT in low_level_events_enriched: {enriched_count}")

    # 4. Check UI tree events specifically
    print("\n4️⃣ UI Tree Events Count:")
    cur.execute("""
        SELECT COUNT(*) 
        FROM low_level_events_enriched 
        WHERE user_id = %s AND event_type = 'ui_tree'
    """, (target_user_id,))
    ui_tree_count = cur.fetchone()[0]
    print(f"   📊 UI tree events: {ui_tree_count}")

    # 5. Check event type distribution
    print("\n5️⃣ Event Type Distribution:")
    cur.execute("""
        SELECT event_type, COUNT(*) 
        FROM low_level_events_enriched 
        WHERE user_id = %s 
        GROUP BY event_type 
        ORDER BY COUNT(*) DESC
    """, (target_user_id,))
    
    event_types = cur.fetchall()
    for event_type, count in event_types:
        print(f"   - {event_type or 'NULL'}: {count}")

    # 6. Check for recent events
    print("\n6️⃣ Recent Events Sample:")
    cur.execute("""
        SELECT id, created_at, event_type 
        FROM low_level_events_enriched 
        WHERE user_id = %s 
        ORDER BY created_at DESC 
        LIMIT 10
    """, (target_user_id,))
    
    recent_events = cur.fetchall()
    for event_id, created_at, event_type in recent_events:
        print(f"   - Event {event_id}: {event_type} at {created_at}")

    # 7. Check distinct sessions in low_level_events
    print("\n7️⃣ Sessions in Events vs Session Metadata:")
    cur.execute("""
        SELECT COUNT(DISTINCT session_id) 
        FROM low_level_events 
        WHERE user_id = %s
    """, (target_user_id,))
    sessions_in_events = cur.fetchone()[0]
    print(f"   📊 Distinct sessions in low_level_events: {sessions_in_events}")
    print(f"   📊 Sessions in session_metadata: {len(sessions)}")

    # 8. Check if there are events not in session_metadata
    print("\n8️⃣ Orphaned Events (not in session_metadata):")
    cur.execute("""
        SELECT COUNT(*) 
        FROM low_level_events lle
        LEFT JOIN session_metadata sm ON lle.session_id = sm.session_id
        WHERE lle.user_id = %s AND sm.session_id IS NULL
    """, (target_user_id,))
    orphaned_count = cur.fetchone()[0]
    print(f"   📊 Events without session_metadata: {orphaned_count}")

    # 9. Check recent activity and timing
    print("\n9️⃣ Recent Activity Timing:")
    cur.execute("""
        SELECT DATE(created_at) as date, COUNT(*) as daily_count
        FROM low_level_events 
        WHERE user_id = %s 
        AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
    """, (target_user_id,))
    
    daily_counts = cur.fetchall()
    for date, count in daily_counts:
        print(f"   - {date}: {count} events")

    # Summary
    print("\n" + "="*60)
    print("📋 SUMMARY:")
    print(f"   Session Metadata Total: {total_session_events}")
    print(f"   Actual Events Count: {actual_event_count}")  
    print(f"   Enriched View Count: {enriched_count}")
    print(f"   UI Tree Events: {ui_tree_count}")
    print(f"   Sessions in Events: {sessions_in_events}")
    print(f"   Sessions in Metadata: {len(sessions)}")
    print(f"   Orphaned Events: {orphaned_count}")
    
    print("\n🤔 ANALYSIS:")
    if total_session_events != actual_event_count:
        print(f"   ⚠️  Session metadata ({total_session_events}) != actual events ({actual_event_count})")
        if total_session_events < actual_event_count:
            print(f"   📈 Session metadata is missing {actual_event_count - total_session_events} events")
        else:
            print("   📉 Session metadata might be counting deleted/moved events")
    
    if actual_event_count != enriched_count:
        print(f"   ⚠️  Raw events ({actual_event_count}) != enriched view ({enriched_count})")
        print("   📝 The enriched view might have different filtering logic")
    
    if total_session_events == enriched_count:
        print("   ✅ Session metadata matches enriched view - this is what API returns")
        print(f"   📊 API returns totalEventCount: {total_session_events}")
    
    if orphaned_count > 0:
        print(f"   🔗 {orphaned_count} events exist without corresponding session_metadata")
    
    print(f"\n💾 THEORY about discrepancy:")
    print(f"   📊 Database API returns: {total_session_events} (from session_metadata)")
    print(f"   💾 IndexedDB cached: 2244 events (shown in interface)")
    print(f"   🔄 Possible reasons for cache having more:")
    print(f"      1. Cache includes events from before session_metadata was created")
    print(f"      2. Cache includes events that were later deleted from session_metadata")
    print(f"      3. Cache includes events from different time periods")
    print(f"      4. Cache might include events from other users or sessions")

    cur.close()
    conn.close()

except Exception as e:
    print(f"\n❌ Investigation failed: {e}")
    import traceback
    traceback.print_exc() 