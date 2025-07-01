import psycopg2
import json

# Database connection configuration
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': 'dS64xX6mU3E4Sbyc'
}

# Load the workflow file
with open('workflows/bestplanpro_quoting/workflow.json', 'r') as f:
    workflow_json = json.load(f)

# Connect to database
conn = psycopg2.connect(**DB_CONFIG)
cur = conn.cursor()

try:
    # Check which columns exist
    cur.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'deployed_workflows' 
        AND column_name IN ('workflow_json', 'raw_workflow', 'workflow_data', 'workflow_definition')
    """)
    
    available_columns = [row[0] for row in cur.fetchall()]
    
    if available_columns:
        column_name = available_columns[0]
        print(f"✅ Found column: {column_name}")
        
        # Update the workflow
        cur.execute(f"""
            UPDATE deployed_workflows 
            SET {column_name} = %s
            WHERE id = 1
        """, (json.dumps(workflow_json),))
        
        conn.commit()
        print(f"✅ Successfully pushed workflow.json to {column_name} column")
    else:
        # Check all columns
        cur.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'deployed_workflows'
            ORDER BY ordinal_position
        """)
        
        print("❌ No suitable JSON column found. Available columns:")
        for col_name, col_type in cur.fetchall():
            print(f"   - {col_name}: {col_type}")
            
except Exception as e:
    print(f"❌ Error: {e}")
    conn.rollback()
finally:
    cur.close()
    conn.close()
