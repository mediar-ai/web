#!/usr/bin/env python3
"""
Adds workflow_type and parent_workflow_id columns to deployed_workflows table.
This enables settings workflows to be nested under execution workflows.
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

def check_columns_exist(conn):
    """Check if workflow_type and parent_workflow_id columns already exist."""
    print("🔍 Checking if columns already exist...")
    
    with conn.cursor() as cur:
        # Check for workflow_type column
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows' 
                AND column_name = 'workflow_type'
            )
        """)
        workflow_type_exists = cur.fetchone()[0]
        
        # Check for parent_workflow_id column
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows' 
                AND column_name = 'parent_workflow_id'
            )
        """)
        parent_id_exists = cur.fetchone()[0]
        
        # Check for display_order column
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows' 
                AND column_name = 'display_order'
            )
        """)
        display_order_exists = cur.fetchone()[0]
        
        return workflow_type_exists, parent_id_exists, display_order_exists

def add_workflow_type_columns():
    """Adds workflow_type and parent_workflow_id columns to deployed_workflows table."""
    print("🔄 Adding workflow_type and parent_workflow_id columns to deployed_workflows table...")
    
    conn = get_db_connection()
    try:
        workflow_type_exists, parent_id_exists, display_order_exists = check_columns_exist(conn)
        
        if workflow_type_exists and parent_id_exists and display_order_exists:
            print("✅ All columns already exist.")
            return True
        
        with conn.cursor() as cur:
            # Add workflow_type column if it doesn't exist
            if not workflow_type_exists:
                print("📝 Adding workflow_type column...")
                cur.execute("""
                    ALTER TABLE public.deployed_workflows 
                    ADD COLUMN workflow_type text NOT NULL DEFAULT 'execution' 
                        CHECK (workflow_type IN ('execution', 'settings'));
                """)
                print("✅ Successfully added workflow_type column.")
            
            # Add parent_workflow_id column if it doesn't exist
            if not parent_id_exists:
                print("📝 Adding parent_workflow_id column...")
                cur.execute("""
                    ALTER TABLE public.deployed_workflows 
                    ADD COLUMN parent_workflow_id bigint 
                        REFERENCES public.deployed_workflows(id) ON DELETE CASCADE;
                """)
                print("✅ Successfully added parent_workflow_id column.")
            
            # Add display_order column if it doesn't exist
            if not display_order_exists:
                print("📝 Adding display_order column...")
                cur.execute("""
                    ALTER TABLE public.deployed_workflows 
                    ADD COLUMN display_order integer DEFAULT 0;
                """)
                print("✅ Successfully added display_order column.")
            
            return True
            
    except Exception as e:
        print(f"❌ Error adding columns: {e}")
        return False
    finally:
        conn.close()

def create_indexes():
    """Creates indexes for efficient querying."""
    print("🔄 Creating indexes for efficient querying...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Create indexes
            indexes = [
                ("idx_deployed_workflows_parent", "parent_workflow_id"),
                ("idx_deployed_workflows_type", "workflow_type"),
                ("idx_deployed_workflows_type_parent", "workflow_type, parent_workflow_id")
            ]
            
            for index_name, columns in indexes:
                try:
                    cur.execute(f"""
                        CREATE INDEX IF NOT EXISTS {index_name} 
                        ON public.deployed_workflows({columns});
                    """)
                    print(f"✅ Created index {index_name}")
                except Exception as e:
                    print(f"⚠️  Index {index_name} might already exist: {e}")
            
            return True
            
    except Exception as e:
        print(f"❌ Error creating indexes: {e}")
        return False
    finally:
        conn.close()

def add_comments():
    """Adds documentation comments to the new columns."""
    print("🔄 Adding documentation comments...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Add comments
            cur.execute("""
                COMMENT ON COLUMN public.deployed_workflows.workflow_type 
                IS 'Type of workflow: execution (runnable) or settings (configuration template)';
            """)
            
            cur.execute("""
                COMMENT ON COLUMN public.deployed_workflows.parent_workflow_id 
                IS 'Reference to parent execution workflow (for settings workflows only)';
            """)
            
            cur.execute("""
                COMMENT ON COLUMN public.deployed_workflows.display_order 
                IS 'Order for displaying settings workflows within parent (0 = first)';
            """)
            
            print("✅ Successfully added documentation comments.")
            return True
            
    except Exception as e:
        print(f"❌ Error adding comments: {e}")
        return False
    finally:
        conn.close()

def add_constraints():
    """Adds constraint to ensure settings workflows have parents."""
    print("🔄 Adding constraint for settings workflow parent relationship...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check if constraint already exists
            cur.execute("""
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'deployed_workflows' 
                AND constraint_name = 'check_settings_parent'
            """)
            
            if cur.fetchone():
                print("✅ Constraint 'check_settings_parent' already exists.")
                return True
            
            # Add the constraint
            cur.execute("""
                ALTER TABLE public.deployed_workflows 
                ADD CONSTRAINT check_settings_parent 
                CHECK (
                    (workflow_type = 'settings' AND parent_workflow_id IS NOT NULL) OR 
                    (workflow_type = 'execution' AND parent_workflow_id IS NULL)
                );
            """)
            
            print("✅ Successfully added check_settings_parent constraint.")
            return True
            
    except Exception as e:
        print(f"❌ Error adding constraint: {e}")
        return False
    finally:
        conn.close()

def update_existing_workflows():
    """Updates existing workflows to be execution type."""
    print("🔄 Updating existing workflows to be execution type...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Update existing workflows
            cur.execute("""
                UPDATE public.deployed_workflows 
                SET workflow_type = 'execution' 
                WHERE workflow_type IS NULL;
            """)
            
            rows_updated = cur.rowcount
            print(f"✅ Updated {rows_updated} existing workflows to execution type.")
            return True
            
    except Exception as e:
        print(f"❌ Error updating existing workflows: {e}")
        return False
    finally:
        conn.close()

def main():
    """Main function to run all migration steps."""
    print("🚀 Starting workflow type and parent relationship migration...")
    print("=" * 60)
    
    try:
        # Step 1: Add columns
        if not add_workflow_type_columns():
            print("❌ Failed to add columns. Aborting.")
            sys.exit(1)
        
        # Step 2: Create indexes
        if not create_indexes():
            print("❌ Failed to create indexes. Aborting.")
            sys.exit(1)
        
        # Step 3: Add comments
        if not add_comments():
            print("❌ Failed to add comments. Aborting.")
            sys.exit(1)
        
        # Step 4: Update existing workflows
        if not update_existing_workflows():
            print("❌ Failed to update existing workflows. Aborting.")
            sys.exit(1)
        
        # Step 5: Add constraints (do this last to avoid conflicts)
        if not add_constraints():
            print("❌ Failed to add constraints. Aborting.")
            sys.exit(1)
        
        print("=" * 60)
        print("🎉 Migration completed successfully!")
        print("✅ Added workflow_type column with 'execution'/'settings' values")
        print("✅ Added parent_workflow_id for linking settings to execution workflows")
        print("✅ Added display_order for ordering settings workflows")
        print("✅ Created necessary indexes and constraints")
        print("✅ Updated existing workflows to be 'execution' type")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 