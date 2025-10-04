#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test the trigger function directly with a manual SQL call.
"""

import sys
import psycopg2
import requests

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://eshwntsgsputksqamckh.supabase.co"
SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0"

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def upload_test_file(storage_path):
    """Upload test file"""
    url = f"{SUPABASE_URL}/storage/v1/object/workflow-files/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "apikey": SERVICE_ROLE_KEY,
        "Content-Type": "text/plain"
    }
    response = requests.post(url, headers=headers, data="// test")
    return response.status_code in [200, 201]

def check_file_exists(storage_path):
    """Check if file exists"""
    url = f"{SUPABASE_URL}/storage/v1/object/workflow-files/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "apikey": SERVICE_ROLE_KEY
    }
    response = requests.get(url, headers=headers)
    return response.status_code == 200

def main():
    print("🧪 Testing trigger function with pg_net")
    print("=" * 60)

    test_path = "test-folder/test-file-direct.js"

    # Upload test file
    print(f"\n📤 Uploading test file: {test_path}")
    if upload_test_file(test_path):
        print("✅ File uploaded")
    else:
        print("❌ Upload failed")
        return False

    # Verify exists
    if not check_file_exists(test_path):
        print("❌ File doesn't exist after upload")
        return False
    print("✅ File exists in storage")

    # Test pg_net HTTP delete directly
    print(f"\n🔥 Testing pg_net HTTP delete...")

    conn = get_connection()
    cursor = conn.cursor()

    try:
        # Get secrets
        cursor.execute("""
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'supabase_service_role_key';
        """)
        key = cursor.fetchone()[0]

        cursor.execute("""
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'supabase_url';
        """)
        url = cursor.fetchone()[0]

        print(f"   Using URL: {url}")
        print(f"   Key length: {len(key)}")

        # Make HTTP delete call via pg_net
        delete_url = f"{url}/storage/v1/object/workflow-files/{test_path}"
        print(f"   DELETE: {delete_url}")

        cursor.execute("""
            SELECT net.http_delete(
                url := %s,
                headers := jsonb_build_object(
                    'Authorization', 'Bearer ' || %s,
                    'apikey', %s
                )
            );
        """, (delete_url, key, key))

        result = cursor.fetchone()[0]
        conn.commit()

        print(f"   Response: {result}")

        # Check if file was deleted
        import time
        time.sleep(2)

        if not check_file_exists(test_path):
            print("✅ SUCCESS: File was deleted via pg_net!")
            return True
        else:
            print("❌ FAILED: File still exists after pg_net delete")
            print(f"   HTTP response was: {result}")
            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    success = main()
    if not success:
        sys.exit(1)
