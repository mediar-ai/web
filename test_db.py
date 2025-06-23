import os
import psycopg2
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

# Get database connection
conn_string = os.getenv('SUPABASE_CONN_STRING')
print(f"Connection string: {conn_string[:50]}...")

try:
    conn = psycopg2.connect(conn_string)
    cursor = conn.cursor()
    
    # Check the latest failed events and their error messages
    cursor.execute("""
        SELECT event_id, error_message, processed_at
        FROM low_level_processed_screenshots 
        WHERE processing_failed = true
        ORDER BY processed_at DESC
        LIMIT 10;
    """)
    failed_events = cursor.fetchall()
    
    print(f"\n--- Latest Failed Events ({len(failed_events)}) ---")
    for event_id, error_message, processed_at in failed_events:
        print(f"Event {event_id} at {processed_at}: {error_message}")
    
    # Get overall stats
    cursor.execute("""
        SELECT 
            COUNT(*) as total_processed,
            COUNT(CASE WHEN processing_failed = false THEN 1 END) as successful,
            COUNT(CASE WHEN processing_failed = true THEN 1 END) as failed
        FROM low_level_processed_screenshots;
    """)
    total_processed, successful, failed = cursor.fetchone()
    
    print(f"\n--- Processing Stats ---")
    print(f"Total processed: {total_processed}")
    print(f"Successful: {successful}")
    print(f"Failed: {failed}")
    
    cursor.close()
    conn.close()
    print("\nError check complete!")
    
except Exception as e:
    print(f"Database error: {e}") 