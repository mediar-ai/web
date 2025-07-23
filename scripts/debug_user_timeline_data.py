#!/usr/bin/env python3

import psycopg2
from datetime import datetime, timedelta

def debug_user_data():
    # Database connection
    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        database="postgres", 
        user="postgres.eshwntsgsputksqamckh",
        password="dS64xX6mU3E4Sbyc",
        port="5432"
    )
    
    cursor = conn.cursor()
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    try:
        print(f"🔍 Debugging timeline data for user: {user_id}")
        print("=" * 80)
        
        # 1. Check total events for this user
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events 
            WHERE user_id = %s
        """, (user_id,))
        total_events = cursor.fetchone()[0]
        print(f"📊 Total events for user: {total_events:,}")
        
        # 2. Check recent events (last 7 days)
        seven_days_ago = datetime.now() - timedelta(days=7)
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events 
            WHERE user_id = %s AND created_at >= %s
        """, (user_id, seven_days_ago))
        recent_events = cursor.fetchone()[0]
        print(f"📊 Recent events (7 days): {recent_events:,}")
        
        # 3. Check UI tree events
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events 
            WHERE user_id = %s 
            AND created_at >= %s
            AND payload->'payload'->>'type' = 'ui_tree'
        """, (user_id, seven_days_ago))
        ui_tree_events = cursor.fetchone()[0]
        print(f"📊 Recent UI tree events: {ui_tree_events}")
        
        # 4. Check workflow analyses for this user
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_workflow_analyses 
            WHERE user_id = %s
        """, (user_id,))
        total_analyses = cursor.fetchone()[0]
        print(f"📊 Total workflow analyses: {total_analyses}")
        
        # 5. Check recent workflow analyses
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_workflow_analyses 
            WHERE user_id = %s AND created_at >= %s
        """, (user_id, seven_days_ago))
        recent_analyses = cursor.fetchone()[0]
        print(f"📊 Recent workflow analyses (7 days): {recent_analyses}")
        
        print("\n" + "=" * 80)
        
        # 6. Sample UI tree events (first 3)
        if ui_tree_events > 0:
            print("📝 Sample UI tree events:")
            cursor.execute("""
                SELECT id, created_at, payload->'payload'->>'type' as event_type
                FROM low_level_events 
                WHERE user_id = %s 
                AND created_at >= %s
                AND payload->'payload'->>'type' = 'ui_tree'
                ORDER BY created_at DESC
                LIMIT 3
            """, (user_id, seven_days_ago))
            
            for row in cursor.fetchall():
                event_id, created_at, event_type = row
                print(f"   Event {event_id}: {created_at} ({event_type})")
        
        # 7. Sample workflow analyses (first 3)
        if recent_analyses > 0:
            print("\n📝 Sample workflow analyses:")
            cursor.execute("""
                SELECT id, created_at, window_title
                FROM low_level_workflow_analyses 
                WHERE user_id = %s AND created_at >= %s
                ORDER BY created_at DESC
                LIMIT 3
            """, (user_id, seven_days_ago))
            
            for row in cursor.fetchall():
                analysis_id, created_at, window_title = row
                print(f"   Analysis {analysis_id}: {created_at} ({window_title})")
        
        # 8. Check time overlap
        if ui_tree_events > 0 and recent_analyses > 0:
            print("\n⏰ Time Range Comparison:")
            
            # UI events time range
            cursor.execute("""
                SELECT MIN(created_at), MAX(created_at)
                FROM low_level_events 
                WHERE user_id = %s 
                AND created_at >= %s
                AND payload->'payload'->>'type' = 'ui_tree'
            """, (user_id, seven_days_ago))
            ui_min, ui_max = cursor.fetchone()
            print(f"   UI events: {ui_min} → {ui_max}")
            
            # Analyses time range
            cursor.execute("""
                SELECT MIN(created_at), MAX(created_at)
                FROM low_level_workflow_analyses 
                WHERE user_id = %s AND created_at >= %s
            """, (user_id, seven_days_ago))
            analysis_min, analysis_max = cursor.fetchone()
            print(f"   Analyses:  {analysis_min} → {analysis_max}")
            
            # Check if ranges overlap
            overlap = not (ui_max < analysis_min or analysis_max < ui_min)
            print(f"   Time overlap: {'✅ YES' if overlap else '❌ NO'}")
        
        print("\n" + "=" * 80)
        print("💡 Diagnosis:")
        if ui_tree_events == 0:
            print("   ❌ No UI tree events in recent data - timeline mapping needs UI events")
        elif recent_analyses == 0:
            print("   ❌ No workflow analyses in recent data - nothing to map against")
        elif ui_tree_events > 0 and recent_analyses > 0:
            print("   ✅ Both UI events and analyses exist - should be able to map!")
        else:
            print("   ⚠️ Data exists but may not overlap in time")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    debug_user_data() 