#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Check database logs and vault secrets for trigger debugging.
"""

import sys
import psycopg2

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def main():
    print("🔍 Checking trigger configuration")
    print("=" * 60)

    conn = get_connection()
    cursor = conn.cursor()

    try:
        # Check vault secrets
        print("\n📦 Checking vault secrets...")
        cursor.execute("""
            SELECT name, description, created_at
            FROM vault.secrets
            ORDER BY name;
        """)
        secrets = cursor.fetchall()

        if secrets:
            print(f"Found {len(secrets)} secret(s) in vault:")
            for secret in secrets:
                print(f"   - {secret[0]}: {secret[1] or '(no description)'}")
        else:
            print("❌ No secrets found in vault!")
            print("   Trigger cannot work without secrets")

        # Try to decrypt and check if they have values
        print("\n🔐 Checking if secrets can be decrypted...")
        cursor.execute("""
            SELECT name, length(decrypted_secret) as key_length
            FROM vault.decrypted_secrets
            WHERE name IN ('supabase_service_role_key', 'supabase_url')
            ORDER BY name;
        """)
        decrypted = cursor.fetchall()

        if decrypted:
            for name, length in decrypted:
                print(f"   ✅ {name}: {length} characters")
        else:
            print("   ❌ Could not decrypt secrets or secrets not found")

    except Exception as e:
        print(f"❌ Error checking vault: {e}")

    cursor.close()
    conn.close()

if __name__ == "__main__":
    main()
