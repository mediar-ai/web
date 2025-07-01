import psycopg2
import json
from datetime import datetime

# Database connection configuration
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': 'dS64xX6mU3E4Sbyc'
}

# Load workflow from file
with open('workflows/bestplanpro_quoting/workflow.json', 'r') as f:
    data = json.load(f)
    workflow = data['workflow']

# Convert steps to database format
automation_sequence = []
for step in workflow['steps']:
    db_step = {}
    
    # Basic fields
    if 'step' in step:
        db_step['step_number'] = step['step']
    
    # Map actions
    action_map = {
        'navigate_browser': 'navigate',
        'click_element': 'click',
        'type_into_element': 'fill_input',
        'wait_for_element': 'wait_for_element',
        'delay': 'wait',
        'set_selected': 'click',
        'invoke_element': 'click',
        'get_focused_window_tree': 'extract_data'
    }
    db_step['action'] = action_map.get(step['action'], step['action'])
    
    if 'description' in step:
        db_step['description'] = step['description']
    
    if 'selector' in step and step['selector']:
        db_step['selector'] = step['selector']
        
    # Parameters
    params = step.get('parameters', {})
    if 'url' in params:
        db_step['url'] = params['url']
    if 'text_to_type' in params:
        db_step['value'] = params['text_to_type']
    if params.get('clear_before_typing'):
        db_step['clear_before'] = True
    if 'timeout_ms' in params:
        db_step['timeout'] = params['timeout_ms']
    if 'delay_ms' in params:
        db_step['wait_after'] = params['delay_ms']
    if 'condition' in params:
        db_step['condition'] = params['condition']
    
    # Alternative selectors
    if 'alternative_selectors' in step:
        alt = step['alternative_selectors']
        db_step['alternative_selectors'] = [alt] if isinstance(alt, str) else alt
    
    # Other fields
    if 'expected_result' in step:
        db_step['expected_result'] = step['expected_result']
    if step.get('optional'):
        db_step['optional'] = True
    if 'note' in step:
        db_step['note'] = step['note']
    
    automation_sequence.append(db_step)

# Use existing validation_checks and error_handling from the database
# (since they're not in the local workflow.json file)

# Connect and update
conn = psycopg2.connect(**DB_CONFIG)
cur = conn.cursor()

try:
    # Just update the automation_sequence
    cur.execute("""
        UPDATE deployed_workflows 
        SET automation_sequence = %s
        WHERE id = 1
    """, (json.dumps(automation_sequence),))
    
    conn.commit()
    print(f"✅ Successfully updated workflow with {len(automation_sequence)} steps")
    
    # Verify
    cur.execute("SELECT automation_sequence FROM deployed_workflows WHERE id = 1")
    result = cur.fetchone()
    if result:
        steps = result[0]
        print(f"✅ Verified: Database now has {len(steps)} steps")
        
except Exception as e:
    print(f"❌ Error: {e}")
    conn.rollback()
finally:
    cur.close()
    conn.close()
