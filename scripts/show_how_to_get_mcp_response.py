import os
import json

print("Method 1: Direct psql command to get MCP response")
print("="*60)

# This command fetches the raw_mcp_response from the database
cmd = '''psql "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -c "SELECT raw_mcp_response FROM workflow_executions WHERE id = 263;" -t -A'''

print(f"Command: {cmd}")
print("\nThis saves to a file:")

# Execute and save to file
os.system(f'{cmd} > mcp_response_263.json 2>/dev/null')

# Check file size
import os
if os.path.exists('mcp_response_263.json'):
    size = os.path.getsize('mcp_response_263.json')
    print(f"\n✓ File created: mcp_response_263.json")
    print(f"  Size: {size:,} bytes")
    
    # Show structure
    with open('mcp_response_263.json', 'r') as f:
        content = f.read()
    
    print(f"\nFile contains:")
    print(f"  - Prosperity: {'Prosperity' in content}")
    print(f"  - Price $358.56: {'358.56' in content}")
    print(f"  - View Details: {'View Details' in content}")
    
    # Parse and show structure
    try:
        data = json.loads(content)
        print(f"\n✓ Valid JSON")
        print(f"  Structure: data['result']['content'][0]['text']")
        
        # The actual workflow result is here
        workflow_result = json.loads(data['result']['content'][0]['text'])
        print(f"  Workflow has {len(workflow_result.get('results', []))} steps")
        
    except Exception as e:
        print(f"\n✗ JSON parsing error: {e}")

print("\n\nMethod 2: Using Python with psycopg2 (if you prefer):")
print("="*60)
print("""
import psycopg2
import json

conn = psycopg2.connect(
    host='aws-0-us-west-1.pooler.supabase.com',
    database='postgres',
    user='postgres.eshwntsgsputksqamckh',
    password='dS64xX6mU3E4Sbyc',
    port=5432
)

cur = conn.cursor()
cur.execute("SELECT raw_mcp_response FROM workflow_executions WHERE id = 263")
mcp_response = cur.fetchone()[0]

# Now you have the MCP response as a Python dict/string
""")

print("\nThe MCP response contains the full execution details including the UI tree with quotes.")
