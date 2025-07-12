#!/usr/bin/env python3
"""
Adds cancelled_runs column to deployed_workflows table and updates the trigger.
This script follows the pattern of existing database scripts in this project.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        print("❌ Error: SUPABASE_CONN_STRING environment variable not set.")
        print("Please set it in .env.local file")
        sys.exit(1)
    try:
        conn = psycopg2.connect(conn_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def add_cancelled_runs_column():
    """Adds the cancelled_runs column to deployed_workflows table."""
    print("🔄 Adding cancelled_runs column to deployed_workflows table...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check if column already exists
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'deployed_workflows' 
                AND column_name = 'cancelled_runs'
            """)
            
            if cur.fetchone():
                print("✅ Column 'cancelled_runs' already exists.")
                return True
            
            # Add the column
            cur.execute("""
                ALTER TABLE public.deployed_workflows 
                ADD COLUMN cancelled_runs integer DEFAULT 0;
            """)
            
            print("✅ Successfully added cancelled_runs column.")
            return True
            
    except Exception as e:
        print(f"❌ Error adding column: {e}")
        return False
    finally:
        conn.close()

def update_trigger_function():
    """Updates the trigger function to handle cancelled status."""
    print("🔄 Updating trigger function to handle cancelled status...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Update the trigger function
            cur.execute("""
                CREATE OR REPLACE FUNCTION update_workflow_stats()
                RETURNS TRIGGER AS $$
                DECLARE
                    new_avg_duration INT;
                BEGIN
                    -- Only update stats when status changes to completed, failed, or cancelled
                    IF NEW.status IN ('completed', 'failed', 'cancelled') AND OLD.status NOT IN ('completed', 'failed', 'cancelled') THEN
                        IF NEW.status = 'completed' THEN
                            -- Calculate the new average duration from all successful runs for this workflow
                            SELECT AVG(execution_duration_seconds)::INT INTO new_avg_duration
                            FROM public.workflow_executions
                            WHERE workflow_id = NEW.workflow_id AND status = 'completed';

                            UPDATE public.deployed_workflows
                            SET
                                successful_runs = successful_runs + 1,
                                total_executions = total_executions + 1,
                                average_duration_seconds = new_avg_duration
                            WHERE id = NEW.workflow_id;
                        ELSIF NEW.status = 'failed' THEN
                            UPDATE public.deployed_workflows
                            SET
                                failed_runs = failed_runs + 1,
                                total_executions = total_executions + 1
                            WHERE id = NEW.workflow_id;
                        ELSIF NEW.status = 'cancelled' THEN
                            UPDATE public.deployed_workflows
                            SET
                                cancelled_runs = cancelled_runs + 1,
                                total_executions = total_executions + 1
                            WHERE id = NEW.workflow_id;
                        END IF;
                    END IF;

                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
            """)
            
            print("✅ Successfully updated trigger function.")
            return True
            
    except Exception as e:
        print(f"❌ Error updating trigger function: {e}")
        return False
    finally:
        conn.close()

def backfill_cancelled_runs():
    """Backfills cancelled_runs counts for existing workflows."""
    print("🔄 Backfilling cancelled_runs counts for existing workflows...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Get all workflows
            cur.execute("SELECT id, name FROM deployed_workflows ORDER BY id")
            workflows = cur.fetchall()
            
            if not workflows:
                print("No workflows found.")
                return True
            
            print(f"Found {len(workflows)} workflows to update.")
            
            updated_count = 0
            for workflow_id, workflow_name in workflows:
                # Count cancelled executions for this workflow
                cur.execute("""
                    SELECT COUNT(*) 
                    FROM workflow_executions 
                    WHERE workflow_id = %s AND status = 'cancelled'
                """, (workflow_id,))
                
                cancelled_count = cur.fetchone()[0]
                
                if cancelled_count > 0:
                    # Update the workflow with the correct count
                    cur.execute("""
                        UPDATE deployed_workflows 
                        SET cancelled_runs = %s 
                        WHERE id = %s
                    """, (cancelled_count, workflow_id))
                    
                    print(f"  ✅ Updated workflow '{workflow_name}' (ID: {workflow_id}): {cancelled_count} cancelled runs")
                    updated_count += 1
                else:
                    print(f"  ⏭️  Workflow '{workflow_name}' (ID: {workflow_id}): 0 cancelled runs (no update needed)")
            
            print(f"✅ Backfill completed. Updated {updated_count} workflows.")
            return True
            
    except Exception as e:
        print(f"❌ Error during backfill: {e}")
        return False
    finally:
        conn.close()

def verify_changes():
    """Verifies that the changes were applied correctly."""
    print("🔍 Verifying changes...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check if column exists
            cur.execute("""
                SELECT column_name, data_type, column_default
                FROM information_schema.columns 
                WHERE table_name = 'deployed_workflows' 
                AND column_name = 'cancelled_runs'
            """)
            
            column_info = cur.fetchone()
            if not column_info:
                print("❌ Column 'cancelled_runs' not found!")
                return False
            
            print(f"✅ Column 'cancelled_runs' exists: {column_info[1]} with default {column_info[2]}")
            
            # Check trigger function
            cur.execute("""
                SELECT routine_name 
                FROM information_schema.routines 
                WHERE routine_name = 'update_workflow_stats' 
                AND routine_type = 'FUNCTION'
            """)
            
            if not cur.fetchone():
                print("❌ Trigger function 'update_workflow_stats' not found!")
                return False
            
            print("✅ Trigger function 'update_workflow_stats' exists.")
            
            # Show current counts
            cur.execute("""
                SELECT 
                    id, 
                    name, 
                    successful_runs, 
                    failed_runs, 
                    cancelled_runs, 
                    total_executions 
                FROM deployed_workflows 
                ORDER BY id
            """)
            
            workflows = cur.fetchall()
            print(f"\n📊 Current workflow statistics:")
            print(f"{'ID':<4} {'Name':<30} {'Success':<8} {'Failed':<8} {'Cancelled':<10} {'Total':<8}")
            print("-" * 80)
            
            for row in workflows:
                wf_id, name, success, failed, cancelled, total = row
                name_truncated = (name[:27] + '...') if len(name) > 30 else name
                print(f"{wf_id:<4} {name_truncated:<30} {success or 0:<8} {failed or 0:<8} {cancelled or 0:<10} {total or 0:<8}")
            
            return True
            
    except Exception as e:
        print(f"❌ Error during verification: {e}")
        return False
    finally:
        conn.close()

def main():
    """Main function to run the migration."""
    print("🚀 Starting cancelled_runs column migration...")
    print("=" * 60)
    
    # Step 1: Add the column
    if not add_cancelled_runs_column():
        print("❌ Failed to add column. Aborting.")
        sys.exit(1)
    
    # Step 2: Update the trigger function
    if not update_trigger_function():
        print("❌ Failed to update trigger function. Aborting.")
        sys.exit(1)
    
    # Step 3: Backfill existing data
    if not backfill_cancelled_runs():
        print("❌ Failed to backfill data. Aborting.")
        sys.exit(1)
    
    # Step 4: Verify everything worked
    if not verify_changes():
        print("❌ Verification failed.")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("✅ Migration completed successfully!")
    print("\nThe cancelled_runs column has been added and populated.")
    print("The trigger function now handles 'cancelled' status updates.")
    print("You can now see cancelled counts in the workflow statistics.")

if __name__ == "__main__":
    main() 