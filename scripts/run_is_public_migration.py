#!/usr/bin/env python3
"""
Execute Migration: Rename is_shared to is_public
"""

import os
import sys
from supabase import create_client
from dotenv import load_dotenv

# Load environment variables
script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
env_path = os.path.join(parent_dir, '.env.local')

print(f"Loading .env from: {env_path}")
load_dotenv(env_path)

# Initialize Supabase
supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    raise ValueError("Missing Supabase credentials")

supabase = create_client(supabase_url, supabase_key)

print("=" * 80)
print("EXECUTING MIGRATION: Rename is_shared to is_public")
print("=" * 80)
print()

# Read the migration file
migration_file = os.path.join(parent_dir, 'supabase', 'migrations', '20260201000000_rename_is_shared_to_is_public.sql')

print(f"Reading migration from: {migration_file}")
print()

try:
    with open(migration_file, 'r', encoding='utf-8') as f:
        migration_sql = f.read()
    
    print("Migration SQL loaded successfully")
    print()
    print("=" * 80)
    print("MIGRATION PREVIEW:")
    print("=" * 80)
    print(migration_sql[:500] + "..." if len(migration_sql) > 500 else migration_sql)
    print()
    
    # Execute the migration
    print("=" * 80)
    print("EXECUTING MIGRATION...")
    print("=" * 80)
    print()
    
    # The migration contains multiple statements, we need to execute them via RPC or raw SQL
    # Supabase Python client doesn't have direct SQL execution, so we'll use postgrest RPC
    
    # Split the SQL into individual statements (simple split by semicolon)
    statements = [s.strip() for s in migration_sql.split(';') if s.strip() and not s.strip().startswith('--') and not s.strip().startswith('/*')]
    
    print(f"Found {len(statements)} SQL statements to execute")
    print()
    
    # Execute each statement
    for i, statement in enumerate(statements, 1):
        # Skip comment blocks and empty statements
        if not statement or statement.startswith('DO $$') or 'RAISE NOTICE' in statement:
            print(f"[{i}] Skipping procedural block...")
            continue
            
        # Show what we're executing
        preview = statement[:100].replace('\n', ' ')
        print(f"[{i}] Executing: {preview}...")
        
        try:
            # Use Supabase's rpc to execute raw SQL
            result = supabase.rpc('exec_sql', {'sql': statement}).execute()
            print(f"    ✓ Success")
        except Exception as e:
            # Supabase doesn't have exec_sql RPC by default
            # We need to execute via direct database connection
            print(f"    Note: Cannot execute via RPC (exec_sql not available)")
            print(f"    Attempting alternative method...")
            break
    
    print()
    print("=" * 80)
    print("ALTERNATIVE: Using psycopg2 for direct execution")
    print("=" * 80)
    print()
    
    # We need to use psycopg2 for direct PostgreSQL access
    try:
        import psycopg2
        from urllib.parse import urlparse
        
        # Get database URL from environment
        db_url = os.getenv('DATABASE_URL') or os.getenv('SUPABASE_DB_URL')
        
        if not db_url:
            print("ERROR: DATABASE_URL not found in environment")
            print("Please provide the direct PostgreSQL connection URL")
            sys.exit(1)
        
        print("Connecting to PostgreSQL...")
        conn = psycopg2.connect(db_url)
        conn.autocommit = False  # Use transaction
        cursor = conn.cursor()
        
        print("✓ Connected")
        print()
        
        # Execute the full migration
        print("Executing migration SQL...")
        cursor.execute(migration_sql)
        
        print("✓ Migration executed")
        print()
        
        # Commit the transaction
        print("Committing transaction...")
        conn.commit()
        
        print("✓ Migration committed successfully!")
        print()
        
        # Verify the change
        print("Verifying column rename...")
        cursor.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'deployed_workflows' 
            AND column_name IN ('is_shared', 'is_public')
        """)
        
        columns = cursor.fetchall()
        print("Current columns:")
        for col in columns:
            print(f"  - {col[0]}: {col[1]}")
        
        cursor.close()
        conn.close()
        
        print()
        print("=" * 80)
        print("MIGRATION COMPLETED SUCCESSFULLY!")
        print("=" * 80)
        
    except ImportError:
        print("ERROR: psycopg2 not installed")
        print()
        print("MANUAL EXECUTION REQUIRED")
        print("=" * 80)
        print()
        print("Please run this migration manually using one of these methods:")
        print()
        print("1. Supabase Dashboard:")
        print("   - Go to SQL Editor")
        print("   - Paste the migration SQL")
        print("   - Execute")
        print()
        print("2. psql command:")
        print(f"   psql <DATABASE_URL> -f {migration_file}")
        print()
        print("3. Supabase CLI:")
        print("   cd to your project")
        print("   supabase db push")
        
    except Exception as e:
        print(f"ERROR executing migration: {e}")
        print()
        print("MANUAL EXECUTION REQUIRED - See instructions above")
        sys.exit(1)

except FileNotFoundError:
    print(f"ERROR: Migration file not found at {migration_file}")
    sys.exit(1)
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)

