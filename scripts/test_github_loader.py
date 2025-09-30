#!/usr/bin/env python3
"""Test loading workflows from GitHub"""

import os
import sys
from github import Github, Auth
from dotenv import load_dotenv
import yaml

# Fix Windows encoding
sys.stdout.reconfigure(encoding='utf-8')

# Load environment
load_dotenv('../.env.local')

GITHUB_TOKEN = os.getenv('GITHUB_WORKFLOW_TOKEN')

if not GITHUB_TOKEN:
    print("❌ No GitHub token found")
    exit(1)

try:
    # Connect to GitHub
    auth = Auth.Token(GITHUB_TOKEN)
    g = Github(auth=auth)
    repo = g.get_repo("mediar-ai/workflows")

    print("🧪 Testing GitHub Workflow Loading\n")

    # List all workflows
    print("📁 Production Workflows:")
    try:
        prod_contents = repo.get_contents("production")
        for item in prod_contents:
            if item.type == "dir":
                print(f"   - {item.name}/")

                # Try to load the workflow
                workflow_path = f"production/{item.name}/workflow.yaml"
                try:
                    workflow_file = repo.get_contents(workflow_path)
                    size = workflow_file.size
                    print(f"     ✅ workflow.yaml ({size} bytes)")
                except:
                    print(f"     ⚠️ No workflow.yaml found")
    except Exception as e:
        print(f"   Error: {e}")

    print("\n📁 Development Workflows:")
    try:
        dev_contents = repo.get_contents("development")
        for item in dev_contents:
            if item.type == "dir":
                print(f"   - {item.name}/")

                # Try to load the workflow
                workflow_path = f"development/{item.name}/workflow.yaml"
                try:
                    workflow_file = repo.get_contents(workflow_path)
                    size = workflow_file.size
                    print(f"     ✅ workflow.yaml ({size} bytes)")
                except:
                    print(f"     ⚠️ No workflow.yaml found")
    except Exception as e:
        print(f"   Error: {e}")

    # Load a specific workflow
    print("\n📄 Loading BestPlanPro Workflow:")
    workflow_path = "production/bestplanpro/workflow.yaml"

    workflow_content = repo.get_contents(workflow_path)
    decoded = workflow_content.decoded_content.decode('utf-8')

    print(f"   Path: {workflow_path}")
    print(f"   SHA: {workflow_content.sha}")
    print(f"   Size: {len(decoded)} bytes")

    # Parse YAML
    try:
        parsed = yaml.safe_load(decoded)
        if isinstance(parsed, list):
            print(f"   Steps: {len(parsed)}")
            print(f"   First step: {parsed[0].get('name', 'unnamed') if parsed else 'none'}")
    except:
        # Try to show raw content
        lines = decoded.split('\n')
        print(f"   Lines: {len(lines)}")
        print(f"\n   Preview:")
        for line in lines[:5]:
            print(f"   {line}")

    # Check SAP workflow with files
    print("\n📁 SAP Workflow with Files:")
    sap_contents = repo.get_contents("production/sap_with_login")

    yaml_files = []
    js_files = []

    for item in sap_contents:
        if item.type == "file":
            if item.name.endswith('.yaml') or item.name.endswith('.yml'):
                yaml_files.append(item.name)
            elif item.name.endswith('.js'):
                js_files.append(item.name)

    print(f"   YAML files: {len(yaml_files)}")
    print(f"   JS files: {len(js_files)}")

    if js_files:
        print(f"\n   JavaScript files:")
        for js in js_files[:10]:
            print(f"   - {js}")
        if len(js_files) > 10:
            print(f"   ... and {len(js_files) - 10} more")

    print("\n✨ GitHub loading test complete!")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()