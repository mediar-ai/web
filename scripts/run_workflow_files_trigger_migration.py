#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Run migration to add workflow_files deletion trigger.
This prevents orphaned storage files when workflows are deleted.

Usage: python scripts/run_workflow_files_trigger_migration.py
"""

import os
import sys
import psycopg2

# Fix Windows encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def get_connection():
    """Get database connection"""
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def check_pg_net_extension(conn):
    """Check if pg_net extension is enabled"""
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM pg_extension
                WHERE extname = 'pg_net'
            );
        """)
        return cursor.fetchone()[0]
    finally:
        cursor.close()

def enable_pg_net_extension(conn):
    """Enable pg_net extension"""
    cursor = conn.cursor()
    try:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_net;")
        conn.commit()
        return True
    except Exception as e:
        print(f"Failed to enable pg_net: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()

def run_migration(conn):
    """Run the migration file"""
    migration_file = "supabase/migrations/20260103000000_add_workflow_files_deletion_trigger.sql"

    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False

    print(f"📁 Running migration: {migration_file}")

    try:
        with open(migration_file, 'r', encoding='utf-8') as f:
            sql_content = f.read()

        cursor = conn.cursor()
        cursor.execute(sql_content)
        conn.commit()
        cursor.close()

        print("✅ Migration executed successfully")
        return True

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        conn.rollback()
        return False

def verify_trigger(conn):
    """Verify the trigger was created"""
    cursor = conn.cursor()
    try:
        # Check trigger exists
        cursor.execute("""
            SELECT tgname, tgenabled
            FROM pg_trigger
            WHERE tgname = 'trigger_delete_workflow_file_storage';
        """)
        trigger = cursor.fetchone()

        # Check function exists
        cursor.execute("""
            SELECT proname
            FROM pg_proc
            WHERE proname = 'delete_workflow_file_from_storage';
        """)
        function = cursor.fetchone()

        if trigger and function:
            print(f"✅ Trigger verified: {trigger[0]} (enabled: {trigger[1] == 'O'})")
            print(f"✅ Function verified: {function[0]}")
            return True
        else:
            print("❌ Trigger or function not found")
            return False

    finally:
        cursor.close()

def main():
    print("🚀 Workflow Files Deletion Trigger Migration")
    print("=" * 60)

    conn = get_connection()

    try:
        # Check pg_net extension
        print("\n🔍 Checking prerequisites...")
        has_pg_net = check_pg_net_extension(conn)

        if not has_pg_net:
            print("⚠️  pg_net extension not enabled")
            print("📝 Attempting to enable pg_net...")
            if enable_pg_net_extension(conn):
                print("✅ pg_net extension enabled")
            else:
                print("❌ Failed to enable pg_net")
                print("   Please enable manually in Supabase Dashboard:")
                print("   Database → Extensions → Search 'pg_net' → Enable")
                return False
        else:
            print("✅ pg_net extension already enabled")

        # Run migration
        print("\n📋 Running migration...")
        if not run_migration(conn):
            return False

        # Verify
        print("\n🔍 Verifying installation...")
        if not verify_trigger(conn):
            return False

        print("\n" + "=" * 60)
        print("🎉 Migration completed successfully!")
        print("\n📝 What was created:")
        print("   ✅ Function: delete_workflow_file_from_storage()")
        print("   ✅ Trigger: trigger_delete_workflow_file_storage")
        print("   ✅ Trigger fires: BEFORE DELETE on workflow_files")

        print("\n⚠️  IMPORTANT NOTES:")
        print("   1. Trigger requires vault secrets to work:")
        print("      - supabase_service_role_key")
        print("      - supabase_url")
        print("   2. Add these via Supabase Dashboard → Vault")
        print("   3. Until secrets are added, trigger will log warnings")
        print("      but DB deletions will proceed normally")

        return True

    except Exception as e:
        print(f"💥 Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    success = main()
    if success:
        print("\n✅ Trigger is deployed!")
    else:
        print("\n❌ Migration failed!")
        sys.exit(1)
