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

def load_local_workflow(filepath='workflows/bestplanpro_quoting/workflow.json'):
    """Load workflow from local file"""
    with open(filepath, 'r') as f:
        data = json.load(f)
    return data

def convert_local_to_db_format(local_workflow):
    """Convert local workflow format to database format"""
    workflow_data = local_workflow['workflow']
    steps = workflow_data['steps']
    automation_sequence = []
    
    # Map local action names to DB action names
    action_mapping = {
        'navigate_browser': 'navigate',
        'click_element': 'click',
        'type_into_element': 'fill_input',
        'wait_for_element': 'wait_for_element',
        'delay': 'wait',
        'set_selected': 'click',  # For radio buttons
        'invoke_element': 'click',
        'get_focused_window_tree': 'extract_data'
    }
    
    for step in steps:
        # Map action
        local_action = step['action']
        db_action = action_mapping.get(local_action, local_action)
        
        db_step = {
            'step_number': step['step'],
            'action': db_action,
            'description': step['description'],
            'selector': step.get('selector')
        }
        
        # Handle parameters
        params = step.get('parameters', {})
        
        # URL for navigation
        if 'url' in params:
            db_step['url'] = params['url']
            
        # Text input
        if 'text_to_type' in params:
            db_step['value'] = params['text_to_type']
            if params.get('clear_before_typing', False):
                db_step['clear_before'] = True
                
        # Timeouts
        if 'timeout_ms' in params:
            db_step['timeout'] = params['timeout_ms']
            
        # Delays
        if 'delay_ms' in params:
            db_step['wait_after'] = params['delay_ms']
            
        # Wait conditions
        if 'condition' in params:
            db_step['condition'] = params['condition']
            
        # State for set_selected
        if 'state' in params:
            db_step['state'] = params['state']
            
        # Alternative selectors
        if 'alternative_selectors' in step:
            alt_selector = step['alternative_selectors']
            if isinstance(alt_selector, str):
                db_step['alternative_selectors'] = [alt_selector]
            else:
                db_step['alternative_selectors'] = alt_selector
                
        # Optional flag
        if step.get('optional', False):
            db_step['optional'] = True
            
        # Expected result
        if 'expected_result' in step:
            db_step['expected_result'] = step['expected_result']
            
        # Note
        if 'note' in step:
            db_step['note'] = step['note']
            
        automation_sequence.append(db_step)
    
    # Extract validation checks
    validation_checks = []
    
    # Default validation checks based on the workflow
    validation_checks.append({
        "name": "EULA accepted",
        "type": "element_check",
        "selector": "!name:End-User License Agreement"
    })
    
    validation_checks.append({
        "name": "Form filled",
        "type": "form_validation",
        "required_fields": [
            "Date of Birth: has value",
            "Sex: Male selected",
            "Weight: has value",
            "Height: has value",
            "State: has value",
            "Zip Code: has value",
            "Face Value: has value",
            "Product Type: Term selected",
            "Open Enrollment: No selected"
        ]
    })
    
    validation_checks.append({
        "name": "Quote running",
        "type": "element_check",
        "selector": "name:Please wait..."
    })
    
    validation_checks.append({
        "name": "Results displayed",
        "type": "element_check",
        "selector": "name:Quote Results"
    })
    
    # Extract error handling
    error_handling = []
    
    error_handling.append({
        "error_condition": "EULA dialog blocks interaction",
        "recovery_actions": [
            {
                "action": "retry",
                "description": "Click Accept button again"
            }
        ]
    })
    
    error_handling.append({
        "error_condition": "Health wizard appears",
        "recovery_actions": [
            {
                "action": "click",
                "description": "Click Cancel button (#16251652239921112986)"
            }
        ]
    })
    
    error_handling.append({
        "error_condition": "Run Quote button disabled",
        "recovery_actions": [
            {
                "action": "verify",
                "description": "All required fields are filled"
            }
        ]
    })
    
    error_handling.append({
        "error_condition": "Quote takes too long",
        "recovery_actions": [
            {
                "action": "wait",
                "description": "Up to 60 seconds"
            },
            {
                "action": "fallback",
                "description": "Refresh and retry entire sequence"
            }
        ]
    })
    
    return {
        'automation_sequence': automation_sequence,
        'validation_checks': validation_checks,
        'error_handling': error_handling
    }

def update_workflow_in_db(workflow_id, automation_data):
    """Update workflow in database"""
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    try:
        # Update the workflow
        cur.execute("""
            UPDATE deployed_workflows 
            SET 
                automation_sequence = %s,
                validation_checks = %s,
                error_handling = %s,
                last_updated = NOW()
            WHERE id = %s
        """, (
            json.dumps(automation_data['automation_sequence']),
            json.dumps(automation_data['validation_checks']),
            json.dumps(automation_data['error_handling']),
            workflow_id
        ))
        
        rows_updated = cur.rowcount
        conn.commit()
        
        print(f"✅ Updated {rows_updated} workflow(s) in database")
        
        # Verify the update
        cur.execute("""
            SELECT automation_sequence 
            FROM deployed_workflows 
            WHERE id = %s
        """, (workflow_id,))
        
        result = cur.fetchone()
        if result:
            updated_sequence = result[0]
            print(f"✅ Verified: Workflow now has {len(updated_sequence)} steps")
        
        return True
        
    except Exception as e:
        print(f"❌ Error updating database: {e}")
        conn.rollback()
        return False
        
    finally:
        cur.close()
        conn.close()

# Main execution
if __name__ == "__main__":
    print("📖 Loading local workflow from workflows/bestplanpro_quoting/workflow.json...")
    local_workflow = load_local_workflow()
    
    print(f"✅ Loaded workflow: {local_workflow['workflow']['name']}")
    print(f"   Steps: {len(local_workflow['workflow']['steps'])}")
    
    print("\n🔄 Converting to database format...")
    db_data = convert_local_to_db_format(local_workflow)
    
    print(f"✅ Converted:")
    print(f"   Automation steps: {len(db_data['automation_sequence'])}")
    print(f"   Validation checks: {len(db_data['validation_checks'])}")
    print(f"   Error handling rules: {len(db_data['error_handling'])}")
    
    # Save a backup of what we're about to update
    backup_filename = f"workflow_update_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(backup_filename, 'w') as f:
        json.dump(db_data, f, indent=2)
    print(f"\n💾 Backup saved to: {backup_filename}")
    
    print("\n🚀 Updating workflow in database...")
    success = update_workflow_in_db(1, db_data)
    
    if success:
        print("\n✅ Workflow successfully updated in database!")
    else:
        print("\n❌ Failed to update workflow in database")
