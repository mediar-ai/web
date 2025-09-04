#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv(".env.local")


def get_db_connection():
    """Get database connection using environment variables."""
    try:
        database_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
        if database_url:
            conn = psycopg2.connect(database_url)
        else:
            conn = psycopg2.connect(
                host=os.getenv("DB_HOST"),
                database=os.getenv("DB_NAME"),
                user=os.getenv("DB_USER"),
                password=os.getenv("DB_PASSWORD"),
                port=os.getenv("DB_PORT", 5432),
            )
        return conn
    except Exception as e:
        print(f"Database connection failed: {e}")
        raise


def undo_change():
    """Re-enable workflow #11 if user wants"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    print("\nUNDO CRON CHANGE")
    print("="*60)
    
    try:
        # Show current status
        cursor.execute("""
            SELECT id, name, cron_enabled
            FROM deployed_workflows
            WHERE id IN (10, 11)
            ORDER BY id;
        """)
        
        print("Current status:")
        for id, name, enabled in cursor.fetchall():
            status = "ENABLED" if enabled else "DISABLED"
            print(f"  Workflow #{id}: {status}")
        
        print("\nThis will RE-ENABLE workflow #11")
        print("WARNING: You'll have 2 workflows with same cron schedule!")
        
        response = input("\nProceed? (y/N): ")
        
        if response.lower() == 'y':
            cursor.execute("""
                UPDATE deployed_workflows 
                SET cron_enabled = true 
                WHERE id = 11;
            """)
            conn.commit()
            print("\n✅ Workflow #11 has been RE-ENABLED")
            print("Both workflows will now trigger every minute!")
        else:
            print("\n❌ No changes made")
        
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    undo_change()
