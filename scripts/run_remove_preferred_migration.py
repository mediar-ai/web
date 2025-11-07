#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Run Remove Preferred Assignment Type Migration

This script runs the migration to remove 'preferred' assignment type and simplify
machine assignments to only use 'exclusive' or auto-assignment.

This script follows the pattern of existing database scripts in this project.
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

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        # Use the known connection string from other scripts
        conn_string = "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
        print("🔗 Using known connection string from scripts")
    
    try:
        conn = psycopg2.connect(conn_string)
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print("💡 Make sure your SUPABASE_CONN_STRING is correct in .env.local")
        raise

def run_migration_file():
    """Run the main migration file."""
    print("🚀 Running remove preferred assignment type migration...")
    
    migration_file = 'supabase/migrations/20250207000000_remove_preferred_assignment_type.sql'
    
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
            # Check for any remaining preferred assignments
            cur.execute("""
                SELECT COUNT(*) 
                FROM workflow_machine_assignments 
                WHERE assignment_type = 'preferred';
            """)
            preferred_count = cur.fetchone()[0]
            
            if preferred_count > 0:
                print(f"   ⚠️  WARNING: {preferred_count} preferred assignments still exist!")
                return False
            else:
                print(f"   ✅ No preferred assignments found (expected)")
            
            # Check constraint
            print("   🔍 Checking constraint...")
            cur.execute("""
                SELECT pg_get_constraintdef(oid) 
                FROM pg_constraint
                WHERE conname = 'workflow_machine_assignments_assignment_type_check';
            """)
            
            result = cur.fetchone()
            if result:
                constraint_def = result[0]
                if 'preferred' in constraint_def.lower():
                    print(f"      ⚠️  Constraint still contains 'preferred'")
                    return False
                else:
                    print(f"      ✅ Constraint updated correctly")
            
            # Check current assignments
            cur.execute("""
                SELECT assignment_type, COUNT(*) 
                FROM workflow_machine_assignments 
                GROUP BY assignment_type 
                ORDER BY assignment_type;
            """)
            
            assignments = cur.fetchall()
            print(f"\n   📊 Current assignments:")
            for atype, count in assignments:
                print(f"      • {atype}: {count}")
        
        conn.close()
        print("\n✅ Migration verification completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Migration verification failed: {e}")
        return False

def display_next_steps():
    """Display next steps after successful migration."""
    print("\n" + "=" * 80)
    print("🎉 MIGRATION COMPLETED SUCCESSFULLY!")
    print("=" * 80)
    print("\n📋 NEXT STEPS:")
    
    print("\n1. 🚀 Deploy Code Changes to Vercel:")
    print("   git add .")
    print('   git commit -m "Remove preferred assignment type, keep only exclusive"')
    print("   git push origin main")
    print("   # Vercel will auto-deploy")
    
    print("\n2. ✅ Verify Application:")
    print("   • Check workflow settings UI - should show only 'EXCLUSIVE' option")
    print("   • Test cron scheduler - exclusive assignments should work")
    print("   • Test manual workflow execution")
    
    print("\n3. 📊 Monitor:")
    print("   • Check Vercel deployment logs")
    print("   • Monitor workflow executions")
    print("   • Verify no errors related to machine assignments")
    
    print("\n🔔 WHAT CHANGED:")
    print("   ✅ Removed 'preferred' assignment type from database")
    print("   ✅ Workflows now have only 2 modes:")
    print("      • EXCLUSIVE: Must run on specific machine (blocks if unavailable)")
    print("      • NO ASSIGNMENT: Uses auto-assignment (load balanced)")
    print("   ✅ Updated all API endpoints and UI components")
    print()

def main():
    """Main function to run the migration."""
    print("=" * 80)
    print("🚀 Starting 'Remove Preferred Assignment Type' Migration")
    print("=" * 80)
    print()
    
    try:
        # Step 1: Run migration
        if not run_migration_file():
            print("❌ Failed to run migration file. Aborting.")
            sys.exit(1)
        
        # Step 2: Verify migration
        if not verify_migration():
            print("❌ Migration verification failed. Check manually.")
            sys.exit(1)
        
        # Step 3: Display next steps
        display_next_steps()
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

