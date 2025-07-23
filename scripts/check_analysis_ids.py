#!/usr/bin/env python3

import psycopg2
from datetime import datetime, timedelta

def check_analysis_ids():
    conn = psycopg2.connect(
        host="aws-0-us-west-1.pooler.supabase.com",
        database="postgres", 
        user="postgres.eshwntsgsputksqamckh",
        password="***REMOVED***",
        port="5432"
    )
    
    cursor = conn.cursor()
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    seven_days_ago = datetime.now() - timedelta(days=7)
    
    try:
        print(f"🔍 Checking Analysis IDs for {user_id}")
        print("=" * 80)
        
        # Check what analysis IDs exist for this user
        cursor.execute("""
            SELECT id, created_at, window_title
            FROM low_level_workflow_analyses 
            WHERE user_id = %s AND created_at >= %s
            ORDER BY created_at DESC
            LIMIT 10
        """, (user_id, seven_days_ago))
        
        analyses = cursor.fetchall()
        
        if analyses:
            print(f"✅ Found {len(analyses)} recent workflow analyses:")
            for analysis_id, created_at, window_title in analyses:
                print(f"   ID: {analysis_id} | {created_at} | {window_title}")
        else:
            print("❌ No recent workflow analyses found")
            
        print("\n" + "=" * 80)
        
        # Check if analysis_id=1 exists at all
        cursor.execute("""
            SELECT id, created_at, user_id, window_title
            FROM low_level_workflow_analyses 
            WHERE id = 1
        """)
        
        analysis_1 = cursor.fetchone()
        if analysis_1:
            aid, created, uid, title = analysis_1
            print(f"📋 Analysis ID=1 exists: User={uid}, Created={created}, Title={title}")
        else:
            print("❌ Analysis ID=1 does NOT exist in database")
            
        print("\n" + "=" * 80)
        print("💡 Diagnosis:")
        if not analyses:
            print("   - No recent analyses for this user")
        elif not analysis_1:
            print("   - LLM is returning hardcoded 'analysis_id: 1' instead of actual IDs")
            print("   - Need to fix LLM prompt/response parsing")
        else:
            print("   - Check LLM prompt to ensure correct analysis_id is passed")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    check_analysis_ids() 