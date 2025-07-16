#!/usr/bin/env python3
"""
Version-aware workflow upload script.
Uses the new versioning system to create new versions without overwriting existing ones.

Usage: 
  python scripts/upload_workflow_version.py <workflow_id> <json_file_path> [options]

Options:
  --version <version_number>    Specific version number (default: auto-increment)
  --notes <change_notes>        Description of changes
  --activate                    Activate the new version immediately
  --preview                     Show what would be uploaded without actually doing it

Examples:
  python scripts/upload_workflow_version.py 1 sequences/quoting_v2.json --activate
  python scripts/upload_workflow_version.py 1 sequences/quoting_v2.json --version 2.0.0 --notes "Major update with new features"
"""

import json
import sys
import os
import requests
import argparse
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

def upload_workflow_version(workflow_id, json_file_path, version_number=None, change_notes=None, activate=False, preview=False):
    """Upload a new version of a workflow using the versioning API."""
    
    # Read the JSON file
    print(f"📖 Reading workflow from {json_file_path}...")
    
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
    
    # Prepare request payload
    payload = {
        "automation_sequence": automation_sequence,
        "set_as_active": activate
    }
    
    if version_number:
        payload["version_number"] = version_number
    
    if change_notes:
        payload["change_notes"] = change_notes
    elif version_number:
        payload["change_notes"] = f"Version {version_number} uploaded via script"
    else:
        payload["change_notes"] = f"New version uploaded from {os.path.basename(json_file_path)}"
    
    if preview:
        print(f"\n👁️  PREVIEW MODE - No changes will be made")
        print(f"📋 Would create new version with:")
        print(f"   - Workflow ID: {workflow_id}")
        print(f"   - Version: {version_number or 'auto-increment'}")
        print(f"   - Activate immediately: {activate}")
        print(f"   - Change notes: {payload['change_notes']}")
        print(f"   - Automation sequence: {len(automation_sequence)} items")
        return True
    
    # Determine API endpoint
    api_base = 'http://localhost:3000'
    api_endpoint = f"{api_base}/api/remote-workflows/{workflow_id}/versions"
    
    print(f"\n📤 Uploading to: {api_endpoint}")
    print(f"   - Creating new version: {version_number or 'auto-increment'}")
    print(f"   - Activate after upload: {activate}")
    
    try:
        # Make API request
        response = requests.post(
            api_endpoint,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        if response.status_code == 201:
            result = response.json()
            print(f"\n✅ Successfully created version!")
            print(f"   - Version: {result['version']['version_number']}")
            print(f"   - Version ID: {result['version']['id']}")
            print(f"   - Is Active: {result['version']['is_active']}")
            print(f"   - Total Versions: {result['workflow']['total_versions']}")
            
            if activate:
                print(f"   - ✅ Version activated and ready for execution")
            else:
                print(f"   - ⏸️  Version created but not activated")
                print(f"   - To activate: POST /api/remote-workflows/{workflow_id}/activate/{result['version']['version_number']}")
            
            return True
        
        elif response.status_code == 409:
            error_data = response.json()
            print(f"❌ Version conflict: {error_data.get('error', 'Version already exists')}")
            print(f"💡 Try using --version with a different number or check existing versions")
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
        print(f"💡 Make sure your development server is running")
        return False
    except requests.exceptions.Timeout:
        print(f"❌ Request timeout")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def list_workflow_versions(workflow_id):
    """List all versions of a workflow."""
    api_base = 'http://localhost:3000'
    api_endpoint = f"{api_base}/api/remote-workflows/{workflow_id}/versions"
    
    try:
        response = requests.get(api_endpoint, timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            workflow = result['workflow']
            versions = result['versions']
            
            print(f"\n📋 Workflow: {workflow['name']} (ID: {workflow['id']})")
            print(f"   Total versions: {workflow['total_versions']}")
            print(f"   Current version ID: {workflow['current_version_id']}")
            
            print(f"\n📖 Version History:")
            for version in versions:
                status = "🟢 ACTIVE" if version['is_active'] else "⚪ Inactive"
                exec_count = version['execution_count']
                print(f"   {status} v{version['version_number']} - {exec_count} executions - {version['created_at']}")
                if version['change_notes']:
                    print(f"      Notes: {version['change_notes']}")
            
            return True
        else:
            print(f"❌ Failed to get versions: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Error getting versions: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(
        description='Upload new workflow versions with full version control',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload and activate new version
  python scripts/upload_workflow_version.py 1 sequences/quoting_v2.json --activate
  
  # Create specific version with notes
  python scripts/upload_workflow_version.py 1 sequences/quoting_v2.json --version 2.0.0 --notes "Major update"
  
  # Preview what would be uploaded
  python scripts/upload_workflow_version.py 1 sequences/quoting_v2.json --preview
  
  # List existing versions
  python scripts/upload_workflow_version.py 1 --list-versions
        """)
    
    parser.add_argument('workflow_id', type=int, help='Workflow ID to update')
    parser.add_argument('json_file', nargs='?', help='Path to JSON file with automation sequence')
    parser.add_argument('--version', help='Specific version number (e.g., 2.0.0)')
    parser.add_argument('--notes', help='Description of changes in this version')
    parser.add_argument('--activate', action='store_true', help='Activate the new version immediately')
    parser.add_argument('--preview', action='store_true', help='Show what would be uploaded without actually doing it')
    parser.add_argument('--list-versions', action='store_true', help='List all versions of the workflow')
    
    args = parser.parse_args()
    
    print(f"🚀 Workflow Version Manager")
    print(f"Started at: {datetime.now()}")
    
    # List versions mode
    if args.list_versions:
        print(f"\n📋 Listing versions for workflow {args.workflow_id}...")
        success = list_workflow_versions(args.workflow_id)
        sys.exit(0 if success else 1)
    
    # Upload mode - require json file
    if not args.json_file:
        print("❌ JSON file is required for upload operations")
        parser.print_help()
        sys.exit(1)
    
    print(f"\n📁 Workflow ID: {args.workflow_id}")
    print(f"📄 Source file: {args.json_file}")
    
    if args.version:
        print(f"🏷️  Target version: {args.version}")
    else:
        print(f"🏷️  Version: auto-increment")
    
    if args.activate:
        print(f"⚡ Will activate after upload")
    
    if args.preview:
        print(f"👁️  Preview mode enabled")
    
    success = upload_workflow_version(
        workflow_id=args.workflow_id,
        json_file_path=args.json_file,
        version_number=args.version,
        change_notes=args.notes,
        activate=args.activate,
        preview=args.preview
    )
    
    if success:
        print(f"\n✅ Operation completed successfully!")
        
        if not args.preview and not args.activate:
            print(f"\n💡 Next steps:")
            print(f"   - Test the new version")
            print(f"   - Activate when ready: POST /api/remote-workflows/{args.workflow_id}/activate/{args.version or 'latest'}")
            print(f"   - List versions: python scripts/upload_workflow_version.py {args.workflow_id} --list-versions")
    else:
        print(f"\n❌ Operation failed!")
        sys.exit(1)

if __name__ == "__main__":
    main() 