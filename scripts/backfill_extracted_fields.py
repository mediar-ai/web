#!/usr/bin/env python3
"""
Backfill extracted fields in low_level_events table.
Processes records in small batches to avoid timeouts and provide progress tracking.
"""

import psycopg2
import json
import time
from datetime import datetime
from typing import Dict, Any, Optional

# Database connection
def get_connection():
    return psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )

def extract_event_type(payload: Dict[str, Any]) -> str:
    """Extract event type from payload structure."""
    try:
        # Try payload.payload.type first (most common)
        if isinstance(payload, dict) and 'payload' in payload:
            nested = payload['payload']
            if isinstance(nested, dict) and 'type' in nested:
                return str(nested['type'])
        
        # Fallback to payload.type
        if isinstance(payload, dict) and 'type' in payload:
            return str(payload['type'])
        
        return 'unknown'
    except Exception:
        return 'unknown'

def extract_app_name(payload: Dict[str, Any]) -> Optional[str]:
    """Extract app name from payload structure."""
    try:
        if isinstance(payload, dict) and 'payload' in payload:
            nested = payload['payload']
            if isinstance(nested, dict) and 'event' in nested:
                event = nested['event']
                if isinstance(event, dict):
                    # Try app_name first
                    if 'app_name' in event and event['app_name']:
                        return str(event['app_name'])
                    # Try application as fallback
                    if 'application' in event and event['application']:
                        return str(event['application'])
        
        return None
    except Exception:
        return None

def extract_has_ui_tree(payload: Dict[str, Any]) -> bool:
    """Check if payload contains UI tree data."""
    try:
        if isinstance(payload, dict) and 'payload' in payload:
            nested = payload['payload']
            if isinstance(nested, dict) and 'event' in nested:
                event = nested['event']
                if isinstance(event, dict) and 'screen' in event:
                    screen = event['screen']
                    if isinstance(screen, dict) and 'ui_tree' in screen:
                        ui_tree = screen['ui_tree']
                        return bool(ui_tree and str(ui_tree).strip())
        
        return False
    except Exception:
        return False

def extract_screenshot_timestamp(payload: Dict[str, Any]) -> Optional[str]:
    """Extract screenshot after_timestamp from payload."""
    try:
        if isinstance(payload, dict) and 'payload' in payload:
            nested = payload['payload']
            if isinstance(nested, dict) and 'event' in nested:
                event = nested['event']
                if isinstance(event, dict) and 'screenshot_diff' in event:
                    screenshot_diff = event['screenshot_diff']
                    if isinstance(screenshot_diff, dict) and 'after_timestamp' in screenshot_diff:
                        timestamp = screenshot_diff['after_timestamp']
                        if timestamp:
                            return str(timestamp)
        
        return None
    except Exception:
        return None

def backfill_batch(conn, offset: int, batch_size: int) -> int:
    """Process a batch of records and return the number of records processed."""
    cursor = conn.cursor()
    
    try:
        # Fetch batch of records that haven't been processed yet
        cursor.execute("""
            SELECT id, payload 
            FROM low_level_events 
            WHERE event_type IS NULL
            ORDER BY id
            LIMIT %s OFFSET %s
        """, (batch_size, offset))
        
        records = cursor.fetchall()
        
        if not records:
            return 0
        
        print(f"Processing batch at offset {offset}: {len(records)} records")
        
        # Process each record in the batch
        updates = []
        for record_id, payload_raw in records:
            try:
                # Parse JSON payload
                payload = json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
                
                # Extract fields
                event_type = extract_event_type(payload)
                app_name = extract_app_name(payload)
                has_ui_tree = extract_has_ui_tree(payload)
                screenshot_timestamp = extract_screenshot_timestamp(payload)
                
                updates.append((
                    event_type,
                    app_name,
                    has_ui_tree,
                    screenshot_timestamp,
                    record_id
                ))
                
            except Exception as e:
                print(f"  ⚠️  Error processing record {record_id}: {e}")
                # Add default values for failed records
                updates.append((
                    'unknown',
                    None,
                    False,
                    None,
                    record_id
                ))
        
        # Bulk update the records
        cursor.executemany("""
            UPDATE low_level_events 
            SET 
                event_type = %s,
                app_name = %s,
                has_ui_tree = %s,
                screenshot_timestamp = %s
            WHERE id = %s
        """, updates)
        
        conn.commit()
        
        # Log statistics for this batch
        event_types = {}
        app_names = set()
        ui_tree_count = 0
        screenshot_count = 0
        
        for event_type, app_name, has_ui_tree, screenshot_timestamp, _ in updates:
            event_types[event_type] = event_types.get(event_type, 0) + 1
            if app_name:
                app_names.add(app_name)
            if has_ui_tree:
                ui_tree_count += 1
            if screenshot_timestamp:
                screenshot_count += 1
        
        print(f"  ✅ Updated {len(updates)} records")
        print(f"     Event types: {dict(list(event_types.items())[:5])}{'...' if len(event_types) > 5 else ''}")
        print(f"     App names found: {len(app_names)} unique")
        print(f"     UI trees: {ui_tree_count}, Screenshots: {screenshot_count}")
        
        return len(records)
        
    except Exception as e:
        print(f"  ❌ Error processing batch at offset {offset}: {e}")
        conn.rollback()
        return 0
    finally:
        cursor.close()

def get_total_unprocessed_count(conn) -> int:
    """Get total count of unprocessed records."""
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM low_level_events WHERE event_type IS NULL")
        return cursor.fetchone()[0]
    finally:
        cursor.close()

def main():
    """Main backfill process."""
    print("🚀 Starting backfill of extracted fields in low_level_events")
    print(f"⏰ Started at: {datetime.now()}")
    
    BATCH_SIZE = 1000  # Process 1k records at a time
    
    conn = get_connection()
    
    try:
        # Get initial count
        total_unprocessed = get_total_unprocessed_count(conn)
        print(f"📊 Total unprocessed records: {total_unprocessed:,}")
        
        if total_unprocessed == 0:
            print("✅ No records to process!")
            return
        
        processed_total = 0
        offset = 0
        start_time = time.time()
        
        while True:
            batch_start = time.time()
            
            processed_count = backfill_batch(conn, offset, BATCH_SIZE)
            
            if processed_count == 0:
                break
            
            processed_total += processed_count
            offset += processed_count
            
            # Calculate progress and ETA
            batch_time = time.time() - batch_start
            elapsed_total = time.time() - start_time
            progress_pct = (processed_total / total_unprocessed) * 100
            
            if processed_total > 0:
                avg_time_per_batch = elapsed_total / (processed_total / BATCH_SIZE)
                remaining_batches = (total_unprocessed - processed_total) / BATCH_SIZE
                eta_seconds = remaining_batches * avg_time_per_batch
                eta_minutes = eta_seconds / 60
            else:
                eta_minutes = 0
            
            print(f"📈 Progress: {processed_total:,}/{total_unprocessed:,} ({progress_pct:.1f}%) - Batch took {batch_time:.1f}s - ETA: {eta_minutes:.1f}min")
            
            # Small delay to avoid overwhelming the database
            time.sleep(0.5)
        
        elapsed_total = time.time() - start_time
        print(f"\n🎉 Backfill completed!")
        print(f"   Total processed: {processed_total:,} records")
        print(f"   Total time: {elapsed_total/60:.1f} minutes")
        print(f"   Average rate: {processed_total/(elapsed_total/60):.0f} records/minute")
        
        # Final statistics
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                event_type,
                COUNT(*) as count
            FROM low_level_events 
            WHERE event_type IS NOT NULL
            GROUP BY event_type 
            ORDER BY count DESC
            LIMIT 10
        """)
        
        print(f"\n📊 Final event type distribution:")
        for event_type, count in cursor.fetchall():
            print(f"   {event_type}: {count:,}")
        
        cursor.close()
        
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    main() 