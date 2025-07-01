#!/usr/bin/env python3
"""
Update database workflow to match the original workflow.json structure
This ensures Modal execution works correctly
"""

import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor

def load_original_workflow():
    """Load the original working workflow.json"""
    with open('workflows/bestplanpro_quoting/workflow.json', 'r') as f:
        return json.load(f)

def convert_to_database_format(workflow_json):
    """Convert the original workflow format to database automation_sequence format"""
    automation_sequence = []
    
    for step in workflow_json['workflow']['steps']:
        # Convert to database format but keep all original data
        db_step = {
            'step_number': step['step'],
            'action': step['action'],  # Keep original action names!
            'description': step.get('description', ''),
            'expected_result': step.get('expected_result', '')
        }
        
        # Add selector if present
        if 'selector' in step:
            db_step['selector'] = step['selector']
            
        # Add alternative selectors if present
        if 'alternative_selectors' in step:
            db_step['alternative_selectors'] = step['alternative_selectors']
            
        # IMPORTANT: Keep the original parameters structure
        if 'parameters' in step:
            db_step['parameters'] = step['parameters']
            
        # Add any wait_after from parameters
        if 'parameters' in step and 'timeout_ms' in step['parameters']:
            db_step['wait_after'] = step['parameters']['timeout_ms']
            
        automation_sequence.append(db_step)
    
    return automation_sequence

def update_database_workflow():
    """Update the workflow in database to match original structure"""
    # Get database URL from environment
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("❌ DATABASE_URL environment variable not set")
        return False
        
    # Load original workflow
    print("📂 Loading original workflow.json...")
    original_workflow = load_original_workflow()
    workflow_info = original_workflow['workflow']
    
    print(f"✅ Loaded: {workflow_info['name']} v{workflow_info['version']}")
    print(f"   Steps: {len(workflow_info['steps'])}")
    
    # Convert to database format
    automation_sequence = convert_to_database_format(original_workflow)
    
    # Extract validation checks and error handling
    validation_checks = []
    error_handling = []
    
    # Add some basic validation checks based on the workflow
    validation_checks.append({
        "name": "All fields filled",
        "type": "form_validation",
        "required_fields": [
            "Date of Birth", "Weight", "Height", "State", 
            "Zip Code", "Face Value"
        ]
    })
    
    # Connect to database
    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        print("\n🔄 Updating workflow in database...")
        
        # Update the workflow with proper structure
        cur.execute("""
            UPDATE deployed_workflows 
            SET 
                automation_sequence = %s,
                validation_checks = %s,
                error_handling = %s,
                version = %s,
                description = %s,
                estimated_duration_seconds = 180,
                updated_at = NOW()
            WHERE id = 1
            RETURNING id, name
        """, (
            json.dumps(automation_sequence),
            json.dumps(validation_checks),
            json.dumps(error_handling),
            workflow_info['version'],
            workflow_info['description']
        ))
        
        result = cur.fetchone()
        conn.commit()
        
        print(f"✅ Updated workflow ID {result['id']}: {result['name']}")
        
        # Verify the update
        cur.execute("SELECT automation_sequence->0 as first_step FROM deployed_workflows WHERE id = 1")
        first_step = cur.fetchone()['first_step']
        
        print("\n📋 First step in database:")
        print(json.dumps(first_step, indent=2))
        
        cur.close()
        conn.close()
        
        print("\n✅ Database workflow updated successfully!")
        print("   The Modal executor should now work correctly")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Database error: {e}")
        return False

if __name__ == "__main__":
    print("🔧 Updating Database Workflow to Match Original")
    print("=" * 50)
    
    success = update_database_workflow()
    
    if success:
        print("\n🎉 Update complete! You can now run the workflow again.")
    else:
        print("\n❌ Update failed. Please check the error messages above.") 