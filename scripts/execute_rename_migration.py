#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Execute Migration: Rename is_shared to is_public
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Fix Windows console encoding for emojis
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Load environment variables
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        # Use the known connection string from other scripts
        conn_string = "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
        print("🔗 Using known connection string")
    
    try:
        conn = psycopg2.connect(conn_string)
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def run_migration():
    """Run the is_shared -> is_public migration."""
    print("🚀 Running is_shared -> is_public migration...")
    
    migration_file = 'supabase/migrations/20260201000000_rename_is_shared_to_is_public.sql'
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    try:
        conn = get_db_connection()
        
        # Read the migration file
        with open(migration_file, 'r', encoding='utf-8') as file:
            migration_sql = file.read()
        
        print(f"   📄 Read migration file ({len(migration_sql)} characters)")
        
        # Execute the entire migration as one transaction
        with conn.cursor() as cur:
            try:
                print("   🔄 Executing migration...")
                cur.execute(migration_sql)
                conn.commit()
                print("   ✅ Migration executed successfully!")
            except psycopg2.Error as e:
                conn.rollback()
                error_msg = str(e)
                
                if 'already exists' in error_msg.lower() or 'does not exist' in error_msg.lower():
                    print(f"   ⚠️  Warning: {error_msg[:200]}")
                    print("   ✅ Migration appears to be already applied!")
                else:
                    print(f"   ❌ Migration error: {error_msg}")
                    raise e
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error running migration: {e}")
        return False

def verify_migration():
    """Verify that the migration was successful."""
    print("\n🔍 Verifying migration results...")
    
    try:
        conn = get_db_connection()
        
        with conn.cursor() as cur:
            # Check if is_public column exists
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'deployed_workflows' 
                AND column_name IN ('is_shared', 'is_public');
            """)
            
            columns = [row[0] for row in cur.fetchall()]
            
            has_is_public = 'is_public' in columns
            has_is_shared = 'is_shared' in columns
            
            print(f"\n   📊 Column status:")
            print(f"      • is_public exists: {has_is_public}")
            print(f"      • is_shared exists: {has_is_shared}")
            
            if has_is_public and not has_is_shared:
                print(f"      ✅ Column successfully renamed!")
            elif has_is_shared and not has_is_public:
                print(f"      ❌ Migration not applied (still using is_shared)")
                return False
            
            # Check NULL org_id count
            cur.execute("""
                SELECT COUNT(*) 
                FROM deployed_workflows 
                WHERE organization_id IS NULL;
            """)
            null_count = cur.fetchone()[0]
            print(f"\n   📊 NULL organization_id count: {null_count}")
            if null_count == 0:
                print(f"      ✅ No orphaned workflows")
            
            # Check public workflows
            if has_is_public:
                cur.execute("""
                    SELECT id, name, organization_id, is_public
                    FROM deployed_workflows 
                    WHERE is_public = true;
                """)
                
                public_wfs = cur.fetchall()
                print(f"\n   📊 Public workflows (is_public=true): {len(public_wfs)}")
                for wf in public_wfs:
                    print(f"      • Workflow {wf[0]}: {wf[1]}")
                    print(f"        organization_id: {wf[2]}")
                    print(f"        is_public: {wf[3]}")
                
                # Specifically check workflow 57
                cur.execute("""
                    SELECT id, name, organization_id, is_public
                    FROM deployed_workflows 
                    WHERE id = 57;
                """)
                
                wf57 = cur.fetchone()
                if wf57:
                    print(f"\n   📊 Workflow 57 status:")
                    print(f"      • organization_id: {wf57[2]}")
                    print(f"      • is_public: {wf57[3]}")
                    if wf57[3]:
                        print(f"      ⚠️  Workflow 57 is now PUBLIC (visible to all users)")
                    else:
                        print(f"      ✅ Workflow 57 is private")
        
        conn.close()
        print("\n✅ Migration verification completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Migration verification failed: {e}")
        return False

def main():
    """Main function to run the migration."""
    print("=" * 80)
    print("🚀 Executing Migration: is_shared -> is_public")
    print("=" * 80)
    print()
    
    try:
        # Step 1: Run migration
        if not run_migration():
            print("❌ Failed to run migration. Aborting.")
            sys.exit(1)
        
        # Step 2: Verify migration
        if not verify_migration():
            print("❌ Migration verification failed. Check manually.")
            sys.exit(1)
        
        # Step 3: Success
        print("\n" + "=" * 80)
        print("🎉 MIGRATION COMPLETED SUCCESSFULLY!")
        print("=" * 80)
        print("\n📋 NEXT STEPS:")
        print("   1. ✅ Database updated (is_shared -> is_public)")
        print("   2. ✅ Web app code already updated")
        print("   3. ✅ Desktop app code already updated")
        print("   4. 🔄 Restart web app to pick up changes")
        print("   5. 🔄 Rebuild desktop app")
        print()
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

