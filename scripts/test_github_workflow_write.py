#!/usr/bin/env python3
"""Test writing a workflow to GitHub"""

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

# Sample workflow YAML
sample_workflow = """
# Test Workflow
# Created: 2025-09-29

- name: Test Step
  action: navigate
  arguments:
    url: https://example.com

- name: Click Button
  action: click
  selector: button.submit
"""

try:
    # Connect to GitHub
    auth = Auth.Token(GITHUB_TOKEN)
    g = Github(auth=auth)
    repo = g.get_repo("mediar-ai/workflows")

    print(f"✅ Connected to repository: {repo.full_name}")

    # Create a test workflow in development folder
    file_path = "development/test_workflow/workflow.yaml"

    try:
        # Check if file exists
        existing = repo.get_contents(file_path)
        print(f"⚠️ File already exists at {file_path}")

        # Update it
        result = repo.update_file(
            file_path,
            "Update test workflow",
            sample_workflow,
            existing.sha,
            branch="main"
        )
        print(f"✅ Updated file at {file_path}")
        print(f"   Commit SHA: {result['commit'].sha}")

    except Exception as e:
        if "404" in str(e):
            # Create new file
            result = repo.create_file(
                file_path,
                "Create test workflow",
                sample_workflow,
                branch="main"
            )
            print(f"✅ Created new file at {file_path}")
            print(f"   Commit SHA: {result['commit'].sha}")
        else:
            raise

    # Read it back
    content = repo.get_contents(file_path)
    decoded = content.decoded_content.decode('utf-8')
    print(f"\n📄 File content ({len(decoded)} bytes):")
    print(decoded[:200] + "..." if len(decoded) > 200 else decoded)

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()