#!/usr/bin/env python3
"""
Setup script for RPA Knowledgebase
Runs the migration to create table, indexes, and search functions
"""

import psycopg2
import sys
from pathlib import Path

# Database connection string
DB_CONNECTION = "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

def main():
    print("=" * 80)
    print("RPA KNOWLEDGEBASE SETUP")
    print("=" * 80)
    
    # Read migration file
    migration_file = Path(__file__).parent.parent / "supabase" / "migrations" / "20260116000000_create_rpa_knowledgebase.sql"
    
    if not migration_file.exists():
        print(f"❌ Migration file not found: {migration_file}")
        sys.exit(1)
    
    print(f"\n📄 Reading migration file: {migration_file.name}")
    migration_sql = migration_file.read_text()
    
    # Connect to database
    print(f"\n🔌 Connecting to database...")
    try:
        conn = psycopg2.connect(DB_CONNECTION)
        conn.autocommit = False  # Use transaction for safety
        cur = conn.cursor()
        print("✅ Connected successfully")
    except Exception as e:
        print(f"❌ Failed to connect: {e}")
        sys.exit(1)
    
    # Check if table already exists
    print(f"\n🔍 Checking if rpa_knowledgebase table already exists...")
    cur.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'rpa_knowledgebase'
        );
    """)
    table_exists = cur.fetchone()[0]
    
    if table_exists:
        print("⚠️  Table 'rpa_knowledgebase' already exists!")
        response = input("   Do you want to DROP and recreate? (yes/no): ").strip().lower()
        if response != 'yes':
            print("❌ Setup aborted by user")
            cur.close()
            conn.close()
            sys.exit(0)
        
        print("\n🗑️  Dropping existing table and related objects...")
        try:
            # Drop in reverse order of dependencies
            cur.execute("DROP VIEW IF EXISTS rpa_kb_stats CASCADE;")
            cur.execute("DROP FUNCTION IF EXISTS increment_rpa_kb_stats CASCADE;")
            cur.execute("DROP FUNCTION IF EXISTS search_rpa_kb_two_stage CASCADE;")
            cur.execute("DROP FUNCTION IF EXISTS search_rpa_kb_similarity CASCADE;")
            cur.execute("DROP FUNCTION IF EXISTS search_rpa_kb_keyword CASCADE;")
            cur.execute("DROP TABLE IF EXISTS rpa_knowledgebase CASCADE;")
            conn.commit()
            print("✅ Dropped successfully")
        except Exception as e:
            conn.rollback()
            print(f"❌ Failed to drop: {e}")
            cur.close()
            conn.close()
            sys.exit(1)
    
    # Run migration
    print(f"\n🚀 Running migration...")
    try:
        cur.execute(migration_sql)
        conn.commit()
        print("✅ Migration completed successfully!")
    except Exception as e:
        conn.rollback()
        print(f"❌ Migration failed: {e}")
        cur.close()
        conn.close()
        sys.exit(1)
    
    # Verify installation
    print(f"\n✅ Verifying installation...")
    
    # Check table
    cur.execute("""
        SELECT COUNT(*) 
        FROM information_schema.columns 
        WHERE table_name = 'rpa_knowledgebase';
    """)
    column_count = cur.fetchone()[0]
    print(f"   Table columns: {column_count}")
    
    # Check indexes
    cur.execute("""
        SELECT COUNT(*) 
        FROM pg_indexes 
        WHERE tablename = 'rpa_knowledgebase';
    """)
    index_count = cur.fetchone()[0]
    print(f"   Indexes created: {index_count}")
    
    # Check functions
    functions = [
        'search_rpa_kb_keyword',
        'search_rpa_kb_similarity',
        'search_rpa_kb_two_stage',
        'increment_rpa_kb_stats'
    ]
    for func in functions:
        cur.execute(f"""
            SELECT EXISTS(
                SELECT 1 FROM pg_proc 
                WHERE proname = '{func}'
            );
        """)
        exists = cur.fetchone()[0]
        status = '✅' if exists else '❌'
        print(f"   Function {func}: {status}")
    
    # Check view
    cur.execute("""
        SELECT EXISTS(
            SELECT 1 FROM information_schema.views 
            WHERE table_name = 'rpa_kb_stats'
        );
    """)
    view_exists = cur.fetchone()[0]
    print(f"   View rpa_kb_stats: {'✅' if view_exists else '❌'}")
    
    # Check extensions
    print(f"\n🔧 Checking extensions...")
    for ext in ['vector', 'pg_trgm']:
        cur.execute(f"SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = '{ext}');")
        exists = cur.fetchone()[0]
        print(f"   Extension {ext}: {'✅' if exists else '❌'}")
    
    # Show stats
    print(f"\n📊 Initial statistics:")
    cur.execute("SELECT * FROM rpa_kb_stats;")
    stats = cur.fetchone()
    if stats:
        print(f"   Total steps: {stats[0]}")
        print(f"   Table size: {stats[10]}")
    
    # Close connection
    cur.close()
    conn.close()
    
    print("\n" + "=" * 80)
    print("✅ SETUP COMPLETE!")
    print("=" * 80)
    print("\nNext steps:")
    print("1. Use the API endpoints to create steps with embeddings")
    print("2. Test search functionality with sample queries")
    print("3. Monitor performance with: SELECT * FROM rpa_kb_stats;")
    print("\nUseful queries:")
    print("  - View stats: SELECT * FROM rpa_kb_stats;")
    print("  - Count steps: SELECT COUNT(*) FROM rpa_knowledgebase;")
    print("  - Test keyword search: SELECT * FROM search_rpa_kb_keyword('button');")
    print("")

if __name__ == "__main__":
    main()

