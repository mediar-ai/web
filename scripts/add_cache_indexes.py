#!/usr/bin/env python3

import psycopg2

def add_cache_indexes():
    """
    Add critical indexes for cache optimization
    """
    try:
        # Connect to database (same pattern as other scripts)
        conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
        
        # Important: Set autocommit to True for CREATE INDEX CONCURRENTLY
        conn.autocommit = True
        cur = conn.cursor()
        
        print("🔧 ADDING CRITICAL CACHE INDEXES")
        print("=" * 60)
        
        # 1. Add GIN index on execution_params
        print("1️⃣ Adding GIN index on execution_params...")
        try:
            cur.execute("""
                CREATE INDEX CONCURRENTLY idx_workflow_executions_execution_params_gin 
                ON workflow_executions USING gin (execution_params);
            """)
            print("   ✅ GIN index created successfully")
        except Exception as e:
            if "already exists" in str(e):
                print("   ✅ GIN index already exists")
            else:
                print(f"   ❌ Error: {e}")
        
        # 2. Add composite index for cache queries
        print("2️⃣ Adding composite index for cache lookups...")
        try:
            cur.execute("""
                CREATE INDEX CONCURRENTLY idx_workflow_executions_cache_lookup 
                ON workflow_executions (workflow_id, status, execution_params);
            """)
            print("   ✅ Composite index created successfully")
        except Exception as e:
            if "already exists" in str(e):
                print("   ✅ Composite index already exists")
            else:
                print(f"   ❌ Error: {e}")
        
        # 3. Add hash-based index  
        print("3️⃣ Adding hash-based index...")
        try:
            cur.execute("""
                CREATE INDEX CONCURRENTLY idx_workflow_executions_params_hash 
                ON workflow_executions (workflow_id, status, execution_params_hash);
            """)
            print("   ✅ Hash index created successfully")
        except Exception as e:
            if "already exists" in str(e):
                print("   ✅ Hash index already exists")
            else:
                print(f"   ❌ Error: {e}")
        
        # 4. Test query performance
        print()
        print("📊 Testing cache query performance...")
        import time
        start_time = time.time()
        cur.execute("""
            SELECT id, formatted_output, created_at, execution_duration_seconds, results, status
            FROM workflow_executions 
            WHERE workflow_id = 1 
            AND status IN ('completed', 'failed')
            AND execution_params = '{"quote_type": "Face Value", "quote_value": "5000"}'::jsonb
            ORDER BY id DESC 
            LIMIT 1;
        """)
        result = cur.fetchone()
        query_time = (time.time() - start_time) * 1000
        
        if result:
            print(f"⚡ Cache query time: {query_time:.1f}ms (found result)")
        else:
            print(f"⚡ Cache query time: {query_time:.1f}ms (no result found)")
        
        # 5. Show all indexes on the table
        print()
        print("📋 All indexes on workflow_executions:")
        cur.execute("""
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'workflow_executions' 
            ORDER BY indexname;
        """)
        
        for row in cur.fetchall():
            index_name, index_def = row
            if 'execution_params' in index_name:
                print(f"   🎯 {index_name} (cache-related)")
            else:
                print(f"   📊 {index_name}")
        
        cur.close()
        conn.close()
        
        print()
        print("🎉 Index optimization complete!")
        
    except Exception as e:
        print(f"❌ Error adding indexes: {e}")
        return False
    
    return True

if __name__ == "__main__":
    add_cache_indexes() 