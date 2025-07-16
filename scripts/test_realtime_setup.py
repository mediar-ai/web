#!/usr/bin/env python3
"""
Comprehensive real-time setup tester and configuration guide.
Tests the current state and provides instructions for manual enablement.
"""

import os
import sys
import psycopg2
import requests
import time
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        print("❌ Error: SUPABASE_CONN_STRING environment variable not set.")
        sys.exit(1)
    try:
        conn = psycopg2.connect(conn_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def check_database_setup():
    """Check all database-level real-time requirements."""
    print("🔍 Checking Database Real-time Setup...")
    print("-" * 40)
    
    conn = get_db_connection()
    results = {
        'publication_exists': False,
        'tables_published': [],
        'replica_identity': {},
        'rls_status': {}
    }
    
    try:
        with conn.cursor() as cur:
            # Check publication
            cur.execute("SELECT pubname FROM pg_publication WHERE pubname = 'supabase_realtime'")
            if cur.fetchone():
                results['publication_exists'] = True
                print("✅ supabase_realtime publication exists")
                
                # Check published tables
                cur.execute("""
                    SELECT tablename 
                    FROM pg_publication_tables 
                    WHERE pubname = 'supabase_realtime' 
                    AND tablename IN ('deployed_workflows', 'workflow_executions')
                """)
                published_tables = [row[0] for row in cur.fetchall()]
                results['tables_published'] = published_tables
                
                for table in ['deployed_workflows', 'workflow_executions']:
                    status = "✅ Published" if table in published_tables else "❌ Not published"
                    print(f"   {table}: {status}")
            else:
                print("❌ supabase_realtime publication not found")
            
            # Check replica identity
            cur.execute("""
                SELECT c.relname, c.relreplident
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' 
                AND c.relname IN ('deployed_workflows', 'workflow_executions')
            """)
            
            replica_types = {'d': 'DEFAULT', 'f': 'FULL', 'n': 'NOTHING', 'i': 'INDEX'}
            print("\n🔑 Replica Identity:")
            for table, replica_type in cur.fetchall():
                replica_name = replica_types.get(replica_type, replica_type)
                results['replica_identity'][table] = replica_name
                print(f"   {table}: {replica_name}")
            
            # Check RLS status
            cur.execute("""
                SELECT tablename, rowsecurity 
                FROM pg_tables 
                WHERE tablename IN ('deployed_workflows', 'workflow_executions')
                AND schemaname = 'public'
            """)
            
            print("\n🛡️ Row Level Security:")
            for table, rls_enabled in cur.fetchall():
                results['rls_status'][table] = rls_enabled
                status = "✅ Enabled" if rls_enabled else "⚠️ Disabled"
                print(f"   {table}: {status}")
                
    except Exception as e:
        print(f"❌ Database check failed: {e}")
    finally:
        conn.close()
    
    return results

def test_frontend_connection():
    """Test if frontend can establish real-time connection."""
    print("\n🌐 Testing Frontend Real-time Connection...")
    print("-" * 40)
    
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    
    if not supabase_url or not supabase_key:
        print("❌ Missing frontend Supabase environment variables")
        return False
    
    # Try to connect to WebSocket endpoint
    ws_url = supabase_url.replace('https://', 'wss://').replace('http://', 'ws://') + '/realtime/v1/websocket'
    print(f"🔗 WebSocket URL: {ws_url}")
    
    try:
        # Test HTTP endpoint first (easier to debug)
        response = requests.get(f"{supabase_url}/rest/v1/", headers={
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}'
        }, timeout=5)
        
        if response.status_code == 200:
            print("✅ REST API connection successful")
        else:
            print(f"⚠️ REST API returned status: {response.status_code}")
            
    except Exception as e:
        print(f"❌ Connection test failed: {e}")
        return False
    
    return True

def check_environment_variables():
    """Check all required environment variables."""
    print("\n🔧 Checking Environment Variables...")
    print("-" * 40)
    
    required_vars = {
        'NEXT_PUBLIC_SUPABASE_URL': os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
        'SUPABASE_SERVICE_KEY': os.getenv('SUPABASE_SERVICE_KEY'),
        'SUPABASE_CONN_STRING': os.getenv('SUPABASE_CONN_STRING')
    }
    
    all_set = True
    for var_name, var_value in required_vars.items():
        if var_value:
            # Show partial value for security
            display_value = var_value[:20] + "..." if len(var_value) > 20 else var_value
            print(f"✅ {var_name}: {display_value}")
        else:
            print(f"❌ {var_name}: Not set")
            all_set = False
    
    return all_set

def generate_dashboard_instructions():
    """Generate step-by-step instructions for manual dashboard configuration."""
    print("\n📋 Manual Configuration Instructions")
    print("=" * 50)
    
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL', 'your-project-url')
    project_id = supabase_url.split('//')[1].split('.')[0] if '//' in supabase_url else 'your-project-id'
    
    print(f"""
🌐 **STEP 1: Access Supabase Dashboard**
   Open: https://supabase.com/dashboard/project/{project_id}

🔧 **STEP 2: Enable Real-time for Tables**
   1. Navigate to: Database → Replication
   2. In the "Realtime" section, find the tables:
      - deployed_workflows
      - workflow_executions
   3. Toggle "Enable" for both tables
   4. Click "Save" or "Apply Changes"

⚡ **STEP 3: Verify Real-time Status**
   In the Replication page, you should see:
   - ✅ deployed_workflows: Realtime enabled
   - ✅ workflow_executions: Realtime enabled

🔄 **STEP 4: Test the Implementation**
   1. Restart your Next.js development server
   2. Open browser console in your app
   3. Look for successful WebSocket connection logs
   4. Test by creating workflow executions

💡 **Alternative: API-based Enablement**
   If dashboard doesn't work, try Supabase REST API:
   
   ```bash
   # Enable for deployed_workflows
   curl -X POST 'https://{project_id}.supabase.co/rest/v1/rpc/enable_realtime' \\
        -H 'apikey: YOUR_SERVICE_KEY' \\
        -H 'Authorization: Bearer YOUR_SERVICE_KEY' \\
        -H 'Content-Type: application/json' \\
        -d '{{"table_name": "deployed_workflows"}}'
   
   # Enable for workflow_executions  
   curl -X POST 'https://{project_id}.supabase.co/rest/v1/rpc/enable_realtime' \\
        -H 'apikey: YOUR_SERVICE_KEY' \\
        -H 'Authorization: Bearer YOUR_SERVICE_KEY' \\
        -H 'Content-Type: application/json' \\
        -d '{{"table_name": "workflow_executions"}}'
   ```
""")

def main():
    """Main testing and configuration function."""
    print("📡 Real-time Setup Diagnostic & Configuration Tool")
    print("=" * 60)
    
    # Check environment
    env_ok = check_environment_variables()
    if not env_ok:
        print("\n❌ Missing environment variables. Please check .env.local file.")
        return
    
    # Check database setup
    db_results = check_database_setup()
    
    # Test frontend connection
    frontend_ok = test_frontend_connection()
    
    # Generate summary and instructions
    print("\n📊 DIAGNOSTIC SUMMARY")
    print("=" * 30)
    
    if db_results['publication_exists'] and len(db_results['tables_published']) == 2:
        print("✅ Database publication: Ready")
    else:
        print("❌ Database publication: Issues found")
    
    if frontend_ok:
        print("✅ Frontend connection: OK")
    else:
        print("⚠️ Frontend connection: Check network/config")
    
    # Determine next steps
    if len(db_results['tables_published']) == 2:
        print("\n🎯 **NEXT STEP: Enable real-time in Supabase Dashboard**")
        print("   Database is ready, but real-time service needs dashboard activation.")
        generate_dashboard_instructions()
    else:
        print("\n❌ **ISSUE: Database not properly configured**")
        print("   Run the enable_realtime_subscriptions.py script first.")
    
    print(f"\n⏰ Test completed at: {time.strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main() 