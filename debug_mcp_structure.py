import json
import re

# Get the MCP response
import os
os.system('psql "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -c "SELECT raw_mcp_response FROM workflow_executions WHERE id = 263;" -t -A > temp_mcp.json 2>/dev/null')

with open('temp_mcp.json', 'r') as f:
    raw_text = f.read()

print("Raw text length:", len(raw_text))
print("\nFirst 500 chars:")
print(repr(raw_text[:500]))

# Check if it's valid JSON
try:
    data = json.loads(raw_text)
    print("\n✓ Valid JSON at top level")
    print("Top-level keys:", list(data.keys()))
    
    if 'result' in data:
        print("\nResult keys:", list(data['result'].keys()))
        
        if 'content' in data['result']:
            print(f"Content has {len(data['result']['content'])} items")
            
            for i, item in enumerate(data['result']['content']):
                print(f"\nContent item {i}:")
                print(f"  Type: {item.get('type')}")
                if 'text' in item:
                    text = item['text']
                    print(f"  Text length: {len(text)}")
                    print(f"  Text preview: {text[:200]}...")
                    
                    # Check if this is JSON
                    try:
                        inner_data = json.loads(text)
                        print(f"  ✓ Valid inner JSON")
                        print(f"  Inner keys: {list(inner_data.keys())}")
                        
                        # Look for the quote data
                        if 'Prosperity' in text:
                            print("  ✓ Contains 'Prosperity'")
                        if '358.56' in text:
                            print("  ✓ Contains price '358.56'")
                            
                    except:
                        print(f"  ✗ Not valid JSON")

except json.JSONDecodeError as e:
    print(f"\n✗ Not valid JSON: {e}")
    print("\nTrying to find quotes directly in raw text...")
    
    # Search for patterns directly
    patterns = [
        'Prosperity PrimeTerm',
        '358.56',
        'View Details',
        'Monthly Price'
    ]
    
    for pattern in patterns:
        if pattern in raw_text:
            print(f"✓ Found '{pattern}'")
            pos = raw_text.find(pattern)
            print(f"  Position: {pos}")
            print(f"  Context: ...{raw_text[max(0,pos-50):pos+50]}...")

os.remove('temp_mcp.json')
