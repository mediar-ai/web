import modal
import os
import psycopg2
import json
import requests
from datetime import datetime, timedelta, timezone
import uuid
import time
import difflib

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
    'password': '***REMOVED***'
}

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
            VALUES (%s, %s, %s, %s, NOW() + INTERVAL '30 minutes')
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
        # First, clean up obviously expired/completed locks
        cur.execute("""
            DELETE FROM processing_locks 
            WHERE expires_at < NOW() OR status IN ('completed', 'failed')
        """)
        basic_cleanup = cur.rowcount
        
        # Smart cleanup: Remove locks older than 10 minutes (instead of 30)
        # This handles cases where Modal apps are stopped manually
        cur.execute("""
            DELETE FROM processing_locks 
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
        # Get next unprocessed UI tree event
        cur.execute("""
            SELECT id, user_id, session_id, created_at, payload
            FROM low_level_events 
            WHERE user_id = %s 
              AND payload->'payload'->>'type' = 'ui_tree'
              AND id NOT IN (
                  SELECT DISTINCT lle.id
                  FROM low_level_events lle
                  INNER JOIN low_level_workflow_analyses llwa 
                  ON lle.created_at = llwa.client_timestamp 
                  AND lle.user_id = llwa.user_id
                  WHERE lle.user_id = %s
              )
              AND id NOT IN (
                  SELECT event_id FROM processing_locks 
                  WHERE user_id = %s AND (
                      (status = 'in_progress' AND expires_at > NOW()) OR
                      status = 'failed'
                  )
              )
            ORDER BY created_at ASC
            LIMIT 1
        """, (user_id, user_id, user_id))
        
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
        FROM public.get_unprocessed_ui_tree_events(p_user_id := %s)
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
        FROM low_level_events 
        WHERE user_id = %s 
          AND payload->'payload'->>'type' = 'ui_tree'
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
        FROM low_level_events 
        WHERE user_id = %s 
          AND payload->'payload'->>'type' = 'ui_tree'
          AND created_at < %s
          AND created_at > %s - INTERVAL '10 minutes' -- Limit lookback
          AND COALESCE(
            (payload->'payload'->'event'->'screen'->>'ui_tree')::jsonb->'attributes'->>'name',
            payload->'payload'->'event'->>'app_name'
          ) = %s
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
                 (payload->'payload'->'event'->'screenshot_diff'->>'after_timestamp')::timestamp 
                 - %s::timestamp
               ))) as time_diff
        FROM low_level_events
        WHERE user_id = %s
          AND payload->'payload'->>'type' = 'screenshot_diff'
          AND (payload->'payload'->'event'->'screenshot_diff'->>'after_timestamp')::timestamp 
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
    - Truncates ui_tree strings in ui_tree events to 300 characters.
    """
    processed_payloads = []
    for event in events:
        # The full event payload from the DB is the 5th element (index 4)
        original_payload = event[4].get('payload', {})
        event_type = original_payload.get('type')

        if event_type == 'screenshot_diff':
            continue  # Ignore screenshot_diff events entirely

        if event_type == 'ui_tree':
            try:
                ui_tree_str = original_payload.get('event', {}).get('screen', {}).get('ui_tree')
                if ui_tree_str and isinstance(ui_tree_str, str) and len(ui_tree_str) > 300:
                    import copy
                    payload_to_add = copy.deepcopy(original_payload)
                    truncated_tree = ui_tree_str[:300] + '... (truncated)'
                    payload_to_add['event']['screen']['ui_tree'] = truncated_tree
                    processed_payloads.append(payload_to_add)
                else:
                    # No truncation needed, add original payload
                    processed_payloads.append(original_payload)
            except Exception as e:
                print(f"Warning: Could not process intermediate ui_tree. Error: {e}")
                processed_payloads.append(original_payload) # Fallback
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
        SELECT COUNT(*) FROM public.get_unprocessed_ui_tree_events(p_user_id := %s);
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
        
        # Clean up expired locks (table already exists in production)
        cur.execute("DELETE FROM processing_locks WHERE expires_at < NOW();")
        conn.commit()
        
        # Additional smart cleanup
        cleanup_expired_locks(cur, conn)

        # Define retry logic variables
        base_retry_delay_seconds = 60
        max_retries = 6
        
        # Process events in a loop until no more remain
        while True:
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
                        """, (user_id, session_id, created_at.isoformat(), json.dumps(structured_output), window_title))
                        conn.commit()
                        
                        # Save context metadata
                        cur.execute("""
                            UPDATE low_level_workflow_analyses 
                            SET context_metadata = %s
                            WHERE user_id = %s AND client_timestamp = %s
                        """, (json.dumps(context_metadata), user_id, created_at.isoformat()))
                        conn.commit()
                        
                        total_processed += 1
                        print(f"✅ Successfully processed event {event_id} ({total_processed} total)")
                    else:
                        print(f"❌ No structured output received for event {event_id}")
                    
                    # Release lock with completed status
                    release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['COMPLETED'])
                    event_processed_or_failed = True
                    
                except Exception as event_error:
                    print(f"❌ Error processing event {event_id}: {event_error}")
                    # Release lock with failed status
                    release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['FAILED'])
                    event_processed_or_failed = True # Mark as failed to stop retrying this event
            
            # Handle case where max retries are exceeded for an event
            if not event_processed_or_failed and retries >= max_retries:
                print(f"❌ Max retries ({max_retries}) exceeded for event {event_id}. Marking as failed.")
                release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['FAILED'])
        
        return {
            "success": True,
            "message": f"Processed all events for user (total: {total_processed})",
            "user_id": user_id,
            "total_processed": total_processed,
            "processor_id": processor_id
        }
        
    except Exception as e:
        print(f"❌ Error processing user {user_id}: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_id": user_id,
            "total_processed": total_processed,
            "processor_id": processor_id
        }
        
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

# DEPRECATED: This function processes only ONE event per user - inefficient
# Use process_all_events_for_user() instead which processes ALL events per user
# @app.function(
#     secrets=[
#         modal.Secret.from_name("supabase-secret"),
#         modal.Secret.from_name("custom-secret")  # For VERCEL_URL
#     ],
#     timeout=1800,  # 30 minutes
#     retries=0  # No automatic retries to prevent duplicates
# )
def process_next_event_for_user_deprecated(user_id: str):
    """
    Process the next unprocessed event for a specific user with duplicate prevention.
    Uses database locks to ensure only one instance processes each event.
    """
    processor_id = f"processor-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    print(f"🚀 Starting processor {processor_id} for user: {user_id}")
    
    conn = None
    cur = None
    event_id = None
    
    try:
        # Connect to database
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Clean up expired locks (table already exists in production) 
        cur.execute("DELETE FROM processing_locks WHERE expires_at < NOW();")
        conn.commit()
        
        # Additional smart cleanup
        cleanup_expired_locks(cur, conn)
        
        # Get next event with lock
        event = get_next_unprocessed_event_with_lock(cur, conn, user_id, processor_id)
        
        if not event:
            print(f"✅ No more unprocessed events for user: {user_id}")
            return {
                "success": True,
                "message": "No unprocessed events",
                "user_id": user_id,
                "processor_id": processor_id
            }
        
        event_id, user_id, session_id, created_at, payload = event
        print(f"🔄 Processing event {event_id} for user {user_id}")
        
        # Double-check if event was already processed (race condition protection)
        if is_event_already_processed(cur, user_id, created_at.isoformat()):
            print(f"⏭️  Event {event_id} already processed, skipping")
            release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['COMPLETED'])
            return {
                "success": True,
                "message": "Event already processed",
                "user_id": user_id,
                "event_id": event_id,
                "processor_id": processor_id
            }
        
        # Build FRESH context including all previous analyses
        context, context_metadata = build_fresh_context(cur, user_id, event)
        context_fields = list(context.keys())
        print(f"Built fresh context for event {event_id} with fields: {context_fields}")
        
        # Generate context metadata for tracking
        context_metadata = generate_context_metadata(context)
        print(f"Context metadata: {context_metadata}")
        
        log_truncated_context(context, f"Context for Event {event_id}")
        
        # Prepare LLM API call
        model_name = 'gemini-2.5-pro'  # Default model (was: gemini-2.5-pro-preview-06-05)
        api_payload = {
            'prompt': 'WORKFLOW_STEP_ANALYSIS_V2_PROMPT',  # This will be overridden by the API
            'model': model_name,
            'context': context
        }
        
        # Debug: Print API payload summary
        print(f"API Payload summary: prompt length={len(api_payload['prompt'])}, model={api_payload['model']}, context_fields={list(api_payload['context'].keys())}")
        
        # Record start time for performance tracking
        start_time = time.time()
        
        # Add small delay to prevent API rate limiting (stagger requests)
        import random
        delay = random.uniform(1, 3)  # 1-3 second random delay
        print(f"⏱️  Adding {delay:.1f}s delay to prevent rate limiting...")
        time.sleep(delay)
        
        print(f"Calling LLM API for event {event_id}...")
        try:
            response = requests.post(
                "https://app.mediar.ai/api/process-workflow-step",  # Use production URL
                json=api_payload,
                headers={'Content-Type': 'application/json'},
                timeout=300  # 5 minute timeout
            )
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
            analysis_id = None
            if structured_output:
                window_title = get_window_title(event)
                print(f"💾 SAVING to DB: analysis for event {event_id} with title '{window_title}'")
                cur.execute("""
                    INSERT INTO low_level_workflow_analyses 
                    (user_id, session_id, client_timestamp, llm_structured_output, window_title)
                    VALUES (%s, %s, %s, %s, %s)
                """, (user_id, session_id, created_at.isoformat(), json.dumps(structured_output), window_title))
                conn.commit()
                print(f"✅ Successfully processed and saved analysis for event {event_id}")
                
                # Save context metadata now that column exists
                cur.execute("""
                    UPDATE low_level_workflow_analyses 
                    SET context_metadata = %s
                    WHERE user_id = %s AND client_timestamp = %s
                """, (json.dumps(context_metadata), user_id, created_at.isoformat()))
                
            else:
                print(f"❌ No structured output received for event {event_id}")
            
            # Log LLM trace (temporarily disabled until migration is applied)
            # log_llm_trace(
            #     cur, conn, user_id, session_id, analysis_id, 
            #     call_type='workflow_analysis',
            #     model_name=model_name,
            #     raw_input={'prompt': api_payload['prompt'], 'context': api_payload['context']},
            #     raw_output=result,
            #     structured_output=structured_output,
            #     processing_time_ms=processing_time_ms,
            #     tokens_input=tokens_input,
            #     tokens_output=tokens_output,
            #     cost_usd=cost_usd,
            #     status='success',
            #     context_metadata=context_metadata
            # )
            
        except Exception as llm_error:
            # Calculate processing time even for errors
            end_time = time.time()
            processing_time_ms = int((end_time - start_time) * 1000)
            
            print(f"❌ LLM API call failed for event {event_id}: {llm_error}")
            
            # Log failed LLM trace
            log_llm_trace(
                cur, conn, user_id, session_id, None, 'workflow_analysis', model_name,
                api_payload, None, None, processing_time_ms,
                None, None, None, 'error', str(llm_error), context_metadata
            )
            
            raise llm_error
        
        # Release lock with completed status
        release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['COMPLETED'])
        
        return {
            "success": True,
            "message": "Event processed successfully",
            "user_id": user_id,
            "event_id": event_id,
            "processor_id": processor_id
        }
        
    except Exception as e:
        print(f"❌ Error processing event for user {user_id}: {e}")
        
        # Release lock with failed status
        if conn and cur and event_id:
            try:
                release_processing_lock(cur, conn, user_id, event_id, processor_id, PROCESSING_STATUS['FAILED'])
            except:
                pass
        
        return {
            "success": False,
            "error": str(e),
            "user_id": user_id,
            "event_id": event_id,
            "processor_id": processor_id
        }
        
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret"),
        modal.Secret.from_name("custom-secret")  # For VERCEL_URL
    ],
    schedule=modal.Period(minutes=60),  # Run every 60 minutes to prevent overlaps
    timeout=1800
)
def scheduled_processing():
    """
    Automatically find and process ALL events for all users every 60 minutes.
    Uses the efficient full parallel processing approach with better conflict prevention.
    """
    print("🔄 Starting scheduled FULL parallel processing...")
    try:
        # Check current processor load before spawning more
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Count active processors
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
                VALUES ('coordinator', 0, %s, %s, NOW() + INTERVAL '30 minutes')
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

# DEPRECATED: This function uses the old inefficient approach
# It triggers process_all_events_for_user() but with concurrency limits
# The scheduled_processing() now calls trigger_full_parallel_processing() directly
# @app.function(
#     secrets=[modal.Secret.from_name("supabase-secret")],
#     timeout=1800
# )
def find_and_trigger_users_with_prevention_deprecated():
    """
    Find users with unprocessed events and trigger sequential processing.
    Includes duplicate prevention to avoid multiple processors for same user.
    """
    processor_id = f"coordinator-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    print(f"🎯 Starting coordinator {processor_id}")
    
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Clean up expired locks (table already exists in production)
        cur.execute("DELETE FROM processing_locks WHERE expires_at < NOW();")
        conn.commit()
        
        # Additional smart cleanup
        cleanup_expired_locks(cur, conn)
        
        # Find users with unprocessed events (not currently being processed)
        cur.execute("""
            SELECT DISTINCT user_id::text 
            FROM low_level_events 
            WHERE payload->'payload'->>'type' = 'ui_tree'
              AND id NOT IN (
                  SELECT DISTINCT lle.id
                  FROM low_level_events lle
                  INNER JOIN low_level_workflow_analyses llwa 
                  ON lle.created_at = llwa.client_timestamp 
                  AND lle.user_id = llwa.user_id
              )
              AND user_id::text NOT IN (
                  SELECT DISTINCT user_id FROM processing_locks 
                  WHERE status = 'in_progress' AND expires_at > NOW()
              )
            ORDER BY user_id
        """)
        
        users = [row[0] for row in cur.fetchall()]
        print(f"📋 Found {len(users)} users with unprocessed events")
        
        # Check current active processors to avoid overload
        cur.execute("""
            SELECT COUNT(DISTINCT processor_id) as active_processors
            FROM processing_locks 
            WHERE status = 'in_progress' AND expires_at > NOW()
        """)
        current_active = cur.fetchone()[0]
        MAX_CONCURRENT = 100  # Allow massive parallel processing
        available_slots = max(0, MAX_CONCURRENT - current_active)
        
        # Limit number of users to process based on available slots
        users_to_process = users[:available_slots] if available_slots > 0 else []
        
        print(f"📊 Active: {current_active}/{MAX_CONCURRENT}, Available slots: {available_slots}, Processing: {len(users_to_process)} users")
        
        results = []
        for user_id in users_to_process:
            try:
                print(f"🚀 Triggering FULL processor for user: {user_id}")
                
                # Trigger processing ALL events for this user
                result = process_all_events_for_user.remote(user_id)
                results.append({
                    "user_id": user_id,
                    "status": "triggered",
                    "result": result
                })
                
            except Exception as e:
                print(f"❌ Failed to trigger processor for user {user_id}: {e}")
                results.append({
                    "user_id": user_id,
                    "status": "failed",
                    "error": str(e)
                })
        
        # Report skipped users due to concurrency limits
        skipped_users = users[available_slots:] if available_slots < len(users) else []
        if skipped_users:
            print(f"⏸️  Skipped {len(skipped_users)} users due to concurrency limits: {skipped_users[:3]}{'...' if len(skipped_users) > 3 else ''}")
        
        return {
            "success": True,
            "message": f"Triggered processors for {len(users)} users",
            "coordinator_id": processor_id,
            "results": results
        }
        
    except Exception as e:
        print(f"❌ Error in coordinator: {e}")
        return {
            "success": False,
            "error": str(e),
            "coordinator_id": processor_id
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