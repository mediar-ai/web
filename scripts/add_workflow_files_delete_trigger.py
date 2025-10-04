#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Add database trigger to automatically delete storage files when workflow_files records are deleted.
This prevents orphaned files in Supabase Storage when workflows are deleted via CASCADE.

Usage: python scripts/add_workflow_files_delete_trigger.py
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from dotenv import load_dotenv

# Fix Windows encoding issues
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Load environment variables
load_dotenv('.env.local')

def get_db_connection():
    """Get database connection"""
    # Use hardcoded connection string like other scripts
    conn_string = "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

    try:
        conn = psycopg2.connect(conn_string)
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def create_storage_deletion_function(conn):
    """Create function that deletes file from storage"""
    print("📝 Creating storage deletion function...")

    with conn.cursor() as cur:
        # Drop function if exists
        cur.execute("""
            DROP FUNCTION IF EXISTS delete_workflow_file_from_storage() CASCADE;
        """)

        # Create function that calls Supabase storage API
        # Note: This uses pg_net extension which must be enabled in Supabase
        cur.execute("""
            CREATE OR REPLACE FUNCTION delete_workflow_file_from_storage()
            RETURNS TRIGGER AS $$
            DECLARE
                storage_response jsonb;
                service_role_key text;
                supabase_url text;
            BEGIN
                -- Get Supabase credentials from vault
                -- These should be set as Supabase secrets
                SELECT decrypted_secret INTO service_role_key
                FROM vault.decrypted_secrets
                WHERE name = 'supabase_service_role_key'
                LIMIT 1;

                SELECT decrypted_secret INTO supabase_url
                FROM vault.decrypted_secrets
                WHERE name = 'supabase_url'
                LIMIT 1;

                -- If credentials not in vault, skip deletion
                IF service_role_key IS NULL OR supabase_url IS NULL THEN
                    RAISE WARNING 'Supabase credentials not found in vault - skipping storage deletion for %', OLD.storage_path;
                    RETURN OLD;
                END IF;

                -- Call Supabase Storage API to delete file
                -- Using pg_net extension (must be enabled)
                SELECT net.http_delete(
                    url := supabase_url || '/storage/v1/object/workflow-files/' || OLD.storage_path,
                    headers := jsonb_build_object(
                        'Authorization', 'Bearer ' || service_role_key,
                        'apikey', service_role_key
                    )
                ) INTO storage_response;

                -- Log the deletion attempt
                RAISE NOTICE 'Deleted storage file: % (response: %)', OLD.storage_path, storage_response;

                RETURN OLD;
            EXCEPTION WHEN OTHERS THEN
                -- Log error but don't fail the delete operation
                RAISE WARNING 'Failed to delete storage file %: %', OLD.storage_path, SQLERRM;
                RETURN OLD;
            END;
            $$ LANGUAGE plpgsql SECURITY DEFINER;
        """)

        # Add comment
        cur.execute("""
            COMMENT ON FUNCTION delete_workflow_file_from_storage() IS
            'Automatically deletes file from Supabase Storage when workflow_files record is deleted';
        """)

        print("✅ Successfully created storage deletion function")

def create_deletion_trigger(conn):
    """Create trigger that fires on workflow_files deletion"""
    print("📝 Creating deletion trigger on workflow_files table...")

    with conn.cursor() as cur:
        # Drop trigger if exists
        cur.execute("""
            DROP TRIGGER IF EXISTS trigger_delete_workflow_file_storage
            ON public.workflow_files;
        """)

        # Create trigger
        cur.execute("""
            CREATE TRIGGER trigger_delete_workflow_file_storage
            BEFORE DELETE ON public.workflow_files
            FOR EACH ROW
            EXECUTE FUNCTION delete_workflow_file_from_storage();
        """)

        # Add comment
        cur.execute("""
            COMMENT ON TRIGGER trigger_delete_workflow_file_storage ON public.workflow_files IS
            'Deletes file from Supabase Storage before deleting database record to prevent orphans';
        """)

        print("✅ Successfully created deletion trigger")

def check_pg_net_extension(conn):
    """Check if pg_net extension is enabled"""
    print("🔍 Checking for pg_net extension...")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM pg_extension
                WHERE extname = 'pg_net'
            );
        """)
        result = cur.fetchone()
        exists = result[0] if result else False

        if exists:
            print("✅ pg_net extension is enabled")
            return True
        else:
            print("⚠️  pg_net extension is NOT enabled")
            print("   You need to enable it via Supabase dashboard:")
            print("   Database → Extensions → Search for 'pg_net' → Enable")
            return False

def check_vault_secrets(conn):
    """Check if vault secrets are configured"""
    print("🔍 Checking for vault secrets...")

    with conn.cursor() as cur:
        # Check if vault schema exists
        cur.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.schemata
                WHERE schema_name = 'vault'
            );
        """)
        result = cur.fetchone()
        vault_exists = result[0] if result else False

        if not vault_exists:
            print("⚠️  Vault schema not found")
            print("   Supabase vault may not be available in your project")
            return False

        # Try to check for secrets (may fail if not set up)
        try:
            cur.execute("""
                SELECT name
                FROM vault.decrypted_secrets
                WHERE name IN ('supabase_service_role_key', 'supabase_url')
                LIMIT 2;
            """)
            secrets = cur.fetchall()

            if len(secrets) == 2:
                print("✅ Vault secrets configured")
                return True
            else:
                print(f"⚠️  Only {len(secrets)}/2 required secrets found in vault")
                print("   Required secrets: supabase_service_role_key, supabase_url")
                return False
        except Exception as e:
            print(f"⚠️  Could not check vault secrets: {e}")
            return False

def verify_implementation(conn):
    """Verify that the trigger is working"""
    print("🔍 Verifying trigger implementation...")

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Check function exists
        cur.execute("""
            SELECT proname
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND p.proname = 'delete_workflow_file_from_storage';
        """)
        func_result = cur.fetchone()

        if not func_result:
            print("❌ Function not found")
            return False

        # Check trigger exists
        cur.execute("""
            SELECT tgname
            FROM pg_trigger
            WHERE tgname = 'trigger_delete_workflow_file_storage';
        """)
        trigger_result = cur.fetchone()

        if not trigger_result:
            print("❌ Trigger not found")
            return False

        print("✅ Function and trigger exist")
        print("\n📋 What was created:")
        print("   ✅ Function: delete_workflow_file_from_storage()")
        print("   ✅ Trigger: trigger_delete_workflow_file_storage")
        print("   ✅ Trigger timing: BEFORE DELETE on workflow_files")
        print("   ✅ Trigger fires: For each row")

        return True

def main():
    """Main function to add workflow files deletion trigger"""
    print("🚀 Adding workflow_files storage deletion trigger...")
    print(f"Started at: {datetime.now()}")
    print()

    conn = get_db_connection()
    conn.autocommit = False

    try:
        # Check prerequisites
        print("="*60)
        print("CHECKING PREREQUISITES")
        print("="*60)

        pg_net_ok = check_pg_net_extension(conn)
        vault_ok = check_vault_secrets(conn)

        if not pg_net_ok or not vault_ok:
            print("\n⚠️  WARNING: Prerequisites not fully met")
            print("The trigger will be created but may not work without:")
            print("  - pg_net extension (for HTTP calls)")
            print("  - Vault secrets (for Supabase credentials)")

            response = input("\nContinue anyway? (y/n): ")
            if response.lower() != 'y':
                print("Aborted by user")
                return False

        print("\n" + "="*60)
        print("CREATING TRIGGER")
        print("="*60)

        # Create function
        create_storage_deletion_function(conn)

        # Create trigger
        create_deletion_trigger(conn)

        # Commit changes
        conn.commit()

        print("\n" + "="*60)
        print("VERIFICATION")
        print("="*60)

        # Verify implementation
        if verify_implementation(conn):
            print("\n🎉 Trigger successfully deployed!")
            print("\n📝 How it works:")
            print("   1. When workflow_files record is deleted (including CASCADE)")
            print("   2. BEFORE DELETE trigger fires")
            print("   3. Function calls Supabase Storage API to delete file")
            print("   4. If deletion fails, warning is logged but DB delete continues")
            print("   5. This prevents orphaned files in storage")

            print("\n⚠️  IMPORTANT NOTES:")
            print("   - Trigger uses pg_net extension for HTTP calls")
            print("   - Requires vault secrets: supabase_service_role_key, supabase_url")
            print("   - If API call fails, DB record still deletes (prevents blocking)")
            print("   - Check logs for any deletion errors")

            print(f"\nCompleted at: {datetime.now()}")
            return True
        else:
            print("❌ Verification failed!")
            conn.rollback()
            return False

    except Exception as e:
        print(f"❌ Error during deployment: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    try:
        success = main()
        if success:
            print("\n✅ Workflow files deletion trigger is ready!")
        else:
            print("\n❌ Deployment failed!")
            exit(1)
    except Exception as e:
        print(f"\n💥 Fatal error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
