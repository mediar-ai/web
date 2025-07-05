"""
Working quote parser for MCP responses - True Price-based backward approach
Finds "Price" labels first, then works backward to find amounts and carriers
"""
import re
from typing import List, Dict, Any

def extract_quotes_from_mcp_response(mcp_response_text: str) -> List[Dict[str, Any]]:
    """
    Extract insurance quotes by finding "Price" label, then working backward.
    
    Process:
    1. Find all occurrences of "Price" (e.g., "Monthly Price")
    2. Look backward to find the dollar amount
    3. Continue backward to find carrier:product
    4. Check forward for status indicators
    """
    quotes = []
    processed_positions = set()
    
    # Find all occurrences of "Price" (could be "Monthly Price", "Price", etc.)
    # Using 6-backslash escaping pattern as found in MCP responses
    price_label_pattern = r'\\\\\\"name\\\\\\":\\\\\\"([^"\\]*Price[^"\\]*)\\\\\\"'
    price_label_matches = list(re.finditer(price_label_pattern, mcp_response_text))
    
    for price_match in price_label_matches:
        price_label = price_match.group(1)
        price_label_pos = price_match.start()
        
        # Step 1: Look backward for the dollar amount
        backward_start = max(0, price_label_pos - 500)
        backward_text = mcp_response_text[backward_start:price_label_pos]
        
        # Find the most recent dollar amount before "Price"
        dollar_pattern = r'\\\\\\"name\\\\\\":\\\\\\"\$(\d+(?:,\d{3})*(?:\.\d{2})?)\\\\\\"'
        dollar_matches = list(re.finditer(dollar_pattern, backward_text))
        
        if not dollar_matches:
            continue
            
        # Get the last (closest) dollar match
        last_dollar_match = dollar_matches[-1]
        dollar_amount = f"${last_dollar_match.group(1)}"
        dollar_pos = backward_start + last_dollar_match.start()
        
        # Skip if we've already processed this price
        if dollar_pos in processed_positions:
            continue
        processed_positions.add(dollar_pos)
        
        # Step 2: Continue backward from the dollar amount to find carrier:product
        carrier_search_start = max(0, dollar_pos - 1500)
        carrier_search_text = mcp_response_text[carrier_search_start:dollar_pos]
        
        # Find all name fields before the dollar amount
        name_pattern = r'\\\\\\"name\\\\\\":\\\\\\"([^"\\]+)\\\\\\"'
        name_matches = list(re.finditer(name_pattern, carrier_search_text))
        
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
                            
                            # Check for status between carrier and price label
                            status_section = mcp_response_text[dollar_pos:price_label_pos + 200]
                            
                            status = []
                            if 'Graded' in status_section:
                                status.append('Graded')
                            if 'Discontinued' in status_section:
                                status.append('Discontinued')
                            if 'Ineligible' in status_section:
                                status.append('Ineligible')
                            
                            if not status:
                                status.append('Available')
                            
                            quote = {
                                'carrier': carrier,
                                'product': product,
                                'monthly_price': dollar_amount,
                                'status': status,
                                'eligible': not any(s in ['Discontinued', 'Ineligible'] for s in status)
                            }
                            
                            quotes.append(quote)
                            carrier_product_found = True
                            break
    
    return quotes 