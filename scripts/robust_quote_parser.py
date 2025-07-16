import json
import re
from typing import List, Dict, Any

def extract_quotes_from_mcp_response(mcp_response_text: str) -> List[Dict[str, Any]]:
    """
    Extract insurance quotes from MCP response by properly parsing nested JSON
    """
    quotes = []
    
    try:
        # Step 1: Parse the outer MCP response
        mcp_data = json.loads(mcp_response_text)
        
        # Step 2: Navigate to the result content
        if 'result' not in mcp_data or 'content' not in mcp_data['result']:
            print("No result content found in MCP response")
            return quotes
        
        # Step 3: Extract the workflow execution result
        for content_item in mcp_data['result']['content']:
            if content_item.get('type') != 'text':
                continue
                
            try:
                # Parse the workflow result JSON
                workflow_result = json.loads(content_item['text'])
                
                # Look for the final UI tree in the results
                if 'results' not in workflow_result:
                    continue
                
                # Process each step result
                for step_result in workflow_result['results']:
                    if 'result' not in step_result or 'content' not in step_result['result']:
                        continue
                    
                    # Look for UI tree content
                    for result_content in step_result['result']['content']:
                        if 'text' not in result_content:
                            continue
                        
                        result_text = result_content['text']
                        
                        # Check if this contains UI tree data
                        if 'ui_tree' in result_text and 'View Details' in result_text:
                            # This is likely the final state with quotes
                            quotes_found = parse_ui_tree_for_quotes(result_text)
                            quotes.extend(quotes_found)
                            
            except json.JSONDecodeError:
                # If JSON parsing fails, try pattern matching as fallback
                print("Failed to parse as JSON, trying pattern matching")
                quotes_from_patterns = extract_quotes_by_patterns(content_item['text'])
                quotes.extend(quotes_from_patterns)
    
    except Exception as e:
        print(f"Error parsing MCP response: {e}")
        import traceback
        traceback.print_exc()
    
    return quotes

def parse_ui_tree_for_quotes(ui_tree_text: str) -> List[Dict[str, Any]]:
    """
    Parse UI tree text to extract quote information
    """
    quotes = []
    
    try:
        # Parse the JSON that contains the UI tree
        ui_data = json.loads(ui_tree_text)
        
        if 'ui_tree' in ui_data:
            # Parse the actual UI tree
            ui_tree = json.loads(ui_data['ui_tree'])
            # Traverse the tree to find quotes
            quotes = extract_quotes_from_ui_tree(ui_tree)
        
    except json.JSONDecodeError:
        # If JSON parsing fails, use pattern matching
        print("UI tree JSON parsing failed, using pattern matching")
        quotes = extract_quotes_by_patterns(ui_tree_text)
    
    return quotes

def extract_quotes_from_ui_tree(node: Dict[str, Any], quotes: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Recursively traverse UI tree to find quote information
    """
    if quotes is None:
        quotes = []
    
    # Check current node
    attrs = node.get('attributes', {})
    if attrs.get('role') == 'Text':
        text = attrs.get('name', '')
        
        # Check if this looks like a carrier/product
        if ':' in text and any(term in text.upper() for term in ['TERM', 'WHOLE', 'UNIVERSAL', 'PRIMETERM']):
            if 'logo' not in text.lower():
                # This is likely a quote
                parts = text.split(':', 1)
                quote = {
                    'carrier': parts[0].strip(),
                    'product': parts[1].strip(),
                    'text_node': node,
                    'monthly_price': None,
                    'status': ['Available'],
                    'eligible': True
                }
                quotes.append(quote)
    
    # Process children
    for child in node.get('children', []):
        extract_quotes_from_ui_tree(child, quotes)
    
    # After collecting all nodes, match prices to quotes
    if node.get('attributes', {}).get('role') == 'Document':  # Root level
        match_prices_to_quotes(node, quotes)
    
    return quotes

def match_prices_to_quotes(root_node: Dict[str, Any], quotes: List[Dict[str, Any]]):
    """
    Match price information to quotes based on proximity in the tree
    """
    # Collect all text nodes
    all_text_nodes = []
    collect_text_nodes(root_node, all_text_nodes)
    
    # For each quote, find the nearest price
    for quote in quotes:
        quote_node = quote.pop('text_node', None)
        if not quote_node:
            continue
        
        # Find price after this quote
        found_quote = False
        for i, node in enumerate(all_text_nodes):
            if node == quote_node:
                found_quote = True
            elif found_quote:
                text = node.get('attributes', {}).get('name', '')
                # Check if this is a price
                if text.startswith('$') and any(c.isdigit() for c in text):
                    quote['monthly_price'] = text
                    # Check next few nodes for status
                    for j in range(i, min(i + 5, len(all_text_nodes))):
                        status_text = all_text_nodes[j].get('attributes', {}).get('name', '')
                        if status_text.lower() in ['graded', 'discontinued', 'ineligible']:
                            quote['status'] = [status_text]
                            quote['eligible'] = status_text.lower() not in ['discontinued', 'ineligible']
                    break

def collect_text_nodes(node: Dict[str, Any], text_nodes: List[Dict[str, Any]]):
    """
    Collect all text nodes in order
    """
    attrs = node.get('attributes', {})
    if attrs.get('role') == 'Text' and 'name' in attrs:
        text_nodes.append(node)
    
    for child in node.get('children', []):
        collect_text_nodes(child, text_nodes)

def extract_quotes_by_patterns(text: str) -> List[Dict[str, Any]]:
    """
    Fallback pattern-based extraction
    """
    quotes = []
    
    # Try multiple escaping levels
    patterns = [
        (r'\\\\\\\"name\\\\\\\":\\\\\\\"([^\\]+:[^\\]+?)\\\\\\\"', 6),  # 6 backslashes
        (r'\\\\"name\\\\":\\\\"([^\\]+:[^\\]+?)\\\\"', 4),              # 4 backslashes
        (r'\\\"name\\\":\\\"([^\\]+:[^\\]+?)\\\"', 3),                  # 3 backslashes
        (r'"name":"([^"]+:[^"]+)"', 0),                                 # No escaping
    ]
    
    for pattern, level in patterns:
        # Look for carrier:product patterns
        carrier_matches = re.finditer(pattern, text)
        
        for match in carrier_matches:
            full_text = match.group(1)
            if any(term in full_text.upper() for term in ['TERM', 'WHOLE', 'UNIVERSAL']) and ':' in full_text:
                if 'logo' not in full_text.lower():
                    parts = full_text.split(':', 1)
                    
                    # Look for price after this match
                    pos = match.end()
                    price_section = text[pos:pos+1000]
                    
                    # Try same escaping level for price
                    if level == 6:
                        price_pattern = r'\\\\\\\"name\\\\\\\":\\\\\\\"(\$[\d,]+\.?\d*)\\\\\\\"'
                    elif level == 4:
                        price_pattern = r'\\\\"name\\\\":\\\\"(\$[\d,]+\.?\d*)\\\\"'
                    elif level == 3:
                        price_pattern = r'\\\"name\\\":\\\"(\$[\d,]+\.?\d*)\\\"'
                    else:
                        price_pattern = r'"name":"(\$[\d,]+\.?\d*)"'
                    
                    price_match = re.search(price_pattern, price_section)
                    
                    quote = {
                        'carrier': parts[0].strip(),
                        'product': parts[1].strip(),
                        'monthly_price': price_match.group(1) if price_match else None,
                        'status': ['Available'],
                        'eligible': True
                    }
                    
                    # Check for status indicators
                    if 'Graded' in price_section:
                        quote['status'] = ['Graded']
                    elif 'Discontinued' in price_section:
                        quote['status'] = ['Discontinued']
                        quote['eligible'] = False
                    elif 'Ineligible' in price_section:
                        quote['status'] = ['Ineligible']
                        quote['eligible'] = False
                    
                    quotes.append(quote)
                    print(f"Found quote with {level}-backslash pattern: {quote['carrier']}")
                    
        if quotes:  # If we found quotes, stop trying other patterns
            break
    
    return quotes

# Test the parser
if __name__ == "__main__":
    import os
    
    # First, get the MCP response from the database
    print("Fetching MCP response from database...")
    os.system('psql "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -c "SELECT raw_mcp_response FROM workflow_executions WHERE id = 263;" -t -A > temp_mcp_response.json 2>/dev/null')
    
    # Read and parse
    with open('temp_mcp_response.json', 'r') as f:
        mcp_response = f.read()
    
    print("\nParsing MCP response for quotes...")
    print("="*60)
    
    quotes = extract_quotes_from_mcp_response(mcp_response)
    
    print(f"\n\nEXTRACTED {len(quotes)} QUOTES:")
    print("="*60)
    
    for i, quote in enumerate(quotes):
        print(f"\nQuote {i+1}:")
        print(f"  Carrier: {quote['carrier']}")
        print(f"  Product: {quote['product']}")
        print(f"  Monthly Price: {quote.get('monthly_price', 'N/A')}")
        print(f"  Status: {', '.join(quote['status'])}")
        print(f"  Eligible: {quote['eligible']}")
    
    # Clean up
    os.remove('temp_mcp_response.json')
    
    if quotes:
        print("\n✅ Successfully extracted quotes!")
        print("\nThis parser handles:")
        print("  - Nested JSON structure")
        print("  - Multiple escaping levels")
        print("  - UI tree traversal")
        print("  - Pattern matching fallback")
    else:
        print("\n❌ No quotes found")
        print("\nDebugging: The MCP response might have a different structure than expected.")
        print("Check the escaping level or JSON nesting.")
