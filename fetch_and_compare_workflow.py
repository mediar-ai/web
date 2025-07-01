import psycopg2
import json
import difflib
from datetime import datetime

# Database connection configuration
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': '***REMOVED***'
}

def get_workflow_from_db(workflow_id=1):
    """Fetch workflow from database"""
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    try:
        cur.execute("""
            SELECT id, name, automation_sequence, validation_checks, error_handling
            FROM deployed_workflows 
            WHERE id = %s
        """, (workflow_id,))
        
        result = cur.fetchone()
        if result:
            return {
                'id': result[0],
                'name': result[1],
                'automation_sequence': result[2],
                'validation_checks': result[3],
                'error_handling': result[4]
            }
        return None
    finally:
        cur.close()
        conn.close()

def load_local_workflow(filepath='workflows/bestplanpro_quoting/workflow.json'):
    """Load workflow from local file"""
    with open(filepath, 'r') as f:
        data = json.load(f)
    return data

def convert_local_to_db_format(local_workflow):
    """Convert local workflow format to database format"""
    steps = local_workflow['workflow']['steps']
    automation_sequence = []
    
    for step in steps:
        db_step = {
            'step_number': step['step'],
            'action': step['action'],
            'description': step['description'],
            'selector': step.get('selector'),
            'expected_result': step.get('expected_result')
        }
        
        # Handle parameters
        params = step.get('parameters', {})
        if 'url' in params:
            db_step['url'] = params['url']
        if 'text_to_type' in params:
            db_step['value'] = params['text_to_type']
        if 'timeout_ms' in params:
            db_step['timeout'] = params['timeout_ms']
        if 'delay_ms' in params:
            db_step['wait_after'] = params['delay_ms']
        if 'condition' in params:
            db_step['condition'] = params['condition']
        if 'state' in params:
            db_step['state'] = params['state']
            
        # Add alternative selectors
        if 'alternative_selectors' in step:
            db_step['alternative_selectors'] = [step['alternative_selectors']]
            
        # Add optional flag
        if step.get('optional'):
            db_step['optional'] = True
            
        automation_sequence.append(db_step)
    
    return automation_sequence

def compare_workflows(db_workflow, local_workflow):
    """Compare database and local workflows"""
    print("=== WORKFLOW COMPARISON ===\n")
    
    # Convert local format to DB format for comparison
    local_automation_sequence = convert_local_to_db_format(local_workflow)
    db_automation_sequence = db_workflow['automation_sequence']
    
    # Basic info
    print(f"Database Workflow: {db_workflow['name']}")
    print(f"Local Workflow: {local_workflow['workflow']['name']}")
    print(f"\nDatabase Steps: {len(db_automation_sequence)}")
    print(f"Local Steps: {len(local_automation_sequence)}")
    
    # Compare step by step
    print("\n=== STEP-BY-STEP COMPARISON ===")
    
    max_steps = max(len(db_automation_sequence), len(local_automation_sequence))
    
    differences = []
    for i in range(max_steps):
        if i < len(db_automation_sequence) and i < len(local_automation_sequence):
            db_step = db_automation_sequence[i]
            local_step = local_automation_sequence[i]
            
            # Compare key fields
            if db_step.get('action') != local_step.get('action'):
                differences.append(f"Step {i+1}: Action mismatch - DB: {db_step.get('action')} vs Local: {local_step.get('action')}")
            
            if db_step.get('description') != local_step.get('description'):
                differences.append(f"Step {i+1}: Description differs")
                
            if db_step.get('selector') != local_step.get('selector'):
                differences.append(f"Step {i+1}: Selector differs - DB: {db_step.get('selector')} vs Local: {local_step.get('selector')}")
                
        elif i >= len(db_automation_sequence):
            differences.append(f"Step {i+1}: Exists in local but not in database")
        else:
            differences.append(f"Step {i+1}: Exists in database but not in local")
    
    # Print differences
    if differences:
        print("\n⚠️  DIFFERENCES FOUND:")
        for diff in differences:
            print(f"  - {diff}")
    else:
        print("\n✅ No structural differences found!")
    
    # Save database workflow to file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    db_filename = f"db_workflow_{timestamp}.json"
    with open(db_filename, 'w') as f:
        json.dump(db_workflow, f, indent=2)
    print(f"\n💾 Database workflow saved to: {db_filename}")
    
    # Create a detailed diff file
    diff_filename = f"workflow_diff_{timestamp}.txt"
    with open(diff_filename, 'w') as f:
        f.write("=== DETAILED WORKFLOW COMPARISON ===\n\n")
        
        # Write JSON diff
        db_json = json.dumps(db_automation_sequence, indent=2, sort_keys=True)
        local_json = json.dumps(local_automation_sequence, indent=2, sort_keys=True)
        
        diff = difflib.unified_diff(
            db_json.splitlines(keepends=True),
            local_json.splitlines(keepends=True),
            fromfile='database_workflow.json',
            tofile='local_workflow.json'
        )
        
        f.writelines(diff)
    
    print(f"📄 Detailed diff saved to: {diff_filename}")
    
    return differences

# Main execution
if __name__ == "__main__":
    print("🔍 Fetching workflow from database...")
    db_workflow = get_workflow_from_db(1)
    
    if not db_workflow:
        print("❌ Workflow not found in database!")
        exit(1)
    
    print("📖 Loading local workflow...")
    local_workflow = load_local_workflow()
    
    print("\n🔄 Comparing workflows...")
    differences = compare_workflows(db_workflow, local_workflow)
    
    print("\n✅ Comparison complete!")
