#!/usr/bin/env python3

import os
import sys
from datetime import datetime

import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv(".env.local")


def get_db_connection():
    """Get database connection using environment variables."""
    try:
        # Try to get connection string from environment
        database_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
        if database_url:
            conn = psycopg2.connect(database_url)
        else:
            # Fallback to individual components
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


def check_cron_columns_exist(conn):
    """Check if cron columns already exist."""
    print("\n🔍 Checking current database state...")

    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'deployed_workflows' 
            AND table_schema = 'public'
            AND column_name LIKE 'cron_%'
            ORDER BY column_name;
        """
        )

        existing_columns = [row[0] for row in cursor.fetchall()]

        expected_columns = [
            "cron_expression",
            "cron_timezone",
            "cron_enabled",
            "cron_max_concurrent",
            "cron_retry_on_failure",
            "cron_retry_count",
        ]

        for col in expected_columns:
            if col in existing_columns:
                print(f"   ✅ Column '{col}' already exists")
            else:
                print(f"   ❌ Column '{col}' needs to be added")

        # Also check for timestamp columns
        cursor.execute(
            """
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'deployed_workflows' 
            AND table_schema = 'public'
            AND column_name IN ('last_scheduled_execution', 'next_scheduled_execution');
        """
        )

        timestamp_columns = [row[0] for row in cursor.fetchall()]
        for col in ["last_scheduled_execution", "next_scheduled_execution"]:
            if col in timestamp_columns:
                print(f"   ✅ Column '{col}' already exists")
            else:
                print(f"   ❌ Column '{col}' needs to be added")

        return len(existing_columns) + len(timestamp_columns) >= 8  # All columns exist

    except Exception as e:
        print(f"❌ Error checking columns: {e}")
        return False
    finally:
        cursor.close()


def check_view_exists(conn):
    """Check if active_cron_jobs view exists."""
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT viewname 
            FROM pg_views 
            WHERE schemaname = 'public' 
            AND viewname = 'active_cron_jobs';
        """
        )

        result = cursor.fetchone()
        exists = result is not None

        if exists:
            print("   ✅ View 'active_cron_jobs' already exists")
        else:
            print("   ❌ View 'active_cron_jobs' needs to be created")

        return exists

    except Exception as e:
        print(f"❌ Error checking view: {e}")
        return False
    finally:
        cursor.close()


def dry_run_migration(conn):
    """Perform a dry run of the migration (check what would be executed)."""
    print("\n🧪 DRY RUN MODE - No changes will be made")
    print("=" * 50)

    migration_file = "supabase/migrations/20250128000000_add_cron_scheduling.sql"

    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False

    with open(migration_file, "r", encoding="utf-8") as file:
        migration_sql = file.read()

    print(f"📄 Migration file: {migration_file}")
    print(f"📏 Size: {len(migration_sql)} characters")
    print(f"📊 Lines: {len(migration_sql.splitlines())} lines")

    # Parse and show what would be executed
    lines = migration_sql.split("\n")
    statements = []
    current_statement = []

    for line in lines:
        line = line.strip()
        if line and not line.startswith("--"):
            current_statement.append(line)
            if line.endswith(";"):
                statements.append(" ".join(current_statement))
                current_statement = []

    print(f"\n📋 Would execute {len(statements)} SQL statements:")
    for i, stmt in enumerate(statements, 1):
        if "ALTER TABLE" in stmt:
            print(f"   {i}. ALTER TABLE (add columns)")
        elif "CREATE INDEX" in stmt:
            print(f"   {i}. CREATE INDEX")
        elif "CREATE OR REPLACE VIEW" in stmt:
            print(f"   {i}. CREATE VIEW")
        elif "COMMENT ON" in stmt:
            print(f"   {i}. ADD COMMENT")
        elif "GRANT" in stmt:
            print(f"   {i}. GRANT PERMISSIONS")
        else:
            print(f"   {i}. {stmt[:50]}...")

    print("\n✅ Dry run completed - no changes made")
    return True


def run_migration_file(conn):
    """Run the actual migration file."""
    print("\n🚀 Running cron scheduling migration...")

    migration_file = "supabase/migrations/20250128000000_add_cron_scheduling.sql"

    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False

    try:
        # Read the migration file
        with open(migration_file, "r", encoding="utf-8") as file:
            migration_sql = file.read()

        print(f"   📄 Read migration file ({len(migration_sql)} characters)")

        # Execute the migration in a transaction
        with conn.cursor() as cur:
            try:
                print("   🔄 Executing migration...")
                cur.execute(migration_sql)
                conn.commit()
                print("   ✅ Migration executed successfully!")
            except psycopg2.Error as e:
                conn.rollback()
                error_msg = str(e)

                # Check if it's just "already exists" errors
                if "already exists" in error_msg.lower():
                    print(f"   ⚠️  Some objects already exist: {error_msg[:200]}...")
                    print("   ✅ Migration appears to be already applied!")
                else:
                    print(f"   ❌ Migration error: {error_msg}")
                    raise e

        return True

    except Exception as e:
        print(f"❌ Error running migration: {e}")
        return False


def verify_migration(conn):
    """Verify that the migration was successful."""
    print("\n🔍 Verifying migration results...")

    cursor = conn.cursor()
    try:
        # Check columns
        cursor.execute(
            """
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'deployed_workflows' 
            AND table_schema = 'public'
            AND column_name LIKE '%cron%'
            ORDER BY column_name;
        """
        )

        columns = cursor.fetchall()
        print(f"   📋 Found {len(columns)} cron-related columns:")
        for col_name, data_type, nullable, default in columns:
            default_str = f" DEFAULT {default}" if default else ""
            nullable_str = "NULL" if nullable == "YES" else "NOT NULL"
            print(f"      • {col_name}: {data_type} {nullable_str}{default_str}")

        # Check indexes
        cursor.execute(
            """
            SELECT indexname, indexdef
            FROM pg_indexes 
            WHERE tablename = 'deployed_workflows'
            AND indexname LIKE '%cron%';
        """
        )

        indexes = cursor.fetchall()
        print(f"   🔍 Found {len(indexes)} cron-related indexes:")
        for index_name, index_def in indexes:
            print(f"      • {index_name}")

        # Check view
        cursor.execute(
            """
            SELECT viewname, definition
            FROM pg_views 
            WHERE schemaname = 'public' 
            AND viewname = 'active_cron_jobs';
        """
        )

        view = cursor.fetchone()
        if view:
            print(f"   👁️  View 'active_cron_jobs' created successfully")
        else:
            print(f"   ❌ View 'active_cron_jobs' not found")

        # Test the view
        cursor.execute("SELECT COUNT(*) FROM public.active_cron_jobs;")
        count = cursor.fetchone()[0]
        print(f"   📊 Active cron jobs: {count}")

        return True

    except Exception as e:
        print(f"❌ Error verifying migration: {e}")
        return False
    finally:
        cursor.close()


def main():
    """Main migration orchestration."""
    print("🚀 Cron Scheduling Migration")
    print(f"⏰ Started at: {datetime.now()}")
    print("=" * 50)

    # Parse command line arguments
    dry_run = "--dry-run" in sys.argv
    force = "--force" in sys.argv

    if dry_run:
        print("🧪 DRY RUN MODE ENABLED")

    try:
        conn = get_db_connection()

        # Check current state
        columns_exist = check_cron_columns_exist(conn)
        view_exists = check_view_exists(conn)

        if columns_exist and view_exists and not force:
            print("\n✅ Migration appears to be already applied!")
            print("   Use --force to run anyway")
            return True

        if dry_run:
            return dry_run_migration(conn)

        # Confirm before running
        if not force:
            print(f"\n⚠️  About to run migration on database")
            response = input("Continue? (y/N): ").strip().lower()
            if response != "y":
                print("❌ Migration cancelled by user")
                return False

        # Run the migration
        success = run_migration_file(conn)
        if not success:
            return False

        # Verify results
        verify_migration(conn)

        print(f"\n🎉 Cron scheduling migration completed successfully!")
        print("📋 Next steps:")
        print("   1. Deploy your NextJS app to activate the cron scheduler")
        print("   2. Upload YAML workflows with cron expressions")
        print("   3. Monitor the /api/cron/scheduler endpoint")

        return True

    except Exception as e:
        print(f"💥 Fatal error: {e}")
        return False
    finally:
        if "conn" in locals():
            conn.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("Usage: python scripts/run_cron_migration.py [OPTIONS]")
        print("Options:")
        print("  --dry-run    Show what would be executed without making changes")
        print("  --force      Run migration even if it appears already applied")
        print("  --help       Show this help message")
        sys.exit(0)

    success = main()
    sys.exit(0 if success else 1)
