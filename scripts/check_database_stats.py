#!/usr/bin/env python3
"""
Comprehensive database statistics checker for backfill progress.
"""
import psycopg2
from datetime import datetime, timedelta

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def check_database_stats():
    """Check comprehensive database statistics for backfill progress."""
    print("🔍 COMPREHENSIVE DATABASE BACKFILL ANALYSIS")
    print("=" * 60)
    print(f"⏰ Analysis time: {datetime.now()}")
    print()
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # 1. Overall progress
        print("📊 OVERALL PROGRESS")
        print("-" * 30)
        
        cursor.execute("SELECT COUNT(*) FROM low_level_events")
        total_events = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM low_level_events_metadata")
        processed_events = cursor.fetchone()[0]
        
        progress_pct = (processed_events / total_events * 100) if total_events > 0 else 0
        remaining = total_events - processed_events
        
        print(f"Total events: {total_events:,}")
        print(f"Processed: {processed_events:,}")
        print(f"Progress: {progress_pct:.2f}%")
        print(f"Remaining: {remaining:,}")
        print()
        
        # 2. Processing rate analysis
        print("📈 PROCESSING RATE ANALYSIS")
        print("-" * 30)
        
        # Last hour
        one_hour_ago = datetime.now() - timedelta(hours=1)
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events_metadata 
            WHERE extracted_at >= %s
        """, (one_hour_ago,))
        last_hour = cursor.fetchone()[0]
        
        # Last 10 minutes
        ten_min_ago = datetime.now() - timedelta(minutes=10)
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events_metadata 
            WHERE extracted_at >= %s
        """, (ten_min_ago,))
        last_10_min = cursor.fetchone()[0]
        
        # Last minute
        one_min_ago = datetime.now() - timedelta(minutes=1)
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events_metadata 
            WHERE extracted_at >= %s
        """, (one_min_ago,))
        last_minute = cursor.fetchone()[0]
        
        print(f"Last hour: {last_hour:,} events ({last_hour}/hour)")
        print(f"Last 10 min: {last_10_min:,} events ({last_10_min * 6}/hour projected)")
        print(f"Last minute: {last_minute:,} events ({last_minute * 60}/hour projected)")
        
        # ETA calculation
        if last_hour > 0:
            hours_remaining = remaining / last_hour
            eta = datetime.now() + timedelta(hours=hours_remaining)
            print(f"ETA (based on last hour): {eta.strftime('%Y-%m-%d %H:%M')} ({hours_remaining:.1f} hours)")
        print()
        
        # 3. Event type distribution
        print("📋 EVENT TYPE DISTRIBUTION (TOP 10)")
        print("-" * 30)
        
        cursor.execute("""
            SELECT event_type, COUNT(*) as count
            FROM low_level_events_metadata 
            GROUP BY event_type 
            ORDER BY count DESC
            LIMIT 10
        """)
        
        for event_type, count in cursor.fetchall():
            pct = (count / processed_events * 100) if processed_events > 0 else 0
            print(f"{event_type:<20} {count:>8,} ({pct:>5.1f}%)")
        print()
        
        # 4. App name distribution
        print("🖥️  APP NAME DISTRIBUTION (TOP 10)")
        print("-" * 30)
        
        cursor.execute("""
            SELECT app_name, COUNT(*) as count
            FROM low_level_events_metadata 
            WHERE app_name IS NOT NULL
            GROUP BY app_name 
            ORDER BY count DESC
            LIMIT 10
        """)
        
        for app_name, count in cursor.fetchall():
            pct = (count / processed_events * 100) if processed_events > 0 else 0
            print(f"{app_name:<30} {count:>8,} ({pct:>5.1f}%)")
        print()
        
        # 5. UI Tree and Screenshot stats
        print("🌳 UI TREES & SCREENSHOTS")
        print("-" * 30)
        
        cursor.execute("""
            SELECT 
                COUNT(*) FILTER (WHERE has_ui_tree = true) as ui_trees,
                COUNT(*) FILTER (WHERE screenshot_timestamp IS NOT NULL) as screenshots,
                COUNT(*) as total
            FROM low_level_events_metadata
        """)
        
        ui_trees, screenshots, total = cursor.fetchone()
        ui_tree_pct = (ui_trees / total * 100) if total > 0 else 0
        screenshot_pct = (screenshots / total * 100) if total > 0 else 0
        
        print(f"Events with UI trees: {ui_trees:,} ({ui_tree_pct:.1f}%)")
        print(f"Events with screenshots: {screenshots:,} ({screenshot_pct:.1f}%)")
        print()
        
        # 6. Recent processing timeline
        print("⏰ RECENT PROCESSING TIMELINE (Last 6 hours)")
        print("-" * 30)
        
        for i in range(6):
            start_time = datetime.now() - timedelta(hours=i+1)
            end_time = datetime.now() - timedelta(hours=i)
            
            cursor.execute("""
                SELECT COUNT(*) FROM low_level_events_metadata 
                WHERE extracted_at >= %s AND extracted_at < %s
            """, (start_time, end_time))
            
            count = cursor.fetchone()[0]
            print(f"{start_time.strftime('%H:%M')}-{end_time.strftime('%H:%M')}: {count:,} events")
        print()
        
        # 7. Database size info
        print("💾 DATABASE SIZE INFO")
        print("-" * 30)
        
        cursor.execute("""
            SELECT 
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
            FROM pg_tables 
            WHERE tablename IN ('low_level_events', 'low_level_events_metadata')
            AND schemaname = 'public'
        """)
        
        for schema, table, size in cursor.fetchall():
            print(f"{table}: {size}")
        print()
        
        # 8. Status summary
        print("✅ STATUS SUMMARY")
        print("-" * 30)
        
        if progress_pct >= 90:
            status = "🟢 Nearly complete"
        elif progress_pct >= 70:
            status = "🟡 Making good progress" 
        elif progress_pct >= 50:
            status = "🟠 Halfway there"
        elif progress_pct >= 25:
            status = "🔴 Early progress"
        else:
            status = "⚪ Just started"
            
        print(f"Status: {status}")
        
        if last_minute > 0:
            print("🟢 Active processing detected")
        else:
            print("🔴 No recent processing detected")
            
        if progress_pct > 10:
            print("✅ Sufficient data for testing")
        else:
            print("⏳ More data needed for testing")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    check_database_stats() 