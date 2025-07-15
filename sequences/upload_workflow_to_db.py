#!/usr/bin/env python3
"""
Upload workflow JSON to database with correct structure.
This script reads a workflow JSON file and uploads it to the deployed_workflows table
with the proper structure expected by the Modal app.

Usage: python upload_workflow_to_db.py <workflow_id> <json_file_path>
"""

import json
import sys
import os
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

def get_db_connection():
    """Get database connection from environment variables"""
    # Try to get individual components first
    db_host = os.getenv('SUPABASE_DB_HOST')
    db_name = os.getenv('SUPABASE_DB_NAME', 'postgres')
    db_user = os.getenv('SUPABASE_DB_USER')
    db_password = os.getenv('SUPABASE_DB_PASSWORD')
    db_port = os.getenv('SUPABASE_DB_PORT', '5432')
    
    # If individual components not found, try DATABASE_URL or SUPABASE_CONN_STRING
    if not all([db_host, db_user, db_password]):
        database_url = os.getenv('DATABASE_URL') or os.getenv('SUPABASE_CONN_STRING')
        if database_url:
            # Parse DATABASE_URL
            import urllib.parse
            url = urllib.parse.urlparse(database_url)
            db_host = url.hostname
            db_port = url.port or 5432
            db_user = url.username
            db_password = url.password
            db_name = url.path[1:] if url.path else 'postgres'
    
    if not all([db_host, db_user, db_password]):
        raise ValueError("Database credentials not found in environment variables")
    
    return psycopg2.connect(
        host=db_host,
        database=db_name,
        user=db_user,
        password=db_password,
        port=db_port
    )

def upload_workflow(workflow_id, json_file_path):
    """Upload workflow JSON to database with correct structure"""
    
    # Read the JSON file
    print(f"📖 Reading workflow from {json_file_path}...")
    with open(json_file_path, 'r') as f:
        workflow_data = json.load(f)
    
    # The Modal app expects the automation_sequence field to contain an array
    # Check if the loaded data is already in the correct format
    if isinstance(workflow_data, list):
        # If it's a list, it needs to be wrapped
        automation_sequence = workflow_data
        print("📦 Wrapping array in automation_sequence field...")
    elif isinstance(workflow_data, dict) and 'automation_sequence' in workflow_data:
        # If it already has automation_sequence, use it as is
        automation_sequence = workflow_data['automation_sequence']
        print("✅ File already has automation_sequence field")
    else:
        # Otherwise, wrap it in an array
        automation_sequence = [workflow_data]
        print("📦 Wrapping object in automation_sequence array...")
    
    # Log the structure for debugging
    print(f"\n📊 Structure Analysis:")
    print(f"  - Type of automation_sequence: {type(automation_sequence)}")
    if isinstance(automation_sequence, list) and len(automation_sequence) > 0:
        print(f"  - Length of array: {len(automation_sequence)}")
        first_item = automation_sequence[0]
        print(f"  - Type of first item: {type(first_item)}")
        if isinstance(first_item, dict):
            print(f"  - Keys in first item: {list(first_item.keys())}")
            if 'tool_name' in first_item:
                print(f"  - tool_name: {first_item['tool_name']}")
            if 'arguments' in first_item and isinstance(first_item['arguments'], dict):
                if 'items' in first_item['arguments']:
                    print(f"  - Number of items: {len(first_item['arguments']['items'])}")
    
    # Connect to database
    print(f"\n🔌 Connecting to database...")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Check if workflow exists
        cur.execute("SELECT id, name FROM deployed_workflows WHERE id = %s", (workflow_id,))
        existing = cur.fetchone()
        
        if not existing:
            print(f"❌ Workflow with ID {workflow_id} not found!")
            return False
        
        print(f"✅ Found workflow: {existing['name']} (ID: {existing['id']})")
        
        # Update the automation_sequence field
        # Use Json wrapper to ensure proper JSONB encoding
        print(f"\n📤 Uploading automation sequence to database...")
        cur.execute("""
            UPDATE deployed_workflows 
            SET automation_sequence = %s,
                updated_at = %s
            WHERE id = %s
        """, (
            Json(automation_sequence),  # This ensures proper JSONB encoding
            datetime.utcnow(),
            workflow_id
        ))
        
        # Commit the transaction
        conn.commit()
        print(f"✅ Successfully updated workflow {workflow_id}")
        
        # Verify the update
        print(f"\n🔍 Verifying update...")
        cur.execute("""
            SELECT 
                jsonb_typeof(automation_sequence) as type,
                jsonb_array_length(automation_sequence) as array_length,
                automation_sequence->0->>'tool_name' as first_tool_name,
                jsonb_array_length(automation_sequence->0->'arguments'->'items') as items_count
            FROM deployed_workflows 
            WHERE id = %s
        """, (workflow_id,))
        
        result = cur.fetchone()
        print(f"\n📊 Verification Results:")
        print(f"  - JSON type: {result['type']}")
        print(f"  - Array length: {result['array_length']}")
        print(f"  - First tool name: {result['first_tool_name']}")
        print(f"  - Items count: {result['items_count']}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error updating workflow: {e}")
        conn.rollback()
        return False
    finally:
        cur.close()
        conn.close()

def main():
    if len(sys.argv) != 3:
        print("Usage: python upload_workflow_to_db.py <workflow_id> <json_file_path>")
        print("Example: python upload_workflow_to_db.py 1 sequences/quoting_070325.json")
        sys.exit(1)
    
    workflow_id = int(sys.argv[1])
    json_file_path = sys.argv[2]
    
    if not os.path.exists(json_file_path):
        print(f"❌ File not found: {json_file_path}")
        sys.exit(1)
    
    print(f"🚀 Uploading workflow from {json_file_path} to workflow ID {workflow_id}")
    
    success = upload_workflow(workflow_id, json_file_path)
    
    if success:
        print(f"\n✅ Upload completed successfully!")
    else:
        print(f"\n❌ Upload failed!")
        sys.exit(1)

if __name__ == "__main__":
    main() 