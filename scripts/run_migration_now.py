#!/usr/bin/env python3
"""
Execute Migration: Rename is_shared to is_public
Using Supabase REST API query endpoint
"""

import os
import sys
from supabase import create_client
from dotenv import load_dotenv

# Load environment variables
script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
env_path = os.path.join(parent_dir, '.env.local')

print("Loading .env from:", env_path)
load_dotenv(env_path)

# Initialize Supabase
supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("ERROR: Missing Supabase credentials")
    sys.exit(1)

supabase = create_client(supabase_url, supabase_key)

print("=" * 80)
print("EXECUTING MIGRATION")
print("=" * 80)
print()

# Execute migration steps one by one using Supabase Python client

print("Step 1: Checking current state...")
try:
    # Check if is_shared exists
    result = supabase.table('deployed_workflows').select('is_shared').limit(1).execute()
    print("  [OK] is_shared column exists")
except Exception as e:
    print(f"  [ERROR] Cannot query is_shared: {e}")
    sys.exit(1)

print()
print("Step 2: Renaming column is_shared -> is_public...")

# We cannot rename columns via REST API, need to use raw SQL
# Let's try using the Supabase SQL endpoint directly
import requests

headers = {
    'apikey': supabase_key,
    'Authorization': f'Bearer {supabase_key}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
}

# Read the migration SQL
migration_file = os.path.join(parent_dir, 'supabase', 'migrations', '20260201000000_rename_is_shared_to_is_public.sql')

with open(migration_file, 'r', encoding='utf-8') as f:
    migration_sql = f.read()

print("  Migration SQL loaded")
print()

# Try to execute via PostgREST's rpc endpoint
# First, we need to create an RPC function to execute SQL

print("Attempting to execute migration...")
print()

# Since we can't execute DDL via REST API, let's break it down into steps we CAN do

print("=" * 80)
print("MIGRATION REQUIRES MANUAL EXECUTION")
print("=" * 80)
print()
print("The migration contains DDL statements (ALTER TABLE, RENAME COLUMN)")
print("which cannot be executed via Supabase REST API.")
print()
print("Please execute manually:")
print()
print("1. Open Supabase Dashboard:")
print("   https://supabase.com/dashboard/project/eshwntsgsputksqamckh/sql/new")
print()
print("2. Copy this SQL:")
print()
print("-" * 80)
print(migration_sql)
print("-" * 80)
print()
print("3. Paste into SQL Editor and click RUN")
print()
print("Alternative: The SQL is also in MIGRATION_TO_RUN.sql in your workspace")
print()

