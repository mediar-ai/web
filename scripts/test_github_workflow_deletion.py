#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test GitHub workflow deletion by:
1. Creating a test workflow in GitHub
2. Creating matching DB record and storage files
3. Deleting from GitHub
4. Verifying webhook cleaned up everything

Usage: python scripts/test_github_workflow_deletion.py
"""

import sys
import psycopg2
import requests
import time
from datetime import datetime

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Configuration
SUPABASE_URL = "https://eshwntsgsputksqamckh.supabase.co"
SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0"
GITHUB_TOKEN = "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"

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def upload_storage_file(storage_path, content):
    """Upload file to Supabase Storage"""
    url = f"{SUPABASE_URL}/storage/v1/object/workflow-files/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "apikey": SERVICE_ROLE_KEY,
        "Content-Type": "text/plain"
    }
    response = requests.post(url, headers=headers, data=content)
    return response.status_code in [200, 201]

def check_storage_file_exists(storage_path):
    """Check if file exists in storage"""
    url = f"{SUPABASE_URL}/storage/v1/object/workflow-files/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "apikey": SERVICE_ROLE_KEY
    }
    response = requests.get(url, headers=headers)
    return response.status_code == 200

def create_github_file(path, content, message):
    """Create file in GitHub"""
    url = f"https://api.github.com/repos/mediar-ai/workflows/contents/{path}"
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    import base64
    data = {
        "message": message,
        "content": base64.b64encode(content.encode()).decode()
    }
    response = requests.put(url, headers=headers, json=data)
    if response.status_code in [200, 201]:
        return response.json()['content']['sha']
    return None

def delete_github_file(path, sha, message):
    """Delete file from GitHub"""
    url = f"https://api.github.com/repos/mediar-ai/workflows/contents/{path}"
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    data = {
        "message": message,
        "sha": sha
    }
    response = requests.delete(url, headers=headers, json=data)
    return response.status_code == 200

def main():
    print("🧪 Testing GitHub workflow deletion with storage cleanup")
    print("=" * 60)

    test_folder = f"test-deletion-{int(time.time())}"
    test_yaml_path = f"{test_folder}/workflow.yaml"
    workflow_id = None
    github_sha = None

    conn = get_connection()

    try:
        cursor = conn.cursor()

        # Step 1: Create test workflow in GitHub
        print(f"\n📝 Step 1: Creating test workflow in GitHub: {test_folder}")
        yaml_content = """name: Test Deletion Workflow
description: Testing deletion cleanup
automation_sequence:
  - tool_name: log_message
    arguments:
      message: "test"
"""
        github_sha = create_github_file(test_yaml_path, yaml_content, "Test: Create workflow for deletion test")

        if not github_sha:
            print("❌ Failed to create GitHub file")
            return False

        print(f"✅ Created in GitHub: {test_yaml_path} (SHA: {github_sha[:8]})")

        # Wait for webhook to process
        print("⏳ Waiting 5 seconds for webhook to process...")
        time.sleep(5)

        # Step 2: Verify workflow was created in DB
        print(f"\n🔍 Step 2: Checking if webhook created DB record...")
        cursor.execute("""
            SELECT id, name, github_folder
            FROM deployed_workflows
            WHERE github_folder = %s;
        """, (test_folder,))

        workflow_record = cursor.fetchone()
        if not workflow_record:
            print(f"❌ Workflow not found in DB - webhook may not have processed yet")
            print(f"   Waiting another 5 seconds...")
            time.sleep(5)
            cursor.execute("""
                SELECT id, name, github_folder
                FROM deployed_workflows
                WHERE github_folder = %s;
            """, (test_folder,))
            workflow_record = cursor.fetchone()

        if not workflow_record:
            print(f"❌ Workflow still not in DB - webhook may have failed")
            return False

        workflow_id = workflow_record[0]
        workflow_name = workflow_record[1]
        print(f"✅ Found workflow in DB: {workflow_name} (ID: {workflow_id})")

        # Step 3: Add test storage files
        print(f"\n📤 Step 3: Adding storage files for workflow {workflow_id}")
        test_storage_paths = [
            f"workflows/{workflow_id}/helper.js",
            f"workflows/{workflow_id}/config.json"
        ]

        for storage_path in test_storage_paths:
            if upload_storage_file(storage_path, f"// Test file: {storage_path}"):
                print(f"   ✅ Uploaded: {storage_path}")
            else:
                print(f"   ❌ Failed to upload: {storage_path}")

        # Create DB records for storage files
        for storage_path in test_storage_paths:
            cursor.execute("""
                INSERT INTO workflow_files (
                    workflow_id,
                    version_number,
                    file_path,
                    storage_path,
                    file_hash,
                    file_size,
                    content_type
                ) VALUES (%s, '1.0.0', %s, %s, 'test-hash', 100, 'text/plain');
            """, (workflow_id, storage_path.split('/')[-1], storage_path))
        conn.commit()
        print(f"✅ Created {len(test_storage_paths)} workflow_files records")

        # Step 4: Verify everything exists
        print(f"\n🔍 Step 4: Verifying setup...")
        cursor.execute("""
            SELECT COUNT(*) FROM workflow_files WHERE workflow_id = %s;
        """, (workflow_id,))
        file_count = cursor.fetchone()[0]
        print(f"   ✅ DB records: {file_count} workflow_files")

        storage_exists_count = sum(1 for path in test_storage_paths if check_storage_file_exists(path))
        print(f"   ✅ Storage files: {storage_exists_count}/{len(test_storage_paths)} exist")

        # Step 5: Delete workflow from GitHub
        print(f"\n🗑️ Step 5: Deleting workflow from GitHub...")
        if delete_github_file(test_yaml_path, github_sha, "Test: Delete workflow to test cleanup"):
            print(f"✅ Deleted from GitHub: {test_yaml_path}")
        else:
            print(f"❌ Failed to delete from GitHub")
            return False

        # Wait for webhook to process deletion
        print("⏳ Waiting 10 seconds for webhook to process deletion...")
        time.sleep(10)

        # Step 6: Verify cleanup
        print(f"\n🔍 Step 6: Verifying cleanup...")

        # Check DB record deleted
        cursor.execute("""
            SELECT id FROM deployed_workflows WHERE id = %s;
        """, (workflow_id,))
        if cursor.fetchone():
            print(f"   ❌ FAILED: Workflow still in DB")
            success = False
        else:
            print(f"   ✅ DB record deleted")
            success = True

        # Check workflow_files CASCADE deleted
        cursor.execute("""
            SELECT COUNT(*) FROM workflow_files WHERE workflow_id = %s;
        """, (workflow_id,))
        remaining_files = cursor.fetchone()[0]
        if remaining_files > 0:
            print(f"   ❌ FAILED: {remaining_files} workflow_files still in DB")
            success = False
        else:
            print(f"   ✅ workflow_files CASCADE deleted")

        # Check storage files deleted
        remaining_storage = sum(1 for path in test_storage_paths if check_storage_file_exists(path))
        if remaining_storage > 0:
            print(f"   ❌ FAILED: {remaining_storage}/{len(test_storage_paths)} storage files still exist")
            success = False
        else:
            print(f"   ✅ All storage files deleted")

        cursor.close()

        print("\n" + "=" * 60)
        if success:
            print("🎉 TEST PASSED!")
            print("\n✅ Webhook successfully:")
            print("   1. Detected workflow deletion from GitHub")
            print("   2. Deleted storage files BEFORE CASCADE")
            print("   3. Deleted DB record (CASCADE cleaned up related records)")
            print("\n💡 No orphaned files!")
        else:
            print("❌ TEST FAILED!")
            print("\n⚠️  Some cleanup steps did not complete correctly")
            print("   Check logs above for details")

        return success

    except Exception as e:
        print(f"\n💥 Error during test: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup: ensure GitHub file is deleted
        if github_sha:
            try:
                delete_github_file(test_yaml_path, github_sha, "Cleanup: Delete test workflow")
                print(f"\n🧹 Cleaned up GitHub file: {test_yaml_path}")
            except:
                pass

        # Cleanup: ensure DB record is deleted
        if workflow_id:
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM deployed_workflows WHERE id = %s;", (workflow_id,))
                conn.commit()
                cursor.close()
                print(f"🧹 Cleaned up DB record: {workflow_id}")
            except:
                pass

        conn.close()

if __name__ == "__main__":
    success = main()
    if not success:
        sys.exit(1)
