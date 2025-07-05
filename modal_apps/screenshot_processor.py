import modal
import os
import psycopg2
import json
import base64
import requests
from typing import Dict, List, Optional, Tuple

app = modal.App("screenshot-processor")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary", "requests")

# SQL to find screenshot_diff events that haven't been processed yet (supports both Structure A and B)
GET_UNPROCESSED_SCREENSHOTS_SQL = """
    SELECT id, user_id, session_id, created_at, payload
    FROM low_level_events 
    WHERE payload->'payload'->>'type' = 'screenshot_diff'
    AND NOT EXISTS (
        SELECT 1 FROM low_level_processed_screenshots lps 
        WHERE lps.event_id = low_level_events.id
    )
    AND NOT EXISTS (
        SELECT 1 FROM screenshot_processing_locks spl
        WHERE spl.event_id = low_level_events.id AND spl.expires_at > NOW()
    )
    AND (
        -- Structure A: screenshot_diff format
        LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'after') > 5000 OR
        LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'before') > 5000 OR
        -- Structure B: direct screenshot format
        LENGTH(payload->'payload'->'event'->>'screenshot_after') > 5000 OR
        LENGTH(payload->'payload'->'event'->>'screenshot_before') > 5000
    )
    ORDER BY created_at DESC
    LIMIT %s;
"""

# SQL to mark an event as processed
MARK_PROCESSED_SQL = """
    INSERT INTO low_level_processed_screenshots 
    (event_id, user_id, session_id, before_path, after_path, before_size, after_size)
    VALUES (%s, %s, %s, %s, %s, %s, %s);
"""

# SQL to mark an event as failed
MARK_FAILED_SQL = """
    INSERT INTO low_level_processed_screenshots 
    (event_id, user_id, session_id, processing_failed, error_message)
    VALUES (%s, %s, %s, %s, %s);
"""

# --- New Lock Management SQL ---
ACQUIRE_LOCK_SQL = """
    INSERT INTO screenshot_processing_locks (event_id, processor_id, expires_at)
    VALUES (%s, %s, NOW() + INTERVAL '5 minutes')
    ON CONFLICT (event_id) DO NOTHING
    RETURNING id;
"""

RELEASE_LOCK_SQL = """
    DELETE FROM screenshot_processing_locks WHERE event_id = %s AND processor_id = %s;
"""

def get_db_connection():
    """Get database connection using environment variables"""
    conn_string = os.environ.get('SUPABASE_CONN_STRING')
    if not conn_string:
        raise Exception("SUPABASE_CONN_STRING environment variable not set")
    return psycopg2.connect(conn_string)

def extract_image_data(payload: Dict) -> Tuple[Optional[str], Optional[str]]:
    """Extract before and after image data from payload - supports both Structure A and B"""
    try:
        event_data = payload.get('payload', {}).get('event', {})
        
        # Structure A: screenshot_diff object (current format)
        screenshot_diff = event_data.get('screenshot_diff', {})
        before_data = screenshot_diff.get('before')
        after_data = screenshot_diff.get('after')
        
        # Structure B: direct screenshot fields (alternative format)
        if not before_data and not after_data:
            before_data = event_data.get('screenshot_before')
            after_data = event_data.get('screenshot_after')
        
        # Validate that the data URLs are actually complete images
        def is_valid_image(data):
            if not data or data == "":
                return False
            if not isinstance(data, str):
                return False
            if not data.startswith('data:image'):
                return False
            # Reasonable threshold since we filter corrupted data at SQL level
            if len(data) < 1000:  
                return False
            return True
        
        # Clean up the data - convert empty strings to None
        before_data = before_data if is_valid_image(before_data) else None
        after_data = after_data if is_valid_image(after_data) else None
        
        # Log which structure was used for debugging
        if before_data or after_data:
            structure_type = "A (screenshot_diff)" if screenshot_diff else "B (direct)"
            print(f"Extracted images using Structure {structure_type}")
        
        return before_data, after_data
    except Exception as e:
        print(f"Error extracting image data: {e}")
        return None, None

def upload_image_to_supabase(image_data_url: str, storage_path: str) -> Tuple[bool, Optional[int]]:
    """Upload image to Supabase storage and return success status and file size"""
    try:
        # Parse data URL
        if not image_data_url.startswith('data:'):
            return False, None
            
        # Extract base64 data
        header, data = image_data_url.split(',', 1)
        image_bytes = base64.b64decode(data)
        
        # Get Supabase storage URL and key
        supabase_url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
        
        # If URL is not available, extract it from connection string
        if not supabase_url:
            conn_string = os.environ.get('SUPABASE_CONN_STRING')
            if conn_string:
                # Extract project ref from connection string
                # Format: postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres
                import re
                match = re.search(r'postgres\.([^:]+):', conn_string)
                if match:
                    project_ref = match.group(1)
                    supabase_url = f"https://{project_ref}.supabase.co"
        
        if not supabase_url or not supabase_key:
            print(f"Missing Supabase credentials - URL: {bool(supabase_url)}, Key: {bool(supabase_key)}")
            return False, None
        
        # Upload to storage
        storage_url = f"{supabase_url}/storage/v1/object/low-level-event-screenshots/{storage_path}"
        
        # Determine content type
        content_type = 'image/jpeg'
        if 'image/png' in header:
            content_type = 'image/png'
        
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': content_type,
            'x-upsert': 'true'  # Allow overwrite
        }
        
        response = requests.post(storage_url, data=image_bytes, headers=headers)
        
        if response.status_code in [200, 201]:
            return True, len(image_bytes)
        else:
            print(f"Upload failed: {response.status_code} - {response.text}")
            return False, None
            
    except Exception as e:
        print(f"Error uploading image: {e}")
        return False, None

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret")
    ],
    # Using the new parameter name as recommended by Modal's deprecation warning.
    max_containers=5,
    timeout=300
)
def process_screenshots(batch_size: int = 10):
    """
    Process a batch of screenshots with robust, isolated transaction handling.
    """
    processor_id = f"screenshot-processor-{os.urandom(4).hex()}"
    print(f"🚀 Starting {processor_id}...")
    
    events_to_process = []
    try:
        # Step 1: Fetch a batch of unprocessed events in a single transaction.
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(GET_UNPROCESSED_SCREENSHOTS_SQL, (batch_size,))
                events_to_process = cursor.fetchall()
        
        if not events_to_process:
            print("✅ No unprocessed screenshots found.")
            return {"processed": 0, "failed": 0, "skipped": 0}

    except Exception as e:
        print(f"❌ CRITICAL: Failed to fetch event batch: {e}")
        return {"error": f"Failed to fetch batch: {e}"}

    processed_count = 0
    failed_count = 0
    skipped_count = 0

    # Step 2: Loop through the fetched events and process them one by one.
    for event_id, user_id, session_id, created_at, payload in events_to_process:
        lock_acquired = False
        try:
            # Step 2a: Acquire lock in an isolated transaction.
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(ACQUIRE_LOCK_SQL, (event_id, processor_id))
                    conn.commit()
                    if cursor.rowcount > 0:
                        lock_acquired = True
            
            if not lock_acquired:
                print(f"⏩ Event {event_id} was locked by another process. Skipping.")
                skipped_count += 1
                continue

            print(f"🔒 Processing event {event_id} with lock...")
            
            # Step 2b: Main processing logic (image extraction and upload).
            before_data, after_data = extract_image_data(payload)

            if not before_data and not after_data:
                raise ValueError("No valid image data found in payload.")

            before_path, after_path, before_size, after_size = None, None, 0, 0
            
            if before_data:
                upload_success, size = upload_image_to_supabase(before_data, f"{user_id}/{session_id}/screenshots/{event_id}_before.jpeg")
                if upload_success:
                    before_path, before_size = f"{user_id}/{session_id}/screenshots/{event_id}_before.jpeg", size
                else:
                    raise Exception(f"Upload failed for before_path for event {event_id}")

            if after_data:
                upload_success, size = upload_image_to_supabase(after_data, f"{user_id}/{session_id}/screenshots/{event_id}_after.jpeg")
                if upload_success:
                    after_path, after_size = f"{user_id}/{session_id}/screenshots/{event_id}_after.jpeg", size
                else:
                    raise Exception(f"Upload failed for after_path for event {event_id}")

            if not before_path and not after_path:
                raise Exception("Both before and after image uploads failed.")

            # Step 2c: Mark as processed in an isolated transaction.
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(MARK_PROCESSED_SQL, (event_id, user_id, session_id, before_path, after_path, before_size, after_size))
                    conn.commit()
            
            print(f"✅ Successfully processed event {event_id}")
            processed_count += 1

        except Exception as e:
            # Step 2d: If anything fails, mark as failed in a new, isolated transaction.
            error_message = f"Error processing event {event_id}: {e}"
            print(f"❌ {error_message}")
            failed_count += 1
            try:
                with get_db_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(MARK_FAILED_SQL, (event_id, user_id, session_id, True, str(e)[:255]))
                        conn.commit()
            except Exception as mark_fail_e:
                print(f"❌ CRITICAL: Could not mark event {event_id} as failed: {mark_fail_e}")

        finally:
            # Step 2e: ALWAYS release the lock in a final, isolated transaction.
            if lock_acquired:
                try:
                    with get_db_connection() as conn:
                        with conn.cursor() as cursor:
                            cursor.execute(RELEASE_LOCK_SQL, (event_id, processor_id))
                            conn.commit()
                    print(f"🔑 Released lock for event {event_id}")
                except Exception as release_lock_e:
                    print(f"❌ CRITICAL: Failed to release lock for event {event_id}: {release_lock_e}")

    print(f"🏁 Finished {processor_id}. Processed: {processed_count}, Failed: {failed_count}, Skipped: {skipped_count}")
    return {
        "processed": processed_count,
        "failed": failed_count,
        "skipped": skipped_count
    }

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret")
    ],
    schedule=modal.Period(minutes=3),  # Process every 3 minutes
    timeout=300
)
def scheduled_screenshot_processing():
    """Automatically process screenshots on schedule"""
    print("Running scheduled screenshot processing...")
    try:
        # Check if there are any unprocessed events first
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT COUNT(*) FROM low_level_events 
            WHERE payload->'payload'->>'type' = 'screenshot_diff'
            AND NOT EXISTS (
                SELECT 1 FROM low_level_processed_screenshots lps 
                WHERE lps.event_id = low_level_events.id
            )
            AND (
                -- Structure A: screenshot_diff format
                LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'after') > 5000 OR
                LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'before') > 5000 OR
                -- Structure B: direct screenshot format
                LENGTH(payload->'payload'->'event'->>'screenshot_after') > 5000 OR
                LENGTH(payload->'payload'->'event'->>'screenshot_before') > 5000
            );
        """)
        
        pending_count = cursor.fetchone()[0]
        cursor.close()
        conn.close()
        
        if pending_count == 0:
            print("No unprocessed screenshot events found. Skipping processing.")
            return {"status": "no_work", "pending_count": 0}
        
        print(f"Found {pending_count} unprocessed screenshot events. Starting processing...")
        
        # Process in batches - use larger batch size for scheduled processing
        batch_size = 25
        result = process_screenshots.remote(batch_size=batch_size)
        
        print(f"Scheduled processing completed: {result}")
        return {
            "status": "completed", 
            "pending_count": pending_count,
            "batch_size": batch_size,
            "result": result
        }
    except Exception as e:
        print(f"Error in scheduled processing: {e}")
        return {"status": "error", "error": str(e)} 