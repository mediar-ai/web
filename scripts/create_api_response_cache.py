#!/usr/bin/env python3
"""
Creates API response cache table for dynamic documentation examples.
This script follows the pattern of existing database scripts in this project.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        print("❌ Error: SUPABASE_CONN_STRING environment variable not set.")
        print("Please set it in .env.local file")
        sys.exit(1)
    try:
        conn = psycopg2.connect(conn_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def create_api_response_cache_table():
    """Creates the api_response_cache table for storing API response examples."""
    print("🔄 Creating api_response_cache table...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check if table already exists
            cur.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'api_response_cache'
            """)
            
            if cur.fetchone():
                print("✅ Table 'api_response_cache' already exists.")
                return True
            
            # Create the table
            cur.execute("""
                CREATE TABLE api_response_cache (
                    id BIGSERIAL PRIMARY KEY,
                    endpoint_path TEXT NOT NULL, -- e.g., '/api/remote-workflows/executions/[executionId]'
                    http_method TEXT NOT NULL, -- GET, POST, PUT, DELETE
                    status_code INTEGER NOT NULL, -- 200, 201, etc.
                    response_body JSONB NOT NULL, -- The actual API response
                    request_params JSONB, -- Query params, path params, body for context
                    execution_time_ms INTEGER, -- How long the request took
                    user_id TEXT, -- Optional: which user made the request
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """)
            print("✅ Created api_response_cache table")
            
            # Create indexes for efficient lookups
            cur.execute("""
                CREATE INDEX idx_api_response_cache_endpoint_method 
                ON api_response_cache(endpoint_path, http_method)
            """)
            print("✅ Created endpoint+method index")
            
            cur.execute("""
                CREATE INDEX idx_api_response_cache_created_at 
                ON api_response_cache(created_at DESC)
            """)
            print("✅ Created created_at index")
            
            # Create cleanup function to keep only last 100 responses per endpoint
            cur.execute("""
                CREATE OR REPLACE FUNCTION cleanup_api_response_cache()
                RETURNS TRIGGER AS $$
                BEGIN
                    -- Keep only the last 100 responses per endpoint+method combination
                    DELETE FROM api_response_cache 
                    WHERE id NOT IN (
                        SELECT id 
                        FROM api_response_cache 
                        WHERE endpoint_path = NEW.endpoint_path 
                        AND http_method = NEW.http_method
                        ORDER BY created_at DESC 
                        LIMIT 100
                    )
                    AND endpoint_path = NEW.endpoint_path 
                    AND http_method = NEW.http_method;
                    
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql
            """)
            print("✅ Created cleanup function (keeps last 100 responses per endpoint)")
            
            # Create trigger to auto-cleanup after each insert
            cur.execute("""
                CREATE TRIGGER trigger_cleanup_api_response_cache
                    AFTER INSERT ON api_response_cache
                    FOR EACH ROW
                    EXECUTE FUNCTION cleanup_api_response_cache()
            """)
            print("✅ Created auto-cleanup trigger")
            
            print("🎉 API response cache table setup complete!")
            return True
            
    except Exception as e:
        print(f"❌ Error creating api_response_cache table: {e}")
        return False
    finally:
        conn.close()

def verify_table_creation():
    """Verifies the table was created successfully."""
    print("\n🔍 Verifying table creation...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check table exists
            cur.execute("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'api_response_cache'
                ORDER BY ordinal_position
            """)
            
            columns = cur.fetchall()
            if columns:
                print("✅ Table structure:")
                for column_name, data_type in columns:
                    print(f"   - {column_name}: {data_type}")
                    
                # Check indexes
                cur.execute("""
                    SELECT indexname 
                    FROM pg_indexes 
                    WHERE tablename = 'api_response_cache'
                """)
                indexes = cur.fetchall()
                print("✅ Indexes:")
                for (index_name,) in indexes:
                    print(f"   - {index_name}")
                    
                return True
            else:
                print("❌ Table not found")
                return False
                
    except Exception as e:
        print(f"❌ Error verifying table: {e}")
        return False
    finally:
        conn.close()

def main():
    """Main function to create the API response cache infrastructure."""
    print("🚀 Setting up API Response Cache for Dynamic Documentation")
    print("=" * 60)
    
    success = create_api_response_cache_table()
    if success:
        verify_table_creation()
        print("\n✅ Setup complete! The API response cache is ready to use.")
        print("💡 Next steps:")
        print("   1. Add response caching middleware to API endpoints")
        print("   2. Update documentation to use cached responses")
    else:
        print("❌ Setup failed. Check the error messages above.")
        sys.exit(1)

if __name__ == "__main__":
    main() 