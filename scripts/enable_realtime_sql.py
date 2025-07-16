#!/usr/bin/env python3
"""
Alternative method to enable real-time via SQL commands
Use this if the dashboard approach doesn't work.
"""

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv('.env.local')

def enable_realtime_sql():
    """Enable real-time using SQL commands directly."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        print("❌ SUPABASE_CONN_STRING not found in .env.local")
        return
    
    conn = psycopg2.connect(conn_string)
    conn.autocommit = True
    
    try:
        with conn.cursor() as cur:
            print("🔄 Attempting to enable real-time via SQL...")
            
            # Method 1: Try Supabase-specific commands
            try:
                cur.execute("SELECT supabase_realtime.enable_realtime_for_table('public', 'deployed_workflows');")
                print("✅ Enabled real-time for deployed_workflows")
            except Exception as e:
                print(f"⚠️ Method 1 failed for deployed_workflows: {e}")
            
            try:
                cur.execute("SELECT supabase_realtime.enable_realtime_for_table('public', 'workflow_executions');")
                print("✅ Enabled real-time for workflow_executions")
            except Exception as e:
                print(f"⚠️ Method 1 failed for workflow_executions: {e}")
            
            # Method 2: Check if tables exist in realtime schema
            cur.execute("""
                INSERT INTO realtime.subscription (subscription_id, entity, filters)
                VALUES ('deployed_workflows', 'deployed_workflows', '{}')
                ON CONFLICT DO NOTHING;
            """)
            
            cur.execute("""
                INSERT INTO realtime.subscription (subscription_id, entity, filters)
                VALUES ('workflow_executions', 'workflow_executions', '{}')
                ON CONFLICT DO NOTHING;
            """)
            
            print("✅ Real-time configuration attempted via SQL")
            
    except Exception as e:
        print(f"❌ SQL method failed: {e}")
        print("💡 Manual dashboard configuration is still the recommended approach")
    finally:
        conn.close()

if __name__ == "__main__":
    print("🔧 Alternative Real-time Enablement via SQL")
    print("=" * 40)
    enable_realtime_sql()
    print("\n🎯 Next step: Test your application!")
    print("   1. Restart your Next.js server: npm run dev")
    print("   2. Check browser console for WebSocket connection")
    print("   3. Create a workflow execution to test real-time updates") 