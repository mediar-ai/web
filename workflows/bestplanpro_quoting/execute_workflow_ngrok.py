#!/usr/bin/env python3
"""Execute workflow.json through ngrok MCP endpoint"""

import asyncio
import json
import re
from contextlib import AsyncExitStack
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def extract_applicant_info(workflow_data):
    """Extract applicant information from workflow steps"""
    info = {
        "height": "",
        "date_of_birth": "",
        "weight": "",
        "state": "",
        "zip": "",
        "face_value": "",
        "nicotine": "Never"  # Default value
    }
    
    # Extract from workflow steps
    if workflow_data and 'workflow' in workflow_data and 'steps' in workflow_data['workflow']:
        for step in workflow_data['workflow']['steps']:
            # Extract text input values from parameters
            if step.get('action') == 'type_into_element' and 'parameters' in step:
                text_value = step['parameters'].get('text_to_type', '')
                description = step.get('description', '').lower()
                
                if 'height' in description:
                    # Convert inches to feet and inches (70 = 5'10")
                    try:
                        inches = int(text_value)
                        feet = inches // 12
                        remaining_inches = inches % 12
                        info['height'] = f"{feet}'{remaining_inches:02d}\""
                    except:
                        info['height'] = text_value
                elif 'date of birth' in description:
                    info['date_of_birth'] = text_value
                elif 'weight' in description:
                    info['weight'] = text_value + " lbs"
                elif 'state' in description:
                    info['state'] = text_value
                elif 'zip' in description:
                    info['zip'] = text_value
                elif 'face value' in description:
                    info['face_value'] = text_value
            
            # Extract gender from radio button selection
            elif step.get('action') == 'set_selected' and 'male' in step.get('description', '').lower():
                info['gender'] = 'Male'
    
    return info


def parse_quote_results(ui_tree_text):
    """Parse insurance quotes from the UI tree text"""
    quotes = []
    
    try:
        # Extract the main content that contains quote information
        if "Top Recommendations" not in ui_tree_text:
            return quotes
            
        # Find all group elements that contain quote information
        # Pattern to find carrier names and prices
        carrier_pattern = r'"name":"([^"]+?):\s*([\w\s\*-]+)".*?"role":"Text"'
        price_pattern = r'"name":"\$([0-9,.]+)".*?"role":"Text"'
        status_pattern = r'"name":"(Ineligible|Graded|Discontinued|Monthly Price)"'
        
        # Split by groups that contain quote info
        quote_blocks = ui_tree_text.split('"bounds":[956.0,')
        
        for block in quote_blocks[1:]:  # Skip first split
            quote_info = {}
            
            # Extract carrier and product name
            carrier_match = re.search(carrier_pattern, block)
            if carrier_match:
                full_name = carrier_match.group(1)
                product_type = carrier_match.group(2)
                quote_info['carrier'] = full_name
                quote_info['product'] = product_type
                
                # Extract price
                price_match = re.search(price_pattern, block)
                if price_match:
                    quote_info['monthly_price'] = f"${price_match.group(1)}"
                
                # Extract status
                statuses = []
                for status_match in re.finditer(status_pattern, block):
                    status = status_match.group(1)
                    if status not in ["Monthly Price"]:
                        statuses.append(status)
                
                quote_info['status'] = statuses if statuses else ['Available']
                
                # Check if quote is eligible
                quote_info['eligible'] = 'Ineligible' not in statuses
                
                quotes.append(quote_info)
    
    except Exception as e:
        print(f"Error parsing quotes: {e}")
    
    return quotes


def display_summary(quotes, applicant_info):
    """Display a summary of insurance quotes"""
    print("\n📊 Insurance Quote Summary")
    print("============================================================")
    
    # Display applicant info
    print("\n👤 Applicant Profile:")
    
    # Calculate age from DOB if available
    age = "N/A"
    if applicant_info.get('date_of_birth'):
        try:
            # Extract year from MM/DD/YYYY format
            year = int(applicant_info['date_of_birth'].split('/')[-1])
            age = 2025 - year
        except:
            pass
    
    print(f"  Age: {age}")
    print(f"  Height: {applicant_info.get('height', 'N/A')}")
    print(f"  Weight: {applicant_info.get('weight', 'N/A')}")
    print(f"  Gender: {applicant_info.get('gender', 'N/A')}")
    print(f"  State: {applicant_info.get('state', 'N/A')}, {applicant_info.get('zip', 'N/A')}")
    print(f"  Coverage: {applicant_info.get('face_value', 'N/A')}")
    
    eligible_quotes = [q for q in quotes if q['eligible']]
    ineligible_quotes = [q for q in quotes if not q['eligible']]
    
    print(f"\n✅ Eligible Quotes ({len(eligible_quotes)})")
    print("-" * 60)
    for quote in eligible_quotes:
        print(f"  {quote['carrier']}")
        print(f"  Product: {quote['product']}")
        print(f"  Monthly Premium: {quote.get('monthly_price', 'N/A')}")
        if quote['status'] and quote['status'] != ['Available']:
            print(f"  Status: {', '.join(quote['status'])}")
        print()
    
    if ineligible_quotes:
        print(f"\n❌ Ineligible Carriers ({len(ineligible_quotes)})")
        print("-" * 60)
        for quote in ineligible_quotes:
            print(f"  • {quote['carrier']} - {quote['product']}")
            if quote['status']:
                print(f"    Status: {', '.join(quote['status'])}")
    
    # Calculate summary stats
    if eligible_quotes:
        prices = []
        for q in eligible_quotes:
            if 'monthly_price' in q:
                price_str = q['monthly_price'].replace('$', '').replace(',', '')
                try:
                    prices.append(float(price_str))
                except:
                    pass
        
        if prices:
            print(f"\n💰 Price Summary")
            print("-" * 60)
            print(f"  Lowest Premium: ${min(prices):.2f}/month")
            print(f"  Highest Premium: ${max(prices):.2f}/month")
            print(f"  Average Premium: ${sum(prices)/len(prices):.2f}/month")


async def execute_workflow():
    """Execute the Best Plan Pro workflow through ngrok"""
    exit_stack = AsyncExitStack()
    
    try:
        # Load workflow
        print("📂 Loading workflow.json...")
        with open('workflow.json', 'r') as f:
            workflow_data = json.load(f)
        
        print(f"📋 Workflow: {workflow_data['workflow']['name']}")
        print(f"   Version: {workflow_data['workflow']['version']}")
        print(f"   Steps: {len(workflow_data['workflow']['steps'])}")
        
        # Extract applicant info from workflow
        applicant_info = extract_applicant_info(workflow_data)
        
        # Connect to ngrok endpoint
        ngrok_url = "https://select-merely-gelding.ngrok-free.app/mcp"
        print(f"\n🔌 Connecting to {ngrok_url}...")
        
        transport = await exit_stack.enter_async_context(
            streamablehttp_client(ngrok_url)
        )
        
        session = await exit_stack.enter_async_context(
            ClientSession(transport[0], transport[1])
        )
        
        await session.initialize()
        print("✅ Connected successfully!")
        
        # Convert workflow steps to MCP format
        tools = []
        for step in workflow_data['workflow']['steps']:
            tool_call = {
                "tool_name": step['action'],
                "arguments": {}
            }
            
            # Add parameters as arguments
            if 'parameters' in step:
                tool_call['arguments'].update(step['parameters'])
            
            # Add selector if present
            if 'selector' in step:
                tool_call['arguments']['selector'] = step['selector']
            
            # Add alternative selectors if present
            if 'alternative_selectors' in step:
                tool_call['arguments']['alternative_selectors'] = step['alternative_selectors']
            
            tools.append(tool_call)
            print(f"   Step {step['step']}: {step['action']} - {step.get('description', '')}")
        
        # Execute the sequence - Note: tools_json expects a JSON string!
        print(f"\n🚀 Executing {len(tools)} steps...")
        result = await session.call_tool("execute_sequence", arguments={
            "tools_json": json.dumps(tools),  # Serialize to JSON string
            "stop_on_error": True,
            "include_detailed_results": True
        })
        
        print("\n✅ Workflow execution completed!")
        
        # Parse and display results
        if hasattr(result, 'content'):
            for item in result.content:
                if hasattr(item, 'text'):
                    result_data = json.loads(item.text)
                    
                    # Find the final UI tree capture
                    for step_result in result_data.get('results', []):
                        if step_result.get('tool_name') == 'get_focused_window_tree':
                            ui_tree = step_result.get('result', {}).get('content', [{}])[0].get('text', '')
                            
                            # Parse quotes from UI tree
                            quotes = parse_quote_results(ui_tree)
                            
                            # Display summary
                            display_summary(quotes, applicant_info)
                            
                            # Save to JSON file
                            with open('quote_results.json', 'w') as f:
                                json.dump({
                                    'timestamp': result_data.get('timestamp'),
                                    'total_duration_ms': result_data.get('total_duration_ms'),
                                    'quotes': quotes,
                                    'applicant_info': applicant_info
                                }, f, indent=2)
                            
                            print("\n💾 Results saved to quote_results.json")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await exit_stack.aclose()


if __name__ == "__main__":
    print("🤖 Best Plan Pro Insurance Quote Automation")
    print("=" * 50)
    asyncio.run(execute_workflow()) 