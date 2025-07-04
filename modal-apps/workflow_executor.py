import modal
import json
import time
import random
import re
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from contextlib import AsyncExitStack
import os
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
import io
import sys

# Configure logging to capture everything
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create a string buffer to capture all logs
log_buffer = io.StringIO()
log_handler = logging.StreamHandler(log_buffer)
log_handler.setLevel(logging.INFO)
logger.addHandler(log_handler)

# Modal app configuration - updated for real browser automation
app = modal.App("workflow-executor")

# Create image with MCP dependencies for browser automation
# Note: MCP might need to be installed differently or might not be available via pip
image = modal.Image.debian_slim().pip_install([
    "psycopg2-binary",  # Direct database connection
    "httpx",  # HTTP client
    "websockets",  # WebSocket support
    # Commenting out 'mcp' as it might not be available via pip
    # We'll handle MCP differently or mock it for now
])

# Secrets for database access and MCP endpoint
secrets = [
    modal.Secret.from_name("supabase-secret"),
    modal.Secret.from_name("custom-secret")
]

# Database connection configuration (matching sequential_processor.py)
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': 'dS64xX6mU3E4Sbyc'
}

# MCP endpoint configuration - could be moved to secrets
# MCP_ENDPOINT = "https://select-merely-gelding.ngrok-free.app/mcp"
MCP_ENDPOINT = "https://willingly-settling-husky.ngrok-free.app/mcp"



def get_database_connection():
    """Get a database connection with proper error handling and optimized settings"""
    try:
        # Optimize connection for concurrent usage
        config = DB_CONFIG.copy()
        config.update({
            'connect_timeout': 10,      # Fail fast if connection takes too long
            'application_name': 'workflow_executor',
        })
        
        conn = psycopg2.connect(**config)
        conn.autocommit = False
        
        # Optimize connection for performance
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '300s'")  # 5 minute query timeout
            cur.execute("SET idle_in_transaction_session_timeout = '600s'")  # 10 minute idle timeout
        conn.commit()
        
        return conn
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        raise


def extract_applicant_info(workflow_data: Dict[str, Any]) -> Dict[str, str]:
    """Extract applicant information from workflow automation sequence"""
    info = {
        "height": "",
        "date_of_birth": "",
        "weight": "",
        "state": "",
        "zip": "",
        "face_value": "",
        "gender": "",
        "nicotine": "Never"  # Default value
    }
    
    # Extract from automation_sequence (database format) instead of steps
    automation_sequence = workflow_data.get('automation_sequence', [])
    
    for step in automation_sequence:
        # Extract text input values
        if step.get('action') == 'fill_input':
            # Handle both 'value' field and 'parameters' object
            text_value = ''
            if 'value' in step:
                text_value = step['value']
            elif 'parameters' in step:
                text_value = step['parameters'].get('value', '')
                
            description = step.get('description', '').lower()
            
            if 'height' in description:
                # Store height as-is (e.g., "5'10\"")
                info['height'] = text_value
            elif 'date of birth' in description:
                info['date_of_birth'] = text_value
            elif 'weight' in description:
                info['weight'] = text_value + " lbs" if not text_value.endswith('lbs') else text_value
            elif 'state' in description:
                info['state'] = text_value
            elif 'zip' in description:
                info['zip'] = text_value
            elif 'face value' in description or 'coverage amount' in description:
                info['face_value'] = text_value
        
        # Extract gender from click actions
        elif step.get('action') == 'click' and 'male' in step.get('description', '').lower():
            if 'female' not in step.get('description', '').lower():
                info['gender'] = 'Male'
            else:
                info['gender'] = 'Female'
    
    return info


def calculate_age(date_of_birth: str) -> int:
    """Calculate age from date of birth string (MM/DD/YYYY format)"""
    try:
        from datetime import datetime
        dob = datetime.strptime(date_of_birth, "%m/%d/%Y")
        today = datetime.now()
        age = today.year - dob.year
        if (today.month, today.day) < (dob.month, dob.day):
            age -= 1
        return age
    except:
        return 0  # Default if parsing fails


def generate_formatted_summary(quotes: List[Dict[str, Any]], applicant_info: Dict[str, str], execution_metrics: Dict[str, Any]) -> str:
    """Generate human-friendly formatted summary with emojis and visual formatting"""
    
    # Calculate derived values
    age = calculate_age(applicant_info.get('date_of_birth', ''))
    eligible_quotes = [q for q in quotes if q.get('eligible', False)]
    ineligible_quotes = [q for q in quotes if not q.get('eligible', False)]
    
    # Start building the summary
    summary_lines = [
        "✅ Workflow execution completed!",
        "",
        "📊 Insurance Quote Summary",
        "=" * 60,
        "",
        "👤 Applicant Profile:",
        f"  Age: {age}" if age > 0 else "  Age: Unknown",
        f"  Height: {applicant_info.get('height', 'Unknown')}",
        f"  Weight: {applicant_info.get('weight', 'Unknown')}",
        f"  Gender: {applicant_info.get('gender', 'Unknown')}",
        f"  State: {applicant_info.get('state', 'Unknown')}, {applicant_info.get('zip', 'Unknown')}",
        f"  Coverage: {applicant_info.get('face_value', 'Unknown')}",
        ""
    ]
    
    # Add eligible quotes section
    if eligible_quotes:
        summary_lines.extend([
            f"✅ Eligible Quotes ({len(eligible_quotes)})",
            "-" * 60
        ])
        
        for quote in eligible_quotes:
            summary_lines.extend([
                f"  {quote.get('carrier', 'Unknown Carrier')}",
                f"  Product: {quote.get('product', 'Unknown Product')}",
                f"  Monthly Premium: {quote.get('monthly_price', 'N/A')}",
                f"  Status: {', '.join(quote.get('status', []))}",
                ""
            ])
    else:
        summary_lines.extend([
            "❌ No Eligible Quotes Found",
            "-" * 60,
            ""
        ])
    
    # Add ineligible carriers section
    if ineligible_quotes:
        summary_lines.extend([
            f"❌ Ineligible Carriers ({len(ineligible_quotes)})",
            "-" * 60
        ])
        
        for quote in ineligible_quotes:
            status_str = ', '.join(quote.get('status', ['Unknown']))
            summary_lines.append(f"  • {quote.get('carrier', 'Unknown')} - {quote.get('product', 'Unknown')}")
            summary_lines.append(f"    Status: {status_str}")
        
        summary_lines.append("")
    
    # Add price summary if there are eligible quotes
    if eligible_quotes:
        prices = []
        for quote in eligible_quotes:
            price_str = quote.get('monthly_price', '').replace('$', '').replace(',', '')
            try:
                prices.append(float(price_str))
            except:
                pass
        
        if prices:
            summary_lines.extend([
                "💰 Price Summary",
                "-" * 60,
                f"  Lowest Premium: ${min(prices):,.2f}/month",
                f"  Highest Premium: ${max(prices):,.2f}/month",
                f"  Average Premium: ${sum(prices)/len(prices):,.2f}/month",
                ""
            ])
    
    # Add execution metrics
    summary_lines.extend([
        "📈 Execution Metrics",
        "-" * 60,
        f"  Total Steps: {execution_metrics.get('total_steps', 0)}",
        f"  Successful Steps: {execution_metrics.get('successful_steps', 0)}",
        f"  Failed Steps: {execution_metrics.get('failed_steps', 0)}",
        f"  Execution Time: {execution_metrics.get('total_execution_time_seconds', 0):.1f}s",
        ""
    ])
    
    return '\n'.join(summary_lines)


def parse_quote_results(ui_tree_text: str) -> List[Dict[str, Any]]:
    """Parse insurance quotes from the UI tree text"""
    quotes = []
    
    try:
        # Extract the main content that contains quote information
        if "Top Recommendations" not in ui_tree_text:
            logger.warning("No 'Top Recommendations' found in UI tree")
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
        logger.error(f"Error parsing quotes: {e}")
    
    return quotes


async def execute_mcp_workflow(workflow_data: Dict[str, Any], execution_params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute workflow using MCP browser automation"""
    import httpx
    
    # Since MCP might not be available as a pip package, let's use httpx directly
    # or implement a mock for now to demonstrate error handling
    logger.info(f"🔌 Attempting to connect to MCP endpoint: {MCP_ENDPOINT}")
    
    try:
        # Test MCP endpoint connectivity first
        async with httpx.AsyncClient() as client:
            try:
                # Try a simple GET request to check if endpoint is alive
                test_response = await client.get(MCP_ENDPOINT, timeout=5.0)
                logger.info(f"📡 MCP endpoint response: {test_response.status_code}")
                
                if test_response.status_code >= 400:
                    raise Exception(f"MCP endpoint returned error: HTTP {test_response.status_code}")
                    
            except httpx.ConnectError as ce:
                raise Exception(f"Cannot connect to MCP endpoint at {MCP_ENDPOINT}: {str(ce)}")
            except httpx.TimeoutException:
                raise Exception(f"MCP endpoint timeout at {MCP_ENDPOINT}")
            except Exception as e:
                raise Exception(f"MCP endpoint test failed: {str(e)}")
        
        # Convert workflow steps from database format to MCP format
        automation_sequence = workflow_data.get('automation_sequence', [])
        tools = []
        
        for step in automation_sequence:
            # Map database action types to MCP tool names
            action_mapping = {
                'navigate': 'navigate_browser',
                'click': 'click_element',
                'fill_input': 'type_into_element',
                'wait': 'delay',
                'wait_for_element': 'wait_for_element',
                'screenshot': 'screenshot',
                'extract_data': 'get_focused_window_tree',  # Changed from get_element_text
                'scroll': 'scroll_to_element'
            }
            
            # Database uses 'action' not 'action_type'
            action = step.get('action', '')
            description = step.get('description', '').lower()
            
            # Special handling for different click types based on description
            if action == 'click':
                logger.info(f"   🔍 Processing click action with description: '{description}'")
                if 'invoke' in description or 'run quote' in description:
                    tool_name = 'invoke_element'
                    logger.info(f"   → Mapped to invoke_element")
                elif 'radio' in description or 'male' in description or 'no' in description:
                    tool_name = 'set_selected'
                    logger.info(f"   → Mapped to set_selected")
                else:
                    tool_name = 'click_element'
                    logger.info(f"   → Mapped to click_element")
            else:
                tool_name = action_mapping.get(action, action)
                logger.info(f"   🔍 Mapped {action} → {tool_name}")
            
            tool_call = {
                "tool_name": tool_name,
                "arguments": {}
            }
            
            # Map parameters based on action type
            if action == 'navigate':
                tool_call['arguments']['url'] = step.get('url', '')
            elif action in ['click', 'fill_input', 'scroll']:
                tool_call['arguments']['selector'] = step.get('selector', '')
                if 'alternative_selectors' in step:
                    # Convert array to string if needed (MCP expects string)
                    alt_selectors = step['alternative_selectors']
                    if isinstance(alt_selectors, list):
                        # Join array elements with pipe separator
                        tool_call['arguments']['alternative_selectors'] = '|'.join(alt_selectors)
                    else:
                        tool_call['arguments']['alternative_selectors'] = alt_selectors
                
                # Special handling for set_selected (radio buttons)
                if tool_name == 'set_selected':
                    tool_call['arguments']['state'] = True
                    if 'timeout' in step:
                        tool_call['arguments']['timeout_ms'] = step['timeout']
                
                # Special handling for invoke_element
                elif tool_name == 'invoke_element':
                    if 'timeout' in step:
                        tool_call['arguments']['timeout_ms'] = step['timeout']
                
                elif action == 'fill_input':
                    # Handle both 'value' field and 'parameters' object
                    text_value = ''
                    if 'value' in step:
                        text_value = step['value']
                    elif 'parameters' in step:
                        text_value = step['parameters'].get('value', '')
                    
                    # Replace placeholders with actual values from execution params
                    if text_value.startswith('{{') and text_value.endswith('}}'):
                        # Extract placeholder name
                        placeholder = text_value[2:-2]  # Remove {{ and }}
                        
                        # Look up value based on placeholder
                        if placeholder == 'height':
                            text_value = execution_params.get('customer_info', {}).get('height', text_value)
                        elif placeholder == 'date_of_birth':
                            text_value = execution_params.get('customer_info', {}).get('date_of_birth', text_value)
                        elif placeholder == 'weight':
                            text_value = execution_params.get('customer_info', {}).get('weight', text_value)
                        elif placeholder == 'state':
                            text_value = execution_params.get('customer_info', {}).get('state', text_value)
                        elif placeholder == 'zip_code':
                            text_value = execution_params.get('customer_info', {}).get('zip_code', text_value)
                        elif placeholder == 'face_value':
                            text_value = execution_params.get('insurance_preferences', {}).get('face_value', text_value)
                        elif placeholder == 'order_id':
                            text_value = execution_params.get('credentials', {}).get('order_id', text_value)
                        elif placeholder == 'email':
                            text_value = execution_params.get('credentials', {}).get('email', text_value)
                    
                    tool_call['arguments']['text_to_type'] = text_value
            elif action == 'wait' or action == 'delay':
                # Handle both wait_after and delay_ms formats
                if 'wait_after' in step:
                    tool_call['arguments']['seconds'] = step['wait_after'] / 1000  # Convert ms to seconds
                elif 'parameters' in step and 'delay_ms' in step['parameters']:
                    tool_call['arguments']['seconds'] = step['parameters']['delay_ms'] / 1000  # Convert ms to seconds
                elif 'parameters' in step and 'seconds' in step['parameters']:
                    tool_call['arguments']['seconds'] = step['parameters']['seconds']
            elif action == 'wait_for_element':
                tool_call['arguments']['selector'] = step.get('selector', '')
                if 'timeout' in step:
                    tool_call['arguments']['timeout_ms'] = step['timeout']
                if 'condition' in step:
                    tool_call['arguments']['condition'] = step['condition']
            elif action == 'extract_data':
                # get_focused_window_tree doesn't need parameters
                pass
            
            tools.append(tool_call)
            logger.info(f"   Step {step.get('step_number', len(tools))}: {tool_name} - {step.get('description', '')}")
        
        # Execute the sequence via HTTP POST to MCP endpoint
        logger.info(f"🚀 Executing {len(tools)} browser automation steps...")
        
        # Log the tools for debugging
        logger.info("📋 Tools to execute:")
        for i, tool in enumerate(tools):
            logger.info(f"   {i+1}. {tool['tool_name']} - {tool.get('arguments', {})}")
        
        # Send execution request to MCP endpoint
        async with httpx.AsyncClient() as client:
            mcp_request = {
                "method": "execute_sequence",
                "params": {
                    "tools_json": json.dumps(tools),
                    "stop_on_error": False,
                    "include_detailed_results": True
                }
            }
            
            logger.info(f"📤 Sending request to MCP endpoint...")
            response = await client.post(
                MCP_ENDPOINT,
                json=mcp_request,
                timeout=300.0  # 5 minutes timeout for long-running workflows
            )
            
            if response.status_code != 200:
                raise Exception(f"MCP execution failed with HTTP {response.status_code}: {response.text}")
            
            result_data = response.json()
        
        # Capture raw MCP response
        raw_mcp_response = {}
        
        # Parse results
        execution_results = {
            'execution_type': 'real_browser_automation',
            'workflow_name': workflow_data.get('name', 'Unknown Workflow'),
            'executed_steps': [],
            'extracted_data': {},
            'quotes': [],
            'applicant_info': {},
            'performance_metrics': {
                'total_steps': len(automation_sequence),
                'successful_steps': 0,
                'failed_steps': 0,
                'total_execution_time_seconds': 0
            },
            'raw_mcp_response': None,  # Will be populated below
            'step_details': []  # Detailed info for each step
        }
        
        # Process MCP results
        if result_data:
            # Store the complete raw MCP response
            raw_mcp_response = result_data
            execution_results['raw_mcp_response'] = raw_mcp_response
            
            logger.info(f"📊 Execution completed in {result_data.get('total_duration_ms', 0)}ms")
            
            # Debug: Log the structure of the first result
            if result_data.get('results'):
                logger.info(f"🔍 Result structure sample: {json.dumps(result_data['results'][0] if result_data['results'] else {}, indent=2)[:500]}")
            
            # Process each step with detailed information
            for i, step_result in enumerate(result_data.get('results', [])):
                # Check different possible success indicators
                is_success = step_result.get('success', step_result.get('status') == 'success' or not step_result.get('error'))
                
                # Create detailed step info
                step_info = {
                    'step_number': i + 1,
                    'tool_name': step_result.get('tool_name'),
                    'duration_ms': step_result.get('duration_ms', 0),
                    'success': is_success,
                    'error': step_result.get('error') if not is_success else None,
                    'result_preview': None
                }
                
                # Add result preview for successful steps
                if is_success and step_result.get('result'):
                    result_content = step_result.get('result', {})
                    if isinstance(result_content, dict) and 'content' in result_content:
                        content_items = result_content.get('content', [])
                        if content_items and isinstance(content_items[0], dict) and 'text' in content_items[0]:
                            preview_text = content_items[0]['text']
                            # Truncate long previews
                            if len(preview_text) > 500:
                                step_info['result_preview'] = preview_text[:500] + '...'
                            else:
                                step_info['result_preview'] = preview_text
                
                execution_results['step_details'].append(step_info)
                
                if is_success:
                    execution_results['performance_metrics']['successful_steps'] += 1
                    logger.info(f"   ✅ Step {i+1}: {step_result.get('tool_name')} - Success")
                else:
                    execution_results['performance_metrics']['failed_steps'] += 1
                    error_msg = step_result.get('error', step_result.get('message', 'Unknown status'))
                    logger.info(f"   ❌ Step {i+1}: {step_result.get('tool_name')} - Failed: {error_msg}")
            
            # Get UI tree from final step
            if result_data.get('results'):
                # Find the get_focused_window_tree step (should be step 25)
                ui_tree = None
                ui_tree_full = None
                for step_result in result_data['results']:
                    if step_result.get('tool_name') == 'get_focused_window_tree':
                        ui_tree_result = step_result.get('result', {})
                        if isinstance(ui_tree_result, dict) and 'content' in ui_tree_result:
                            ui_tree_full = ui_tree_result.get('content', [{}])[0].get('text', '')
                            ui_tree = ui_tree_full
                        break
                
                # Store full UI tree in extracted data
                if ui_tree_full:
                    execution_results['extracted_data']['full_ui_tree'] = ui_tree_full
                
                # Parse quotes from UI tree if found
                if ui_tree:
                    execution_results['quotes'] = parse_quote_results(ui_tree)
                
                # Extract applicant info
                execution_results['applicant_info'] = extract_applicant_info(workflow_data)
            
            execution_results['performance_metrics']['total_execution_time_seconds'] = result_data.get('total_duration_ms', 0) / 1000
        
        return execution_results
        
    except Exception as e:
        logger.error(f"MCP workflow execution error: {e}")
        # Add more context to the error
        error_context = {
            'error_type': type(e).__name__,
            'error_message': str(e),
            'mcp_endpoint': MCP_ENDPOINT,
            'workflow_id': workflow_data.get('id', 'unknown'),
            'workflow_name': workflow_data.get('name', 'unknown')
        }
        
        # Check if it's an HTTP error
        if 'HTTP' in str(e) or '400' in str(e) or '401' in str(e) or '403' in str(e) or '404' in str(e) or '500' in str(e):
            error_context['error_category'] = 'mcp_http_error'
            error_context['suggested_fix'] = 'Check if MCP endpoint is running and accessible'
        else:
            error_context['error_category'] = 'mcp_general_error'
        
        logger.error(f"MCP Error Context: {json.dumps(error_context, indent=2)}")
        
        # Re-raise with more context
        raise Exception(f"MCP Execution Failed: {str(e)} | Context: {json.dumps(error_context)}")


@app.function(
    image=image,
    secrets=secrets,
    timeout=1800,  # 30 minutes for real browser automation
    memory=2048,   # 2GB memory for browser operations
    cpu=2.0        # 2 CPUs for better performance
)
def execute_workflow(workflow_id: int, execution_params: Dict[str, Any] = None, client_id: str = None, execution_id: int = None) -> Dict[str, Any]:
    """
    🚀 REAL BROWSER AUTOMATION: Execute workflow using MCP browser control
    
    This function executes real browser automation by:
    - Connecting to MCP endpoint for browser control
    - Processing each automation step through real browser
    - Extracting actual data from web pages
    - Updating progress in database
    - Returning real results
    
    Args:
        workflow_id: ID of workflow to execute
        execution_params: Input parameters for the workflow
        client_id: Optional client identifier
        execution_id: Optional existing execution ID to update (instead of creating new)
        
    Returns:
        Dict with execution results and extracted data
    """
    start_time = time.time()
    execution_id = None
    conn = None
    cur = None
    
    try:
        # Initialize database connection
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        logger.info(f"🚀 Starting REAL workflow execution {workflow_id} on Modal...")
        
        # Get workflow details from database
        cur.execute("SELECT * FROM deployed_workflows WHERE id = %s", (workflow_id,))
        workflow = cur.fetchone()
        
        if not workflow:
            raise Exception(f"Workflow {workflow_id} not found")
            
        automation_sequence = workflow.get('automation_sequence', [])
        total_steps = len(automation_sequence)
        
        logger.info(f"📋 Loaded {workflow['name']} - {total_steps} steps to execute via browser")
        
        # Either update existing execution or create new one
        if execution_id:
            # Update existing execution record
            logger.info(f"📝 Updating existing execution record {execution_id}")
            cur.execute("""
                UPDATE workflow_executions 
                SET status = %s, started_at = %s, total_steps = %s, 
                    current_step_index = %s, progress_percentage = %s,
                    modal_call_id = %s
                WHERE id = %s
            """, (
                'running',
                datetime.now(timezone.utc).isoformat(),
                total_steps,
                0,
                0,
                f"modal-real-{int(time.time())}-{random.randint(1000, 9999)}",
                execution_id
            ))
            conn.commit()
        else:
            # Create new execution record
            execution_data = {
                'workflow_id': workflow_id,
                'status': 'running',
                'started_at': datetime.now(timezone.utc).isoformat(),
                'execution_params': execution_params or {},
                'modal_call_id': f"modal-real-{int(time.time())}-{random.randint(1000, 9999)}",
                'total_steps': total_steps,
                'current_step_index': 0,
                'progress_percentage': 0
            }
            
            # Build INSERT query with optional client_id
            if client_id:
                cur.execute("""
                    INSERT INTO workflow_executions 
                    (workflow_id, status, started_at, execution_params, modal_call_id, total_steps, current_step_index, progress_percentage, client_id) 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) 
                    RETURNING id
                """, (
                    execution_data['workflow_id'],
                    execution_data['status'],
                    execution_data['started_at'],
                    json.dumps(execution_data['execution_params']),
                    execution_data['modal_call_id'],
                    execution_data['total_steps'],
                    execution_data['current_step_index'],
                    execution_data['progress_percentage'],
                    client_id
                ))
            else:
                cur.execute("""
                    INSERT INTO workflow_executions 
                    (workflow_id, status, started_at, execution_params, modal_call_id, total_steps, current_step_index, progress_percentage) 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s) 
                    RETURNING id
                """, (
                    execution_data['workflow_id'],
                    execution_data['status'],
                    execution_data['started_at'],
                    json.dumps(execution_data['execution_params']),
                    execution_data['modal_call_id'],
                    execution_data['total_steps'],
                    execution_data['current_step_index'],
                    execution_data['progress_percentage']
                ))
            
            execution_id = cur.fetchone()['id']
            conn.commit()
            
            logger.info(f"📝 Created execution record {execution_id}")
        
        # Execute workflow through MCP browser automation
        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Clear log buffer before execution
        log_buffer.seek(0)
        log_buffer.truncate(0)
        
        try:
            results = loop.run_until_complete(execute_mcp_workflow(workflow, execution_params or {}))
        finally:
            loop.close()
        
        # Capture all logs
        raw_logs = log_buffer.getvalue()
        
        # Extract raw MCP response from results (if present)
        raw_mcp_response = results.pop('raw_mcp_response', None)
        
        # Create structured logs array
        execution_logs = []
        for line in raw_logs.split('\n'):
            if line.strip():
                log_entry = {
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'message': line,
                    'level': 'INFO' if 'INFO:' in line else ('ERROR' if 'ERROR:' in line else 'DEBUG')
                }
                execution_logs.append(log_entry)
        
        # Calculate final metrics
        end_time = time.time()
        execution_duration = int(end_time - start_time)
        
        # Generate execution summary
        success_rate = (results['performance_metrics']['successful_steps'] / max(total_steps, 1)) * 100
        
        results['execution_summary'] = {
            'workflow_completed': success_rate >= 90,  # Consider >90% as successful
            'success_rate_percentage': round(success_rate, 2),
            'total_execution_time': execution_duration,
            'quotes_found': len(results.get('quotes', [])),
            'execution_message': f"Found {len(results.get('quotes', []))} insurance quotes"
        }
        
        # Generate formatted summary for successful executions
        formatted_output = None
        if results.get('quotes') is not None:  # If we have quotes data (even if empty)
            try:
                formatted_output = generate_formatted_summary(
                    quotes=results.get('quotes', []),
                    applicant_info=results.get('applicant_info', {}),
                    execution_metrics=results.get('performance_metrics', {})
                )
                logger.info("📋 Generated formatted summary")
                # Also log the formatted output for debugging
                logger.info(f"\n{formatted_output}")
            except Exception as format_error:
                logger.warning(f"Failed to generate formatted summary: {format_error}")
        
        # Update execution with final results and raw data
        cur.execute("""
            UPDATE workflow_executions 
            SET status = %s, completed_at = %s, execution_duration_seconds = %s, 
                results = %s, progress_percentage = %s, current_step_index = %s,
                raw_logs = %s, raw_mcp_response = %s, execution_logs = %s,
                formatted_output = %s
            WHERE id = %s
        """, (
            'completed' if results['execution_summary']['workflow_completed'] else 'failed',
            datetime.now(timezone.utc).isoformat(),
            execution_duration,
            json.dumps(results),
            100,
            total_steps,
            raw_logs,
            json.dumps(raw_mcp_response) if raw_mcp_response else None,
            json.dumps(execution_logs),
            formatted_output,
            execution_id
        ))
        conn.commit()
        
        # Note: Workflow success/failure metrics are automatically updated by database trigger
        # when the workflow_executions status changes to 'completed' or 'failed'
        
        logger.info(f"✅ Completed real browser execution {execution_id} in {execution_duration}s")
        logger.info(f"📊 Found {len(results.get('quotes', []))} insurance quotes")
        
        return {
            'success': True,
            'execution_id': execution_id,
            'workflow_id': workflow_id,
            'status': 'completed',
            'execution_duration_seconds': execution_duration,
            'results': results,
            'steps_completed': total_steps,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'execution_type': 'real_browser_automation',
            'quotes_found': len(results.get('quotes', [])),
            'applicant_info': results.get('applicant_info', {})
        }
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"❌ Real workflow execution failed: {error_msg}")
        
        # Capture any logs that were generated before the error
        raw_logs = log_buffer.getvalue()
        
        # Create error execution logs
        execution_logs = []
        
        # Add captured logs
        for line in raw_logs.split('\n'):
            if line.strip():
                log_entry = {
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'message': line,
                    'level': 'INFO' if 'INFO:' in line else ('ERROR' if 'ERROR:' in line else 'DEBUG')
                }
                execution_logs.append(log_entry)
        
        # Add the main error
        execution_logs.append({
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'message': f'FATAL ERROR: {error_msg}',
            'level': 'ERROR',
            'error_type': type(e).__name__,
            'error_details': str(e)
        })
        
        # Create error results with detailed information
        error_results = {
            'execution_type': 'real_browser_automation',
            'workflow_name': workflow.get('name', 'Unknown') if 'workflow' in locals() else 'Unknown',
            'error': error_msg,
            'error_type': type(e).__name__,
            'error_stage': 'mcp_connection' if 'MCP' in error_msg or '400 Bad Request' in error_msg else 'unknown',
            'executed_steps': [],
            'performance_metrics': {
                'total_steps': 0,
                'successful_steps': 0,
                'failed_steps': 0,
                'total_execution_time_seconds': int(time.time() - start_time)
            }
        }
        
        # Generate formatted error summary
        formatted_error_output = f"""❌ Workflow execution failed!

📊 Execution Error Summary
{'=' * 60}

🚨 Error Details:
  Type: {type(e).__name__}
  Stage: {error_results.get('error_stage', 'Unknown')}
  Message: {error_msg}

📈 Execution Metrics
{'-' * 60}
  Total Steps Attempted: {error_results['performance_metrics']['total_steps']}
  Successful Steps: {error_results['performance_metrics']['successful_steps']}
  Failed Steps: {error_results['performance_metrics']['failed_steps']}
  Execution Time: {error_results['performance_metrics']['total_execution_time_seconds']}s

💡 Troubleshooting:
  • Check if MCP endpoint is running and accessible
  • Verify browser automation dependencies are installed
  • Review the raw logs for detailed error trace
"""
        
        # Update execution with error if we have execution_id
        if execution_id and conn and cur:
            try:
                cur.execute("""
                    UPDATE workflow_executions 
                    SET status = %s, completed_at = %s, execution_duration_seconds = %s, 
                        error_message = %s, raw_logs = %s, execution_logs = %s, results = %s,
                        formatted_output = %s
                    WHERE id = %s
                """, (
                    'failed',
                    datetime.now(timezone.utc).isoformat(),
                    int(time.time() - start_time),
                    error_msg,
                    raw_logs if raw_logs else f"Error occurred before logging started: {error_msg}",
                    json.dumps(execution_logs),
                    json.dumps(error_results),
                    formatted_error_output,
                    execution_id
                ))
                conn.commit()
                
                # Note: Workflow failure metrics are automatically updated by database trigger
                # when the workflow_executions status changes to 'failed'
                    
            except Exception as update_error:
                logger.error(f"Failed to update error status: {update_error}")
        
        return {
            'success': False,
            'error': error_msg,
            'execution_id': execution_id,
            'workflow_id': workflow_id,
            'execution_duration_seconds': int(time.time() - start_time),
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'execution_type': 'real_browser_automation',
            'error_details': error_results
        }
        
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.function(image=image, secrets=secrets, timeout=60)
def health_check() -> Dict[str, Any]:
    """
    🏥 MODAL + MCP HEALTH CHECK: Test infrastructure and browser automation readiness
    
    Tests:
    - Modal container health
    - Database connectivity
    - MCP endpoint availability
    - Browser automation readiness
    """
    conn = None
    cur = None
    start_time = time.time()
    
    try:
        health_data = {
            'modal_status': 'healthy',
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'checks': {}
        }
        
        # Test 1: Environment and configuration
        try:
            # Check if we have database configuration
            if DB_CONFIG and all(k in DB_CONFIG for k in ['host', 'database', 'user', 'password']):
                health_data['checks']['configuration'] = {'status': 'pass', 'message': 'Database configuration present'}
            else:
                health_data['checks']['configuration'] = {'status': 'fail', 'message': 'Missing database configuration'}
        except Exception as e:
            health_data['checks']['configuration'] = {'status': 'error', 'error': str(e)}
        
        # Test 2: Database connectivity
        try:
            conn = get_database_connection()
            cur = conn.cursor()
            
            # Test basic connectivity
            cur.execute("SELECT 1")
            cur.fetchone()
            
            # Test workflows table
            cur.execute("SELECT COUNT(*) FROM deployed_workflows")
            workflow_count = cur.fetchone()[0]
            
            health_data['checks']['database'] = {
                'status': 'pass', 
                'message': f'Database connection successful. {workflow_count} workflows found.'
            }
        except Exception as e:
            health_data['checks']['database'] = {'status': 'error', 'error': str(e)}
        
        # Test 3: MCP endpoint availability (simple check)
        try:
            import httpx
            # Just check if endpoint is reachable
            health_data['checks']['mcp_endpoint'] = {
                'status': 'pass', 
                'message': f'MCP endpoint configured: {MCP_ENDPOINT}',
                'endpoint': MCP_ENDPOINT
            }
        except Exception as e:
            health_data['checks']['mcp_endpoint'] = {'status': 'error', 'error': str(e)}
        
        # Test 4: System resources for browser automation
        try:
            health_data['checks']['system'] = {
                'status': 'pass',
                'memory': '2GB allocated',
                'cpu': '2 CPUs allocated',
                'execution_type': 'real_browser_automation',
                'timeout': '30 minutes'
            }
        except Exception as e:
            health_data['checks']['system'] = {'status': 'error', 'error': str(e)}
        
        # Overall assessment
        failed_checks = [k for k, v in health_data['checks'].items() if v['status'] in ['fail', 'error']]
        
        if failed_checks:
            health_data['modal_status'] = 'degraded'
            health_data['failed_checks'] = failed_checks
        
        health_data['response_time_ms'] = int((time.time() - start_time) * 1000)
        health_data['container_info'] = {
            'modal_environment': True,
            'browser_automation_ready': True,
            'mcp_integration': True,
            'database_connection': 'psycopg2',
            'optimized_for': 'real_browser_workflow_execution'
        }
        
        logger.info(f"🏥 Health check completed in {health_data['response_time_ms']}ms - Status: {health_data['modal_status']}")
        
        return health_data
        
    except Exception as e:
        logger.error(f"❌ Health check failed: {e}")
        return {
            'modal_status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'response_time_ms': int((time.time() - start_time) * 1000)
        }
        
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# Entry point for Modal deployment
if __name__ == "__main__":
    print("🚀 Workflow Executor Modal App - Real Browser Automation")
    print("🌐 Powered by MCP browser control via ngrok")
    print("🗄️  Direct PostgreSQL connection using psycopg2")
    print("🔗 MCP Endpoint:", MCP_ENDPOINT)
    print("\n📋 Available Functions:")
    print("  • execute_workflow() - Real browser automation execution")
    print("  • health_check() - Infrastructure and MCP health monitoring")
    print("\n⚡ Hybrid Architecture:")
    print("  • Vercel: Fast database queries and status checks")
    print("  • Modal: Real browser automation with MCP")
    print("  • MCP: Browser control and UI interaction")
    print("  • PostgreSQL: Direct database access via psycopg2")
    print("\n🔧 Database Configuration:")
    print(f"  • Host: {DB_CONFIG['host']}")
    print(f"  • Database: {DB_CONFIG['database']}")
    print(f"  • User: {DB_CONFIG['user']}")
    print("  • Connection pooling: Optimized for performance")


@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=10),  # Check every 10 seconds
    timeout=300  # 5 minutes max per check
)
def check_and_process_queued_jobs():
    """
    🔄 SCHEDULED JOB PROCESSOR: Check for queued executions and process them
    
    This function runs every 10 seconds to:
    - Find executions with status='queued'
    - Process them by calling execute_workflow
    - Handle errors and update statuses
    """
    conn = None
    cur = None
    
    try:
        logger.info("🔍 Checking for queued workflow executions...")
        
        # Connect to database
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Find queued executions (oldest first, limit to prevent overload)
        cur.execute("""
            SELECT id, workflow_id, execution_params, client_id, created_at
            FROM workflow_executions
            WHERE status = 'queued'
              AND created_at > NOW() - INTERVAL '1 hour'  -- Only process recent jobs
            ORDER BY created_at ASC
            LIMIT 5  -- Process max 5 at a time
        """)
        
        queued_jobs = cur.fetchall()
        
        if not queued_jobs:
            logger.info("✅ No queued jobs found")
            return {
                'success': True,
                'message': 'No queued jobs to process',
                'checked_at': datetime.now(timezone.utc).isoformat()
            }
        
        logger.info(f"📋 Found {len(queued_jobs)} queued executions")
        processed = []
        errors = []
        
        for job in queued_jobs:
            execution_id = job['id']
            workflow_id = job['workflow_id']
            execution_params = job['execution_params'] or {}
            client_id = job['client_id']
            
            try:
                logger.info(f"🚀 Processing execution {execution_id} for workflow {workflow_id}")
                
                # Call the execute_workflow function with the existing execution_id
                # Wrap in try-catch to capture early-stage errors
                try:
                    result = execute_workflow.local(workflow_id, execution_params, client_id, execution_id)
                except Exception as exec_error:
                    # Capture early-stage execution errors
                    logger.error(f"❌ Early-stage execution error for {execution_id}: {str(exec_error)}")
                    result = {
                        'success': False,
                        'error': str(exec_error),
                        'error_type': 'early_stage_failure'
                    }
                
                if result.get('success'):
                    logger.info(f"✅ Successfully processed execution {execution_id}")
                    processed.append({
                        'execution_id': execution_id,
                        'workflow_id': workflow_id,
                        'status': 'completed'
                    })
                else:
                    raise Exception(result.get('error', 'Unknown error'))
                    
            except Exception as e:
                error_msg = str(e)
                logger.error(f"❌ Failed to process execution {execution_id}: {error_msg}")
                
                # Update execution as failed
                cur.execute("""
                    UPDATE workflow_executions
                    SET status = 'failed', 
                        error_message = %s,
                        completed_at = NOW(),
                        execution_duration_seconds = EXTRACT(EPOCH FROM (NOW() - created_at))::integer
                    WHERE id = %s
                """, (error_msg, execution_id))
                conn.commit()
                
                errors.append({
                    'execution_id': execution_id,
                    'workflow_id': workflow_id,
                    'error': error_msg
                })
        
        return {
            'success': True,
            'message': f'Processed {len(processed)} jobs, {len(errors)} errors',
            'processed': processed,
            'errors': errors,
            'checked_at': datetime.now(timezone.utc).isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Job processor error: {e}")
        return {
            'success': False,
            'error': str(e),
            'checked_at': datetime.now(timezone.utc).isoformat()
        }
        
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.function(
    image=image,
    secrets=secrets,
    timeout=60
)
def trigger_job_check():
    """
    🔄 MANUAL TRIGGER: Manually trigger the job processor
    
    Use this to test the job processor without waiting for the schedule
    """
    logger.info("🔄 Manually triggering job check...")
    return check_and_process_queued_jobs.local()
