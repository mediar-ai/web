#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test workflow_files deletion trigger by creating a test workflow with a file,
then deleting it and verifying the storage file was also deleted.

Usage: python scripts/test_workflow_files_trigger.py
"""

import sys
import psycopg2
import requests
import time

# Fix Windows encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Supabase configuration
SUPABASE_URL = "https://eshwntsgsputksqamckh.supabase.co"
SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0"

def get_connection():
    """Get database connection"""
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def upload_test_file(storage_path, content):
    """Upload a test file to Supabase Storage"""
    url = f"{SUPABASE_URL}/storage/v1/object/workflow-files/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "apikey": SERVICE_ROLE_KEY,
        "Content-Type": "text/plain"
    }

    response = requests.post(url, headers=headers, data=content)
    return response.status_code in [200, 201]

def check_file_exists(storage_path):
    """Check if a file exists in Supabase Storage"""
    url = f"{SUPABASE_URL}/storage/v1/object/workflow-files/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "apikey": SERVICE_ROLE_KEY
    }

    response = requests.get(url, headers=headers)
    return response.status_code == 200

def main():
    print("🧪 Testing workflow_files deletion trigger")
    print("=" * 60)

    conn = get_connection()
    test_workflow_id = None
    test_storage_path = "workflows/999999/test-trigger.js"

    try:
        cursor = conn.cursor()

        # Step 1: Create test workflow
        print("\n📝 Step 1: Creating test workflow...")
        cursor.execute("""
            INSERT INTO deployed_workflows (
                name,
                automation_sequence,
                organization_id
            ) VALUES (
                'Test Trigger Workflow',
                '[]'::jsonb,
                1
            )
            RETURNING id;
        """)
        test_workflow_id = cursor.fetchone()[0]
        conn.commit()
        print(f"✅ Created test workflow: {test_workflow_id}")

        # Step 2: Upload test file to storage
        print(f"\n📤 Step 2: Uploading test file to storage...")
        test_content = "// Test file for trigger verification\nconsole.log('test');"

        # Update storage path to use actual workflow ID
        test_storage_path = f"workflows/{test_workflow_id}/test-trigger.js"

        if upload_test_file(test_storage_path, test_content):
            print(f"✅ Uploaded file: {test_storage_path}")
        else:
            print(f"❌ Failed to upload file")
            return False

        # Verify file exists
        if check_file_exists(test_storage_path):
            print(f"✅ Confirmed file exists in storage")
        else:
            print(f"❌ File not found in storage")
            return False

        # Step 3: Create workflow_files record
        print(f"\n📝 Step 3: Creating workflow_files record...")
        cursor.execute("""
            INSERT INTO workflow_files (
                workflow_id,
                version_number,
                file_path,
                storage_path,
                file_hash,
                file_size,
                content_type
            ) VALUES (
                %s,
                '1.0.0',
                'test-trigger.js',
                %s,
                'test-hash-123',
                %s,
                'application/javascript'
            );
        """, (test_workflow_id, test_storage_path, len(test_content)))
        conn.commit()
        print(f"✅ Created workflow_files record")

        # Step 4: Verify record exists
        cursor.execute("""
            SELECT id, storage_path
            FROM workflow_files
            WHERE workflow_id = %s;
        """, (test_workflow_id,))
        file_record = cursor.fetchone()
        if file_record:
            print(f"✅ Confirmed DB record exists: ID={file_record[0]}")
        else:
            print(f"❌ DB record not found")
            return False

        # Wait a moment
        time.sleep(1)

        # Step 5: Delete workflow_files record (trigger should fire)
        print(f"\n🔥 Step 4: Deleting workflow_files record (trigger fires)...")
        cursor.execute("""
            DELETE FROM workflow_files
            WHERE workflow_id = %s;
        """, (test_workflow_id,))
        conn.commit()
        print(f"✅ Deleted workflow_files record")

        # Wait for trigger to complete
        time.sleep(2)

        # Step 6: Check if storage file was deleted
        print(f"\n🔍 Step 5: Verifying storage file was deleted...")
        if not check_file_exists(test_storage_path):
            print(f"✅ SUCCESS: Storage file was deleted by trigger!")
            print(f"   Path: {test_storage_path}")
            success = True
        else:
            print(f"❌ FAILED: Storage file still exists")
            print(f"   Path: {test_storage_path}")
            print(f"   Trigger may not be working correctly")
            success = False

        # Cleanup: Delete test workflow
        print(f"\n🧹 Cleanup: Deleting test workflow...")
        cursor.execute("""
            DELETE FROM deployed_workflows
            WHERE id = %s;
        """, (test_workflow_id,))
        conn.commit()
        print(f"✅ Cleaned up test workflow")

        cursor.close()

        print("\n" + "=" * 60)
        if success:
            print("🎉 TRIGGER TEST PASSED!")
            print("\n✅ The trigger successfully:")
            print("   1. Detected workflow_files deletion")
            print("   2. Called Supabase Storage API")
            print("   3. Deleted the actual storage file")
            print("\n💡 Trigger is working correctly!")
        else:
            print("❌ TRIGGER TEST FAILED!")
            print("\n⚠️  Possible issues:")
            print("   1. Vault secrets not configured correctly")
            print("   2. pg_net extension not enabled")
            print("   3. Trigger function has errors")
            print("\n🔍 Check database logs for warnings/errors")

        return success

    except Exception as e:
        print(f"\n💥 Error during test: {e}")
        import traceback
        traceback.print_exc()

        # Cleanup on error
        if test_workflow_id:
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM deployed_workflows WHERE id = %s;", (test_workflow_id,))
                conn.commit()
                cursor.close()
                print(f"🧹 Cleaned up test workflow {test_workflow_id}")
            except:
                pass

        return False

    finally:
        conn.close()

if __name__ == "__main__":
    success = main()
    if not success:
        sys.exit(1)
