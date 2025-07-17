#!/usr/bin/env python3

import psycopg2
import json
from collections import Counter

def check_status_distribution():
    """Check the distribution of execution statuses in the database"""
    try:
        # Connect to database (using same connection string as other scripts)
        conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
        cur = conn.cursor()
        
        # Get status distribution
        print("🔍 Fetching execution status distribution...")
        cur.execute("SELECT status FROM workflow_executions;")
        statuses = [row[0] for row in cur.fetchall()]
        
        print(f"📊 Total executions: {len(statuses)}")
        
        # Count status distribution
        status_counts = Counter(statuses)
        
        print("\n📈 Status distribution:")
        for status, count in sorted(status_counts.items()):
            percentage = (count / len(statuses)) * 100
            print(f"  {status}: {count} ({percentage:.1f}%)")
        
        # Show recent failed executions to understand their value
        print("\n🔍 Recent failed executions (last 5):")
        cur.execute("""
            SELECT id, workflow_id, status, error_message, created_at 
            FROM workflow_executions 
            WHERE status = 'failed' 
            ORDER BY id DESC 
            LIMIT 5;
        """)
        
        for row in cur.fetchall():
            execution_id, workflow_id, status, error_message, created_at = row
            error_preview = error_message[:100] + '...' if error_message and len(error_message) > 100 else (error_message or 'No error message')
            print(f"  ID {execution_id}: workflow_{workflow_id} - {error_preview}")
        
        # Check if failed executions have duplicate parameters (cache potential)
        print("\n🎯 Failed executions with duplicate parameters:")
        cur.execute("""
            SELECT execution_params, COUNT(*) as count
            FROM workflow_executions 
            WHERE status = 'failed' 
            GROUP BY execution_params
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC;
        """)
        
        duplicate_param_groups = cur.fetchall()
        total_duplicate_failed = sum(count for _, count in duplicate_param_groups)
        
        for execution_params, count in duplicate_param_groups[:5]:  # Show top 5
            print(f"  {count} failed executions with same parameters")
        
        print(f"\n💡 Cache potential for failed executions: {total_duplicate_failed} executions could benefit from caching")
        
        # Also check completed executions for comparison
        cur.execute("""
            SELECT execution_params, COUNT(*) as count
            FROM workflow_executions 
            WHERE status = 'completed' 
            GROUP BY execution_params
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC
            LIMIT 5;
        """)
        
        completed_duplicates = cur.fetchall()
        total_duplicate_completed = sum(count for _, count in completed_duplicates)
        
        print(f"\n✅ Completed executions with duplicate parameters: {total_duplicate_completed} (currently cached)")
        
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    check_status_distribution() 