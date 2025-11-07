#!/usr/bin/env python3
"""
Execute Migration via Supabase REST API
Simpler approach that doesn't require database password
"""

import os
import sys
from dotenv import load_dotenv
import requests

# Load environment variables
script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
env_path = os.path.join(parent_dir, '.env.local')

print("Loading .env from:", env_path)
load_dotenv(env_path)

supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("ERROR: Missing Supabase credentials")
    sys.exit(1)

print("=" * 80)
print("EXECUTING MIGRATION VIA SUPABASE API")
print("=" * 80)
print()

# Read migration file
migration_file = os.path.join(parent_dir, 'supabase', 'migrations', '20260201000000_rename_is_shared_to_is_public.sql')

with open(migration_file, 'r', encoding='utf-8') as f:
    migration_sql = f.read()

print("[OK] Migration SQL loaded")
print()

# Unfortunately, Supabase REST API doesn't support raw SQL execution
# We need to either:
# 1. Use psycopg2 with database password
# 2. Execute manually via Supabase Dashboard
# 3. Use Supabase CLI

print("=" * 80)
print("MANUAL EXECUTION REQUIRED")
print("=" * 80)
print()
print("The migration SQL cannot be executed via REST API.")
print("Please execute it manually using one of these methods:")
print()
print("METHOD 1: Supabase Dashboard (Recommended)")
print("-" * 80)
print("1. Go to: https://supabase.com/dashboard/project/eshwntsgsputksqamckh")
print("2. Click 'SQL Editor' in the left sidebar")
print("3. Click 'New Query'")
print("4. Copy and paste the SQL below")
print("5. Click 'Run' or press Ctrl+Enter")
print()
print("SQL to execute:")
print("-" * 80)
print(migration_sql)
print("-" * 80)
print()
print("METHOD 2: Copy migration file directly")
print("-" * 80)
print(f"File location: {migration_file}")
print("Copy the contents and paste into SQL Editor")
print()
print("=" * 80)
print()

# Create a convenient output file
output_file = os.path.join(parent_dir, 'MIGRATION_TO_RUN.sql')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(migration_sql)

print(f"[OK] Migration SQL copied to: {output_file}")
print("You can open this file and copy-paste into Supabase SQL Editor")
print()
print("=" * 80)
print("QUICK LINK")
print("=" * 80)
print()
print("Open this URL to go directly to SQL Editor:")
print(f"https://supabase.com/dashboard/project/eshwntsgsputksqamckh/sql/new")
print()

