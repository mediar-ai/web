#!/usr/bin/env python3

import psycopg2
from datetime import datetime, timedelta

def check_alignment():
    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        database="postgres", 
        user="postgres.eshwntsgsputksqamckh",
        password="dS64xX6mU3E4Sbyc",
        port="5432"
    )
    
    cursor = conn.cursor()
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    seven_days_ago = datetime.now() - timedelta(days=7)
    
    try:
        print("🕐 Checking time alignment between UI events and analyses...")
        print("=" * 80)
        
        # Find UI events that have analyses within 5 minutes
        cursor.execute("""
            WITH ui_events AS (
                SELECT id, created_at
                FROM low_level_events 
                WHERE user_id = %s 
                AND created_at >= %s
                AND payload->'payload'->>'type' = 'ui_tree'
                ORDER BY created_at
            ),
            analyses AS (
                SELECT id, created_at
                FROM low_level_workflow_analyses 
                WHERE user_id = %s 
                AND created_at >= %s
                ORDER BY created_at
            )
            SELECT 
                u.id as ui_event_id,
                u.created_at as ui_time,
                a.id as analysis_id,
                a.created_at as analysis_time,
                ABS(EXTRACT(EPOCH FROM (u.created_at - a.created_at))) as time_diff_seconds
            FROM ui_events u
            LEFT JOIN analyses a ON (
                ABS(EXTRACT(EPOCH FROM (u.created_at - a.created_at))) <= 300
            )
            WHERE a.id IS NOT NULL
            ORDER BY u.created_at
            LIMIT 10
        """, (user_id, seven_days_ago, user_id, seven_days_ago))
        
        matches = cursor.fetchall()
        
        if matches:
            print(f"✅ Found {len(matches)} UI events with nearby analyses (within 5 minutes):")
            for match in matches:
                ui_id, ui_time, analysis_id, analysis_time, diff = match
                print(f"   UI {ui_id} ({ui_time}) ↔ Analysis {analysis_id} ({analysis_time}) [Δ{diff:.0f}s]")
        else:
            print("❌ No UI events have analyses within 5-minute window")
            
        print("\n" + "=" * 80)
        
        # Check what happens if we expand the time window
        for window_minutes in [10, 30, 60]:
            cursor.execute("""
                WITH ui_events AS (
                    SELECT id, created_at
                    FROM low_level_events 
                    WHERE user_id = %s 
                    AND created_at >= %s
                    AND payload->'payload'->>'type' = 'ui_tree'
                ),
                analyses AS (
                    SELECT id, created_at
                    FROM low_level_workflow_analyses 
                    WHERE user_id = %s 
                    AND created_at >= %s
                )
                SELECT COUNT(DISTINCT u.id)
                FROM ui_events u
                LEFT JOIN analyses a ON (
                    ABS(EXTRACT(EPOCH FROM (u.created_at - a.created_at))) <= %s
                )
                WHERE a.id IS NOT NULL
            """, (user_id, seven_days_ago, user_id, seven_days_ago, window_minutes * 60))
            
            count = cursor.fetchone()[0]
            print(f"📊 {window_minutes}-minute window: {count}/110 UI events have matching analyses")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    check_alignment() 