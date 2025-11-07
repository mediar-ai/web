#!/usr/bin/env python3
"""
Execute Migration: Rename is_shared to is_public
Direct execution using PostgreSQL connection
"""

import os
import sys
from dotenv import load_dotenv
import re

# Load environment variables
script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
env_path = os.path.join(parent_dir, '.env.local')

print("Loading .env from:", env_path)
load_dotenv(env_path)

# Get Supabase credentials
supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
db_password = os.getenv('SUPABASE_DB_PASSWORD') or os.getenv('DB_PASSWORD')

if not supabase_url or not supabase_key:
    print("ERROR: Missing Supabase credentials")
    sys.exit(1)

print(f"Supabase URL: {supabase_url}")
print()

# Extract project reference from URL
# Format: https://xxxxx.supabase.co
match = re.search(r'https://([^.]+)\.supabase\.co', supabase_url)
if not match:
    print("ERROR: Could not extract project reference from Supabase URL")
    sys.exit(1)

project_ref = match.group(1)
print(f"Project Reference: {project_ref}")
print()

# Construct database URL
# Try multiple password sources
if db_password:
    db_url = f"postgresql://postgres.{project_ref}:{db_password}@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
    print(f"Using DB password from environment")
else:
    # Try using service role key as password (some Supabase setups)
    db_url = f"postgresql://postgres.{project_ref}:{supabase_key}@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
    print(f"Using service role key as DB password")

print()
print("=" * 80)
print("INSTALLING REQUIRED PACKAGE: psycopg2-binary")
print("=" * 80)
print()

# Try to install psycopg2
try:
    import subprocess
    result = subprocess.run([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '--quiet'], 
                          capture_output=True, text=True)
    if result.returncode == 0:
        print("[OK] psycopg2-binary installed")
    else:
        print("Note: psycopg2-binary may already be installed")
except Exception as e:
    print(f"Note: {e}")

print()

# Now import psycopg2
try:
    import psycopg2
    print("[OK] psycopg2 imported successfully")
except ImportError as e:
    print(f"ERROR: Could not import psycopg2: {e}")
    print()
    print("Please install manually:")
    print("  pip install psycopg2-binary")
    sys.exit(1)

print()
print("=" * 80)
print("CONNECTING TO DATABASE")
print("=" * 80)
print()

# Read migration file
migration_file = os.path.join(parent_dir, 'supabase', 'migrations', '20260201000000_rename_is_shared_to_is_public.sql')

try:
    with open(migration_file, 'r', encoding='utf-8') as f:
        migration_sql = f.read()
    print(f"[OK] Migration loaded from: {migration_file}")
except FileNotFoundError:
    print(f"ERROR: Migration file not found: {migration_file}")
    sys.exit(1)

print()

# Connect to database
try:
    print("Connecting to PostgreSQL...")
    print(f"Host: aws-0-us-west-1.pooler.supabase.com")
    print(f"Database: postgres")
    print(f"User: postgres.{project_ref}")
    print()
    
    conn = psycopg2.connect(
        db_url,
        connect_timeout=10,
        options='-c statement_timeout=30000'  # 30 second timeout
    )
    conn.autocommit = False  # Use transaction for safety
    
    print("[OK] Connected successfully")
    print()
    
except psycopg2.OperationalError as e:
    print(f"ERROR: Could not connect to database")
    print(f"Details: {e}")
    print()
    print("Please check:")
    print("  1. Supabase project is running")
    print("  2. Database password is correct in .env.local")
    print("  3. IP address is whitelisted in Supabase settings")
    print()
    print("You can find the database password in:")
    print("  Supabase Dashboard > Project Settings > Database > Connection string")
    sys.exit(1)
except Exception as e:
    print(f"ERROR: Unexpected connection error: {e}")
    sys.exit(1)

# Execute migration
try:
    cursor = conn.cursor()
    
    print("=" * 80)
    print("EXECUTING MIGRATION")
    print("=" * 80)
    print()
    
    # Show preview
    print("Migration preview:")
    lines = migration_sql.split('\n')[:20]
    for line in lines:
        if line.strip():
            print(f"  {line}")
    print("  ...")
    print()
    
    # Execute
    print("Executing SQL migration...")
    cursor.execute(migration_sql)
    
    print("[OK] Migration executed successfully")
    print()
    
    # Commit transaction
    print("Committing changes...")
    conn.commit()
    
    print("[OK] Changes committed")
    print()
    
    print("=" * 80)
    print("VERIFYING MIGRATION")
    print("=" * 80)
    print()
    
    # Check if column was renamed
    cursor.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'deployed_workflows' 
        AND column_name IN ('is_shared', 'is_public')
        ORDER BY column_name
    """)
    
    columns = cursor.fetchall()
    
    print("Columns in deployed_workflows table:")
    for col in columns:
        print(f"  - {col[0]} ({col[1]}) nullable={col[2]}")
    
    has_is_public = any(col[0] == 'is_public' for col in columns)
    has_is_shared = any(col[0] == 'is_shared' for col in columns)
    
    print()
    if has_is_public and not has_is_shared:
        print("[OK] Column successfully renamed: is_shared -> is_public")
    elif has_is_public and has_is_shared:
        print("[WARN] Both columns exist (unexpected)")
    elif not has_is_public and has_is_shared:
        print("[ERROR] Column not renamed (is_shared still exists)")
    else:
        print("[ERROR] Neither column found (unexpected)")
    
    print()
    
    # Check workflow counts
    cursor.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE is_public = true) as public_count,
            COUNT(*) FILTER (WHERE organization_id IS NULL) as null_org_count
        FROM deployed_workflows
    """)
    
    stats = cursor.fetchone()
    
    print("Workflow statistics:")
    print(f"  Total workflows: {stats[0]}")
    print(f"  Public workflows (is_public=true): {stats[1]}")
    print(f"  Workflows with NULL org_id: {stats[2]}")
    
    print()
    
    # Show workflow 57 specifically
    cursor.execute("""
        SELECT id, name, organization_id, is_public
        FROM deployed_workflows
        WHERE id = 57
    """)
    
    wf57 = cursor.fetchone()
    
    if wf57:
        print("Workflow 57 status:")
        print(f"  ID: {wf57[0]}")
        print(f"  Name: {wf57[1]}")
        print(f"  organization_id: {wf57[2]}")
        print(f"  is_public: {wf57[3]}")
        print()
        if wf57[3]:
            print("  [WARN] Workflow 57 is now PUBLIC - visible to all users!")
        else:
            print("  [OK] Workflow 57 remains private to owning org")
    
    cursor.close()
    conn.close()
    
    print()
    print("=" * 80)
    print("[SUCCESS] MIGRATION COMPLETED SUCCESSFULLY")
    print("=" * 80)
    print()
    print("Next steps:")
    print("  1. Restart your web app (the API is already updated)")
    print("  2. Rebuild desktop app (Rust/TypeScript already updated)")
    print("  3. Test workflow visibility in both apps")
    
except psycopg2.Error as e:
    print(f"ERROR during migration: {e}")
    print()
    print("Rolling back transaction...")
    conn.rollback()
    conn.close()
    print("[OK] Transaction rolled back - no changes made")
    sys.exit(1)
    
except Exception as e:
    print(f"ERROR: Unexpected error: {e}")
    print()
    try:
        conn.rollback()
        conn.close()
        print("[OK] Transaction rolled back")
    except:
        pass
    sys.exit(1)

