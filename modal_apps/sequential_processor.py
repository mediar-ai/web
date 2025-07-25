import modal
import os
import psycopg2
import psycopg2.extras
import json
import requests
from datetime import datetime, timedelta, timezone
import uuid
import time
import difflib
import sys
from datetime import datetime
# === GRACEFUL SHUTDOWN HANDLING ===
import signal
import threading
import atexit

app = modal.App("sequential-workflow-processor")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary", "requests")

# --- FEATURE FLAGS ---
# WARNING: Disabling screenshots will significantly reduce context quality for the LLM.
# This is a temporary measure to prevent '413 Request Entity Too Large' errors.
INCLUDE_SCREENSHOTS_IN_CONTEXT = False
# --- END FEATURE FLAGS ---

# --- CANCELLATION PREVENTION NOTES ---
# Modal cancellation requests occur when:
# 1. Scheduled functions overlap due to long-running processors (2hr timeout) vs short schedule (15min)
# 2. Multiple coordinators try to run simultaneously
# 3. Resource limits are exceeded causing Modal to cancel older instances
# 
# Prevention strategies implemented:
# - Increased schedule from 15min to 60min to prevent overlaps
# - Reduced concurrent processor limit from 50 to 20
# - Added coordinator locking to prevent multiple instances
# - Added coordinator conflict detection in scheduled_processing
# --- END CANCELLATION NOTES ---

# Database connection configuration
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': 'dS64xX6mU3E4Sbyc'
}

# Function verification for edge case fix
def verify_function_edge_case_fix():
    """Verify the database query handles the edge case correctly"""
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    # Test Matt's user (known edge case with multiple events per timestamp)
    user_id = 'cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9'
    
    try:
        # Count truly unprocessed events (using the actual query logic)
        cur.execute("""
            SELECT COUNT(*)
            FROM low_level_events_enriched
            WHERE user_id = %s
              AND event_type = 'ui_tree'
              AND NOT EXISTS (
                  SELECT 1 FROM low_level_workflow_analyses llwa
                  WHERE llwa.user_id::text = low_level_events_enriched.user_id::text
                    AND llwa.client_timestamp = low_level_events_enriched.created_at
              )
        """, (user_id,))
        unprocessed_count = cur.fetchone()[0]
        
        # Count unique timestamps that have events
        cur.execute("""
            SELECT COUNT(DISTINCT created_at)
            FROM low_level_events_enriched 
            WHERE user_id = %s AND event_type = 'ui_tree'
        """, (user_id,))
        unique_timestamps = cur.fetchone()[0]
        
        # Count total events (for reference)
        cur.execute("""
            SELECT COUNT(*) 
            FROM low_level_events_enriched 
            WHERE user_id = %s AND event_type = 'ui_tree'
        """, (user_id,))
        total_events = cur.fetchone()[0]
        
        # Count analyses
        cur.execute('SELECT COUNT(*) FROM low_level_workflow_analyses WHERE user_id = %s', (user_id,))
        analyses = cur.fetchone()[0]
        
        # The correct expected value is unique_timestamps - analyses (not total_events - analyses)
        expected = unique_timestamps - analyses
        
        print(f"🧪 FUNCTION EDGE CASE TEST:")
        print(f"  Matt Events: {total_events} (across {unique_timestamps} unique timestamps)")
        print(f"  Matt Analyses: {analyses}")
        print(f"  Function Result: {unprocessed_count}, Expected: {expected}")
        
        if unprocessed_count == expected:
            print(f"  ✅ EDGE CASE FUNCTION WORKING! (Correctly handles multiple events per timestamp)")
            return True
        else:
            print(f"  ❌ EDGE CASE FUNCTION BROKEN: Expected {expected}, got {unprocessed_count}")
            return False
    except Exception as e:
        print(f"  ❌ FUNCTION TEST ERROR: {e}")
        return False
    finally:
        conn.close()

# Processing status constants
PROCESSING_STATUS = {
    'PENDING': 'pending',
    'IN_PROGRESS': 'in_progress', 
    'COMPLETED': 'completed',
    'FAILED': 'failed'
}

# Clean up expired processing locks (table is created via migration)
CLEANUP_PROCESSING_LOCKS_SQL = """
-- Clean up expired locks
DELETE FROM processing_locks WHERE expires_at < NOW();
"""

# Global variables for graceful shutdown
shutdown_requested = threading.Event()
active_processors = {}  # processor_id -> {conn, processor_id, user_id}
shutdown_lock = threading.Lock()

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    print(f"\n🛑 Received shutdown signal {signum}, initiating graceful shutdown...")
    shutdown_requested.set()
    
    # Clean up all active processors
    with shutdown_lock:
        for processor_id, info in active_processors.items():
            try:
                print(f"🧹 Cleaning up processor {processor_id} for user {info.get('user_id', 'unknown')}")
                cleanup_processor_on_shutdown(info['conn'], processor_id)
            except Exception as e:
                print(f"❌ Error cleaning up processor {processor_id}: {e}")
    
    print("✅ Graceful shutdown completed")
    sys.exit(0)

def cleanup_processor_on_shutdown(conn, processor_id):
    """Clean up processor locks when shutting down gracefully"""
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE processing_locks 
            SET status = 'failed',
                updated_at = NOW(),
                expires_at = NOW()
            WHERE processor_id = %s AND status = 'in_progress'
        """, (processor_id,))
        affected = cur.rowcount
        conn.commit()
        cur.close()
        if affected > 0:
            print(f"🧹 Released {affected} locks for processor {processor_id}")
        return affected
    except Exception as e:
        print(f"❌ Error cleaning up processor {processor_id}: {e}")
        return 0

def register_processor(processor_id, conn, user_id=None):
    """Register a processor for graceful shutdown handling"""
    with shutdown_lock:
        active_processors[processor_id] = {
            'conn': conn,
            'processor_id': processor_id,
            'user_id': user_id
        }
    print(f"📋 Registered processor {processor_id} for graceful shutdown")

def unregister_processor(processor_id):
    """Unregister a processor when it completes normally"""
    with shutdown_lock:
        if processor_id in active_processors:
            del active_processors[processor_id]
            print(f"📋 Unregistered processor {processor_id}")

# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

def get_database_connection():
    """Get a database connection with proper error handling and optimized settings"""
    try:
        # Optimize connection for concurrent usage
        config = DB_CONFIG.copy()
        config.update({
            'connect_timeout': 10,      # Fail fast if connection takes too long
            'application_name': 'sequential_processor',
        })
        
        conn = psycopg2.connect(**config)
        conn.autocommit = False
        
        # Optimize connection for performance
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '300s'")  # 5 minute query timeout
            cur.execute("SET idle_in_transaction_session_timeout = '600s'")  # 10 minute idle timeout
        conn.commit()
        
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def acquire_processing_lock(cur, conn, user_id, event_id, processor_id):
    """
    Acquire an exclusive lock for processing a specific event.
    Returns True if lock acquired, False if already being processed.
    """
    try:
        # Try to acquire lock with INSERT
        cur.execute("""
            INSERT INTO processing_locks (user_id, event_id, processor_id, status, expires_at)
            VALUES (%s, %s, %s, %s, NOW() + INTERVAL '2 minutes')
            ON CONFLICT (user_id, event_id) DO NOTHING
            RETURNING id
        """, (user_id, event_id, processor_id, PROCESSING_STATUS['IN_PROGRESS']))
        
        result = cur.fetchone()
        if result:
            conn.commit()
            print(f"🔒 Acquired processing lock for user {user_id}, event {event_id}")
            return True
        else:
            # Check if it's our own lock that we can reuse
            cur.execute("""
                SELECT processor_id, status, expires_at
                FROM processing_locks 
                WHERE user_id = %s AND event_id = %s
            """, (user_id, event_id))
            
            existing = cur.fetchone()
            if existing:
                existing_processor, existing_status, expires_at = existing
                if existing_processor == processor_id and expires_at > datetime.now(timezone.utc):
                    print(f"🔄 Reusing existing lock for user {user_id}, event {event_id}")
                    return True
                else:
                    print(f"⏭️  Event {event_id} already being processed by {existing_processor} (status: {existing_status})")
                    return False
            return False
            
    except Exception as e:
        print(f"❌ Failed to acquire lock: {e}")
        conn.rollback()
        return False

def release_processing_lock(cur, conn, user_id, event_id, processor_id, status):
    """Release processing lock and update status"""
    try:
        cur.execute("""
            UPDATE processing_locks 
            SET status = %s, updated_at = NOW()
            WHERE user_id = %s AND event_id = %s AND processor_id = %s
        """, (status, user_id, event_id, processor_id))
        conn.commit()
        print(f"🔓 Released processing lock for user {user_id}, event {event_id} with status {status}")
    except Exception as e:
        print(f"❌ Failed to release lock: {e}")
        conn.rollback()

def cleanup_expired_locks(cur, conn):
    """Smart cleanup of expired and stale processing locks"""
    try:
        # First, clean up completed locks (keep failed locks for audit trail)
        cur.execute("""
            DELETE FROM processing_locks 
            WHERE status = 'completed'
        """)
        
        # Mark expired locks as failed (preserve audit trail)
        cur.execute("""
            UPDATE processing_locks 
            SET status = 'failed', updated_at = NOW()
            WHERE expires_at < NOW() AND status = 'in_progress'
        """)
        basic_cleanup = cur.rowcount
        
        # Smart cleanup: Mark stale locks as failed (instead of deleting)
        # This handles cases where Modal apps are stopped manually
        cur.execute("""
            UPDATE processing_locks 
            SET status = 'failed', updated_at = NOW()
            WHERE status = 'in_progress' 
              AND created_at < NOW() - INTERVAL '10 minutes'
        """)
        stale_cleanup = cur.rowcount
        
        # Aggressive cleanup: Remove duplicate locks for same user
        # (Keep only the most recent lock per user)
        cur.execute("""
            DELETE FROM processing_locks p1
            WHERE status = 'in_progress'
              AND EXISTS (
                  SELECT 1 FROM processing_locks p2 
                  WHERE p2.user_id = p1.user_id 
                    AND p2.status = 'in_progress'
                    AND p2.created_at > p1.created_at
              )
        """)
        duplicate_cleanup = cur.rowcount
        
        total_cleaned = basic_cleanup + stale_cleanup + duplicate_cleanup
        if total_cleaned > 0:
            print(f"🧹 Smart cleanup: {basic_cleanup} expired + {stale_cleanup} stale + {duplicate_cleanup} duplicate locks = {total_cleaned} total")
        
        conn.commit()
        return total_cleaned
        
    except Exception as e:
        print(f"❌ Failed to cleanup locks: {e}")
        conn.rollback()
        return 0

def emergency_cleanup_all_locks(cur, conn):
    """Emergency function to clean up ALL processing locks - use with caution"""
    try:
        print("⚠️  EMERGENCY: Cleaning up ALL processing locks...")
        cur.execute("DELETE FROM processing_locks WHERE status = 'in_progress'")
        deleted_count = cur.rowcount
        conn.commit()
        print(f"🧹 Emergency cleanup: Removed {deleted_count} locks")
        return deleted_count
    except Exception as e:
        print(f"❌ Emergency cleanup failed: {e}")
        conn.rollback()
        return 0

def smart_lock_validation(cur, conn):
    """Validate and clean locks based on age and patterns"""
    try:
        # Find potentially problematic locks
        cur.execute("""
            SELECT user_id, processor_id, created_at, 
                   NOW() - created_at as age,
                   COUNT(*) OVER (PARTITION BY user_id) as user_lock_count
            FROM processing_locks 
            WHERE status = 'in_progress' 
              AND expires_at > NOW()
            ORDER BY created_at ASC
        """)
        
        problematic_locks = []
        locks = cur.fetchall()
        
        for user_id, processor_id, created_at, age, user_lock_count in locks:
            # Flag locks older than 5 minutes or users with multiple locks
            if age.total_seconds() > 300 or user_lock_count > 1:  # 5 minutes
                problematic_locks.append((user_id, processor_id))
        
        if problematic_locks:
            print(f"🔍 Found {len(problematic_locks)} problematic locks")
            
            # Clean them up
            for user_id, processor_id in problematic_locks:
                cur.execute("""
                    DELETE FROM processing_locks 
                    WHERE user_id = %s AND processor_id = %s AND status = 'in_progress'
                """, (user_id, processor_id))
            
            conn.commit()
            print(f"🧹 Validated and cleaned {len(problematic_locks)} problematic locks")
            return len(problematic_locks)
        
        return 0
        
    except Exception as e:
        print(f"❌ Lock validation failed: {e}")
        conn.rollback()
        return 0

def is_event_already_processed(cur, user_id, event_timestamp):
    """Check if an event has already been processed (has analysis)"""
    try:
        cur.execute("""
            SELECT id FROM low_level_workflow_analyses 
            WHERE user_id = %s AND client_timestamp = %s
            LIMIT 1
        """, (user_id, event_timestamp))
        
        result = cur.fetchone()
        return result is not None
    except Exception as e:
        print(f"❌ Failed to check if event already processed: {e}")
        return False

def get_next_unprocessed_event_with_lock(cur, conn, user_id, processor_id):
    """
    Get the next unprocessed event for a user with proper locking.
    Returns None if no events available or all are being processed.
    """
    try:
        # Get next unprocessed UI tree event using low_level_events_enriched view directly
        cur.execute("""
            WITH available_events AS (
                SELECT id, user_id, session_id, created_at, payload
                FROM low_level_events_enriched
                WHERE user_id = %s
                  AND event_type = 'ui_tree'
                  AND id NOT IN (
                      SELECT event_id FROM processing_locks 
                      WHERE user_id = %s AND (
                          (status = 'in_progress' AND expires_at > NOW()) OR
                          status = 'failed'
                      )
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM low_level_workflow_analyses llwa
                      WHERE llwa.user_id = low_level_events_enriched.user_id
                        AND llwa.client_timestamp = low_level_events_enriched.created_at
                  )
                ORDER BY created_at ASC, id ASC
                LIMIT 1
            )
            SELECT id, user_id, session_id, created_at, payload
            FROM available_events
        """, (user_id, user_id))
        
        event = cur.fetchone()
        if not event:
            return None
            
        event_id, user_id, session_id, created_at, payload = event
        
        # Try to acquire lock for this event
        if acquire_processing_lock(cur, conn, user_id, event_id, processor_id):
            return event
        else:
            print(f"⏭️  Could not acquire lock for event {event_id}, skipping")
            return None
            
    except Exception as e:
        print(f"❌ Failed to get next unprocessed event: {e}")
        return None

def get_next_unprocessed_event(cur, user_id):
    """Get the next unprocessed UI tree event for a user"""
    cur.execute("""
        SELECT id, user_id, session_id, created_at, payload
        FROM low_level_events_enriched
        WHERE user_id = %s
          AND event_type = 'ui_tree'
          AND NOT EXISTS (
              SELECT 1 FROM low_level_workflow_analyses llwa
              WHERE llwa.user_id = low_level_events_enriched.user_id
                AND llwa.client_timestamp = low_level_events_enriched.created_at
          )
        ORDER BY created_at ASC
        LIMIT 1;
    """, (user_id,))
    return cur.fetchone()

def get_current_event(cur, event_id):
    """Get the current UI tree event being processed"""
    cur.execute("""
        SELECT id, user_id, session_id, created_at, payload 
        FROM low_level_events 
        WHERE id = %s
    """, (event_id,))
    return cur.fetchone()

def get_previous_ui_tree_by_timestamp(cur, user_id, current_timestamp):
    """Get exactly the previous UI tree event by timestamp"""
    cur.execute("""
        SELECT id, user_id, session_id, created_at, payload 
        FROM low_level_events_enriched
        WHERE user_id = %s 
          AND event_type = 'ui_tree'
          AND created_at < %s
        ORDER BY created_at DESC 
        LIMIT 1
    """, (user_id, current_timestamp))
    return cur.fetchone()

def get_window_title(event):
    """
    Extracts the window title from the top-level 'name' attribute of the UI tree,
    falling back to the app_name if the UI tree is not present.
    """
    try:
        # event structure: id, user_id, session_id, created_at, payload (5 fields)
        payload = event[4] if len(event) >= 5 else {}
        ui_tree_str = payload.get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')

        if ui_tree_str:
            ui_tree = json.loads(ui_tree_str)
            top_level_name = ui_tree.get('attributes', {}).get('name')
            if top_level_name:
                print(f"    -> Title extracted via ui_tree: '{top_level_name}'")
                return top_level_name
        
        # Fallback to the app_name if the ui_tree or top-level name is not found
        fallback_name = payload.get('payload', {}).get('event', {}).get('app_name', 'Unknown')
        print(f"    -> Title extracted via fallback app_name: '{fallback_name}'")
        return fallback_name
    except Exception as e:
        print(f"Error parsing window title for event: {e}")
        return 'Unknown'

def get_previous_same_window_ui_tree(cur, user_id, current_timestamp, window_title):
    """
    Get exactly the previous UI tree event from the same window,
    but only look back a maximum of 10 minutes to prevent excessive context.
    """
    cur.execute("""
        SELECT id, user_id, session_id, created_at, payload 
        FROM low_level_events_enriched
        WHERE user_id = %s 
          AND event_type = 'ui_tree'
          AND created_at < %s
          AND created_at > %s - INTERVAL '10 minutes' -- Limit lookback
          AND app_name = %s
        ORDER BY created_at DESC 
        LIMIT 1
    """, (user_id, current_timestamp, current_timestamp, window_title))
    return cur.fetchone()

def get_events_between_timestamps(cur, user_id, start_timestamp, end_timestamp):
    """Get all events between two timestamps"""
    cur.execute("""
        SELECT id, user_id, session_id, created_at, payload 
        FROM low_level_events
        WHERE user_id = %s
          AND created_at > %s
          AND created_at < %s
        ORDER BY created_at ASC
    """, (user_id, start_timestamp, end_timestamp))
    return cur.fetchall()

def get_screenshots_near_timestamp(cur, user_id, target_timestamp):
    """Get the closest screenshot to a UI tree timestamp"""
    cur.execute("""
        SELECT id, session_id, created_at, payload,
               ABS(EXTRACT(EPOCH FROM (
                 screenshot_timestamp - %s::timestamp
               ))) as time_diff
        FROM low_level_events_enriched
        WHERE user_id = %s
          AND event_type = 'screenshot_diff'
          AND screenshot_timestamp
              BETWEEN %s::timestamp - INTERVAL '2 seconds'
                  AND %s::timestamp + INTERVAL '1 second'
        ORDER BY time_diff ASC
        LIMIT 1
    """, (target_timestamp, user_id, target_timestamp, target_timestamp))
    return cur.fetchone()

def get_screenshot_for_ui_tree_event(cursor, user_id, session_id, ui_tree_timestamp, time_window_seconds=3):
    """Find screenshot_diff event closest to the UI tree timestamp within time window"""
    try:
        from datetime import datetime, timedelta
        
        if isinstance(ui_tree_timestamp, str):
            ui_tree_time = datetime.fromisoformat(ui_tree_timestamp.replace('Z', '+00:00'))
        else:
            ui_tree_time = ui_tree_timestamp
        
        before_bound = ui_tree_time - timedelta(seconds=time_window_seconds)
        after_bound = ui_tree_time + timedelta(seconds=time_window_seconds)
        
        cursor.execute("""
            SELECT id, session_id, created_at, payload
            FROM low_level_events 
            WHERE user_id = %s 
            AND session_id = %s
            AND payload->'payload'->>'type' = 'screenshot_diff'
            AND created_at BETWEEN %s AND %s
            ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - %s)))
            LIMIT 1;
        """, (user_id, session_id, before_bound, after_bound, ui_tree_time))
        
        screenshot_event = cursor.fetchone()
        if not screenshot_event:
            return None
            
        screenshot_payload = screenshot_event[3]
        screenshot_diff = screenshot_payload.get('payload', {}).get('event', {}).get('screenshot_diff', {})
        after_screenshot = screenshot_diff.get('after')
        
        if after_screenshot and len(after_screenshot) > 1000:
            return after_screenshot
            
        return None
        
    except Exception as e:
        print(f"Error getting screenshot for UI tree event: {e}")
        return None

def get_recent_analyses(cur, user_id, limit=10):
    """Get recent analyses for previous context - FRESH from database"""
    cur.execute("""
        SELECT id, user_id, session_id, llm_structured_output, created_at, client_timestamp 
        FROM low_level_workflow_analyses 
        WHERE user_id = %s 
        ORDER BY created_at DESC
        LIMIT %s
    """, (user_id, limit))
    return cur.fetchall()

def generate_simplified_ui_tree_string(ui_tree_str):
    """Generate simplified UI tree string from raw UI tree JSON - matches frontend uiTreeUtils.ts exactly"""
    if not ui_tree_str:
        return None
    
    try:
        import json
        tree = json.loads(ui_tree_str)
        
        # Roman numerals array matching frontend
        roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", 
                 "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
                 "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX"]
        
        def build_simplified_node_string(node, level=1, line_counter=None):
            if line_counter is None:
                line_counter = {'count': 1}
            
            output = []
            attributes = node.get('attributes', {})
            role = attributes.get('role', 'unknown')
            name = attributes.get('name')
            
            # Extract other attributes (excluding role and name)
            other_attributes = {k: v for k, v in attributes.items() if k not in ['role', 'name']}
            
            # Include only relevant attributes for LLM context
            relevant_attributes = {}
            if 'value' in other_attributes:
                relevant_attributes['value'] = other_attributes['value']
            if 'checked' in other_attributes:
                relevant_attributes['checked'] = other_attributes['checked']
            if 'selected' in other_attributes:
                relevant_attributes['selected'] = other_attributes['selected']
            if 'url' in other_attributes and isinstance(other_attributes['url'], str) and len(other_attributes['url']) < 100:
                relevant_attributes['url'] = other_attributes['url']
            
            # Build attributes string
            attributes_string = ''
            if relevant_attributes:
                attributes_string = ', '.join([f"{key}={json.dumps(value)}" for key, value in relevant_attributes.items()])
            
            # Build the line
            roman_level = roman[level] if level < len(roman) else str(level)
            line = f"{line_counter['count']}. {roman_level}. [{role}]"
            if name:
                line += f" '{name}'"
            if attributes_string:
                line += f" {{{attributes_string}}}"
            
            output.append(line)
            line_counter['count'] += 1
            
            # Process children
            children = node.get('children', [])
            for child in children:
                output.extend(build_simplified_node_string(child, level + 1, line_counter))
            
            return output
        
        string_array = build_simplified_node_string(tree, 1, {'count': 1})
        return '\n'.join(string_array)
        
    except Exception as e:
        print(f"Error parsing or simplifying UI Tree: {e}")
        return "Error parsing UI Tree."

def format_timestamp_like_frontend(timestamp):
    """Format timestamp like frontend's toLocaleString() - e.g., '12/25/2024, 3:45:30 PM'"""
    try:
        from datetime import datetime
        if isinstance(timestamp, str):
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        else:
            dt = timestamp
        
        # Format like JavaScript's toLocaleString() - MM/DD/YYYY, H:MM:SS AM/PM
        return dt.strftime('%-m/%-d/%Y, %-I:%M:%S %p')
    except:
        return str(timestamp)

def generate_event_summary_string(event):
    """Generate event summary string - simplified version of frontend eventSummarizer.ts"""
    try:
        # Handle both 4-field and 5-field event structures
        # 4-field: id, session_id, created_at, payload (from some queries)
        # 5-field: id, user_id, session_id, created_at, payload (from most queries)
        if len(event) >= 5:
            payload = event[4]  # 5-field structure
        elif len(event) >= 4:
            payload = event[3]  # 4-field structure
        else:
            payload = {}
            
        nested_payload = payload.get('payload', {})
        event_type = nested_payload.get('type', 'unknown_event_type')
        event_data = nested_payload.get('event', {})
        
        if event_type == 'keyboard':
            keyboard_data = event_data.get('keyboard', {})
            keys = keyboard_data.get('keys', '')
            key_code = keyboard_data.get('key_code', 0)
            is_key_down = keyboard_data.get('is_key_down', False)
            key_state = '(down)' if is_key_down else '(up)'
            
            key_identifier = keys if keys else (str(chr(key_code)) if key_code else 'Unknown key')
            app_name = event_data.get('app_name', 'Unknown App')
            
            return f"Keyboard: {key_identifier} {key_state} in {app_name}"
            
        elif event_type == 'mouse':
            mouse_data = event_data.get('mouse', {})
            button = mouse_data.get('button', 'click')
            event_type_display = mouse_data.get('event_type', 'click').lower()
            
            ui_element = mouse_data.get('metadata', {}).get('ui_element', {})
            app_name = ui_element.get('application') or event_data.get('app_name', 'Unknown App')
            element_name = ui_element.get('name', '<NO NAME>')
            element_role = ui_element.get('role', 'UNKNOWN')
            
            return f"Mouse (event): {button} ({event_type_display}) on {element_role} \"{element_name}\" in \"{app_name}\""
            
        elif event_type == 'ui_tree':
            app_name = 'Unknown App'
            screen_data = event_data.get('screen', {})
            if screen_data.get('ui_tree'):
                try:
                    import json
                    parsed_ui_tree = json.loads(screen_data['ui_tree'])
                    if parsed_ui_tree.get('attributes', {}).get('name'):
                        app_name = parsed_ui_tree['attributes']['name']
                    elif event_data.get('app_name'):
                        app_name = event_data['app_name']
                except:
                    if event_data.get('app_name'):
                        app_name = event_data['app_name']
            elif event_data.get('app_name'):
                app_name = event_data['app_name']
            
            return f"UI Tree captured for {app_name}"
            
        elif event_type == 'screenshot_diff':
            diff_data = event_data.get('screenshot_diff', {})
            before = diff_data.get('before_timestamp', 'N/A')
            after = diff_data.get('after_timestamp', 'N/A')
            return f"Screenshot Diff: {before} vs {after}"
            
        else:
            app_name = event_data.get('app_name', event_data.get('application', ''))
            return f"Event: {event_type}{' in ' + app_name if app_name else ''}"
            
    except Exception as e:
        return f"Event summary error: {e}"

def preprocess_tree(json_string):
    """Preprocess UI tree by removing id and element_id fields - matches frontend diff.ts"""
    try:
        
        def remove_ids(obj):
            if obj is None or not isinstance(obj, (dict, list)):
                return obj
            
            if isinstance(obj, list):
                return [remove_ids(item) for item in obj]
            
            if isinstance(obj, dict):
                new_obj = {}
                for key, value in obj.items():
                    if key not in ['id', 'element_id']:
                        new_obj[key] = remove_ids(value)
                return new_obj
            
            return obj
        
        tree = json.loads(json_string, strict=False)
        cleaned_tree = remove_ids(tree)
        return json.dumps(cleaned_tree, indent=2)
    except Exception as e:
        print(f"Failed to parse or preprocess UI tree: {e}")
        return json_string

def simple_ui_tree_diff(old_tree_str, new_tree_str):
    """Computes a diff between two UI tree JSON strings, matching frontend logic."""
    if not old_tree_str or not new_tree_str:
        return None
    
    try:
        old_processed = preprocess_tree(old_tree_str)
        new_processed = preprocess_tree(new_tree_str)
        
        if not old_processed or not new_processed:
            return None

        old_lines = old_processed.splitlines()
        new_lines = new_processed.splitlines()
        
        # difflib.ndiff produces a diff that is easy to parse for added/removed lines
        diff = difflib.ndiff(old_lines, new_lines)
        
        # Filter for lines that were added or removed, same as frontend
        changed_lines = [line for line in diff if line.startswith('+ ') or line.startswith('- ')]
        
        if changed_lines:
            return '\n'.join(changed_lines)
        else:
            return None
            
    except Exception as e:
        print(f"Error computing UI tree diff: {e}")
        return None

def simple_ui_tree_diff_on_simplified(old_tree_str, new_tree_str):
    """Simple diff implementation for simplified UI tree strings - matches frontend logic"""
    if not old_tree_str or not new_tree_str:
        return None
    
    try:
        # Split into lines for line-by-line comparison
        old_lines = old_tree_str.strip().split('\n')
        new_lines = new_tree_str.strip().split('\n')
        
        # Simple algorithm: compare line by line and mark differences
        i, j = 0, 0
        diff_lines = []
        
        while i < len(old_lines) or j < len(new_lines):
            if i >= len(old_lines):
                # Only new lines remain
                diff_lines.append(f"+ {new_lines[j]}")
                j += 1
            elif j >= len(new_lines):
                # Only old lines remain
                diff_lines.append(f"- {old_lines[i]}")
                i += 1
            elif old_lines[i] == new_lines[j]:
                # Lines match, skip both
                i += 1
                j += 1
            else:
                # Lines differ - mark both as changed
                diff_lines.append(f"- {old_lines[i]}")
                diff_lines.append(f"+ {new_lines[j]}")
                i += 1
                j += 1
        
        # Return only the changed lines (filter out unchanged parts)
        changed_lines = [line for line in diff_lines if line.startswith(('+', '-'))]
        
        if changed_lines:
            return '\n'.join(changed_lines)
        else:
            return None
            
    except Exception as e:
        print(f"Error computing UI tree diff: {e}")
        return None

def generate_context_metadata(context):
    """Generate metadata about what context fields were actually provided"""
    metadata = {
        # Screenshot fields (exactly as in ContextForAnalysis)
        'has_screenshotBefore': 'screenshotBefore' in context,
        'has_screenshotAfter': 'screenshotAfter' in context,
        'has_screenshotBeforeSameWindow': 'screenshotBeforeSameWindow' in context,
        
        # UI Tree fields (exactly as in ContextForAnalysis)
        'has_previousUiTree': 'previousUiTree' in context,  # Should be false per config
        'has_currentUiTree': 'currentUiTree' in context,
        'has_currentUiTree_structure': 'currentUiTree_structure' in context,
        'has_uiTreeDiffLatestVsPreviousForTheSameWindow': 'uiTreeDiffLatestVsPreviousForTheSameWindow' in context,
        
        # Previous context fields (exactly as in ContextForAnalysis)
        'has_previousWindowTitle': 'previousWindowTitle' in context,
        'has_previousWindowTimestamp': 'previousWindowTimestamp' in context,
        
        # Events fields (exactly as in ContextForAnalysis)
        'has_eventsSincePreviousUiTreeByTimestamp': 'eventsSincePreviousUiTreeByTimestamp' in context,
        'has_eventsSincePreviousUiTreeBySameWindow': 'eventsSincePreviousUiTreeBySameWindow' in context,
        
        # Previous analyses field (exactly as in ContextForAnalysis)
        'has_previousAnalyses': 'previousAnalyses' in context,
        
        # Counts for quantitative analysis
        'screenshot_count': sum([
            'screenshotBefore' in context,
            'screenshotAfter' in context, 
            'screenshotBeforeSameWindow' in context
        ]),
        'eventsSincePreviousUiTreeByTimestamp_count': len(context.get('eventsSincePreviousUiTreeByTimestamp', [])),
        'eventsSincePreviousUiTreeBySameWindow_count': len(context.get('eventsSincePreviousUiTreeBySameWindow', [])),
        'previousAnalyses_count': len(context.get('previousAnalyses', [])),
        
        # Context richness score (0-10 based on available fields)
        'context_richness_score': 0
    }
    
    # Calculate context richness score (0-10 based on available fields)
    score = 0
    if metadata['has_screenshotAfter']: score += 1  # Current screenshot
    if metadata['has_screenshotBefore']: score += 1  # Previous screenshot  
    if metadata['has_screenshotBeforeSameWindow']: score += 0.5  # Same window screenshot
    if metadata['has_currentUiTree']: score += 1  # Current UI tree
    if metadata['has_uiTreeDiffLatestVsPreviousForTheSameWindow']: score += 2  # UI tree diff (very valuable)
    if metadata['has_previousWindowTitle']: score += 0.5  # Previous window context
    if metadata['eventsSincePreviousUiTreeByTimestamp_count'] > 0: score += 1  # Events context
    if metadata['eventsSincePreviousUiTreeBySameWindow_count'] > 0: score += 1  # Same window events
    if metadata['previousAnalyses_count'] > 0: score += 2  # Previous analyses (very valuable)
    
    metadata['context_richness_score'] = min(10, score)  # Cap at 10
    
    return metadata

def process_and_filter_intermediate_events(events):
    """
    Filters and processes a list of raw database event rows for context.
    - Skips screenshot_diff events.
    - Passes UI tree events unchanged (truncation only happens in logs).
    """
    processed_payloads = []
    for event in events:
        # The full event payload from the DB is the 5th element (index 4)
        original_payload = event[4].get('payload', {})
        event_type = original_payload.get('type')

        if event_type == 'screenshot_diff':
            continue  # Ignore screenshot_diff events entirely

        if event_type == 'ui_tree':
            # Pass through UI tree events unchanged for LLM analysis
            # Truncation only happens in log_truncated_context for logging
            processed_payloads.append(original_payload)
        else:
            # Not a ui_tree or screenshot_diff, so add it as is
            processed_payloads.append(original_payload)
            
    return processed_payloads

def build_fresh_context(cur, user_id, current_event):
    """Build complete context for one UI tree event with FRESH data - matching frontend format exactly"""
    # current_event structure: id, user_id, session_id, created_at, payload (5 fields)
    current_timestamp = current_event[3]  # created_at
    window_title = get_window_title(current_event)
    
    context = {
        'currentWindowTitle': window_title
    }
    
    # Match frontend contextConfig defaults:
    # includeCurrentUiTree: true
    current_ui_tree_str = current_event[4].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
    if current_ui_tree_str:
        context['currentUiTree_structure'] = "The UI tree is a simplified representation of the accessibility tree. Each line has the format: 'LineNumber. RomanNumeralIndentation. [Role] 'Name' {Attributes}'."
        context['currentUiTree'] = generate_simplified_ui_tree_string(current_ui_tree_str)
    
    # Get previous UI tree by timestamp for other context
    previous_event = get_previous_ui_tree_by_timestamp(cur, user_id, current_timestamp)
    previous_same_window = get_previous_same_window_ui_tree(cur, user_id, current_timestamp, window_title)
    
    # Conditionally include screenshots based on the feature flag
    if INCLUDE_SCREENSHOTS_IN_CONTEXT:
        # ALWAYS try to get screenshots for all three types (matching frontend logic)
        
        # includeScreenshots: true (screenshotBefore - previous UI tree by timestamp)
        # This is disabled to further reduce context size.
        # if previous_event:
        #     prev_screenshot = get_screenshot_for_ui_tree_event(cur, user_id, previous_event[2], previous_event[3])  # session_id, created_at in 5-field structure
        #     if prev_screenshot:
        #         context['screenshotBefore'] = prev_screenshot
        
        # includeScreenshots: true (screenshotBeforeSameWindow - previous same window UI tree)
        if previous_same_window:
            same_window_screenshot = get_screenshot_for_ui_tree_event(cur, user_id, previous_same_window[2], previous_same_window[3])  # session_id, created_at in 5-field structure
            if same_window_screenshot:
                context['screenshotBeforeSameWindow'] = same_window_screenshot
        
        # includeLatestScreenshot: true (screenshotAfter - current UI tree)
        current_screenshot = get_screenshot_for_ui_tree_event(cur, user_id, current_event[2], current_event[3])  # session_id, created_at in 5-field structure
        if current_screenshot:
            context['screenshotAfter'] = current_screenshot
    
    # Now handle other context fields that depend on previous_event
    if previous_event:
        # includePreviousWindowTitle: true
        context['previousWindowTitle'] = get_window_title(previous_event)
        context['previousWindowTimestamp'] = format_timestamp_like_frontend(previous_event[3])  # created_at in 5-field structure
        
        # includeEventsSincePreviousUiTree: true
        events_between = get_events_between_timestamps(cur, user_id, previous_event[3], current_timestamp)  # created_at in 5-field structure
        if events_between:
            processed_events = process_and_filter_intermediate_events(events_between)
            if processed_events:
                context['eventsSincePreviousUiTreeByTimestamp'] = processed_events
    
    # Handle same window context fields
    if previous_same_window:
        # includeEventsSinceSameWindowUiTree: true
        events_same_window = get_events_between_timestamps(cur, user_id, previous_same_window[3], current_timestamp)  # created_at in 5-field structure
        if events_same_window:
            processed_events = process_and_filter_intermediate_events(events_same_window)
            if processed_events:
                context['eventsSincePreviousUiTreeBySameWindow'] = processed_events
    
    # includeUiTreeDiff: true - CRITICAL FIELD! (Match frontend logic exactly)
    if current_ui_tree_str and previous_same_window:
        previous_same_window_ui_tree_str = previous_same_window[4].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')  # payload in 5-field structure
        if previous_same_window_ui_tree_str:
            # Frontend logic: preprocessTree(oldTree) and preprocessTree(newTree), then diffLines()
            # We need to diff the RAW JSON trees, not the simplified strings!
            diff_result = simple_ui_tree_diff(previous_same_window_ui_tree_str, current_ui_tree_str)
            if diff_result:
                context['uiTreeDiffLatestVsPreviousForTheSameWindow'] = diff_result
    
    # includePreviousAnalyses: true
    recent_analyses = get_recent_analyses(cur, user_id, 10)
    if recent_analyses:
        # Build the full previousAnalyses first
        full_previous_analyses = []
        for analysis in recent_analyses[:3]:  # Limit to 3 most recent
            # analysis structure: id, user_id, session_id, llm_structured_output, created_at, client_timestamp
            llm_output = analysis[3] if analysis[3] else {}  # llm_structured_output JSONB
            
            full_previous_analyses.append({
                'step_title': llm_output.get('step_title', 'Not available in data'),
                'step_summary': llm_output.get('step_summary', 'Not available in data'),
                'user_intent': llm_output.get('user_intent', 'Not available in data'),
                'what_was_clicked': llm_output.get('what_was_clicked', 'Not available in data'),
                'what_was_typed': llm_output.get('what_was_typed', 'Not available in data'),
                'how_content_changed': llm_output.get('how_content_changed', 'Not available in data'),
                'events_that_happened': llm_output.get('events_that_happened', 'Not available in data'),
                'results_if_any': llm_output.get('results_if_any', 'Not available in data'),
                'client_timestamp': analysis[5].isoformat() if analysis[5] else None  # client_timestamp
            })
        
        # Convert to string and truncate the TOTAL length to 300 characters
        analyses_str = str(full_previous_analyses)
        if len(analyses_str) > 300:
            context['previousAnalyses'] = analyses_str[:300] + '... (truncated)'
        else:
            context['previousAnalyses'] = full_previous_analyses
    
    # Note: The following are NOT included because frontend contextConfig has them as false:
    # - includePreviousUiTree: false (so no previousUiTree field)
    # - includePreviousSameWindowUiTree: false (so no previous same window UI tree)
    # - includeGoodExamples: false
    # - includeBadExamples: false
    
    # Generate metadata about what context was actually provided
    context_metadata = generate_context_metadata(context)
    
    return context, context_metadata

def has_more_unprocessed_events(cur, user_id):
    """Check if user has more unprocessed events"""
    cur.execute("""
        SELECT COUNT(*)
        FROM low_level_events_enriched
        WHERE user_id = %s
          AND event_type = 'ui_tree'
          AND NOT EXISTS (
              SELECT 1 FROM low_level_workflow_analyses llwa
              WHERE llwa.user_id = low_level_events_enriched.user_id
                AND llwa.client_timestamp = low_level_events_enriched.created_at
          );
    """, (user_id,))
    count = cur.fetchone()[0]
    return count > 0

def log_llm_trace(cur, conn, user_id, session_id, analysis_id, call_type, model_name, 
                  raw_input, raw_output, structured_output, processing_time_ms, 
                  tokens_input, tokens_output, cost_usd, status, error_message=None, 
                  context_metadata=None):
    """Log comprehensive LLM trace information"""
    try:
        request_id = str(uuid.uuid4())
        client_timestamp = datetime.now()
        response_timestamp = datetime.now()
        
        # Calculate total tokens
        tokens_total = (tokens_input or 0) + (tokens_output or 0)
        
        # Build metadata
        metadata = {
            'context_richness_score': context_metadata.get('context_richness_score', 0) if context_metadata else 0,
            'screenshot_count': context_metadata.get('screenshot_count', 0) if context_metadata else 0,
            'events_count': (context_metadata.get('eventsSincePreviousUiTreeByTimestamp_count', 0) + 
                           context_metadata.get('eventsSincePreviousUiTreeBySameWindow_count', 0)) if context_metadata else 0,
            'previous_analyses_count': context_metadata.get('previousAnalyses_count', 0) if context_metadata else 0,
        }
        
        cur.execute("""
            INSERT INTO llm_traces 
            (analysis_id, user_id, session_id, call_type, model_name, provider,
             raw_input, raw_output, structured_output, processing_time_ms,
             tokens_input, tokens_output, tokens_total, cost_usd, status, error_message,
             request_id, client_timestamp, response_timestamp, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            analysis_id, user_id, session_id, call_type, model_name, 'google',
            json.dumps(raw_input), json.dumps(raw_output) if raw_output else None,
            json.dumps(structured_output) if structured_output else None, processing_time_ms,
            tokens_input, tokens_output, tokens_total, cost_usd, status, error_message,
            request_id, client_timestamp, response_timestamp, json.dumps(metadata)
        ))
        
        trace_id = cur.fetchone()[0]
        conn.commit()
        print(f"✅ Logged LLM trace {trace_id} for {call_type}")
        return trace_id
        
    except Exception as e:
        print(f"❌ Failed to log LLM trace: {e}")
        return None

def estimate_cost_usd(model_name, tokens_input, tokens_output):
    """Estimate cost based on model pricing (approximate)"""
    # Pricing per 1M tokens (as of 2024)
    pricing = {
        'gemini-2.5-pro': {'input': 3.50, 'output': 10.50},  # Per 1M tokens (stable Vertex AI model)
        'gemini-2.5-flash': {'input': 0.075, 'output': 0.30},  # Per 1M tokens (stable Vertex AI model)
        'gpt-4o': {'input': 2.50, 'output': 10.00},
        'gpt-4o-mini': {'input': 0.15, 'output': 0.60},
    }
    
    if model_name not in pricing:
        return None
    
    input_cost = (tokens_input or 0) * pricing[model_name]['input'] / 1_000_000
    output_cost = (tokens_output or 0) * pricing[model_name]['output'] / 1_000_000
    
    return round(input_cost + output_cost, 6)

def log_truncated_context(context, context_name="LLM Context"):
    """Logs the context dictionary with long string values truncated."""
    print(f"--- {context_name.upper()} REVIEW ---")
    for key, value in context.items():
        if isinstance(value, str) and len(value) > 300:
            print(f"  -> {key}: {value[:300]}... (truncated, total length: {len(value)})")
        elif isinstance(value, list) and len(value) > 3:
             print(f"  -> {key}: (list of {len(value)} items, showing first 3)")
             for i, item in enumerate(value[:3]):
                 log_truncated_context(item, f"Item {i+1}")
        else:
            print(f"  -> {key}: {value}")
    print(f"--- END {context_name.upper()} ---")

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret"),
        modal.Secret.from_name("custom-secret")  # For VERCEL_URL
    ],
    timeout=3600,  # 60 minutes for processing all events for a user (reduced to prevent overlaps)
    retries=0  # No automatic retries to prevent duplicates
)
def process_all_events_for_user(user_id: str):
    """
    Process ALL remaining unprocessed events for a specific user sequentially.
    This is much more efficient than processing one event at a time.
    """
    processor_id = f"processor-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    print(f"🚀 Starting FULL processor {processor_id} for user: {user_id}")
    
    conn = None
    cur = None
    total_processed = 0
    
    try:
        # Connect to database
        conn = get_database_connection()
        cur = conn.cursor()
        
        # === GRACEFUL SHUTDOWN: Register this processor ===
        register_processor(processor_id, conn, user_id)
        
        # Clean up expired locks (table already exists in production)
        cur.execute("DELETE FROM processing_locks WHERE expires_at < NOW();")
        conn.commit()
        
        # Additional smart cleanup
        cleanup_expired_locks(cur, conn)

        # === EDGE CASE VERIFICATION: Test function for this specific user ===
        if user_id == 'cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9':  # Matt's ID
            print(f"🧪 INDIVIDUAL PROCESSOR FUNCTION TEST for Matt:")
            cur.execute("""
                SELECT COUNT(*)
                FROM low_level_events_enriched
                WHERE user_id = %s
                  AND event_type = 'ui_tree'
                  AND NOT EXISTS (
                      SELECT 1 FROM low_level_workflow_analyses llwa
                      WHERE llwa.user_id = low_level_events_enriched.user_id
                        AND llwa.client_timestamp = low_level_events_enriched.created_at
                  )
            """, (user_id,))
            processor_result = cur.fetchone()[0]
            print(f"  Individual processor sees: {processor_result} unprocessed events")
            if processor_result == 0:
                print(f"  ❌ PROCESSOR CACHE ISSUE: Should see 26 events!")
            else:
                print(f"  ✅ Processor sees events correctly")

        # Define retry logic variables
        base_retry_delay_seconds = 60
        max_retries = 6
        
        # Process events in a loop until no more remain
        while True:
            # === HEARTBEAT: Update heartbeat every event to show processor is alive ===
            if total_processed % 5 == 0:  # Update heartbeat every 5 events to reduce DB load
                update_heartbeat(conn, processor_id)
            
            # Check for shutdown signal
            if shutdown_requested.is_set():
                print(f"🛑 Shutdown signal received. Exiting processor {processor_id}.")
                unregister_processor(processor_id)
                return {
                    "success": False,
                    "message": "Shutdown signal received",
                    "user_id": user_id,
                    "total_processed": total_processed,
                    "processor_id": processor_id
                }
            
            # Get next event with lock
            event = get_next_unprocessed_event_with_lock(cur, conn, user_id, processor_id)
            
            if not event:
                print(f"✅ No more unprocessed events for user: {user_id} (processed {total_processed} events)")
                break
            
            event_id, user_id, session_id, created_at, payload = event
            print(f"🔄 Processing event {total_processed + 1} (ID: {event_id}) for user {user_id}")
            
            # Inner loop for retries
            retries = 0
            event_processed_or_failed = False
            while not event_processed_or_failed and retries < max_retries:
                # Double-check if event was already processed (race condition protection)
                if is_event_already_processed(cur, user_id, created_at.isoformat()):
                    print(f"⏭️  Event {event_id} already processed, skipping")
                    release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['COMPLETED'])
                    event_processed_or_failed = True
                    continue # Continues the inner while loop, which will exit and go to the next event
            
                try:
                    # Build FRESH context including all previous analyses
                    context, context_metadata = build_fresh_context(cur, user_id, event)
                    
                    log_truncated_context(context, f"Context for Event {event_id}")

                    # Prepare LLM API call
                    model_name = 'gemini-2.5-pro'  # Default model (was: gemini-2.5-pro-preview-06-05)
                    api_payload = {
                        'prompt': 'WORKFLOW_STEP_ANALYSIS_V2_PROMPT',  # This will be overridden by the API
                        'model': model_name,
                        'context': context
                    }
                    
                    # Record start time for performance tracking
                    start_time = time.time()
                    
                    print(f"Calling LLM API for event {event_id}...")
                    response = requests.post(
                        "https://app.mediar.ai/api/process-workflow-step",  # Use production URL
                        json=api_payload,
                        headers={'Content-Type': 'application/json'},
                        timeout=300  # 5 minute timeout
                    )

                    # Handle 429 rate limit with backoff
                    if response.status_code == 429:
                        retries += 1
                        import random
                        # Calculate delay with exponential backoff and jitter
                        delay = (base_retry_delay_seconds * (2 ** (retries - 1))) + random.uniform(0, 5)
                        print(f"🚨 Rate limit (429) detected for event {event_id}. Retrying in {delay:.1f}s... (Attempt {retries}/{max_retries})")
                        time.sleep(delay)
                        continue # Retries the same event in the inner loop
                    else:
                        # For other errors, raise an exception to be caught below
                        response.raise_for_status()
                    
                    result = response.json()
                    
                    # Calculate processing time
                    end_time = time.time()
                    processing_time_ms = int((end_time - start_time) * 1000)
                    
                    # Extract metrics from response (if available)
                    structured_output = result.get('structured_output')
                    print(f"📝 LLM Response (structured_output): {json.dumps(structured_output, indent=2)}")
                    tokens_input = result.get('usage', {}).get('input_tokens')
                    tokens_output = result.get('usage', {}).get('output_tokens')
                    cost_usd = estimate_cost_usd(model_name, tokens_input, tokens_output)
                    
                    # Save the analysis result
                    if structured_output:
                        window_title = get_window_title(event)
                        print(f"💾 SAVING to DB: analysis for event {event_id} with title '{window_title}'")
                        cur.execute("""
                            INSERT INTO low_level_workflow_analyses 
                            (user_id, session_id, client_timestamp, llm_structured_output, window_title)
                            VALUES (%s, %s, %s, %s, %s)
                            RETURNING id
                        """, (user_id, session_id, created_at.isoformat(), json.dumps(structured_output), window_title))
                        
                        # Get the analysis_id for logging
                        analysis_id = cur.fetchone()[0]
                        conn.commit()
                        
                        # Save context metadata
                        cur.execute("""
                            UPDATE low_level_workflow_analyses 
                            SET context_metadata = %s
                            WHERE id = %s
                        """, (json.dumps(context_metadata), analysis_id))
                        conn.commit()
                        
                        # 🔥 LOG SUCCESSFUL LLM CALL
                        print(f"📊 Logging LLM trace for analysis {analysis_id}...")
                        log_llm_trace(
                            cur, conn, user_id, session_id, analysis_id, 
                            'workflow_analysis', model_name, api_payload, result, 
                            structured_output, processing_time_ms, tokens_input, 
                            tokens_output, cost_usd, 'success', None, context_metadata
                        )
                        
                        total_processed += 1
                        print(f"✅ Successfully processed event {event_id} ({total_processed} total)")
                    else:
                        print(f"❌ No structured output received for event {event_id}")
                        
                        # 🔥 LOG FAILED LLM CALL (no structured output)
                        print(f"📊 Logging failed LLM trace (no structured output)...")
                        log_llm_trace(
                            cur, conn, user_id, session_id, None, 
                            'workflow_analysis', model_name, api_payload, result, 
                            None, processing_time_ms, tokens_input, 
                            tokens_output, cost_usd, 'failed', 'No structured output received', context_metadata
                        )
                    
                    # Release lock with completed status
                    release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['COMPLETED'])
                    event_processed_or_failed = True
                    
                except modal.exception.ClientClosed as modal_error:
                    print(f"🔌 Modal client disconnected for event {event_id}: {modal_error}")
                    
                    # 🔥 LOG MODAL CLIENT FAILURE (if we have LLM context)
                    if 'api_payload' in locals() and 'model_name' in locals():
                        print(f"📊 Logging Modal client failure for LLM call...")
                        processing_time_ms = int((time.time() - start_time) * 1000) if 'start_time' in locals() else None
                        log_llm_trace(
                            cur, conn, user_id, session_id, None, 
                            'workflow_analysis', model_name, api_payload, None, 
                            None, processing_time_ms, None, None, None, 
                            'failed', f'Modal client disconnected: {modal_error}', 
                            context_metadata if 'context_metadata' in locals() else None
                        )
                    
                    # Release lock with failed status - Modal infrastructure failure
                    release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['FAILED'])
                    event_processed_or_failed = True  # Don't retry Modal client failures
                except Exception as event_error:
                    print(f"❌ Error processing event {event_id}: {event_error}")
                    
                    # 🔥 LOG GENERAL LLM FAILURE (if we have LLM context)
                    if 'api_payload' in locals() and 'model_name' in locals():
                        print(f"📊 Logging general failure for LLM call...")
                        processing_time_ms = int((time.time() - start_time) * 1000) if 'start_time' in locals() else None
                        error_type = type(event_error).__name__
                        error_message = f'{error_type}: {str(event_error)}'
                        
                        # Check if this was an HTTP error (API call made but failed)
                        if hasattr(event_error, 'response'):
                            try:
                                response_data = event_error.response.json() if hasattr(event_error.response, 'json') else None
                                status_code = getattr(event_error.response, 'status_code', None)
                                error_message = f'HTTP {status_code}: {error_message}'
                            except:
                                response_data = None
                        else:
                            response_data = None
                            
                        log_llm_trace(
                            cur, conn, user_id, session_id, None, 
                            'workflow_analysis', model_name, api_payload, response_data, 
                            None, processing_time_ms, None, None, None, 
                            'failed', error_message, 
                            context_metadata if 'context_metadata' in locals() else None
                        )
                    
                    # Release lock with failed status
                    release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['FAILED'])
                    event_processed_or_failed = True # Mark as failed to stop retrying this event
            
            # Handle case where max retries are exceeded for an event
            if not event_processed_or_failed and retries >= max_retries:
                print(f"❌ Max retries ({max_retries}) exceeded for event {event_id}. Marking as failed.")
                release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['FAILED'])
        
        # Final success message
        print(f"✅ Successfully processed {total_processed} events for user: {user_id}")
        
        # === GRACEFUL SHUTDOWN: Unregister processor on success ===
        unregister_processor(processor_id)
        
        return {
            "success": True,
            "message": f"Processed {total_processed} events",
            "user_id": user_id,
            "total_processed": total_processed,
            "processor_id": processor_id
        }
        
    except Exception as e:
        print(f"❌ Error processing events for user {user_id}: {e}")
        
        # Release any remaining locks
        if conn and cur:
            try:
                # Clean up any locks for this processor
                cur.execute("""
                    UPDATE processing_locks 
                    SET status = 'failed', updated_at = NOW(), expires_at = NOW()
                    WHERE processor_id = %s AND status = 'in_progress'
                """, (processor_id,))
                conn.commit()
            except:
                pass
        
        # === GRACEFUL SHUTDOWN: Unregister processor on error ===
        unregister_processor(processor_id)
        
        return {
            "success": False,
            "error": str(e),
            "user_id": user_id,
            "total_processed": total_processed,
            "processor_id": processor_id
        }
        
    finally:
        # === GRACEFUL SHUTDOWN: Ensure processor is unregistered ===
        unregister_processor(processor_id)
        
        if cur:
            cur.close()
        if conn:
            conn.close()

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret"),
        modal.Secret.from_name("custom-secret")  # For VERCEL_URL
    ],
    schedule=modal.Period(minutes=1),   # Changed from 60 to 1 minute for faster processing  
    timeout=2000   # FIXED: Increased from 45 to 2000 seconds (33+ minutes) to accommodate full processing cycle
)
def scheduled_processing():
    """
    Automatically find and process ALL events for all users every 60 minutes.
    Uses the efficient full parallel processing approach with better conflict prevention.
    """
    print("🔄 Starting scheduled FULL parallel processing...")
    
    # Verify edge case fix is working
    print("🧪 Verifying edge case function fix...")
    if not verify_function_edge_case_fix():
        print("❌ EDGE CASE FUNCTION VERIFICATION FAILED!")
    
    try:
        # Check current processor load before spawning more
        conn = get_database_connection()
        cur = conn.cursor()
        
        # === HEARTBEAT MECHANISM: Check for stuck processors first ===
        print("💓 Checking for stuck processors...")
        stuck_processors = detect_stuck_processors(conn, stale_threshold_minutes=15)
        if stuck_processors:
            cleaned_count = cleanup_stuck_processors(conn, stuck_processors)
            print(f"🧹 Cleaned {cleaned_count} stuck processors before starting new cycle")
        
        # Count active processors (excluding the ones we just cleaned)
        cur.execute("""
            SELECT COUNT(DISTINCT processor_id) as active_processors
            FROM processing_locks 
            WHERE status = 'in_progress' AND expires_at > NOW()
        """)
        active_count = cur.fetchone()[0]
        
        # More conservative limit to prevent Modal cancellations
        MAX_CONCURRENT_PROCESSORS = 20  # Reduced from 50 to prevent resource conflicts
        
        if active_count >= MAX_CONCURRENT_PROCESSORS:
            print(f"⏸️  {active_count} processors already active (max: {MAX_CONCURRENT_PROCESSORS}), skipping this cycle")
            return {"success": True, "message": "Skipped due to active processors", "active_processors": active_count}
        
        print(f"📊 Active processors: {active_count}/{MAX_CONCURRENT_PROCESSORS}")
        
        # 🧹 CLEAN UP STALE COORDINATOR LOCKS BEFORE CHECKING
        print("🧹 Cleaning up stale coordinator locks...")
        cur.execute("""
            UPDATE processing_locks 
            SET status = 'failed', updated_at = NOW()
            WHERE processor_id LIKE 'full-coordinator-%' 
            AND (
                expires_at < NOW() 
                OR (NOW() - updated_at) > INTERVAL '5 minutes'
                OR status = 'completed'
            )
            RETURNING processor_id
        """)
        
        cleaned_coordinators = cur.fetchall()
        if cleaned_coordinators:
            print(f"🧹 Cleaned up {len(cleaned_coordinators)} stale coordinator locks")
            for (processor_id,) in cleaned_coordinators:
                print(f"  - {processor_id}")
        else:
            print("✅ No stale coordinator locks found")
        
        conn.commit()
        
        # Check if any scheduled processing is already running
        cur.execute("""
            SELECT COUNT(*) FROM processing_locks 
            WHERE processor_id LIKE 'full-coordinator-%' 
            AND status = 'in_progress' 
            AND expires_at > NOW()
        """)
        coordinator_count = cur.fetchone()[0]
        
        if coordinator_count > 0:
            print(f"⏸️  Coordinator already running ({coordinator_count} active), skipping to prevent conflicts")
            cur.close()
            conn.close()
            return {"success": True, "message": "Skipped due to active coordinator", "active_coordinators": coordinator_count}
        
        cur.close()
        conn.close()
        
        # Use efficient FULL parallel processing approach
        result = trigger_full_parallel_processing.remote()
        print(f"✅ Scheduled FULL parallel processing completed: {result}")
        return result
    except Exception as e:
        print(f"❌ Error in scheduled processing: {e}")
        return {"success": False, "error": str(e)}

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=1800
)
def trigger_full_parallel_processing():
    """
    Manually trigger full parallel processing for ALL users with unprocessed events.
    Each user gets their own processor that handles ALL their remaining events.
    """
    coordinator_id = f"full-coordinator-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    print(f"🎯 Starting FULL PARALLEL coordinator {coordinator_id}")
    
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Acquire coordinator lock to prevent multiple instances
        try:
            cur.execute("""
                INSERT INTO processing_locks (user_id, event_id, processor_id, status, expires_at)
                VALUES ('coordinator', 0, %s, %s, NOW() + INTERVAL '2 minutes')
                ON CONFLICT (user_id, event_id) DO NOTHING
                RETURNING id
            """, (coordinator_id, PROCESSING_STATUS['IN_PROGRESS']))
            
            if not cur.fetchone():
                print(f"⏸️  Another coordinator is already running, skipping")
                return {"success": True, "message": "Skipped due to active coordinator", "coordinator_id": coordinator_id}
            
            conn.commit()
            print(f"🔒 Acquired coordinator lock: {coordinator_id}")
        except Exception as lock_error:
            print(f"❌ Failed to acquire coordinator lock: {lock_error}")
            return {"success": False, "error": f"Failed to acquire coordinator lock: {lock_error}"}
        
        # Clean up expired locks (table already exists in production)
        cur.execute("DELETE FROM processing_locks WHERE expires_at < NOW();")
        conn.commit()
        
        # Smart cleanup of expired, stale, and problematic locks
        cleaned_basic = cleanup_expired_locks(cur, conn)
        cleaned_validation = smart_lock_validation(cur, conn)
        total_cleaned = cleaned_basic + cleaned_validation
        
        if total_cleaned > 0:
            print(f"🔧 Total smart cleanup: {total_cleaned} locks removed")
        
        # Find ALL users with unprocessed events using a more efficient and accurate query
        cur.execute("""
            WITH user_event_counts AS (
                SELECT 
                    user_id, 
                    COUNT(*) as event_count
                FROM low_level_events
                WHERE payload->'payload'->>'type' = 'ui_tree'
                GROUP BY user_id
            ),
            user_analysis_counts AS (
                SELECT 
                    user_id,
                    COUNT(*) as analysis_count
                FROM low_level_workflow_analyses
                GROUP BY user_id
            )
            SELECT uec.user_id::text
            FROM user_event_counts uec
            LEFT JOIN user_analysis_counts uac ON uec.user_id = uac.user_id
            WHERE uec.event_count > COALESCE(uac.analysis_count, 0)
              AND uec.user_id::text NOT IN (
                  SELECT DISTINCT user_id FROM processing_locks 
                  WHERE status = 'in_progress' AND expires_at > NOW()
              )
            ORDER BY uec.user_id;
        """)
        
        users = [row[0] for row in cur.fetchall()]
        print(f"📋 Found {len(users)} users with unprocessed events - starting FULL parallel processing")
        
        cur.close()
        conn.close()
        
        # Trigger ALL users in parallel (no limits)
        results = []
        for user_id in users:
            try:
                print(f"🚀 Launching FULL processor for user: {user_id}")
                
                # Trigger processing ALL events for this user
                result = process_all_events_for_user.remote(user_id)
                results.append({
                    "user_id": user_id,
                    "status": "launched",
                    "result": result
                })
                
            except Exception as e:
                print(f"❌ Failed to launch processor for user {user_id}: {e}")
                results.append({
                    "user_id": user_id,
                    "status": "failed",
                    "error": str(e)
                })
        
        # Release coordinator lock
        try:
            cur.execute("""
                DELETE FROM processing_locks 
                WHERE user_id = 'coordinator' AND event_id = 0 AND processor_id = %s
            """, (coordinator_id,))
            conn.commit()
            print(f"🔓 Released coordinator lock: {coordinator_id}")
        except Exception as unlock_error:
            print(f"❌ Failed to release coordinator lock: {unlock_error}")
        
        return {
            "success": True,
            "message": f"Launched FULL parallel processing for {len(users)} users",
            "coordinator_id": coordinator_id,
            "users_launched": len([r for r in results if r["status"] == "launched"]),
            "users_failed": len([r for r in results if r["status"] == "failed"]),
            "results": results
        }
        
    except Exception as e:
        print(f"❌ Error in FULL parallel coordinator: {e}")
        
        # Release coordinator lock on error
        try:
            if 'cur' in locals() and cur and 'conn' in locals() and conn:
                cur.execute("""
                    DELETE FROM processing_locks 
                    WHERE user_id = 'coordinator' AND event_id = 0 AND processor_id = %s
                """, (coordinator_id,))
                conn.commit()
                print(f"🔓 Released coordinator lock on error: {coordinator_id}")
        except Exception as unlock_error:
            print(f"❌ Failed to release coordinator lock on error: {unlock_error}")
        
        return {
            "success": False,
            "error": str(e),
            "coordinator_id": coordinator_id
        }

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=1800
)
def emergency_cleanup_all_processing_locks():
    """Emergency function to clean up ALL processing locks - use with caution!"""
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Get count before cleanup for reporting
        cur.execute("SELECT COUNT(*) FROM processing_locks WHERE status = 'in_progress'")
        before_count = cur.fetchone()[0]
        
        # Emergency cleanup
        cleaned_count = emergency_cleanup_all_locks(cur, conn)
        
        return {
            "success": True,
            "message": f"Emergency cleanup completed",
            "locks_before": before_count,
            "locks_cleaned": cleaned_count,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close()

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=1800
)
def get_processing_status():
    """Get current processing status and statistics"""
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Get processing statistics
        cur.execute("""
            SELECT 
                status,
                COUNT(*) as count,
                COUNT(DISTINCT user_id) as unique_users
            FROM processing_locks 
            WHERE expires_at > NOW()
            GROUP BY status
            ORDER BY status
        """)
        
        status_stats = {}
        for row in cur.fetchall():
            status, count, unique_users = row
            status_stats[status] = {
                "count": count,
                "unique_users": unique_users
            }
        
        # Get unprocessed events count
        cur.execute("""
            SELECT COUNT(DISTINCT user_id) as users_with_unprocessed
            FROM low_level_events 
            WHERE payload->'payload'->>'type' = 'ui_tree'
              AND id NOT IN (
                  SELECT DISTINCT lle.id
                  FROM low_level_events lle
                  INNER JOIN low_level_workflow_analyses llwa 
                  ON lle.created_at = llwa.client_timestamp 
                  AND lle.user_id = llwa.user_id
              )
        """)
        
        unprocessed_users = cur.fetchone()[0]
        
        return {
            "processing_status": status_stats,
            "users_with_unprocessed_events": unprocessed_users,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close() 

# === HEARTBEAT MECHANISM FOR STUCK PROCESSOR DETECTION ===

def update_heartbeat(conn, processor_id):
    """Update heartbeat (updated_at) for an active processor to show it's still alive"""
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE processing_locks 
            SET updated_at = NOW() 
            WHERE processor_id = %s AND status = 'in_progress'
        """, (processor_id,))
        affected = cur.rowcount
        conn.commit()
        if affected > 0:
            print(f"💓 Heartbeat updated for processor {processor_id}")
        cur.close()
        return affected > 0
    except Exception as e:
        print(f"❌ Failed to update heartbeat for {processor_id}: {e}")
        return False

def detect_stuck_processors(conn, stale_threshold_minutes=15):
    """
    Detect processors that haven't sent a heartbeat in the specified time.
    Returns list of stuck processor info.
    """
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT processor_id, user_id, event_id, created_at, updated_at,
                   EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 60 as minutes_stale
            FROM processing_locks 
            WHERE status = 'in_progress' 
            AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '%s minutes'
            ORDER BY minutes_stale DESC
        """, (stale_threshold_minutes,))
        
        stuck_processors = cur.fetchall()
        cur.close()
        
        if stuck_processors:
            print(f"⚠️  Found {len(stuck_processors)} stuck processors (no heartbeat for >{stale_threshold_minutes}m):")
            for proc in stuck_processors:
                processor_id, user_id, event_id, created_at, updated_at, minutes_stale = proc
                print(f"   - {processor_id}: user {user_id}, stale for {minutes_stale:.1f}m")
        
        return stuck_processors
    except Exception as e:
        print(f"❌ Error detecting stuck processors: {e}")
        return []

def cleanup_stuck_processors(conn, stuck_processors):
    """
    Clean up processors that are truly stuck (no heartbeat for extended period).
    Marks them as failed and releases their locks.
    """
    cleaned_count = 0
    try:
        cur = conn.cursor()
        
        for proc in stuck_processors:
            processor_id, user_id, event_id, created_at, updated_at, minutes_stale = proc
            
            # Mark as failed with detailed reason
            cur.execute("""
                UPDATE processing_locks 
                SET status = 'failed', 
                    updated_at = NOW(),
                    expires_at = NOW()  -- Immediately expire
                WHERE processor_id = %s AND status = 'in_progress'
            """, (processor_id,))
            
            if cur.rowcount > 0:
                cleaned_count += 1
                print(f"🧹 Cleaned stuck processor {processor_id} (stale for {minutes_stale:.1f}m)")
        
        conn.commit()
        cur.close()
        
        if cleaned_count > 0:
            print(f"✅ Cleaned up {cleaned_count} stuck processors")
        
        return cleaned_count
    except Exception as e:
        print(f"❌ Error cleaning stuck processors: {e}")
        return 0

# === END HEARTBEAT MECHANISM ===

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=1800
)
def emergency_cleanup_stuck_processors():
    """Emergency function to clean up stuck processors - use with caution!"""
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Get count before cleanup for reporting
        cur.execute("SELECT COUNT(*) FROM processing_locks WHERE status = 'in_progress'")
        before_count = cur.fetchone()[0]
        
        # Detect stuck processors
        stuck_processors = detect_stuck_processors(conn)
        
        # Clean up stuck processors
        cleaned_count = cleanup_stuck_processors(conn, stuck_processors)
        
        return {
            "success": True,
            "message": f"Emergency cleanup completed",
            "locks_before": before_count,
            "locks_cleaned": cleaned_count,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close()