#!/usr/bin/env python3
"""
Version-aware workflow upload script.
Uses the new versioning API to create new versions instead of overwriting existing ones.

Usage: python sequences/upload_workflow_to_db.py <workflow_id> <json_file_path>

This script has been updated to work with the new workflow versioning system.
It now creates new versions instead of overwriting existing automation sequences.
"""

import json
import sys
import os
import requests
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv('../.env.local')

def upload_workflow_via_api(workflow_id, json_file_path):
    """Upload workflow using the versioning API instead of direct database access."""
    
    print(f"🚀 Version-Aware Workflow Upload")
    print(f"📁 Workflow ID: {workflow_id}")
    print(f"📄 Source file: {json_file_path}")
    print(f"Started at: {datetime.now()}")
    
    # Read the JSON file
    print(f"\n📖 Reading workflow from {json_file_path}...")
    
    if not os.path.exists(json_file_path):
        print(f"❌ File not found: {json_file_path}")
        return False
    
    with open(json_file_path, 'r') as f:
        workflow_data = json.load(f)
    
    # Prepare automation sequence
    if isinstance(workflow_data, list):
        automation_sequence = workflow_data
        print("📦 Using array as automation_sequence...")
    elif isinstance(workflow_data, dict) and 'automation_sequence' in workflow_data:
        automation_sequence = workflow_data['automation_sequence']
        print("✅ Found automation_sequence field in file")
    else:
        automation_sequence = [workflow_data]
        print("📦 Wrapping object in automation_sequence array...")
    
    # Log the structure for debugging
    print(f"\n📊 Structure Analysis:")
    print(f"  - Type: {type(automation_sequence)}")
    if isinstance(automation_sequence, list) and len(automation_sequence) > 0:
        print(f"  - Array length: {len(automation_sequence)}")
        first_item = automation_sequence[0]
        print(f"  - First item type: {type(first_item)}")
        if isinstance(first_item, dict):
            print(f"  - First item keys: {list(first_item.keys())}")
    
    # Prepare request payload for versioning API
    payload = {
        "automation_sequence": automation_sequence,
        "change_notes": f"Updated via upload script from {os.path.basename(json_file_path)}",
        "set_as_active": True  # Activate the new version immediately
    }
    
    # Use local development server
    api_base = 'http://localhost:3000'
    api_endpoint = f"{api_base}/api/remote-workflows/{workflow_id}/versions"
    
    print(f"\n📤 Creating new version via API:")
    print(f"   - Endpoint: {api_endpoint}")
    print(f"   - Will activate new version immediately")
    
    try:
        # Make API request to create new version
        response = requests.post(
            api_endpoint,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        if response.status_code == 201:
            result = response.json()
            print(f"\n✅ Successfully created new version!")
            print(f"   - Version: {result['version']['version_number']}")
            print(f"   - Version ID: {result['version']['id']}")
            print(f"   - Is Active: {result['version']['is_active']}")
            print(f"   - Total Versions: {result['workflow']['total_versions']}")
            print(f"   - ✅ Version activated and ready for execution")
            
            return True
        
        elif response.status_code == 409:
            error_data = response.json()
            print(f"❌ Version conflict: {error_data.get('error', 'Version already exists')}")
            print(f"💡 The automation sequence may be identical to the current version")
            return False
        
        else:
            print(f"❌ Upload failed with status {response.status_code}")
            try:
                error_data = response.json()
                print(f"   Error: {error_data.get('error', 'Unknown error')}")
                if 'details' in error_data:
                    print(f"   Details: {error_data['details']}")
            except:
                print(f"   Response: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection failed to {api_endpoint}")
        print(f"💡 Make sure your development server is running (npm run dev)")
        return False
    except requests.exceptions.Timeout:
        print(f"❌ Request timeout")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def main():
    if len(sys.argv) != 3:
        print("❌ Usage: python upload_workflow_to_db.py <workflow_id> <json_file_path>")
        print("\nExample:")
        print("  python upload_workflow_to_db.py 1 bestproplan_workflow.json")
        print("\n🔄 Note: This script now uses the versioning system!")
        print("  - Creates new versions instead of overwriting")
        print("  - Maintains complete version history")
        print("  - Activates new version automatically")
        sys.exit(1)
    
    workflow_id = sys.argv[1]
    json_file_path = sys.argv[2]
    
    # Convert workflow_id to int for validation
    try:
        workflow_id_int = int(workflow_id)
    except ValueError:
        print(f"❌ Invalid workflow ID: {workflow_id}. Must be a number.")
        sys.exit(1)
    
    success = upload_workflow_via_api(workflow_id_int, json_file_path)
    
    if success:
        print(f"\n🎉 Upload completed successfully!")
        print(f"\n💡 Next steps:")
        print(f"   - Check version history: python ../scripts/upload_workflow_version.py {workflow_id} --list-versions")
        print(f"   - Test the workflow via API or web interface")
    else:
        print(f"\n❌ Upload failed!")
        sys.exit(1)

if __name__ == "__main__":
    main() 