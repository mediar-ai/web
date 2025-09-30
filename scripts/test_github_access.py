#!/usr/bin/env python3
"""Test GitHub access with the provided token"""

import os
import sys
from github import Github
from dotenv import load_dotenv

# Fix Windows encoding
sys.stdout.reconfigure(encoding='utf-8')

# Load environment
load_dotenv('../.env.local')

GITHUB_TOKEN = os.getenv('GITHUB_WORKFLOW_TOKEN')

if not GITHUB_TOKEN:
    print("❌ No GitHub token found in environment")
    exit(1)

print(f"✅ Token found: {GITHUB_TOKEN[:20]}...")

try:
    # Test GitHub access
    g = Github(GITHUB_TOKEN)

    # Get user info
    user = g.get_user()
    print(f"✅ Authenticated as: {user.login}")
    print(f"   Name: {user.name}")

    # Check repo access
    repo_name = "mediar-ai/workflows"
    try:
        repo = g.get_repo(repo_name)
        print(f"✅ Can access repository: {repo_name}")
        print(f"   Private: {repo.private}")
        print(f"   Default branch: {repo.default_branch}")

        # List contents
        contents = repo.get_contents("")
        print(f"\n📁 Repository contents:")
        for content in contents:
            print(f"   - {content.path} ({content.type})")

    except Exception as e:
        print(f"❌ Cannot access repository {repo_name}: {e}")

except Exception as e:
    print(f"❌ GitHub authentication failed: {e}")
    print("   Please check your token has the required permissions (repo scope)")