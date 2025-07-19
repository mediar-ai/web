#!/usr/bin/env python3

import os
import sys
import time
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        print("❌ Error: SUPABASE_CONN_STRING environment variable not set.")
        print("Please set it in .env.local file")
        sys.exit(1)
    try:
        conn = psycopg2.connect(conn_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def test_get_workflow_version_history():
    """Test the performance of get_workflow_version_history function"""
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # First, let's see what workflows exist
        print("🔍 Finding available workflows...")
        cur.execute("""
            SELECT id, name, total_versions 
            FROM deployed_workflows 
            ORDER BY total_versions DESC 
            LIMIT 10
        """)
        workflows = cur.fetchall()
        
        print("📋 Available workflows:")
        for wf_id, name, total_versions in workflows:
            print(f"   ID: {wf_id}, Name: {name}, Versions: {total_versions}")
        
        if not workflows:
            print("❌ No workflows found")
            return
            
        # Test the function with different workflows
        for wf_id, name, total_versions in workflows[:3]:  # Test top 3
            print(f"\n🧪 Testing workflow {wf_id} ({name}) with {total_versions} versions...")
            
            # Time the RPC function call
            start_time = time.time()
            cur.execute("SELECT * FROM get_workflow_version_history(%s)", (wf_id,))
            versions = cur.fetchall()
            end_time = time.time()
            
            duration_ms = (end_time - start_time) * 1000
            print(f"⏱️  Function took {duration_ms:.2f}ms to return {len(versions)} versions")
            
            # Show first few versions for verification
            if versions:
                print("📋 First few versions:")
                for i, version in enumerate(versions[:3]):
                    version_id, version_number, is_active, created_at, change_notes, execution_count = version
                    print(f"   v{version_number}: {execution_count} executions ({'ACTIVE' if is_active else 'inactive'})")
            
            # Test the individual parts to see what's slow
            print(f"\n🔍 Analyzing performance for workflow {wf_id}...")
            
            # Count versions
            start_time = time.time()
            cur.execute("SELECT COUNT(*) FROM deployed_workflow_versions WHERE workflow_id = %s", (wf_id,))
            version_count = cur.fetchone()[0]
            end_time = time.time()
            version_time_ms = (end_time - start_time) * 1000
            print(f"   📊 Version count query: {version_time_ms:.2f}ms ({version_count} versions)")
            
            # Count executions
            start_time = time.time()
            cur.execute("""
                SELECT COUNT(*) 
                FROM workflow_executions e 
                JOIN deployed_workflow_versions v ON e.workflow_version_id = v.id 
                WHERE v.workflow_id = %s
            """, (wf_id,))
            execution_count = cur.fetchone()[0]
            end_time = time.time()
            execution_time_ms = (end_time - start_time) * 1000
            print(f"   🚀 Execution count query: {execution_time_ms:.2f}ms ({execution_count} executions)")
            
            # Test the JOIN without GROUP BY
            start_time = time.time()
            cur.execute("""
                SELECT v.id, v.version_number, v.is_active, v.created_at, v.change_notes, e.id as execution_id
                FROM deployed_workflow_versions v
                LEFT JOIN workflow_executions e ON v.id = e.workflow_version_id
                WHERE v.workflow_id = %s
                ORDER BY v.created_at DESC
                LIMIT 100
            """, (wf_id,))
            join_results = cur.fetchall()
            end_time = time.time()
            join_time_ms = (end_time - start_time) * 1000
            print(f"   🔗 Raw JOIN query (first 100): {join_time_ms:.2f}ms ({len(join_results)} rows)")
            
            if duration_ms > 1000:  # More than 1 second
                print(f"⚠️  SLOW QUERY DETECTED: {duration_ms:.2f}ms for workflow {wf_id}")
    
    except Exception as e:
        print(f"❌ Error testing version history: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        cur.close()
        conn.close()

def test_alternative_query():
    """Test a potentially faster alternative approach"""
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        print("\n🧪 Testing alternative query approach...")
        
        # Get a workflow to test with
        cur.execute("SELECT id FROM deployed_workflows LIMIT 1")
        workflow_id = cur.fetchone()[0]
        
        # Alternative approach using a subquery for execution counts
        start_time = time.time()
        cur.execute("""
            SELECT 
                v.id,
                v.version_number,
                v.is_active,
                v.created_at,
                v.change_notes,
                COALESCE(exec_counts.execution_count, 0) as execution_count
            FROM deployed_workflow_versions v
            LEFT JOIN (
                SELECT workflow_version_id, COUNT(*) as execution_count
                FROM workflow_executions
                GROUP BY workflow_version_id
            ) exec_counts ON v.id = exec_counts.workflow_version_id
            WHERE v.workflow_id = %s
            ORDER BY v.created_at DESC
        """, (workflow_id,))
        results = cur.fetchall()
        end_time = time.time()
        
        alt_duration_ms = (end_time - start_time) * 1000
        print(f"⚡ Alternative query took: {alt_duration_ms:.2f}ms for {len(results)} versions")
        
    except Exception as e:
        print(f"❌ Error testing alternative query: {e}")
    
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    print("🧪 Testing get_workflow_version_history performance...\n")
    test_get_workflow_version_history()
    test_alternative_query()
    print("\n✅ Performance test completed!") 