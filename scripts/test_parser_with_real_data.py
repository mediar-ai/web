import json
import re

# Copy the parse_quote_results function from Modal app
def parse_quote_results(ui_tree_text: str) -> list:
    """Parse insurance quotes from the UI tree text using Price-based backward search"""
    quotes = []
    processed_positions = set()
    
    print("=== QUOTE PARSER STARTED ===")
    print(f"UI tree text length: {len(ui_tree_text)} characters")
    
    # Check for key indicators
    has_view_details = 'View Details' in ui_tree_text
    has_monthly_price = 'Monthly Price' in ui_tree_text
    has_prosperity = 'Prosperity' in ui_tree_text
    
    print(f"UI tree contains: View Details={has_view_details}, Monthly Price={has_monthly_price}, Prosperity={has_prosperity}")
    
    # Find all occurrences of "Price" (could be "Monthly Price", "Price", etc.)
    # Try different patterns
    patterns_to_try = [
        (r'"name": "([^"]*Price[^"]*)"', 'Simple JSON'),
        (r'\\"name\\":\\"([^"\\]*Price[^"\\]*)\\"', '2-backslash'),
        (r'\\\\\\"name\\\\\\":\\\\\\"([^"\\]*Price[^"\\]*)\\\\\\"', '6-backslash')
    ]
    
    price_label_matches = []
    for pattern, pattern_name in patterns_to_try:
        matches = list(re.finditer(pattern, ui_tree_text))
        print(f"{pattern_name} pattern found {len(matches)} price labels")
        if matches:
            price_label_matches = matches
            price_pattern = pattern
            break
    
    # Determine which dollar pattern to use based on which price pattern worked
    if '"name": "' in price_pattern:
        dollar_pattern = r'"name": "\$(\d+(?:,\d{3})*(?:\.\d{2})?)"'
        name_pattern = r'"name": "([^"]+)"'
    elif '\\"name\\":\\"' in price_pattern:
        dollar_pattern = r'\\"name\\":\\"\$(\d+(?:,\d{3})*(?:\.\d{2})?)\\"'
        name_pattern = r'\\"name\\":\\"([^"\\]+)\\"'
    else:
        dollar_pattern = r'\\\\\\"name\\\\\\":\\\\\\"\$(\d+(?:,\d{3})*(?:\.\d{2})?)\\\\\\"'
        name_pattern = r'\\\\\\"name\\\\\\":\\\\\\"([^"\\]+)\\\\\\"'
    
    print(f"Using dollar pattern: {dollar_pattern}")
    
    for i, price_match in enumerate(price_label_matches):
        price_label = price_match.group(1)
        price_label_pos = price_match.start()
        
        print(f"\nProcessing price label {i+1}: '{price_label}' at position {price_label_pos}")
        
        # Step 1: Look backward for the dollar amount
        backward_start = max(0, price_label_pos - 500)
        backward_text = ui_tree_text[backward_start:price_label_pos]
        
        # Find the most recent dollar amount before "Price"
        dollar_matches = list(re.finditer(dollar_pattern, backward_text))
        
        print(f"  Found {len(dollar_matches)} dollar amounts before this price label")
        
        if not dollar_matches:
            print(f"  No dollar amounts found before price label '{price_label}'")
            continue
            
        # Get the last (closest) dollar match
        last_dollar_match = dollar_matches[-1]
        dollar_amount = f"${last_dollar_match.group(1)}"
        dollar_pos = backward_start + last_dollar_match.start()
        
        print(f"  Found dollar amount: {dollar_amount} at position {dollar_pos}")
        
        # Skip if we've already processed this price
        if dollar_pos in processed_positions:
            print(f"  Skipping already processed price at position {dollar_pos}")
            continue
        processed_positions.add(dollar_pos)
        
        # Step 2: Continue backward from the dollar amount to find carrier:product
        carrier_search_start = max(0, dollar_pos - 1500)
        carrier_search_text = ui_tree_text[carrier_search_start:dollar_pos]
        
        # Find all name fields before the dollar amount
        name_matches = list(re.finditer(name_pattern, carrier_search_text))
        
        print(f"  Found {len(name_matches)} name fields before dollar amount")
        
        # Look for carrier:product pattern
        carrier_product_found = False
        for match in reversed(name_matches):
            text = match.group(1)
            
            if ':' in text and not text.startswith('$'):
                parts = text.split(':', 1)
                if len(parts) == 2:
                    potential_product = parts[1].upper()
                    # Check for insurance keywords
                    if any(kw in potential_product for kw in ['TERM', 'WHOLE', 'UNIVERSAL', 'LIFE', 'PRIMETERM', 'YEAR']):
                        if 'logo' not in text.lower():
                            carrier = parts[0].strip()
                            product = parts[1].strip()
                            
                            print(f"  ✓ Found carrier:product - {carrier}: {product}")
                            
                            # Check for status between carrier and price label
                            status_section = ui_tree_text[dollar_pos:price_label_pos + 200]
                            
                            status = []
                            if 'Graded' in status_section:
                                status.append('Graded')
                            if 'Discontinued' in status_section:
                                status.append('Discontinued')
                            if 'Ineligible' in status_section:
                                status.append('Ineligible')
                            
                            if not status:
                                status.append('Available')
                            
                            print(f"  Status: {', '.join(status)}")
                            
                            quote = {
                                'carrier': carrier,
                                'product': product,
                                'monthly_price': dollar_amount,
                                'status': status,
                                'eligible': not any(s in ['Discontinued', 'Ineligible'] for s in status)
                            }
                            
                            quotes.append(quote)
                            print(f"  ✅ Successfully extracted quote: {carrier} - {product} at {dollar_amount}")
                            carrier_product_found = True
                            break
        
        if not carrier_product_found:
            print(f"  Could not find carrier:product for price {dollar_amount}")
    
    print(f"\n=== QUOTE PARSER COMPLETED ===")
    print(f"Total quotes extracted: {len(quotes)}")
    
    return quotes


# Load execution 274 data
with open('execution_274.json', 'r') as f:
    data = json.load(f)

# Extract the UI tree from the last step
step_details = data['execution']['results']['step_details']
print(f"Found {len(step_details)} step groups")

# Get the last group (Generate and Capture Quote)
last_group = step_details[-1]
print(f"Last group status: {last_group['status']}")
print(f"Last group has {len(last_group['results'])} results")

# Get the wait_for_element result (last one)
wait_result = last_group['results'][-1]
print(f"Wait result tool: {wait_result['tool_name']}")

# Extract the UI tree from the result
result_text = wait_result['result']['content'][0]['text']
result_data = json.loads(result_text)

# The UI tree is in the result
ui_tree = result_data['ui_tree']

# Convert UI tree to string (this is what the parser receives)
ui_tree_str = json.dumps(ui_tree)

print(f"\nUI tree length: {len(ui_tree_str)}")
print("\nSearching for key terms:")
print("- 'View Details' found:", "View Details" in ui_tree_str)
print("- 'Monthly Price' found:", "Monthly Price" in ui_tree_str)
print("- 'Prosperity' found:", "Prosperity" in ui_tree_str)
print("- '$358.56' found:", "$358.56" in ui_tree_str)

# Now test the parser
print("\n=== Running parser ===")
quotes = parse_quote_results(ui_tree_str)
print(f"Parser returned {len(quotes)} quotes")

if quotes:
    for i, quote in enumerate(quotes):
        print(f"\nQuote {i+1}:")
        print(f"  Carrier: {quote['carrier']}")
        print(f"  Product: {quote['product']}")
        print(f"  Price: {quote['monthly_price']}")
else:
    print("\nNo quotes found by parser")
    
# Let's also check the exact format
print("\n=== Checking exact string format ===")
# Find the section with the quote
start = ui_tree_str.find("Prosperity")
if start > 0:
    snippet = ui_tree_str[max(0, start-200):start+500]
    print("Quote section snippet:")
    print(snippet) 