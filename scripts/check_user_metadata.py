#!/usr/bin/env python3
import psycopg2

def check_user_data_in_metadata(user_id: str):
    """
    Checks if a specific user has any events in the low_level_events_metadata table.
    """
    conn = psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )
    cursor = conn.cursor()
    
    try:
        print(f"🔍 Checking for migrated data for user: {user_id}")
        
        cursor.execute("""
            SELECT COUNT(m.event_id)
            FROM low_level_events_metadata m
            JOIN low_level_events e ON m.event_id = e.id
            WHERE e.user_id = %s
        """, (user_id,))
        
        count = cursor.fetchone()[0]
        
        if count > 0:
            print(f"✅ Yes, found {count:,} migrated events for this user.")
        else:
            print(f"❌ No, migrated events were found for this user yet.")
            
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    target_user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    check_user_data_in_metadata(target_user_id) 