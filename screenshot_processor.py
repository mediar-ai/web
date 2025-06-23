import modal
import os
import psycopg2
import json
import base64
import requests
from typing import Dict, List, Optional, Tuple

app = modal.App("screenshot-processor")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary", "requests", "fastapi[standard]")

# SQL to find screenshot_diff events that haven't been processed yet
GET_UNPROCESSED_SCREENSHOTS_SQL = """
    SELECT id, user_id, session_id, created_at, payload
    FROM low_level_events 
    WHERE payload->'payload'->>'type' = 'screenshot_diff'
    AND NOT EXISTS (
        SELECT 1 FROM low_level_processed_screenshots lps 
        WHERE lps.event_id = low_level_events.id
    )
    AND (
        LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'after') > 5000 OR
        LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'before') > 5000
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

def get_db_connection():
    """Get database connection using environment variables"""
    conn_string = os.environ.get('SUPABASE_CONN_STRING')
    if not conn_string:
        raise Exception("SUPABASE_CONN_STRING environment variable not set")
    return psycopg2.connect(conn_string)

def extract_image_data(payload: Dict) -> Tuple[Optional[str], Optional[str]]:
    """Extract before and after image data from payload"""
    try:
        screenshot_diff = payload.get('payload', {}).get('event', {}).get('screenshot_diff', {})
        
        before_data = screenshot_diff.get('before')
        after_data = screenshot_diff.get('after')
        
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
    ]
)
def process_screenshots(batch_size: int = 10):
    """Process a batch of screenshots and upload them to storage"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get unprocessed events
        cursor.execute(GET_UNPROCESSED_SCREENSHOTS_SQL, (batch_size,))
        events = cursor.fetchall()
        
        processed_count = 0
        failed_count = 0
        
        for event_id, user_id, session_id, created_at, payload in events:
            try:
                # Extract image data using correct payload structure
                before_data, after_data = extract_image_data(payload)
                
                if not before_data and not after_data:
                    # Mark as failed - no valid image data at all
                    cursor.execute(MARK_FAILED_SQL, (event_id, user_id, session_id, True, "No valid image data found"))
                    failed_count += 1
                    continue
                
                # Generate storage paths
                before_path = f"{user_id}/{session_id}/screenshots/{event_id}_before.jpeg" if before_data else None
                after_path = f"{user_id}/{session_id}/screenshots/{event_id}_after.jpeg" if after_data else None
                
                # Upload images (only upload what we have)
                before_success, before_size = (True, 0)  # Default for missing image
                after_success, after_size = (True, 0)    # Default for missing image
                
                if before_data:
                    before_success, before_size = upload_image_to_supabase(before_data, before_path)
                    if not before_success:
                        before_path = None
                        before_size = 0
                
                if after_data:
                    after_success, after_size = upload_image_to_supabase(after_data, after_path)
                    if not after_success:
                        after_path = None
                        after_size = 0
                
                # Consider it successful if at least one image uploaded successfully
                overall_success = (before_data and before_success) or (after_data and after_success)
                
                if overall_success:
                    # Mark as successfully processed
                    cursor.execute(MARK_PROCESSED_SQL, (
                        event_id, user_id, session_id, 
                        before_path, after_path, 
                        before_size or 0, after_size or 0
                    ))
                    processed_count += 1
                else:
                    # Mark as failed
                    error_msg = "Failed to upload any available images"
                    if before_data and not before_success:
                        error_msg += " (before upload failed)"
                    if after_data and not after_success:
                        error_msg += " (after upload failed)"
                    
                    cursor.execute(MARK_FAILED_SQL, (
                        event_id, user_id, session_id, True, error_msg
                    ))
                    failed_count += 1
                    
            except Exception as e:
                # Mark as failed with error
                cursor.execute(MARK_FAILED_SQL, (
                    event_id, user_id, session_id, True, str(e)
                ))
                failed_count += 1
                print(f"Error processing event {event_id}: {e}")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            "processed": processed_count,
            "failed": failed_count,
            "total_in_batch": len(events)
        }
        
    except Exception as e:
        print(f"Error in process_screenshots: {e}")
        return {"error": str(e)}

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret")
    ]
)
def get_stats():
    """Get processing statistics"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get total screenshot events
        cursor.execute("SELECT COUNT(*) FROM low_level_events WHERE payload->'payload'->>'type' = 'screenshot_diff';")
        total_events = cursor.fetchone()[0]
        
        # Get processed events
        cursor.execute("SELECT COUNT(*) FROM low_level_processed_screenshots;")
        processed_events = cursor.fetchone()[0]
        
        # Get successful vs failed
        cursor.execute("SELECT COUNT(*) FROM low_level_processed_screenshots WHERE processing_failed = false;")
        successful_events = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM low_level_processed_screenshots WHERE processing_failed = true;")
        failed_events = cursor.fetchone()[0]
        
        # Get storage stats
        cursor.execute("SELECT COALESCE(SUM(before_size + after_size), 0) FROM low_level_processed_screenshots WHERE processing_failed = false;")
        total_storage_bytes = cursor.fetchone()[0]
        
        cursor.close()
        conn.close()
        
        return {
            "total_screenshot_events": total_events,
            "processed_events": processed_events,
            "successful_events": successful_events,
            "failed_events": failed_events,
            "pending_events": total_events - processed_events,
            "total_storage_bytes": total_storage_bytes,
            "total_storage_mb": round(total_storage_bytes / 1024 / 1024, 2)
        }
        
    except Exception as e:
        return {"error": str(e)}

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret")
    ]
)
@modal.fastapi_endpoint(method="POST")
def trigger_screenshot_processing():
    """Trigger screenshot processing"""
    result = process_screenshots.remote(batch_size=50)
    return {"status": "Screenshot processing triggered", "result": result}

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret")
    ]
)
@modal.fastapi_endpoint(method="POST")
def process_new_screenshot_event():
    """Process a specific screenshot event immediately (for real-time processing)"""
    try:
        # For now, process a small batch - could be enhanced to target specific event_ids
        result = process_screenshots.remote(batch_size=5)
        return {
            "status": "New screenshot event processing triggered", 
            "result": result,
            "processed_immediately": True
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret")
    ]
)
@modal.fastapi_endpoint(method="GET")
def debug_environment():
    """Debug endpoint to check environment variables"""
    return {
        "supabase_url": os.environ.get('NEXT_PUBLIC_SUPABASE_URL'),
        "has_service_key": bool(os.environ.get('SUPABASE_SERVICE_KEY')),
        "has_service_role_key": bool(os.environ.get('SUPABASE_SERVICE_ROLE_KEY')),
        "has_conn_string": bool(os.environ.get('SUPABASE_CONN_STRING')),
        "available_env_vars": [key for key in os.environ.keys() if 'SUPA' in key.upper()],
        "all_env_keys": list(os.environ.keys())
    }

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret")
    ]
)
@modal.fastapi_endpoint(method="GET")
def get_processing_stats():
    """Get processing statistics"""
    return get_stats.remote()

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
                LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'after') > 5000 OR
                LENGTH(payload->'payload'->'event'->'screenshot_diff'->>'before') > 5000
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
        print(f"Error in scheduled screenshot processing: {e}")
        return {"status": "error", "error": str(e)} 