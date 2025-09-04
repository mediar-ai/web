#!/usr/bin/env python3

import os
import psycopg2
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
        return conn
    except Exception as e:
        print(f"Database connection failed: {e}")
        raise


def check_view():
    """Check if the view exists and returns workflow data"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    print("\nCHECKING PRODUCTION DATABASE VIEW")
    print("="*60)
    
    try:
        # Check if view exists
        cursor.execute("""
            SELECT COUNT(*) 
            FROM pg_views 
            WHERE schemaname = 'public' 
            AND viewname = 'deployed_workflows_with_sequence';
        """)
        
        view_exists = cursor.fetchone()[0] > 0
        print(f"View 'deployed_workflows_with_sequence' exists: {view_exists}")
        
        if not view_exists:
            print("\n❌ CRITICAL: View doesn't exist!")
            print("This is why Modal can't execute workflows!")
            print("\nTo fix, run this SQL in Supabase:")
            print("-"*40)
            print("""
CREATE OR REPLACE VIEW public.deployed_workflows_with_sequence AS
SELECT 
    w.id,
    w.name,
    w.description,
    w.version,
    w.status,
    w.category,
    w.automation_sequence,
    '' as automation_sequence_yaml,
    'jsonb' as sequence_format,
    'jsonb' as preferred_format,
    w.created_at,
    w.updated_at,
    w.workflow_type,
    w.parent_workflow_id,
    w.estimated_duration_seconds,
    w.successful_runs,
    w.failed_runs,
    w.cancelled_runs,
    w.total_executions,
    w.display_order,
    w.created_by,
    w.cron_expression,
    w.cron_timezone,
    w.cron_enabled,
    w.last_scheduled_execution,
    w.next_scheduled_execution,
    w.cron_max_concurrent,
    w.cron_retry_on_failure,
    w.cron_retry_count,
    null::integer as current_version_id,
    1 as total_versions,
    '' as current_version_notes,
    null::integer as version_id,
    '' as change_notes
FROM deployed_workflows w
WHERE w.automation_sequence IS NOT NULL;

GRANT SELECT ON public.deployed_workflows_with_sequence TO anon;
GRANT SELECT ON public.deployed_workflows_with_sequence TO authenticated;
GRANT SELECT ON public.deployed_workflows_with_sequence TO service_role;
            """)
        else:
            # Check if workflows are visible in view
            cursor.execute("""
                SELECT id, name, 
                       automation_sequence IS NOT NULL as has_sequence
                FROM deployed_workflows_with_sequence
                WHERE id IN (12, 13);
            """)
            
            results = cursor.fetchall()
            
            if results:
                print("\nWorkflows in view:")
                for id, name, has_seq in results:
                    print(f"  #{id}: {name} - Has sequence: {has_seq}")
            else:
                print("\n❌ Workflows #12 and #13 NOT visible in view!")
                print("This means they don't have automation_sequence set")
        
        # Check automation_sequence directly
        print("\nDirect check of automation_sequence:")
        cursor.execute("""
            SELECT id, name, 
                   automation_sequence IS NOT NULL as has_sequence,
                   pg_column_size(automation_sequence::text) as size
            FROM deployed_workflows
            WHERE id IN (12, 13);
        """)
        
        results = cursor.fetchall()
        for id, name, has_seq, size in results:
            print(f"  #{id}: {name}")
            print(f"    Has sequence: {has_seq}")
            if size:
                print(f"    Size: {size} bytes")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    check_view()
