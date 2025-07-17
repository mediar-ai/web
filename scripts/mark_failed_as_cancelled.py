#!/usr/bin/env python3

import psycopg2
from datetime import datetime

def mark_failed_as_cancelled():
    """
    Mark failed workflow executions as cancelled, except for the 3 earliest ones.
    Based on the analysis, the failure streak started at execution ID 4570.
    Keep IDs 4570, 4571, 4572 as 'failed' for analysis.
    Mark all other failed executions as 'cancelled'.
    """
    try:
        # Connect to database
        conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
        cur = conn.cursor()
        
        print("🔍 MARKING FAILED JOBS AS CANCELLED")
        print("=" * 80)
        
        # First, get the count of failed jobs
        cur.execute("""
        SELECT COUNT(*) 
        FROM workflow_executions 
        WHERE status = 'failed';
        """)
        
        total_failed = cur.fetchone()[0]
        print(f"📊 Total failed executions: {total_failed}")
        
        # Get the earliest failed executions to understand the range
        cur.execute("""
        SELECT id, created_at, error_message 
        FROM workflow_executions 
        WHERE status = 'failed' 
        ORDER BY id ASC 
        LIMIT 5;
        """)
        
        earliest_failed = cur.fetchall()
        print(f"\n🔍 Earliest failed executions:")
        for id_, created, error in earliest_failed:
            error_preview = error[:50] + '...' if error and len(error) > 50 else (error or 'No error')
            print(f"  ID {id_}: {created} - {error_preview}")
        
        # Based on our analysis, the failure streak started at ID 4570
        # Keep the first 3 failures (4570, 4571, 4572) as 'failed' for analysis
        keep_failed_ids = [4570, 4571, 4572]
        
        print(f"\n📋 Keeping these executions as 'failed' for analysis:")
        for keep_id in keep_failed_ids:
            print(f"  ID {keep_id}")
        
        # Count how many will be changed to cancelled
        cur.execute("""
        SELECT COUNT(*) 
        FROM workflow_executions 
        WHERE status = 'failed' 
        AND id NOT IN (4570, 4571, 4572);
        """)
        
        will_be_cancelled = cur.fetchone()[0]
        print(f"\n🔄 Will mark {will_be_cancelled} executions as 'cancelled'")
        
        # Ask for confirmation
        confirmation = input(f"\n⚠️  Are you sure you want to mark {will_be_cancelled} failed executions as 'cancelled'? (y/N): ")
        
        if confirmation.lower() != 'y':
            print("❌ Operation cancelled by user")
            return
        
        # Update the status to 'cancelled' for all failed executions except the first 3
        print(f"\n🔄 Updating execution statuses...")
        
        cur.execute("""
        UPDATE workflow_executions 
        SET 
            status = 'cancelled',
            updated_at = NOW(),
            error_message = CASE 
                WHEN error_message IS NOT NULL 
                THEN 'CANCELLED: ' || error_message 
                ELSE 'CANCELLED: Bulk cancellation of failed jobs during MCP server outage'
            END
        WHERE status = 'failed' 
        AND id NOT IN (4570, 4571, 4572);
        """)
        
        affected_rows = cur.rowcount
        
        # Commit the changes
        conn.commit()
        
        print(f"✅ Successfully updated {affected_rows} executions from 'failed' to 'cancelled'")
        
        # Verify the results
        print(f"\n📊 Updated status distribution:")
        cur.execute("""
        SELECT status, COUNT(*) 
        FROM workflow_executions 
        GROUP BY status 
        ORDER BY COUNT(*) DESC;
        """)
        
        for status, count in cur.fetchall():
            print(f"  {status:>12}: {count:>4}")
        
        # Show the kept failed executions
        print(f"\n🔍 Executions kept as 'failed' for analysis:")
        cur.execute("""
        SELECT id, created_at, error_message 
        FROM workflow_executions 
        WHERE status = 'failed' 
        ORDER BY id ASC;
        """)
        
        for id_, created, error in cur.fetchall():
            error_preview = error[:80] + '...' if error and len(error) > 80 else (error or 'No error')
            print(f"  ID {id_}: {created} - {error_preview}")
        
        print(f"\n✅ Operation completed successfully!")
        print(f"📝 Summary:")
        print(f"   - Kept 3 earliest failures for analysis")
        print(f"   - Marked {affected_rows} executions as 'cancelled'")
        print(f"   - This cleans up the failure streak while preserving analysis data")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        if 'conn' in locals():
            conn.rollback()
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    mark_failed_as_cancelled() 