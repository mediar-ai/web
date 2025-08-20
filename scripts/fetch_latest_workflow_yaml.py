#!/usr/bin/env python3
"""
Fetch latest workflow YAML from Supabase database.
This script connects to the database and retrieves the most recent workflow
with YAML data, saving it to a local file.

Usage: python scripts/fetch_latest_workflow_yaml.py
"""

import os
import sys
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        # Use the known connection string from other scripts
        conn_string = "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
        print("🔗 Using known connection string from scripts")
    
    try:
        conn = psycopg2.connect(conn_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print("💡 Make sure your SUPABASE_CONN_STRING is correct in .env.local")
        raise

def explore_database_structure(conn):
    """Explore the database structure to understand available tables and columns."""
    print("🔍 Exploring database structure...")
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Check for workflow-related tables
        cur.execute("""
            SELECT table_name, table_type 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name ILIKE '%workflow%'
            ORDER BY table_name;
        """)
        
        workflow_tables = cur.fetchall()
        print(f"\n📊 Found {len(workflow_tables)} workflow-related tables:")
        for table in workflow_tables:
            print(f"  - {table['table_name']} ({table['table_type']})")
        
        # Check deployed_workflows table structure
        if any(t['table_name'] == 'deployed_workflows' for t in workflow_tables):
            print(f"\n🔍 Exploring deployed_workflows table structure:")
            cur.execute("""
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows'
                ORDER BY ordinal_position;
            """)
            
            columns = cur.fetchall()
            for col in columns:
                nullable = "NULL" if col['is_nullable'] == 'YES' else "NOT NULL"
                default = f" DEFAULT {col['column_default']}" if col['column_default'] else ""
                print(f"  - {col['column_name']}: {col['data_type']} {nullable}{default}")
        
        # Check for YAML-related columns
        print(f"\n🔍 Checking for YAML-related columns:")
        cur.execute("""
            SELECT table_name, column_name, data_type
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND column_name ILIKE '%yaml%'
            ORDER BY table_name, column_name;
        """)
        
        yaml_columns = cur.fetchall()
        if yaml_columns:
            for col in yaml_columns:
                print(f"  - {col['table_name']}.{col['column_name']}: {col['data_type']}")
        else:
            print("  - No YAML columns found")

def count_workflows(conn):
    """Count total workflows and those with YAML data."""
    print("\n📊 Counting workflows...")
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Total workflows
        cur.execute("SELECT COUNT(*) as count FROM deployed_workflows")
        result = cur.fetchone()
        total_workflows = result['count'] if result else 0
        print(f"  - Total workflows: {total_workflows}")
        
        # Workflows with automation_sequence
        cur.execute("""
            SELECT COUNT(*) as count 
            FROM deployed_workflows 
            WHERE automation_sequence IS NOT NULL
        """)
        result = cur.fetchone()
        jsonb_workflows = result['count'] if result else 0
        print(f"  - Workflows with JSONB sequence: {jsonb_workflows}")
        
        # Check if YAML column exists and count workflows with YAML data
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows' 
                AND column_name = 'automation_sequence_yaml'
            )
        """)
        result = cur.fetchone()
        yaml_column_exists = result['exists'] if result else False
        
        if yaml_column_exists:
            cur.execute("""
                SELECT COUNT(*) as count 
                FROM deployed_workflows 
                WHERE automation_sequence_yaml IS NOT NULL 
                AND automation_sequence_yaml != ''
            """)
            result = cur.fetchone()
            yaml_workflows = result['count'] if result else 0
            print(f"  - Workflows with YAML sequence: {yaml_workflows}")
        else:
            print(f"  - YAML column not found")
            yaml_workflows = 0
        
        return total_workflows, jsonb_workflows, yaml_workflows

def fetch_latest_workflow_yaml(conn):
    """Fetch the latest workflow with YAML data."""
    print("\n📥 Fetching latest workflow...")
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # First, try to get workflows with YAML data using the compatibility view
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.views 
                WHERE table_schema = 'public' 
                AND table_name = 'deployed_workflows_with_sequence'
            )
        """)
        result = cur.fetchone()
        view_exists = result['exists'] if result else False
        
        if view_exists:
            print("  - Using deployed_workflows_with_sequence view...")
            cur.execute("""
                SELECT id, name, description, status, 
                       automation_sequence_yaml, automation_sequence,
                       sequence_format, version, created_at, updated_at
                FROM deployed_workflows_with_sequence
                WHERE (automation_sequence_yaml IS NOT NULL AND automation_sequence_yaml != '')
                   OR automation_sequence IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 1;
            """)
        else:
            print("  - Using deployed_workflows table directly...")
            # Check if YAML column exists
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'deployed_workflows' 
                    AND column_name = 'automation_sequence_yaml'
                )
            """)
            result = cur.fetchone()
            yaml_column_exists = result['exists'] if result else False
            
            if yaml_column_exists:
                cur.execute("""
                    SELECT id, name, description, status, version,
                           automation_sequence_yaml, automation_sequence,
                           created_at, updated_at
                    FROM deployed_workflows
                    WHERE (automation_sequence_yaml IS NOT NULL AND automation_sequence_yaml != '')
                       OR automation_sequence IS NOT NULL
                    ORDER BY updated_at DESC
                    LIMIT 1;
                """)
            else:
                cur.execute("""
                    SELECT id, name, description, status, version,
                           automation_sequence, created_at, updated_at
                    FROM deployed_workflows
                    WHERE automation_sequence IS NOT NULL
                    ORDER BY updated_at DESC
                    LIMIT 1;
                """)
        
        workflow = cur.fetchone()
        
        if not workflow:
            print("❌ No workflows found with sequence data")
            return None
        
        print(f"\n✅ Found latest workflow:")
        print(f"  - ID: {workflow['id']}")
        print(f"  - Name: {workflow['name']}")
        print(f"  - Description: {workflow.get('description', 'N/A')}")
        print(f"  - Status: {workflow['status']}")
        print(f"  - Version: {workflow.get('version', 'N/A')}")
        print(f"  - Updated: {workflow['updated_at']}")
        
        # Determine which format to use
        has_yaml = workflow.get('automation_sequence_yaml') and workflow['automation_sequence_yaml'].strip()
        has_jsonb = workflow.get('automation_sequence') is not None
        
        if has_yaml:
            print(f"  - Format: YAML ✅")
            sequence_content = workflow['automation_sequence_yaml']
            file_extension = 'yaml'
        elif has_jsonb:
            print(f"  - Format: JSONB (converting to YAML)")
            # Convert JSONB to YAML-like format
            sequence_content = f"""# Workflow: {workflow['name']}
# Description: {workflow.get('description', 'No description')}
# Status: {workflow['status']}
# Version: {workflow.get('version', 'N/A')}
# Updated: {workflow['updated_at']}
# Format: Converted from JSONB

# Automation Sequence (JSON format):
{json.dumps(workflow['automation_sequence'], indent=2)}
"""
            file_extension = 'yaml'
        else:
            print("❌ No sequence data found")
            return None
        
        return {
            'workflow': workflow,
            'content': sequence_content,
            'extension': file_extension
        }

def save_workflow_to_file(workflow_data):
    """Save workflow content to a local file."""
    if not workflow_data:
        return None
    
    workflow = workflow_data['workflow']
    content = workflow_data['content']
    extension = workflow_data['extension']
    
    # Create filename
    safe_name = "".join(c for c in workflow['name'] if c.isalnum() or c in (' ', '-', '_')).rstrip()
    safe_name = safe_name.replace(' ', '_')
    filename = f"workflow_{workflow['id']}_{safe_name}.{extension}"
    
    # Ensure sequences directory exists
    sequences_dir = os.path.join(os.getcwd(), 'sequences')
    os.makedirs(sequences_dir, exist_ok=True)
    
    filepath = os.path.join(sequences_dir, filename)
    
    print(f"\n💾 Saving workflow to: {filepath}")
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"✅ Successfully saved workflow YAML!")
        
        # Show preview
        lines = content.split('\n')
        print(f"\n📄 Content preview (first 15 lines):")
        print("─" * 50)
        for i, line in enumerate(lines[:15], 1):
            print(f"{i:3}: {line}")
        if len(lines) > 15:
            print(f"... and {len(lines) - 15} more lines")
        print("─" * 50)
        
        return filepath
        
    except Exception as e:
        print(f"❌ Failed to save file: {e}")
        return None

def list_recent_workflows(conn, limit=5):
    """List recent workflows for reference."""
    print(f"\n📋 Recent workflows (last {limit}):")
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name, description, status, version, updated_at
            FROM deployed_workflows
            ORDER BY updated_at DESC
            LIMIT %s;
        """, (limit,))
        
        workflows = cur.fetchall()
        
        if not workflows:
            print("  - No workflows found")
            return
        
        for i, wf in enumerate(workflows, 1):
            print(f"  {i}. {wf['name']} (ID: {wf['id']})")
            print(f"     Status: {wf['status']} | Version: {wf.get('version', 'N/A')} | Updated: {wf['updated_at']}")
            if wf['description']:
                print(f"     Description: {wf['description'][:100]}{'...' if len(wf['description']) > 100 else ''}")
            print()

def main():
    """Main function."""
    print("🚀 Supabase Workflow YAML Fetcher")
    print("=" * 50)
    print(f"Started at: {datetime.now()}")
    
    try:
        # Connect to database
        print("\n🔗 Connecting to Supabase...")
        conn = get_db_connection()
        print("✅ Database connection established")
        
        # Explore database structure
        explore_database_structure(conn)
        
        # Count workflows
        total, jsonb, yaml = count_workflows(conn)
        
        if total == 0:
            print("\n❌ No workflows found in database")
            return False
        
        # List recent workflows
        list_recent_workflows(conn)
        
        # Fetch latest workflow
        workflow_data = fetch_latest_workflow_yaml(conn)
        
        if not workflow_data:
            print("\n❌ No workflow data could be retrieved")
            return False
        
        # Save to file
        filepath = save_workflow_to_file(workflow_data)
        
        if filepath:
            print(f"\n🎉 Success! Workflow saved to: {filepath}")
            print(f"\n💡 Next steps:")
            print(f"   - Review the saved YAML file")
            print(f"   - Use it as a reference for workflow structure")
            print(f"   - Modify as needed for your use case")
            return True
        else:
            print(f"\n❌ Failed to save workflow to file")
            return False
            
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()
            print(f"\n🔌 Database connection closed")

if __name__ == "__main__":
    success = main()
    print(f"\nCompleted at: {datetime.now()}")
    if not success:
        sys.exit(1)
