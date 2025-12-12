import modal
import asyncio
import aiohttp
import os
import psycopg2
import json
from datetime import datetime
from typing import Dict, Any, Optional

# Create Modal app
app = modal.App("sync-processor")

# Define the image with required dependencies
image = modal.Image.debian_slim().pip_install([
    "aiohttp",
    "psycopg2-binary"
])

# Database connection configuration using environment variables
def get_db_config():
    """Get database configuration from environment variables (Modal secrets)"""
    return {
        'host': os.environ['SUPABASE_HOST'],
        'port': 5432,
        'database': 'postgres',
        'user': os.environ['SUPABASE_USER'],
        'password': os.environ['SUPABASE_PASSWORD']
    }

def get_database_connection():
    """Gets a new database connection for metadata processing."""
    try:
        conn = psycopg2.connect(**get_db_config())
        conn.autocommit = False
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

# --- Metadata Extraction Logic ---
def extract_event_type(payload: Dict[str, Any]) -> str:
    try:
        if isinstance(payload, dict) and 'payload' in payload:
            nested = payload['payload']
            if isinstance(nested, dict) and 'type' in nested:
                return str(nested['type'])
        if isinstance(payload, dict) and 'type' in payload:
            return str(payload['type'])
        return 'unknown'
    except Exception:
        return 'unknown'

def extract_app_name(payload: Dict[str, Any]) -> Optional[str]:
    try:
        if isinstance(payload, dict) and 'payload' in payload:
            nested = payload['payload']
            if isinstance(nested, dict) and 'window' in nested:
                window = nested['window']
                if isinstance(window, dict) and 'app' in window:
                    return str(window['app'])
        return None
    except Exception:
        return None

def extract_has_ui_tree(payload: Dict[str, Any]) -> bool:
    try:
        return extract_event_type(payload) == 'ui_tree'
    except Exception:
        return False

def extract_screenshot_timestamp(payload: Dict[str, Any]) -> Optional[datetime]:
    try:
        if extract_event_type(payload) == 'screenshot_diff':
            if isinstance(payload, dict) and 'timestamp' in payload:
                return datetime.fromtimestamp(payload['timestamp'])
        return None
    except Exception:
        return None

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("supabase-secret")],
    min_containers=1,  # Updated from keep_warm
    max_containers=1,  # Updated from allow_concurrent_inputs
    timeout=30
)
@modal.concurrent(max_inputs=1)  # Fixed: need max_inputs parameter
def continuous_sync_processor():
    """
    🔄 CONTINUOUS SYNC: Runs forever, calling sync API every 2 seconds
    
    This maintains session metadata consistency by ensuring processed_event_count
    matches the actual count of low_level_workflow_analyses.
    
    Runs independently of the backup sync to provide real-time updates.
    """
    import time
    import requests
    
    base_url = "https://app.mediar.ai"
    iteration = 0
    
    print("🚀 Starting continuous sync processor...")
    
    while True:
        try:
            iteration += 1
            
            response = requests.post(f"{base_url}/api/sync-processed-counts", timeout=25)
            
            if response.status_code == 200:
                if iteration % 10 == 0:  # Log every 20 seconds (10 * 2s)
                    print(f"✅ Continuous sync iteration {iteration}: Processed event counts synced successfully")
            else:
                print(f"❌ Continuous sync iteration {iteration} failed: HTTP {response.status_code}")
                
        except Exception as e:
            print(f"💥 Continuous sync iteration {iteration} error: {str(e)}")
        
        # Wait 2 seconds before next sync
        time.sleep(2)
        
        # Log progress periodically
        if iteration % 100 == 0:
            print(f"📊 Completed {iteration} sync iterations ({iteration * 2} seconds of runtime)")

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("supabase-secret")],
    # schedule=modal.Period(seconds=2),  # MOVED to high_frequency_processor.py
    timeout=90,  # 90 seconds max per run (increased for database load)
    retries=0,  # No retries to prevent queueing
    max_containers=5,  # INCREASED PARALLELISM
    min_containers=0,  # No warm containers to prevent queueing
)
async def backup_sync_and_metadata_processor():
    """
    Combined processor that attempts to run every 2 seconds:
    1. Backup sync (in case continuous processor goes down)
    2. Process metadata for new events (100 batch limit)
    
    Limited to 1 container with no retries to prevent queueing.
    If no container available, the run is skipped.
    """
    timestamp = datetime.now().isoformat()
    print(f"🔄 [{timestamp}] Starting combined backup sync and metadata processing...")
    
    # Task 1: Backup Sync (always run this)
    try:
        base_url = "https://app.mediar.ai"
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{base_url}/api/sync-processed-counts") as response:
                if response.status == 200:
                    print(f"✅ [{timestamp}] Backup sync successful: Processed event counts synced successfully")
                else:
                    print(f"❌ [{timestamp}] Backup sync failed: HTTP {response.status}")
    except Exception as e:
        print(f"❌ [{timestamp}] Backup sync error: {str(e)}")
    
    # Task 2: Metadata Processing (limited to 25 events)
    try:
        print(f"🔄 [{timestamp}] Processing metadata batch (limit: 25)...")
        
        # Use the simple, direct approach without coordination locks
        conn = get_database_connection()
        cursor = conn.cursor()
        
        # Get unprocessed events (back to 25)
        cursor.execute("""
            SELECT id, payload 
            FROM low_level_events 
            WHERE id NOT IN (SELECT event_id FROM low_level_events_metadata)
            LIMIT 25
        """)
        
        events = cursor.fetchall()
        
        if not events:
            print(f"✅ [{timestamp}] No new events to process for metadata.")
            cursor.close()
            conn.close()
            return
        
        print(f"🔄 [{timestamp}] Found {len(events)} new events to process for metadata.")
        
        # Process events
        metadata_rows = []
        for event_id, payload in events:
            try:
                event_type = extract_event_type(payload)
                app_name = extract_app_name(payload)
                has_ui_tree = extract_has_ui_tree(payload)
                screenshot_timestamp = extract_screenshot_timestamp(payload)
                
                metadata_rows.append((
                    event_id,
                    event_type,
                    app_name,
                    has_ui_tree,
                    screenshot_timestamp
                ))
            except Exception as e:
                print(f"⚠️ [{timestamp}] Error processing event {event_id}: {str(e)}")
                continue
        
        # Bulk insert
        cursor.executemany("""
            INSERT INTO low_level_events_metadata
            (event_id, event_type, app_name, has_ui_tree, screenshot_timestamp)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO NOTHING
        """, metadata_rows)
        
        conn.commit()
        print(f"✅ [{timestamp}] Successfully processed {len(metadata_rows)} metadata records.")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"💥 [{timestamp}] Metadata processing error: {str(e)}")
        if 'conn' in locals():
            try:
                conn.close()
            except:
                pass

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=300  # 5 minutes
)
async def test_sync():
    """
    Test function to run a few sync iterations for testing
    """
    print("🧪 Starting test sync process (10 iterations)...")
    
    # Use localhost for testing, production for real runs
    base_url = "http://localhost:3001"  # Use local dev server for testing
    endpoint = f"{base_url}/api/sync-processed-counts"
    
    async with aiohttp.ClientSession() as session:
        for i in range(10):
            try:
                print(f"🔄 [{datetime.now().isoformat()}] Test sync iteration {i+1}/10")
                
                async with session.post(endpoint, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        result = await response.json()
                        print(f"✅ Test sync successful: {result.get('message', 'OK')}")
                    else:
                        error_text = await response.text()
                        print(f"❌ Test sync failed with status {response.status}: {error_text}")
                        
                if i < 9:  # Don't wait after the last iteration
                    await asyncio.sleep(2)
                
            except Exception as e:
                print(f"💥 Test sync error: {str(e)}")
    
    print(f"🏁 Test sync completed")

def test_sync_local():
    """
    Synchronous wrapper for local testing - tests the sync endpoint once
    """
    import requests
    
    print("🧪 Testing sync endpoint locally...")
    
    # Use localhost for testing
    base_url = "http://localhost:3001"  
    endpoint = f"{base_url}/api/sync-processed-counts"
    
    try:
        print(f"🔄 [{datetime.now().isoformat()}] Making sync request to {endpoint}")
        
        response = requests.post(endpoint, timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Local sync test successful: {result.get('message', 'OK')}")
            return True
        else:
            print(f"❌ Local sync test failed with status {response.status_code}: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection error - make sure local dev server is running on port 3001")
        return False
    except Exception as e:
        print(f"💥 Local sync test error: {str(e)}")
        return False

if __name__ == "__main__":
    # For local testing
    import asyncio
    
    async def local_test():
        print("Testing sync locally...")
        await test_sync.local()
    
    asyncio.run(local_test()) 