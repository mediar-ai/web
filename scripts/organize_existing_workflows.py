#!/usr/bin/env python3
"""Organize existing workflows in GitHub repo into proper folder structure"""

import os
import sys
from github import Github, Auth
from dotenv import load_dotenv

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

    print(f"📂 Organizing workflows in {repo.full_name}\n")

    # Get all files in root
    contents = repo.get_contents("")

    # Workflow mapping
    workflow_moves = {
        "workflow_1_Best_Plan_Pro_Insurance_Quote.yaml": "production/bestplanpro/workflow.yaml",
        "default_workflow_property_search.yaml": "production/property_search_default/workflow.yaml",
        "property_search_workflow_netr_test_recorded_1757547572054.yaml": "development/property_search_test/workflow.yaml",
        "process_json_workflow.yaml": "development/process_json/workflow.yaml"
    }

    for content in contents:
        if content.path in workflow_moves:
            old_path = content.path
            new_path = workflow_moves[old_path]

            print(f"Moving: {old_path} → {new_path}")

            try:
                # Get file content
                file_content = repo.get_contents(old_path)
                decoded = file_content.decoded_content.decode('utf-8')

                # Add metadata header
                workflow_name = old_path.replace('.yaml', '').replace('_', ' ').title()
                metadata = f"""# Workflow: {workflow_name}
# Migrated from: {old_path}
# Date: 2025-09-29
# Category: {'production' if 'production' in new_path else 'development'}
# ---

"""
                full_content = metadata + decoded

                # Create new file
                try:
                    repo.create_file(
                        new_path,
                        f"Migrate {workflow_name} to organized structure",
                        full_content,
                        branch="main"
                    )
                    print(f"  ✅ Created: {new_path}")
                except Exception as e:
                    if "already exists" in str(e):
                        # Update existing
                        existing = repo.get_contents(new_path)
                        repo.update_file(
                            new_path,
                            f"Update {workflow_name}",
                            full_content,
                            existing.sha,
                            branch="main"
                        )
                        print(f"  ✅ Updated: {new_path}")
                    else:
                        print(f"  ❌ Error: {e}")

                # Delete old file (optional - commented out for safety)
                # repo.delete_file(old_path, f"Moved to {new_path}", file_content.sha)
                # print(f"  🗑️ Deleted: {old_path}")

            except Exception as e:
                print(f"  ❌ Error moving {old_path}: {e}")

    # Handle sap_with_login folder
    try:
        sap_contents = repo.get_contents("sap_with_login")
        print(f"\n📁 Found sap_with_login folder with {len(sap_contents)} items")

        # Find the main workflow file
        for item in sap_contents:
            if item.name.endswith('.yaml') or item.name.endswith('.yml'):
                old_path = item.path
                new_path = "production/sap_with_login/workflow.yaml"

                print(f"Moving: {old_path} → {new_path}")

                file_content = repo.get_contents(old_path)
                decoded = file_content.decoded_content.decode('utf-8')

                metadata = f"""# Workflow: SAP With Login
# Migrated from: {old_path}
# Date: 2025-09-29
# Category: production
# ---

"""
                full_content = metadata + decoded

                try:
                    repo.create_file(
                        new_path,
                        "Migrate SAP workflow to organized structure",
                        full_content,
                        branch="main"
                    )
                    print(f"  ✅ Created: {new_path}")
                except Exception as e:
                    print(f"  ⚠️ {e}")

        # Copy supporting files
        for item in sap_contents:
            if not item.name.endswith('.yaml') and not item.name.endswith('.yml'):
                if item.type == "file":
                    old_path = item.path
                    new_path = f"production/sap_with_login/{item.name}"

                    print(f"Copying support file: {item.name}")

                    file_content = repo.get_contents(old_path)

                    try:
                        repo.create_file(
                            new_path,
                            f"Copy {item.name} to organized structure",
                            file_content.decoded_content,
                            branch="main"
                        )
                        print(f"  ✅ Copied: {new_path}")
                    except Exception as e:
                        if "already exists" not in str(e):
                            print(f"  ⚠️ {e}")

    except Exception as e:
        print(f"SAP folder handling: {e}")

    print("\n✨ Organization complete!")
    print("\nNew structure:")
    print("  production/")
    print("    ├── bestplanpro/")
    print("    ├── property_search_default/")
    print("    └── sap_with_login/")
    print("  development/")
    print("    ├── property_search_test/")
    print("    ├── process_json/")
    print("    └── test_workflow/")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()