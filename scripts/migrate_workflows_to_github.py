#!/usr/bin/env python3
"""
Migrate workflows from Supabase to GitHub repository
Safe migration that copies workflows without removing from Supabase
"""

import os
import sys
import json
import yaml as pyyaml
import asyncio
from datetime import datetime
from typing import Dict, Any, List
from github import Github, Auth
from supabase import create_client, Client
from dotenv import load_dotenv

# Fix Windows encoding
sys.stdout.reconfigure(encoding='utf-8')

# Load environment variables
load_dotenv('../.env.local')

# Configuration
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
GITHUB_TOKEN = os.getenv('GITHUB_WORKFLOW_TOKEN') or os.getenv('GITHUB_TOKEN')
GITHUB_OWNER = 'mediar-ai'
GITHUB_REPO = 'workflows'

# Initialize GitHub with proper auth
auth = Auth.Token(GITHUB_TOKEN) if GITHUB_TOKEN else None
github = Github(auth=auth) if auth else None

# Initialize Supabase if we have credentials
supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

class WorkflowMigrator:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.repo = github.get_repo(f"{GITHUB_OWNER}/{GITHUB_REPO}")
        self.results = {
            'success': [],
            'failed': [],
            'skipped': []
        }

    def yaml_to_string(self, yaml_data: Any) -> str:
        """Convert YAML object to properly formatted string"""
        if isinstance(yaml_data, str):
            return yaml_data
        return pyyaml.dump(yaml_data, default_flow_style=False, sort_keys=False)

    def sanitize_name(self, name: str) -> str:
        """Sanitize workflow name for file system"""
        return name.lower().replace(' ', '_').replace('/', '_').replace('\\', '_')

    async def migrate_workflow(self, workflow: Dict) -> Dict:
        """Migrate a single workflow to GitHub"""
        workflow_id = workflow['id']
        workflow_name = workflow['name']

        print(f"\nProcessing workflow {workflow_id}: {workflow_name}")

        try:
            # Determine category based on status
            status = workflow.get('status', 'draft')
            if status == 'deprecated':
                category = 'archived'
            elif status in ['active', 'deployed']:
                category = 'production'
            else:
                category = 'development'

            # Prepare GitHub path
            sanitized_name = self.sanitize_name(workflow_name)
            github_path = f"{category}/{sanitized_name}/workflow.yaml"

            # Get automation_sequence
            automation_sequence = workflow.get('automation_sequence')
            if not automation_sequence:
                print(f"  ⚠️ No automation_sequence found, skipping")
                self.results['skipped'].append({
                    'id': workflow_id,
                    'name': workflow_name,
                    'reason': 'No automation_sequence'
                })
                return {'success': False, 'reason': 'No automation_sequence'}

            # Convert to YAML string
            yaml_content = self.yaml_to_string(automation_sequence)

            # Add metadata header
            metadata_header = f"""# Workflow: {workflow_name}
# ID: {workflow_id}
# Description: {workflow.get('description', 'No description')}
# Status: {status}
# Category: {workflow.get('category', 'general')}
# Migrated from Supabase: {datetime.now().isoformat()}
# ---

"""
            full_content = metadata_header + yaml_content

            if self.dry_run:
                print(f"  [DRY RUN] Would save to: {github_path}")
                print(f"  Content length: {len(full_content)} bytes")
            else:
                # Check if file already exists
                try:
                    existing_file = self.repo.get_contents(github_path)
                    # Update existing file
                    commit = self.repo.update_file(
                        github_path,
                        f"Update workflow: {workflow_name}",
                        full_content,
                        existing_file.sha,
                        branch='main'
                    )
                    print(f"  ✅ Updated in GitHub: {github_path}")
                    github_sha = commit['commit'].sha
                except:
                    # Create new file
                    commit = self.repo.create_file(
                        github_path,
                        f"Migrate workflow: {workflow_name}",
                        full_content,
                        branch='main'
                    )
                    print(f"  ✅ Created in GitHub: {github_path}")
                    github_sha = commit['commit'].sha

                # Update Supabase with GitHub reference
                update_data = {
                    'github_path': github_path,
                    'github_ref': 'main',
                    'github_sha': github_sha,
                    'github_sync_status': 'synced',
                    'github_last_synced_at': datetime.now().isoformat()
                }

                result = supabase.table('deployed_workflows').update(update_data).eq('id', workflow_id).execute()

                # Log sync operation
                log_entry = {
                    'workflow_id': workflow_id,
                    'operation': 'push',
                    'github_path': github_path,
                    'github_sha': github_sha,
                    'status': 'success'
                }
                supabase.table('github_workflow_sync_log').insert(log_entry).execute()

                print(f"  ✅ Updated Supabase metadata")

            self.results['success'].append({
                'id': workflow_id,
                'name': workflow_name,
                'path': github_path
            })

            return {'success': True, 'path': github_path}

        except Exception as e:
            print(f"  ❌ Error: {str(e)}")
            self.results['failed'].append({
                'id': workflow_id,
                'name': workflow_name,
                'error': str(e)
            })

            if not self.dry_run:
                # Log failed sync
                log_entry = {
                    'workflow_id': workflow_id,
                    'operation': 'push',
                    'status': 'failed',
                    'error_message': str(e)
                }
                supabase.table('github_workflow_sync_log').insert(log_entry).execute()

            return {'success': False, 'error': str(e)}

    async def migrate_all(self, workflow_ids: List[int] = None):
        """Migrate all or specific workflows"""
        # Fetch workflows from Supabase
        query = supabase.table('deployed_workflows').select('*')

        if workflow_ids:
            query = query.in_('id', workflow_ids)

        result = query.execute()
        workflows = result.data

        print(f"\nFound {len(workflows)} workflows to migrate")

        # Process each workflow
        for workflow in workflows:
            await self.migrate_workflow(workflow)

        # Print summary
        print("\n" + "="*50)
        print("MIGRATION SUMMARY")
        print("="*50)
        print(f"✅ Success: {len(self.results['success'])}")
        print(f"⚠️ Skipped: {len(self.results['skipped'])}")
        print(f"❌ Failed: {len(self.results['failed'])}")

        if self.results['success']:
            print("\nSuccessfully migrated:")
            for item in self.results['success']:
                print(f"  - {item['name']} -> {item['path']}")

        if self.results['failed']:
            print("\nFailed migrations:")
            for item in self.results['failed']:
                print(f"  - {item['name']}: {item['error']}")

        return self.results


async def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description='Migrate workflows from Supabase to GitHub')
    parser.add_argument('--dry-run', action='store_true', help='Perform dry run without making changes')
    parser.add_argument('--workflow-ids', nargs='+', type=int, help='Specific workflow IDs to migrate')

    args = parser.parse_args()

    print("🚀 Starting Workflow Migration to GitHub")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")

    if not GITHUB_TOKEN:
        print("❌ Error: GITHUB_TOKEN not found in environment variables")
        sys.exit(1)

    migrator = WorkflowMigrator(dry_run=args.dry_run)
    results = await migrator.migrate_all(workflow_ids=args.workflow_ids)

    # Exit with error if any migrations failed
    if results['failed']:
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())