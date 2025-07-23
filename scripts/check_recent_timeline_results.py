#!/usr/bin/env python3

import psycopg2
from datetime import datetime, timedelta

def check_recent_results():
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
        print(f"📊 Timeline Mapping Results Summary for {user_id}")
        print("=" * 80)
        
        # Check total annotations
        cursor.execute("""
            SELECT COUNT(*) FROM raw_timeline_event_annotations 
            WHERE user_id = %s
        """, (user_id,))
        total_annotations = cursor.fetchone()[0]
        print(f"📋 Total annotations: {total_annotations}")
        
        # Check recent annotations (last hour)
        one_hour_ago = datetime.now() - timedelta(hours=1)
        cursor.execute("""
            SELECT COUNT(*) FROM raw_timeline_event_annotations 
            WHERE user_id = %s AND created_at >= %s
        """, (user_id, one_hour_ago))
        recent_annotations = cursor.fetchone()[0]
        print(f"📋 Recent annotations (1 hour): {recent_annotations}")
        
        if total_annotations > 0:
            print("\n" + "=" * 80)
            
            # Confidence score distribution
            cursor.execute("""
                SELECT 
                    CASE 
                        WHEN confidence_score >= 0.9 THEN 'High (0.9+)'
                        WHEN confidence_score >= 0.7 THEN 'Good (0.7-0.9)'
                        WHEN confidence_score >= 0.5 THEN 'Medium (0.5-0.7)'
                        ELSE 'Low (<0.5)'
                    END as confidence_range,
                    COUNT(*) as count
                FROM raw_timeline_event_annotations 
                WHERE user_id = %s
                GROUP BY 
                    CASE 
                        WHEN confidence_score >= 0.9 THEN 'High (0.9+)'
                        WHEN confidence_score >= 0.7 THEN 'Good (0.7-0.9)'
                        WHEN confidence_score >= 0.5 THEN 'Medium (0.5-0.7)'
                        ELSE 'Low (<0.5)'
                    END
                ORDER BY MIN(confidence_score) DESC
            """, (user_id,))
            
            confidence_dist = cursor.fetchall()
            print("🎯 Confidence Score Distribution:")
            for range_name, count in confidence_dist:
                print(f"   {range_name}: {count}")
            
            # Workflow related vs unrelated
            cursor.execute("""
                SELECT is_workflow_related, COUNT(*) 
                FROM raw_timeline_event_annotations 
                WHERE user_id = %s 
                GROUP BY is_workflow_related
            """, (user_id,))
            
            related_dist = cursor.fetchall()
            print("\n🔗 Workflow Relationship:")
            for is_related, count in related_dist:
                status = "Related" if is_related else "Unrelated"
                print(f"   {status}: {count}")
                
            # Top workflow types
            cursor.execute("""
                SELECT workflow_type, COUNT(*) as count
                FROM raw_timeline_event_annotations 
                WHERE user_id = %s AND workflow_type IS NOT NULL
                GROUP BY workflow_type
                ORDER BY count DESC
                LIMIT 5
            """, (user_id,))
            
            workflow_types = cursor.fetchall()
            if workflow_types:
                print("\n🔄 Top Workflow Types:")
                for wf_type, count in workflow_types:
                    print(f"   {wf_type}: {count}")
            
            # Sample annotations
            cursor.execute("""
                SELECT 
                    raw_event_id,
                    confidence_score,
                    is_workflow_related,
                    workflow_type,
                    workflow_step,
                    created_at
                FROM raw_timeline_event_annotations 
                WHERE user_id = %s 
                ORDER BY created_at DESC
                LIMIT 5
            """, (user_id,))
            
            samples = cursor.fetchall()
            print(f"\n📝 Sample Annotations (latest {len(samples)}):")
            for event_id, conf, related, wf_type, step, created in samples:
                rel_str = "✅" if related else "❌"
                print(f"   Event {event_id}: {conf:.2f} {rel_str} {wf_type or 'N/A'} - {step or 'N/A'}")
                
        else:
            print("\n💡 No annotations found. This could mean:")
            print("   - Timeline mapping hasn't been run recently")
            print("   - All events had confidence < 0.5 (filtered out)")
            print("   - No workflow analyses matched the time windows")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    check_recent_results() 