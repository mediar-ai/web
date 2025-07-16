#!/usr/bin/env python3
"""
Updates the API response cache cleanup function to keep 100 responses instead of 10.
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

def update_cleanup_function():
    """Updates the cleanup function to keep 100 responses instead of 10."""
    print("🔄 Updating API response cache cleanup function...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Update the cleanup function to keep 100 responses
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
            print("✅ Updated cleanup function to keep last 100 responses per endpoint")
            
            return True
            
    except Exception as e:
        print(f"❌ Error updating cleanup function: {e}")
        return False
    finally:
        conn.close()

def verify_function_update():
    """Verifies the function was updated successfully."""
    print("\n🔍 Verifying function update...")
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check that the function exists
            cur.execute("""
                SELECT routine_name, routine_type
                FROM information_schema.routines 
                WHERE routine_name = 'cleanup_api_response_cache'
                AND routine_type = 'FUNCTION'
            """)
            
            result = cur.fetchone()
            if result:
                print(f"✅ Function found: {result[0]} ({result[1]})")
                return True
            else:
                print("❌ Function not found")
                return False
                
    except Exception as e:
        print(f"❌ Error verifying function: {e}")
        return False
    finally:
        conn.close()

def main():
    """Main function to update the cleanup function."""
    print("🚀 Updating API Response Cache Cleanup Function")
    print("=" * 50)
    
    success = update_cleanup_function()
    if success:
        verify_function_update()
        print("\n✅ Update complete! Cache now keeps 100 responses per endpoint.")
        print("💡 The function will automatically clean up old responses on new inserts.")
    else:
        print("❌ Update failed. Check the error messages above.")
        sys.exit(1)

if __name__ == "__main__":
    main() 