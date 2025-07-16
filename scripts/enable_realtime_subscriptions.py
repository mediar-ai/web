#!/usr/bin/env python3
"""
Enable Supabase real-time subscriptions for deployed_workflows and workflow_executions tables.
This allows the frontend to receive live updates when data changes.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env.local
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

def check_rls_policies():
    """Check and display current RLS policies for our tables."""
    print("🔍 Checking Row Level Security policies...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check RLS status for our tables
            cur.execute("""
                SELECT schemaname, tablename, rowsecurity 
                FROM pg_tables 
                WHERE tablename IN ('deployed_workflows', 'workflow_executions')
                AND schemaname = 'public'
            """)
            
            tables = cur.fetchall()
            for schema, table, rls_enabled in tables:
                status = "✅ Enabled" if rls_enabled else "⚠️ Disabled"
                print(f"   {table}: RLS {status}")
                
                # Show existing policies
                cur.execute("""
                    SELECT policyname, permissive, roles, cmd, qual, with_check
                    FROM pg_policies 
                    WHERE schemaname = %s AND tablename = %s
                """, (schema, table))
                
                policies = cur.fetchall()
                if policies:
                    print(f"     Policies ({len(policies)}):")
                    for policy in policies:
                        print(f"       - {policy[0]} ({policy[3]})")
                else:
                    print(f"     No policies found")
            
    except Exception as e:
        print(f"❌ Failed to check RLS policies: {e}")
    finally:
        conn.close()

def configure_publication():
    """Configure PostgreSQL publication for real-time changes."""
    print("🔄 Configuring PostgreSQL publication for real-time...")
    
    conn = get_db_connection()
    success_count = 0
    try:
        with conn.cursor() as cur:
            # Check if publication exists
            cur.execute("""
                SELECT pubname FROM pg_publication 
                WHERE pubname = 'supabase_realtime'
            """)
            
            if cur.fetchone():
                print("✅ Publication 'supabase_realtime' already exists")
                
                # Check if our tables are added to the publication
                cur.execute("""
                    SELECT schemaname, tablename 
                    FROM pg_publication_tables 
                    WHERE pubname = 'supabase_realtime' 
                    AND tablename IN ('deployed_workflows', 'workflow_executions')
                """)
                
                published_tables = [row[1] for row in cur.fetchall()]
                
                for table in ['deployed_workflows', 'workflow_executions']:
                    if table in published_tables:
                        print(f"✅ {table} already in publication")
                        success_count += 1
                    else:
                        try:
                            cur.execute(f"""
                                ALTER PUBLICATION supabase_realtime ADD TABLE {table}
                            """)
                            print(f"✅ Added {table} to publication")
                            success_count += 1
                        except psycopg2.Error as e:
                            print(f"❌ Could not add {table} to publication: {e}")
            else:
                print("❌ Publication 'supabase_realtime' not found")
                print("   This indicates a Supabase configuration issue")
                
    except Exception as e:
        print(f"❌ Failed to configure publication: {e}")
    finally:
        conn.close()
    
    return success_count

def check_realtime_status():
    """Check current realtime configuration status."""
    print("🔍 Checking real-time configuration status...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check publication tables
            cur.execute("""
                SELECT tablename 
                FROM pg_publication_tables 
                WHERE pubname = 'supabase_realtime' 
                AND tablename IN ('deployed_workflows', 'workflow_executions')
            """)
            
            published_tables = [row[0] for row in cur.fetchall()]
            
            print(f"📊 Publication Status:")
            for table in ['deployed_workflows', 'workflow_executions']:
                status = "✅ Published" if table in published_tables else "❌ Not published"
                print(f"   {table}: {status}")
            
            # Check replica identity (important for realtime)
            cur.execute("""
                SELECT c.relname, c.relreplident
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' 
                AND c.relname IN ('deployed_workflows', 'workflow_executions')
            """)
            
            print(f"\n🔑 Replica Identity Status:")
            replica_types = {'d': 'DEFAULT', 'f': 'FULL', 'n': 'NOTHING', 'i': 'INDEX'}
            for table, replica_type in cur.fetchall():
                print(f"   {table}: {replica_types.get(replica_type, replica_type)}")
                
    except Exception as e:
        print(f"❌ Failed to check realtime status: {e}")
    finally:
        conn.close()

def main():
    """Main function to configure real-time subscriptions."""
    print("📡 Configuring Supabase Real-time Subscriptions")
    print("=" * 50)
    
    # Check current RLS policies
    check_rls_policies()
    print()
    
    # Configure publication (the database-level requirement)
    published_count = configure_publication()
    print()
    
    # Check overall status
    check_realtime_status()
    print()
    
    # Summary and instructions
    print("📊 Summary:")
    print(f"   Tables published for real-time: {published_count}/2")
    
    if published_count == 2:
        print("✅ Database publication configured successfully!")
        print("\n🔧 Next steps to complete real-time setup:")
        print("   1. Enable real-time in Supabase Dashboard:")
        print("      - Go to Database > Replication")
        print("      - Enable real-time for 'deployed_workflows' table")
        print("      - Enable real-time for 'workflow_executions' table")
        print("   2. Or use Supabase CLI (if available):")
        print("      supabase db remote set --table=deployed_workflows --realtime=true")
        print("      supabase db remote set --table=workflow_executions --realtime=true")
        print("   3. Restart your Next.js development server")
        print("   4. Check browser console for real-time connection logs")
        print("   5. Test by creating new workflow executions")
    else:
        print("⚠️ Database publication setup incomplete")
        print("   Check Supabase dashboard for manual configuration")
    
    print("\n💡 Note: Real-time subscriptions require both:")
    print("   - Database publication (✅ configured by this script)")
    print("   - Supabase real-time service enabled (configure via dashboard)")

if __name__ == "__main__":
    main() 