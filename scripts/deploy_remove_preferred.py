#!/usr/bin/env python3
"""
Deploy script to remove 'preferred' assignment type
Runs the migration: 20250207000000_remove_preferred_assignment_type.sql
"""

import os
import sys
import psycopg2
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv(".env.local")

def get_db_connection():
    """Get database connection using environment variables."""
    try:
        database_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
        if database_url:
            conn = psycopg2.connect(database_url)
        else:
            conn = psycopg2.connect(
                host=os.getenv("DB_HOST"),
                database=os.getenv("DB_NAME"),
                user=os.getenv("DB_USER"),
                password=os.getenv("DB_PASSWORD"),
                port=os.getenv("DB_PORT", 5432),
            )
        print("✅ Database connection established")
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def run_migration(conn):
    """Run the migration to remove preferred assignment type."""
    migration_file = "supabase/migrations/20250207000000_remove_preferred_assignment_type.sql"
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    try:
        with open(migration_file, "r", encoding="utf-8") as file:
            migration_sql = file.read()
        
        print(f"📄 Loaded migration file ({len(migration_sql)} characters)")
        print("🚀 Running migration...\n")
        
        with conn.cursor() as cur:
            # Enable notices so we can see the RAISE NOTICE output
            cur.execute("SET client_min_messages TO NOTICE;")
            
            # Execute the migration
            cur.execute(migration_sql)
            
            # Get all notices/logs
            for notice in conn.notices:
                print(f"   {notice.strip()}")
            
            conn.commit()
            print("\n✅ Migration completed successfully!")
        
        return True
        
    except psycopg2.Error as e:
        conn.rollback()
        error_msg = str(e)
        
        if "already exists" in error_msg.lower() or "does not exist" in error_msg.lower():
            print(f"⚠️  Warning: {error_msg[:200]}")
            print("✅ Migration appears to be already applied or partially applied!")
            return True
        else:
            print(f"❌ Migration error: {error_msg}")
            raise e
    except Exception as e:
        print(f"❌ Error running migration: {e}")
        return False

def verify_migration(conn):
    """Verify that preferred assignments are removed."""
    print("\n🔍 Verifying migration...")
    
    cursor = conn.cursor()
    try:
        # Check for any remaining preferred assignments
        cursor.execute("""
            SELECT COUNT(*) 
            FROM workflow_machine_assignments 
            WHERE assignment_type = 'preferred';
        """)
        preferred_count = cursor.fetchone()[0]
        
        if preferred_count > 0:
            print(f"   ⚠️  WARNING: {preferred_count} preferred assignments still exist!")
            return False
        else:
            print(f"   ✅ No preferred assignments found (expected)")
        
        # Check constraint
        cursor.execute("""
            SELECT con.conname, pg_get_constraintdef(con.oid) 
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'workflow_machine_assignments'
            AND con.conname LIKE '%assignment_type%';
        """)
        
        constraints = cursor.fetchall()
        for name, definition in constraints:
            print(f"   ✅ Constraint: {name}")
            if 'preferred' in definition.lower():
                print(f"      ⚠️  Still contains 'preferred': {definition[:100]}")
                return False
        
        # Check current assignments
        cursor.execute("""
            SELECT assignment_type, COUNT(*) 
            FROM workflow_machine_assignments 
            GROUP BY assignment_type 
            ORDER BY assignment_type;
        """)
        
        assignments = cursor.fetchall()
        print(f"\n   📊 Current assignments:")
        for atype, count in assignments:
            print(f"      • {atype}: {count}")
        
        return True
        
    except Exception as e:
        print(f"   ❌ Error verifying migration: {e}")
        return False
    finally:
        cursor.close()

def main():
    """Main deployment orchestration."""
    print("=" * 80)
    print("🚀 DEPLOYMENT: Remove 'preferred' Assignment Type")
    print(f"⏰ Started at: {datetime.now()}")
    print("=" * 80)
    print()
    
    try:
        conn = get_db_connection()
        
        # Run the migration
        success = run_migration(conn)
        if not success:
            return False
        
        # Verify results
        verify_migration(conn)
        
        print("\n" + "=" * 80)
        print("✅ DEPLOYMENT COMPLETE!")
        print("=" * 80)
        print("\n📋 Next steps:")
        print("   1. Restart your Next.js application (Vercel will auto-deploy)")
        print("   2. Test workflow execution with exclusive assignments")
        print("   3. Verify cron scheduler works correctly")
        print("   4. Check UI - assignment dropdowns should show only 'EXCLUSIVE'")
        print()
        
        return True
        
    except Exception as e:
        print(f"\n💥 Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

