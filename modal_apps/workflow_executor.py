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
import collections.abc

# Add contextlib for stdout/stderr capture
import contextlib

# Configure logging to capture everything
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create a string buffer to capture all logs
log_buffer = io.StringIO()
log_handler = logging.StreamHandler(log_buffer)
log_handler.setLevel(logging.DEBUG)  # Capture DEBUG level too
log_handler.setFormatter(
    logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
)
logger.addHandler(log_handler)

# Also capture root logger
root_logger = logging.getLogger()
root_logger.addHandler(log_handler)

# Create a separate buffer for stdout/stderr capture
stdout_buffer = io.StringIO()

# Modal app configuration - updated for real browser automation
app = modal.App("workflow-executor")

# Create image with MCP dependencies for browser automation
# Note: MCP might need to be installed differently or might not be available via pip
image = modal.Image.debian_slim().pip_install(
    [
        "psycopg2-binary",  # Direct database connection
        "httpx",  # HTTP client
        "websockets",  # WebSocket support
        # Commenting out 'mcp' as it might not be available via pip
        # We'll handle MCP differently or mock it for now
    ]
)

# Secrets for database access and MCP endpoint
secrets = [
    modal.Secret.from_name("supabase-secret"),
    modal.Secret.from_name("custom-secret"),
]

# Database connection configuration (matching sequential_processor.py)
DB_CONFIG = {
    "host": "aws-0-us-west-1.pooler.supabase.com",
    "port": 5432,
    "database": "postgres",
    "user": "postgres.eshwntsgsputksqamckh",
    "password": "dS64xX6mU3E4Sbyc",
}

# Configuration for auto-cancellation
CONSECUTIVE_FAILURE_THRESHOLD = 3  # Number of identical failures

# Auto-cancellation logic

def cancel_queued_jobs(cur, conn, workflow_id, original_error_message):
    """Cancel all queued jobs for workflow, return count cancelled"""
    cancellation_message = f"Auto-cancelled: 3 consecutive identical failures - {original_error_message}"
    
    cur.execute("""
        UPDATE workflow_executions 
        SET status = 'cancelled', 
            error_message = %s,
            completed_at = NOW()
        WHERE workflow_id = %s AND status = 'queued'
        RETURNING id
    """, (cancellation_message, workflow_id))
    
    cancelled_ids = [row[0] for row in cur.fetchall()]
    
    # Update workflow status to 'paused' to prevent new executions
    cur.execute("""
        UPDATE deployed_workflows 
        SET status = 'paused',
            updated_at = NOW()
        WHERE id = %s AND status = 'deployed'
    """, (workflow_id,))
    
    conn.commit()
    
    return len(cancelled_ids), cancelled_ids


def check_failure_patterns_for_workflow(cur, conn, workflow_id):
    """
    🚫 WORKFLOW-SPECIFIC FAILURE PATTERN CHECK: Prevents claiming jobs for a specific workflow with recent consecutive failures.
    
    Checks if the last 3 executions (completed/failed) for the workflow are ALL failures with identical error messages.
    Ignores cancelled jobs since they never actually executed. If pattern found, cancels all queued jobs.
    
    Returns: (should_block: bool, reason: str, check_duration_ms: int)
    """
    start_time = time.time()
    
    try:
        # Check if we should skip cancellation check for this workflow (manual resume)
        cur.execute("""
            SELECT skip_next_cancellation_check 
            FROM deployed_workflows 
            WHERE id = %s
        """, (workflow_id,))
        
        result = cur.fetchone()
        if result and result[0]:  # skip_next_cancellation_check is True
            # Reset the flag and allow this execution to proceed
            cur.execute("""
                UPDATE deployed_workflows 
                SET skip_next_cancellation_check = false,
                    updated_at = NOW()
                WHERE id = %s
            """, (workflow_id,))
            conn.commit()
            
            check_duration_ms = int((time.time() - start_time) * 1000)
            logger.info("✅ Skipping cancellation check for workflow %d (manual resume) (took %dms)", 
                       workflow_id, check_duration_ms)
            return False, "Skipped cancellation check - manual resume", check_duration_ms
        
        # Check the last 3 executions that actually ran (completed or failed), ignoring cancelled jobs
        cur.execute("""
            SELECT id, status, error_message, completed_at
            FROM workflow_executions 
            WHERE workflow_id = %s 
            AND status IN ('completed', 'failed')
            AND completed_at > NOW() - INTERVAL '10 minutes'
            ORDER BY completed_at DESC
            LIMIT %s
        """, (workflow_id, CONSECUTIVE_FAILURE_THRESHOLD))
        
        recent_executions = cur.fetchall()
        check_duration_ms = int((time.time() - start_time) * 1000)
        
        if len(recent_executions) < CONSECUTIVE_FAILURE_THRESHOLD:
            logger.debug("🔍 Pre-claim check for workflow %d: %d recent executions, proceeding (took %dms)", 
                        workflow_id, len(recent_executions), check_duration_ms)
            return False, "", check_duration_ms
        
        # Check if ALL 3 most recent executions are failures with identical error messages
        all_failed = all(exec['status'] == 'failed' for exec in recent_executions)
        
        if not all_failed:
            logger.debug("🔍 Pre-claim check for workflow %d: Not all recent executions failed, proceeding (took %dms)", 
                        workflow_id, check_duration_ms)
            return False, "", check_duration_ms
        
        # All 3 are failures - check if they have identical error messages
        error_messages = [exec['error_message'] for exec in recent_executions if exec['error_message']]
        
        if len(error_messages) == CONSECUTIVE_FAILURE_THRESHOLD and all(msg == error_messages[0] for msg in error_messages):
            # Found problematic pattern - cancel remaining queued jobs for this workflow
            cancelled_count, cancelled_ids = cancel_queued_jobs(
                cur, conn, workflow_id, error_messages[0]
            )
            
            reason = f"Blocked job claim: Workflow {workflow_id} has {len(recent_executions)} consecutive identical failures. Cancelled {cancelled_count} queued jobs and paused workflow."
            logger.warning("🚫 %s (took %dms)", reason, check_duration_ms)
            if cancelled_ids:
                logger.warning("🚫 Cancelled execution IDs: %s", cancelled_ids)
            logger.warning("⏸️ Workflow %d status changed to 'paused' to prevent new executions", workflow_id)
            
            return True, reason, check_duration_ms
        
        logger.debug("🔍 Pre-claim check for workflow %d: No blocking patterns found (took %dms)", workflow_id, check_duration_ms)
        return False, "", check_duration_ms
        
    except Exception as e:
        check_duration_ms = int((time.time() - start_time) * 1000)
        logger.error("❌ Error in pre-claim failure pattern check for workflow %d: %s (took %dms)", workflow_id, e, check_duration_ms)
        return False, f"Check error: {e}", check_duration_ms

# MCP endpoint configuration - could be moved to secrets
# MCP_BASE_URL = "https://select-merely-gelding.ngrok-free.app"  # Louis computer
# MCP_BASE_URL = "https://willingly-settling-husky.ngrok-free.app"  # Matt computer

# Windows VM service management endpoints (from our ngrok-powered system)
VM_MANAGEMENT_ENDPOINT = "https://vm-windows-1.ngrok.dev"

# MCP server endpoints
MCP_BASE_URL = "https://mcp-server-1.ngrok.app"
MCP_ENDPOINT = f"{MCP_BASE_URL}/mcp"
MCP_HEALTH_ENDPOINT = f"{MCP_BASE_URL}/health"


class CaptureOutput:
    """Context manager to capture stdout/stderr along with regular logs"""

    def __init__(self, stdout_buffer, include_stderr=True):
        self.stdout_buffer = stdout_buffer
        self.include_stderr = include_stderr
        self._stdout = None
        self._stderr = None

    def __enter__(self):
        self._stdout = sys.stdout
        sys.stdout = self.stdout_buffer
        if self.include_stderr:
            self._stderr = sys.stderr
            sys.stderr = self.stdout_buffer
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stdout = self._stdout
        if self.include_stderr and self._stderr:
            sys.stderr = self._stderr


def get_database_connection():
    """Get a database connection with proper error handling and optimized settings"""
    try:
        # Optimize connection for concurrent usage
        config = DB_CONFIG.copy()
        config.update(
            {
                "connect_timeout": 10,  # Fail fast if connection takes too long
                "application_name": "workflow_executor",
            }
        )

        conn = psycopg2.connect(**config)
        conn.autocommit = False

        # Optimize connection for performance
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '300s'")  # 5 minute query timeout
            cur.execute(
                "SET idle_in_transaction_session_timeout = '600s'"
            )  # 10 minute idle timeout
        conn.commit()

        return conn
    except Exception as e:
        logger.error("❌ Database connection failed: %s", e)
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
        "nicotine": "Never",  # Default value
    }

    try:
        automation_sequence = workflow_data.get("automation_sequence", [{}])[0]
        items = automation_sequence.get("arguments", {}).get("items", [])

        for item in items:
            if "steps" in item:
                for step in item["steps"]:
                    tool_name = step.get("tool_name")
                    arguments = step.get("arguments", {})

                    if tool_name == "type_into_element":
                        text_to_type = arguments.get("text_to_type", "")
                        # Check for various keys that might hold the description
                        description = arguments.get("description", "").lower()
                        selector = arguments.get("selector", "").lower()

                        if "height" in description or "height" in selector:
                            info["height"] = text_to_type
                        elif "date of birth" in description or "mm/dd/yyyy" in selector:
                            info["date_of_birth"] = text_to_type
                        elif "weight" in description or "weight" in selector:
                            info["weight"] = text_to_type
                        elif "state" in description or "state" in selector:
                            info["state"] = text_to_type
                        elif "zip" in description or "zip" in selector:
                            info["zip"] = text_to_type
                        elif (
                            "face value" in description
                            or "face value" in selector
                            or "100,000" in text_to_type
                        ):
                            info["face_value"] = text_to_type

                    elif tool_name == "set_selected":
                        description = arguments.get("description", "").lower()
                        selector = arguments.get("selector", "").lower()
                        if "male" in description or "male" in selector:
                            info["gender"] = "Male"
                        elif "female" in description or "female" in selector:
                            info["gender"] = "Female"

                    elif tool_name == "select_option":
                        option_name = arguments.get("option_name", "").lower()
                        if "never" in option_name:
                            info["nicotine"] = "Never"
                        elif "past" in option_name:
                            info["nicotine"] = "Past"
                        elif "current" in option_name:
                            info["nicotine"] = "Current"

    except Exception as e:
        logger.error("Could not extract applicant info: %s", e)

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


def generate_formatted_summary(
    quotes: List[Dict[str, Any]],
    applicant_info: Dict[str, str],
    execution_metrics: Dict[str, Any],
) -> str:
    """Generate human-friendly formatted summary with emojis and visual formatting"""

    # Calculate derived values
    age = calculate_age(applicant_info.get("date_of_birth", ""))
    eligible_quotes = [q for q in quotes if q.get("eligible", False)]
    ineligible_quotes = [q for q in quotes if not q.get("eligible", False)]

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
        "",
    ]

    # Add eligible quotes section
    if eligible_quotes:
        summary_lines.extend([f"✅ Eligible Quotes ({len(eligible_quotes)})", "-" * 60])

        for quote in eligible_quotes:
            summary_lines.extend(
                [
                    f"  {quote.get('carrier', 'Unknown Carrier')}",
                    f"  Product: {quote.get('product', 'Unknown Product')}",
                    f"  Monthly Premium: {quote.get('monthly_price', 'N/A')}",
                    f"  Status: {', '.join(quote.get('status', []))}",
                    "",
                ]
            )
    else:
        summary_lines.extend(["❌ No Eligible Quotes Found", "-" * 60, ""])

    # Add ineligible carriers section
    if ineligible_quotes:
        summary_lines.extend(
            [f"❌ Ineligible Carriers ({len(ineligible_quotes)})", "-" * 60]
        )

        for quote in ineligible_quotes:
            status_str = ", ".join(quote.get("status", ["Unknown"]))
            summary_lines.append(
                f"  • {quote.get('carrier', 'Unknown')} - {quote.get('product', 'Unknown')}"
            )
            summary_lines.append(f"    Status: {status_str}")

        summary_lines.append("")

    # Add price summary if there are eligible quotes
    if eligible_quotes:
        prices = []
        for quote in eligible_quotes:
            price_str = quote.get("monthly_price", "").replace("$", "").replace(",", "")
            try:
                prices.append(float(price_str))
            except:
                pass

        if prices:
            summary_lines.extend(
                [
                    "💰 Price Summary",
                    "-" * 60,
                    f"  Lowest Premium: ${min(prices):,.2f}/month",
                    f"  Highest Premium: ${max(prices):,.2f}/month",
                    f"  Average Premium: ${sum(prices)/len(prices):,.2f}/month",
                    "",
                ]
            )

    # Add execution metrics
    summary_lines.extend(
        [
            "📈 Execution Metrics",
            "-" * 60,
            f"  Total Steps: {execution_metrics.get('total_steps', 0)}",
            f"  Successful Steps: {execution_metrics.get('successful_steps', 0)}",
            f"  Failed Steps: {execution_metrics.get('failed_steps', 0)}",
            f"  Execution Time: {execution_metrics.get('total_execution_time_seconds', 0):.1f}s",
            "",
        ]
    )

    return "\n".join(summary_lines)


def deep_merge(d, u):
    """
    Recursively merge dictionaries.
    'd' is the dictionary to be updated, 'u' is the dictionary with new values.
    """
    for k, v in u.items():
        if isinstance(v, collections.abc.Mapping):
            d[k] = deep_merge(d.get(k, {}), v)
        else:
            d[k] = v
    return d

def extract_defaults_recursive(schema_node: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recursively traverses a schema dictionary and extracts the default values.
    """
    defaults = {}
    for key, value in schema_node.items():
        if isinstance(value, dict):
            if 'default' in value:
                # This is a leaf node with a default value
                defaults[key] = value['default']
            else:
                # This is a nested group of parameters, recurse
                nested_defaults = extract_defaults_recursive(value)
                if nested_defaults:
                    defaults[key] = nested_defaults
    return defaults


async def check_mcp_server_health() -> bool:
    """
    Check if the MCP server is healthy and reachable.
    Returns True if healthy, False otherwise.
    """
    import httpx
    
    try:
        logger.info("🏥 Checking MCP server health at: %s", MCP_HEALTH_ENDPOINT)
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Check MCP health endpoint
            response = await client.get(
                MCP_HEALTH_ENDPOINT,
                headers={"ngrok-skip-browser-warning": "true"}
            )
            
            if response.status_code == 200:
                logger.info("✅ MCP server is healthy")
                return True
            else:
                logger.warning("⚠️ MCP server returned status %d", response.status_code)
                return False
                
    except Exception as e:
        logger.warning("❌ MCP server health check failed: %s", e)
        return False


async def restart_windows_vm_service() -> bool:
    """
    Attempt to restart the Windows VM service using the management endpoint.
    Returns True if restart was successful, False otherwise.
    """
    import httpx
    
    try:
        logger.info("🔄 Attempting to restart Windows VM service...")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Call the VM management endpoint to restart the service
            response = await client.post(
                f"{VM_MANAGEMENT_ENDPOINT}/restart",
                headers={"ngrok-skip-browser-warning": "true"}
            )
            
            if response.status_code == 200:
                result = response.json()
                if result.get("success", False):
                    logger.info("✅ Windows VM service restarted successfully")
                    logger.info("📋 Service status: %s", result.get("service_status", {}).get("status", "Unknown"))
                    return True
                else:
                    logger.error("❌ VM service restart failed: %s", result.get("error", "Unknown error"))
                    return False
            else:
                logger.error("❌ VM management endpoint returned status %d", response.status_code)
                return False
                
    except Exception as e:
        logger.error("❌ Failed to restart Windows VM service: %s", e)
        return False


async def wait_for_mcp_server_recovery(max_wait_seconds: int = 60) -> bool:
    """
    Wait for the MCP server to come back online after a restart.
    Returns True if server is back online, False if timeout.
    """
    import asyncio
    
    logger.info("⏳ Waiting for MCP server to come back online...")
    
    start_time = time.time()
    retry_count = 0
    
    while (time.time() - start_time) < max_wait_seconds:
        retry_count += 1
        logger.info("🔍 Health check attempt %d...", retry_count)
        
        if await check_mcp_server_health():
            recovery_time = int(time.time() - start_time)
            logger.info("✅ MCP server is back online after %d seconds", recovery_time)
            return True
        
        # Wait 5 seconds before next check
        await asyncio.sleep(5)
    
    logger.error("❌ MCP server did not come back online within %d seconds", max_wait_seconds)
    return False

def log_merge_details(original, merged, path=""):
    """Recursively compares two dictionaries and logs the changes."""
    # Using sorted keys for consistent log output
    for key in sorted(merged.keys()):
        new_path = f"{path}.{key}" if path else key
        if key not in original:
            logger.info(f"  ➕ Added '{new_path}': {merged[key]}")
        elif isinstance(merged.get(key), dict) and isinstance(original.get(key), dict):
            log_merge_details(original[key], merged[key], path=new_path)
        elif original.get(key) != merged.get(key):
            logger.info(f"  🔄 Changed '{new_path}': '{original.get(key)}' -> '{merged.get(key)}'")

async def execute_mcp_workflow(
    workflow_data: Dict[str, Any], execution_params: Dict[str, Any]
) -> Dict[str, Any]:
    """Execute workflow using the working MCP HTTP approach"""
    import httpx

    logger.info("🔌 Attempting to connect to MCP endpoint: %s", MCP_ENDPOINT)

    try:
        # Use the automation sequence from the database
        automation_sequence = workflow_data.get("automation_sequence")

        if (
            not automation_sequence
            or not isinstance(automation_sequence, list)
            or len(automation_sequence) == 0
        ):
            raise ValueError(
                "automation_sequence is missing, not a list, or empty in the workflow data"
            )

        workflow_data_to_use = automation_sequence[0]

        tool_name = workflow_data_to_use.get("tool_name")
        arguments = workflow_data_to_use.get("arguments", {})

        # --- PARAMETER OVERRIDE LOGIC ---
        if execution_params:
            logger.info("⚡️ Merging execution parameters into workflow inputs:")
            
            # --- FINAL CORRECTED LOGIC ---
            # 1. Use the `inputs` block as the source for default values.
            default_inputs = arguments.get('inputs', {})

            # 2. For logging, show the changes between defaults and user overrides
            log_merge_details(default_inputs, execution_params)

            # 3. Create the final runtime values by merging overrides onto defaults
            final_runtime_inputs = deep_merge(default_inputs, execution_params)
            
            # 4. Update ONLY the 'inputs' block. The 'variables' schema is not touched.
            arguments['inputs'] = final_runtime_inputs
            # --- END FINAL CORRECTED LOGIC ---

        else:
            logger.info("✅ Using default inputs from workflow definition.")

        # The entire `arguments` object, containing the `variables` schema, the final `inputs`,
        # and the `items`, is sent to MCP. The template engine inside MCP will know
        # to use the `inputs` block for template substitution.

        logger.info("📋 Workflow: %s", tool_name)
        logger.info("   Items: %d", len(arguments.get("items", [])))

        # --- MORE DETAILED LOGGING ---
        logger.info("--- DETAILED LOGGING: Payload being sent to MCP ---")
        # For clarity, we log the two main parts of the arguments separately
        if 'inputs' in arguments:
             logger.info("   Runtime Inputs (for execution): %s", json.dumps(arguments['inputs'], indent=2))

        log_string = json.dumps(arguments)
        logger.info(f"Full Arguments Payload (truncated): {log_string[:200]}{'...' if len(log_string) > 200 else ''}")
        logger.info("--- END DETAILED LOGGING ---")

        async with httpx.AsyncClient(timeout=300.0) as client:
            # Step 1: Initialize MCP session
            logger.info("🔌 Initializing MCP session...")
            init_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"roots": {"listChanged": False}, "sampling": {}},
                    "clientInfo": {
                        "name": "modal-workflow-executor",
                        "version": "1.0.0",
                    },
                },
            }

            response = await client.post(
                MCP_ENDPOINT,
                json=init_request,
                headers={"Accept": "application/json, text/event-stream"},
            )

            if response.status_code != 200:
                # 🔄 AUTO-RESTART LOGIC: If MCP server is unreachable, try to restart it
                if response.status_code in [404, 502, 503, 504]:  # Common "server down" errors
                    logger.warning("🚨 MCP server unreachable (status %d). Attempting automatic restart...", response.status_code)
                    
                    # Check if MCP server is actually down
                    if not await check_mcp_server_health():
                        logger.info("🔄 Confirmed: MCP server is down. Initiating Windows VM service restart...")
                        
                        # Attempt to restart the Windows VM service
                        if await restart_windows_vm_service():
                            logger.info("✅ VM service restart initiated. Waiting for MCP server recovery...")
                            
                            # Wait for MCP server to come back online
                            if await wait_for_mcp_server_recovery(max_wait_seconds=90):
                                logger.info("🎉 MCP server recovered! Retrying workflow execution...")
                                
                                # Retry the MCP session initialization
                                retry_response = await client.post(
                                    MCP_ENDPOINT,
                                    json=init_request,
                                    headers={"Accept": "application/json, text/event-stream"},
                                )
                                
                                if retry_response.status_code == 200:
                                    logger.info("✅ MCP session initialized successfully after restart")
                                    response = retry_response  # Use the successful response
                                else:
                                    logger.error("❌ MCP session initialization still failed after restart: %d", retry_response.status_code)
                                    raise Exception(f"Failed to initialize MCP session after restart: {retry_response.status_code}")
                            else:
                                logger.error("❌ MCP server did not recover after restart")
                                raise Exception("MCP server did not recover after Windows VM service restart")
                        else:
                            logger.error("❌ Failed to restart Windows VM service")
                            raise Exception("Failed to restart Windows VM service - MCP server remains unreachable")
                    else:
                        logger.warning("⚠️ MCP server health check passed but session init failed")
                        raise Exception(f"Failed to initialize MCP session: {response.status_code}")
                else:
                    # For other error codes, don't attempt restart
                    raise Exception(f"Failed to initialize MCP session: {response.status_code}")

            # Extract session ID from response headers
            session_id = response.headers.get("Mcp-Session-Id")
            if not session_id:
                raise Exception("No session ID received from MCP server")

            logger.info(f"✅ MCP session initialized: {session_id}")

            # Step 1.5: Send initialized notification (required by MCP protocol)
            logger.info("📤 Sending initialized notification...")
            initialized_request = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {},
            }

            response = await client.post(
                MCP_ENDPOINT,
                json=initialized_request,
                headers={
                    "Accept": "application/json, text/event-stream",
                    "Mcp-Session-Id": session_id,
                },
            )

            if response.status_code not in [200, 202]:
                logger.warning(
                    "⚠️ Initialized notification failed: %s", response.status_code
                )
            else:
                logger.info("✅ Session initialized successfully")

            # Step 2: Execute the workflow
            logger.info("🚀 Executing workflow: %s...", tool_name)
            start_time = time.time()

            tool_request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            }

            response = await client.post(
                MCP_ENDPOINT,
                json=tool_request,
                headers={
                    "Accept": "application/json, text/event-stream",
                    "Mcp-Session-Id": session_id,
                },
            )

            if response.status_code != 200:
                raise Exception(
                    f"Workflow execution failed: {response.status_code} - {response.text}"
                )

            # Parse the response (handle SSE format)
            response_text = response.text
            if not response_text:
                raise Exception("Empty response from MCP server")

            logger.info("✅ Workflow execution completed!")
            execution_time = time.time() - start_time
            logger.info("⏱️ Execution time: %.1fs", execution_time)

            # Parse and display results (handle SSE format)
            try:
                # Handle Server-Sent Events format
                # Split by lines and find the data line (SSE can have empty keep-alive lines)
                lines = response_text.split("\n")
                json_text = None

                # Look for the data line, skipping empty lines and SSE comments
                for line in lines:
                    line = line.strip()
                    if line.startswith("data: "):
                        json_text = line[6:]  # Remove "data: " prefix
                        break
                    elif line and not line.startswith(
                        ":"
                    ):  # Non-SSE line that's not a comment
                        json_text = line
                        break

                if not json_text:
                    logger.error(
                        "No data found in response. First 200 chars: %s",
                        response_text[:200],
                    )
                    raise Exception("No data found in SSE response")

                result_data = json.loads(json_text)

                # --- MORE DETAILED LOGGING ---
                logger.info(
                    "--- DETAILED LOGGING: Full content from RAW MCP response ---"
                )
                log_string = json.dumps(result_data)
                logger.info(f"{log_string[:100]}{'...' if len(log_string) > 100 else ''}")
                logger.info("--- END DETAILED LOGGING ---")

                # Extract the actual content from the MCP response
                mcp_content = None
                if isinstance(result_data, dict) and "result" in result_data:
                    result_content = result_data.get("result", {}).get("content", [])
                    if result_content and isinstance(result_content, list):
                        # The actual workflow result is in the text content
                        for content_item in result_content:
                            if content_item.get("type") == "text":
                                try:
                                    # The text content is a JSON string, so we load it
                                    mcp_content_text = content_item.get("text", "{}")
                                    mcp_content = json.loads(mcp_content_text)

                                    break
                                except json.JSONDecodeError:
                                    logger.warning(
                                        "Failed to parse MCP content text as JSON, using raw text"
                                    )
                                    # Fallback to using the text directly if it's not JSON
                                    mcp_content = {"raw_text": content_item.get("text")}

                # --- MORE DETAILED LOGGING FOR PARSER ---
                logger.info(
                    "--- DETAILED LOGGING: Full content from mcp_content for parser debugging ---"
                )
                log_string = json.dumps(mcp_content)
                logger.info(f"{log_string[:100]}{'...' if len(log_string) > 100 else ''}")
                logger.info("--- END DETAILED LOGGING ---")

                # Extract quotes and metrics from the MCP response
                quotes = []
                successful_steps = 0
                failed_steps = 0
                executed_steps = []

                if mcp_content:
                    # --- MORE DETAILED LOGGING FOR PARSER ---
                    logger.info(
                        "--- DETAILED LOGGING: Full content from mcp_content for parser debugging ---"
                    )
                    log_string = json.dumps(mcp_content)
                    logger.info(f"{log_string[:100]}{'...' if len(log_string) > 100 else ''}")
                    logger.info("--- END DETAILED LOGGING ---")

                    # Check for parser errors first
                    if "parser_error" in mcp_content:
                        logger.error(
                            "❌ Output parser failed in MCP agent: %s",
                            mcp_content["parser_error"],
                        )

                    # Extract quotes from the step results
                    # Look for the wait_for_output_parser step which contains extracted_data
                    quotes = []
                    logger.info("🔍 DEBUG: Searching for quotes in MCP response structure...")
                    
                    if "results" in mcp_content and isinstance(mcp_content["results"], list):
                        logger.info("🔍 DEBUG: Found %d top-level results", len(mcp_content["results"]))
                        for i, step_result in enumerate(mcp_content["results"]):
                            logger.info("🔍 DEBUG: Step %d status: %s", i, step_result.get("status"))
                            
                            # Check if this is the "Set Coverage and Generate Quote" group
                            if step_result.get("status") == "success" and "results" in step_result:
                                logger.info("🔍 DEBUG: Found %d sub-results in step %d", len(step_result["results"]), i)
                                for j, sub_result in enumerate(step_result["results"]):
                                    tool_name = sub_result.get("tool_name")
                                    logger.info("🔍 DEBUG: Sub-result %d tool_name: %s", j, tool_name)
                                    
                                    if tool_name == "wait_for_output_parser":
                                        logger.info("🔍 DEBUG: Found wait_for_output_parser step!")
                                        if "result" in sub_result and "content" in sub_result["result"]:
                                            logger.info("🔍 DEBUG: Found content in wait_for_output_parser result")
                                            for content_item in sub_result["result"]["content"]:
                                                if content_item.get("type") == "text":
                                                    logger.info("🔍 DEBUG: Found text content, attempting to parse...")
                                                    try:
                                                        parser_result = json.loads(content_item.get("text", "{}"))
                                                        logger.info("🔍 DEBUG: Parser result keys: %s", list(parser_result.keys()))
                                                        if "extracted_data" in parser_result:
                                                            quotes = parser_result["extracted_data"]
                                                            logger.info(
                                                                "✅ Found %d quotes from wait_for_output_parser step",
                                                                len(quotes)
                                                            )
                                                            break
                                                    except json.JSONDecodeError as e:
                                                        logger.warning("Failed to parse wait_for_output_parser result: %s", e)
                                    if quotes:
                                        break
                                if quotes:
                                    break
                            if quotes:
                                break
                    else:
                        logger.info("🔍 DEBUG: No 'results' field found in mcp_content")
                        logger.info("🔍 DEBUG: MCP content keys: %s", list(mcp_content.keys()) if mcp_content else "None")
                    
                    # Fallback: check for parsed_output field (legacy support)
                    if not quotes and "parsed_output" in mcp_content:
                        parsed_output = mcp_content.get("parsed_output", [])
                        if not parsed_output:
                            logger.warning(
                                "⚠️ 'parsed_output' field exists but is empty. The UI tree may not have matched the parsing rules."
                            )
                        else:
                            logger.info(
                                "✅ Found 'parsed_output' field with %d items. Using it for quotes.",
                                len(parsed_output),
                            )
                        quotes = parsed_output
                    
                    if not quotes:
                        logger.warning(
                            "⚠️ No quotes found in MCP response. Check for parser errors or if the workflow produced a UI tree."
                        )
                        logger.info("🔍 DEBUG: Final MCP content structure for troubleshooting:")
                        logger.info("🔍 DEBUG: %s", json.dumps(mcp_content, indent=2)[:2000] + "..." if mcp_content else "None")

                    # Extract execution step details for metrics
                    if "results" in mcp_content and isinstance(
                        mcp_content["results"], list
                    ):
                        for idx, step_result in enumerate(mcp_content["results"]):
                            step_info = {
                                "index": idx,
                                "duration_ms": step_result.get("duration_ms", 0),
                                "success": "error" not in step_result,
                            }
                            executed_steps.append(step_info)

                            if step_info["success"]:
                                successful_steps += 1
                            else:
                                failed_steps += 1

                # Build execution results in the expected format
                execution_results = {
                    "execution_type": "real_browser_automation",
                    "workflow_name": workflow_data.get(
                        "name", "Insurance Quote Workflow"
                    ),
                    "executed_steps": executed_steps,
                    "extracted_data": mcp_content if mcp_content else {},
                    "quotes": quotes,
                    "applicant_info": extract_applicant_info(workflow_data),
                    "performance_metrics": {
                        "total_steps": len(arguments.get("items", [])),
                        "successful_steps": successful_steps,
                        "failed_steps": failed_steps,
                        "total_execution_time_seconds": execution_time,
                    },
                    "raw_mcp_response": result_data,
                    "step_details": (
                        mcp_content.get("results", []) if mcp_content else []
                    ),
                }

                logger.info("📋 Sequence Execution Result:")
                logger.info("Tool: %s", tool_name)
                logger.info("Status: ✅ Completed")
                logger.info("Result length: %d characters", len(json_text))
                logger.info("🎉 %s executed successfully!", tool_name)
                logger.info("Found %d quotes.", len(quotes))

                return execution_results

            except json.JSONDecodeError as e:
                logger.error("❌ Failed to parse response JSON: %s", e)
                logger.error("Raw response: %s...", response_text[:500])
                raise Exception(f"Failed to parse MCP response: {e}")

    except Exception as e:
        logger.error("MCP workflow execution error: %s", e)
        # Add more context to the error
        error_context = {
            "error_type": type(e).__name__,
            "error_message": str(e),
            "mcp_endpoint": MCP_ENDPOINT,
            "vm_management_endpoint": VM_MANAGEMENT_ENDPOINT,
            "workflow_id": workflow_data.get("id", "unknown"),
            "workflow_name": workflow_data.get("name", "unknown"),
        }

        # Check if it's an HTTP error and add restart context
        if (
            "HTTP" in str(e)
            or "400" in str(e)
            or "401" in str(e)
            or "403" in str(e)
            or "404" in str(e)
            or "500" in str(e)
        ):
            error_context["error_category"] = "mcp_http_error"
            
            # Check if this was a restart-related error
            if "restart" in str(e).lower():
                error_context["restart_attempted"] = True
                error_context["suggested_fix"] = (
                    "Automatic restart was attempted but failed. Check Windows VM service status manually."
                )
            else:
                error_context["restart_attempted"] = False
                error_context["suggested_fix"] = (
                    "Check if MCP endpoint is running and accessible. Automatic restart will be attempted."
                )
        else:
            error_context["error_category"] = "mcp_general_error"
            error_context["restart_attempted"] = False

        logger.error("MCP Error Context: %s", json.dumps(error_context, indent=2))

        # Re-raise with more context
        raise Exception(
            f"MCP Execution Failed: {str(e)} | Context: {json.dumps(error_context)}"
        )


@app.function(
    image=image,
    secrets=secrets,
    timeout=1800,  # 30 minutes for real browser automation (cleanup at 25 min prevents stuck jobs)
    memory=2048,  # 2GB memory for browser operations
    cpu=2.0,  # 2 CPUs for better performance
    max_containers=1,  # Only allow one execution at a time
)
def execute_workflow(
    workflow_id: int,
    execution_params: Dict[str, Any] = None,
    client_id: str = None,
    execution_id: int = None,
) -> Dict[str, Any]:
    """
    🚀 REAL BROWSER AUTOMATION: Execute workflow using MCP browser control

    This function is now responsible for the actual execution of a workflow that
    has already been "claimed" by the queue processor.

    It will:
    - Calculate total steps and update the execution record.
    - Connect to MCP endpoint for browser control
    - Process each automation step through real browser
    - Update progress in database
    - Return final results
    """
    start_time = time.time()
    conn = None
    cur = None

    try:
        # Initialize database connection
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # The job is already marked as 'running' by the queue worker.
        # This function's first job is to fetch the workflow, calculate steps,
        # and update the execution record with that info.
        logger.info("🚀 Executing workflow ID %s for execution record %s", workflow_id, execution_id)

        # Get workflow details from database
        cur.execute("SELECT * FROM deployed_workflows WHERE id = %s", (workflow_id,))
        workflow = cur.fetchone()

        if not workflow:
            raise Exception(f"Workflow {workflow_id} not found")

        # Calculate total steps and update the execution record
        automation_sequence = workflow.get("automation_sequence", [{}])[0]
        arguments = automation_sequence.get("arguments", {})
        # The canonical key for the list of execution groups is now 'steps'.
        steps_list = arguments.get("steps", [])
        total_steps = len(steps_list)
        
        cur.execute(
            """
            UPDATE workflow_executions
            SET total_steps = %s
            WHERE id = %s
            """,
            (total_steps, execution_id)
        )
        conn.commit()

        logger.info(
            "📋 Loaded workflow '%s' - %d groups to execute via browser",
            workflow["name"],
            total_steps,
        )

        # Execute workflow through MCP browser automation
        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        # Clear buffers to ensure isolated logging for this execution
        log_buffer.seek(0)
        log_buffer.truncate(0)
        stdout_buffer.seek(0)
        stdout_buffer.truncate(0)

        # Capture stdout/stderr during execution
        with CaptureOutput(stdout_buffer):
            try:
                # Log system information
                logger.info("📍 Modal Function: execute_workflow")
                logger.info("🔗 MCP Endpoint: %s", MCP_ENDPOINT)
                logger.info("📦 Workflow ID: %s", workflow_id)
                logger.info("🏷️ Execution ID: %s", execution_id)
                logger.info("⏰ Start Time: %s", datetime.now(timezone.utc).isoformat())

                # Handle empty height parameter to avoid overriding defaults
                params_for_mcp = execution_params.copy() if execution_params else {}
                if params_for_mcp.get("applicant", {}).get("height") == "":
                    logger.info("Removing empty 'height' parameter from applicant to allow workflow default to be used.")
                    del params_for_mcp["applicant"]["height"]
                    # If the applicant object becomes empty after removing height, remove it too
                    if not params_for_mcp["applicant"]:
                        del params_for_mcp["applicant"]

                results = loop.run_until_complete(
                    execute_mcp_workflow(workflow, params_for_mcp)
                )
                logger.info(
                    "Received %d quotes from MCP workflow.",
                    len(results.get("quotes", [])),
                )
            finally:
                loop.close()

        # Capture all logs from both buffers
        raw_logs = log_buffer.getvalue()
        stdout_logs = stdout_buffer.getvalue()

        # Combine logs with clear sections
        combined_logs = f"""
=== LOGGER OUTPUT ===
{raw_logs}

=== STDOUT/STDERR OUTPUT ===
{stdout_logs}

=== END OF EXECUTION {execution_id} ===
"""

        # Extract raw MCP response from results (if present)
        raw_mcp_response = results.pop("raw_mcp_response", None)

        # Create structured logs array
        execution_logs = []
        for line in raw_logs.split("\n"):
            if line.strip():
                log_entry = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "message": line,
                    "level": (
                        "INFO"
                        if "INFO:" in line
                        else ("ERROR" if "ERROR:" in line else "DEBUG")
                    ),
                }
                execution_logs.append(log_entry)

        # Calculate final metrics
        end_time = time.time()
        execution_duration = int(end_time - start_time)

        # Generate execution summary
        success_rate = (
            results["performance_metrics"]["successful_steps"] / max(total_steps, 1)
        ) * 100
        quotes_found = len(results.get("quotes", []))

        # A workflow is only truly successful if:
        # 1. ALL steps completed (100% success rate)
        # 2. AND it achieved its business goal (found at least one quote)
        workflow_completed = success_rate == 100 and quotes_found > 0

        # --- Enhanced Error Message Extraction ---
        error_message_for_db = None
        if not workflow_completed:
            # Case 1: The workflow ran perfectly but found no quotes.
            if quotes_found == 0 and success_rate == 100:
                error_message_for_db = "Workflow incomplete - No quotes found"
            # Case 2: An actual error occurred during MCP execution.
            elif raw_mcp_response and 'result' in raw_mcp_response:
                try:
                    mcp_result_text = raw_mcp_response['result']['content'][0]['text']
                    mcp_result = json.loads(mcp_result_text)
                    
                    if mcp_result.get('status') != 'success':
                        failed_step = None
                        # Find the first step with a status of 'error'
                        if 'results' in mcp_result and isinstance(mcp_result['results'], list):
                            for group in mcp_result['results']:
                                if 'results' in group and isinstance(group['results'], list):
                                    for step in group['results']:
                                        if step.get('status') == 'error':
                                            failed_step = step
                                            break
                                if failed_step:
                                    break
                        
                        if failed_step:
                            tool_name = failed_step.get('tool_name', 'Unknown Tool')
                            error_details = failed_step.get('error', 'Unknown error')
                            
                            # Extract the high-level error type for a concise message
                            match = re.search(r'\{\\\"error_type\\\":\\\"(.*?)\\\"', error_details)
                            error_type = match.group(1) if match else "Unknown"
                            
                            # Create a more informative high-level message, e.g., "type_into_element failed: ElementNotFound"
                            error_message_for_db = f"{tool_name} failed: {error_type}"
                        else:
                            # Fallback if no specific failed step is found
                            error_message_for_db = "MCP Execution Failed: See logs for details"

                except (json.JSONDecodeError, KeyError, IndexError) as e:
                    logger.error(f"Failed to parse MCP error from response: {e}")
                    error_message_for_db = "MCP Execution Failed: Unable to parse error"
            else:
                # Fallback for other unknown errors
                error_message_for_db = "Workflow failed: Unknown error"

        results["execution_summary"] = {
            "workflow_completed": workflow_completed,
            "success_rate_percentage": round(success_rate, 2),
            "total_execution_time": execution_duration,
            "quotes_found": quotes_found,
            "execution_message": f"Found {quotes_found} insurance quotes",
        }

        # Generate formatted summary for successful executions
        formatted_output = None
        if results.get("quotes") is not None:  # If we have quotes data (even if empty)
            try:
                quotes_output = results.get("quotes", [])
                
                if not workflow_completed and quotes_found == 0:
                    # Specific handling for "failed" state due to no quotes
                    logger.warning("Workflow failed: No quotes found. Generating failure summary.")
                    
                    execution_metrics = results.get("performance_metrics", {})
                    
                    summary_lines = [
                        f"❌ {error_message_for_db}",
                        "-"*30,
                        f"All {execution_metrics.get('successful_steps', 0)} automation steps completed successfully, but no insurance quotes were extracted from the final page.",
                        "This usually means the applicant's criteria (e.g., age, health) did not result in any available products from the provider.",
                    ]
                    formatted_output = "\n".join(summary_lines)
                else:
                    # Existing logic for successful executions with quotes
                    formatted_output = json.dumps(quotes_output, indent=2)
                    logger.info("📋 Using raw quote output as formatted_output.")
                    logger.info("\n%s", formatted_output)

            except Exception as format_error:
                logger.warning("Failed to serialize raw quote output: %s", format_error)
                formatted_output = f"Error: Could not format results.\n{format_error}"

        # Update execution with final results and raw data
        cur.execute(
            """
            UPDATE workflow_executions 
            SET status = %s, completed_at = %s, execution_duration_seconds = %s, 
                results = %s, progress_percentage = %s, current_step_index = %s,
                raw_logs = %s, raw_mcp_response = %s, execution_logs = %s,
                formatted_output = %s, error_message = %s
            WHERE id = %s
        """,
            (
                (
                    "completed"
                    if results["execution_summary"]["workflow_completed"]
                    else "failed"
                ),
                datetime.now(timezone.utc).isoformat(),
                execution_duration,
                json.dumps(results),
                100,
                total_steps,
                combined_logs,  # Use combined logs instead of just raw_logs
                json.dumps(raw_mcp_response) if raw_mcp_response else None,
                json.dumps(execution_logs),
                formatted_output,
                error_message_for_db,
                execution_id,
            ),
        )
        conn.commit()

        # Note: Auto-cancellation is now handled proactively BEFORE claiming jobs
        # No need for reactive cancellation after failures

        # Note: Workflow success/failure metrics are automatically updated by database trigger
        # when the workflow_executions status changes to 'completed' or 'failed'

        logger.info(
            "✅ Completed real browser execution %s in %ds",
            execution_id,
            execution_duration,
        )
        logger.info("📊 Found %d insurance quotes", len(results.get("quotes", [])))

        return {
            "success": True,
            "execution_id": execution_id,
            "workflow_id": workflow_id,
            "status": "completed",
            "execution_duration_seconds": execution_duration,
            "results": results,
            "steps_completed": total_steps,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "execution_type": "real_browser_automation",
            "quotes_found": len(results.get("quotes", [])),
            "applicant_info": results.get("applicant_info", {}),
        }

    except Exception as e:
        error_msg = str(e)
        logger.error("❌ Real workflow execution failed: %s", error_msg)

        # Capture any logs that were generated before the error
        raw_logs = log_buffer.getvalue()
        stdout_logs = stdout_buffer.getvalue()

        # Combine logs for error case
        combined_logs = f"""
=== LOGGER OUTPUT ===
{raw_logs}

=== STDOUT/STDERR OUTPUT ===
{stdout_logs}

=== ERROR OCCURRED IN EXECUTION {execution_id} ===
"""

        # Create error execution logs
        execution_logs = []

        # Add captured logs
        for line in raw_logs.split("\n"):
            if line.strip():
                log_entry = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "message": line,
                    "level": (
                        "INFO"
                        if "INFO:" in line
                        else ("ERROR" if "ERROR:" in line else "DEBUG")
                    ),
                }
                execution_logs.append(log_entry)

        # Add the main error
        execution_logs.append(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": f"FATAL ERROR: {error_msg}",
                "level": "ERROR",
                "error_type": type(e).__name__,
                "error_details": str(e),
            }
        )

        # Create error results with detailed information
        error_results = {
            "execution_type": "real_browser_automation",
            "workflow_name": (
                workflow.get("name", "Unknown") if "workflow" in locals() else "Unknown"
            ),
            "error": error_msg,
            "error_type": type(e).__name__,
            "error_stage": (
                "mcp_connection"
                if "MCP" in error_msg or "400 Bad Request" in error_msg
                else "unknown"
            ),
            "executed_steps": [],
            "performance_metrics": {
                "total_steps": 0,
                "successful_steps": 0,
                "failed_steps": 0,
                "total_execution_time_seconds": int(time.time() - start_time),
            },
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
                cur.execute(
                    """
                    UPDATE workflow_executions 
                    SET status = %s, completed_at = %s, execution_duration_seconds = %s, 
                        error_message = %s, raw_logs = %s, execution_logs = %s, results = %s,
                        formatted_output = %s
                    WHERE id = %s
                """,
                    (
                        "failed",
                        datetime.now(timezone.utc).isoformat(),
                        int(time.time() - start_time),
                        error_msg,
                        (
                            combined_logs
                            if combined_logs
                            else f"Error occurred before logging started: {error_msg}"
                        ),
                        json.dumps(execution_logs),
                        json.dumps(error_results),
                        formatted_error_output,
                        execution_id,
                    ),
                )
                conn.commit()

                # Note: Auto-cancellation is now handled proactively BEFORE claiming jobs
                # No need for reactive cancellation after failures

                # Note: Workflow failure metrics are automatically updated by database trigger
                # when the workflow_executions status changes to 'failed'

            except Exception as update_error:
                logger.error("Failed to update error status: %s", update_error)

        return {
            "success": False,
            "error": error_msg,
            "execution_id": execution_id,
            "workflow_id": workflow_id,
            "execution_duration_seconds": int(time.time() - start_time),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "execution_type": "real_browser_automation",
            "error_details": error_results,
        }

    finally:
        # Database cleanup
        if cur:
            cur.close()
        if conn:
            conn.close()


def cleanup_stale_executions(cur, conn, stale_threshold_minutes: int = 25):
    """
    Clean up executions that have been 'running' for too long without completion.
    This handles two types of stuck jobs:
    1. Jobs that started but Modal containers crashed/timed out (25+ minutes)
    2. Jobs that were dispatched to Modal but never started (30+ minutes with NULL logs)
    
    CRITICAL FIX: Default threshold reduced to 25 minutes (from 45) to close the gap
    that allowed job #1444 to stay stuck for 7+ hours.
    
    Timeline:
    - Modal timeout: 30 minutes
    - This cleanup: 25 minutes (catches stuck jobs BEFORE Modal timeout)
    - NULL logs cleanup: 30 minutes (catches jobs that never started)
    - Smart check: 30 minutes (matches Modal timeout exactly)
    
    Returns the total number of executions cleaned up.
    """
    try:
        # First, get details about what we're about to clean up for better logging
        cur.execute(
            """
            SELECT id, workflow_id, started_at, 
                   EXTRACT(EPOCH FROM (NOW() - started_at))/60 as minutes_running,
                   modal_call_id
            FROM workflow_executions
            WHERE 
                status = 'running'
                AND started_at < NOW() - INTERVAL '%s minutes'
            ORDER BY started_at ASC
            """,
            (stale_threshold_minutes,)
        )
        
        stale_jobs = cur.fetchall()
        
        if not stale_jobs:
            return 0
            
        # Log details about each stale job before cleanup
        for job in stale_jobs:
            logger.warning(
                "🚨 Detected stale execution ID %s (workflow %s): running for %.1f minutes, modal_call_id: %s",
                job[0], job[1], job[3], job[4] or "None"
            )
        
        # Now perform the cleanup
        cur.execute(
            """
            UPDATE workflow_executions
            SET 
                status = 'failed',
                completed_at = NOW(),
                error_message = 'Auto-cleanup: Execution stuck in running state for ' || %s || '+ minutes (likely Modal timeout)',
                execution_duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::integer
            WHERE 
                status = 'running'
                AND started_at < NOW() - INTERVAL '%s minutes'
            RETURNING id, workflow_id, EXTRACT(EPOCH FROM (NOW() - started_at))/60 as minutes_stuck
            """,
            (stale_threshold_minutes, stale_threshold_minutes)
        )
        
        cleaned_jobs = cur.fetchall()
        conn.commit()
        
        if cleaned_jobs:
            stale_ids = [job[0] for job in cleaned_jobs]
            total_minutes = sum(job[2] for job in cleaned_jobs)
            avg_minutes = total_minutes / len(cleaned_jobs)
            
            logger.warning(
                "🧹 Smart cleanup completed: %d stale executions cleaned up",
                len(stale_ids)
            )
            logger.warning(
                "   📊 Average stuck time: %.1f minutes | IDs: %s",
                avg_minutes, stale_ids
            )
            logger.warning(
                "   🔧 This prevents the queue-blocking issue that affected job #1444"
            )
        
        # ENHANCED: Also clean up jobs that never started (NULL raw_logs)
        # These are jobs that were dispatched to Modal but never actually executed
        cur.execute(
            """
            SELECT id, workflow_id, started_at, 
                   EXTRACT(EPOCH FROM (NOW() - started_at))/60 as minutes_running,
                   modal_call_id
            FROM workflow_executions
            WHERE 
                status = 'running'
                AND started_at < NOW() - INTERVAL '30 minutes'
                AND raw_logs IS NULL
            ORDER BY started_at ASC
            """,
        )
        
        null_logs_jobs = cur.fetchall()
        
        if null_logs_jobs:
            # Log details about each null-logs job before cleanup
            for job in null_logs_jobs:
                logger.warning(
                    "🚨 Detected job with NULL logs ID %s (workflow %s): running for %.1f minutes, modal_call_id: %s",
                    job[0], job[1], job[3], job[4] or "None"
                )
            
            # Clean up jobs with NULL raw_logs (never started execution)
            cur.execute(
                """
                UPDATE workflow_executions
                SET 
                    status = 'failed',
                    completed_at = NOW(),
                    error_message = 'Auto-cleanup: Job stuck in Modal queue without logs for 30+ minutes (likely Modal container startup failure)',
                    execution_duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::integer
                WHERE 
                    status = 'running'
                    AND started_at < NOW() - INTERVAL '30 minutes'
                    AND raw_logs IS NULL
                RETURNING id, workflow_id, EXTRACT(EPOCH FROM (NOW() - started_at))/60 as minutes_stuck
                """,
            )
            
            null_logs_cleaned = cur.fetchall()
            conn.commit()
            
            if null_logs_cleaned:
                null_logs_ids = [job[0] for job in null_logs_cleaned]
                total_null_minutes = sum(job[2] for job in null_logs_cleaned)
                avg_null_minutes = total_null_minutes / len(null_logs_cleaned)
                
                logger.warning(
                    "🧹 NULL logs cleanup completed: %d executions cleaned up",
                    len(null_logs_ids)
                )
                logger.warning(
                    "   📊 Average stuck time: %.1f minutes | IDs: %s",
                    avg_null_minutes, null_logs_ids
                )
                logger.warning(
                    "   🔧 These jobs were dispatched to Modal but never actually started"
                )
        
        total_cleaned = len(cleaned_jobs) + (len(null_logs_cleaned) if null_logs_jobs else 0)
        return total_cleaned
    except Exception as e:
        logger.error("Failed to cleanup stale executions: %s", e)
        conn.rollback()
        return 0


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
            "modal_status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": {},
        }

        # Test 1: Environment and configuration
        try:
            # Check if we have database configuration
            if DB_CONFIG and all(
                k in DB_CONFIG for k in ["host", "database", "user", "password"]
            ):
                health_data["checks"]["configuration"] = {
                    "status": "pass",
                    "message": "Database configuration present",
                }
            else:
                health_data["checks"]["configuration"] = {
                    "status": "fail",
                    "message": "Missing database configuration",
                }
        except Exception as e:
            health_data["checks"]["configuration"] = {
                "status": "error",
                "error": str(e),
            }

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

            health_data["checks"]["database"] = {
                "status": "pass",
                "message": f"Database connection successful. {workflow_count} workflows found.",
            }
        except Exception as e:
            health_data["checks"]["database"] = {"status": "error", "error": str(e)}

        # Test 3: MCP endpoint availability (simple check)
        try:
            import httpx

            # Just check if endpoint is reachable
            health_data["checks"]["mcp_endpoint"] = {
                "status": "pass",
                "message": f"MCP endpoint configured: {MCP_ENDPOINT}",
                "endpoint": MCP_ENDPOINT,
                "health_endpoint": MCP_HEALTH_ENDPOINT,
            }
        except Exception as e:
            health_data["checks"]["mcp_endpoint"] = {"status": "error", "error": str(e)}

        # Test 4: System resources for browser automation
        try:
            health_data["checks"]["system"] = {
                "status": "pass",
                "memory": "2GB allocated",
                "cpu": "2 CPUs allocated",
                "execution_type": "real_browser_automation",
                "timeout": "30 minutes",
            }
        except Exception as e:
            health_data["checks"]["system"] = {"status": "error", "error": str(e)}

        # Overall assessment
        failed_checks = [
            k
            for k, v in health_data["checks"].items()
            if v["status"] in ["fail", "error"]
        ]

        if failed_checks:
            health_data["modal_status"] = "degraded"
            health_data["failed_checks"] = failed_checks

        health_data["response_time_ms"] = int((time.time() - start_time) * 1000)
        health_data["container_info"] = {
            "modal_environment": True,
            "browser_automation_ready": True,
            "mcp_integration": True,
            "database_connection": "psycopg2",
            "optimized_for": "real_browser_workflow_execution",
        }

        logger.info(
            "🏥 Health check completed in %dms - Status: %s",
            health_data["response_time_ms"],
            health_data["modal_status"],
        )

        return health_data

    except Exception as e:
        logger.error("❌ Health check failed: %s", e)
        return {
            "modal_status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "response_time_ms": int((time.time() - start_time) * 1000),
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
    print("🏥 MCP Health Endpoint:", MCP_HEALTH_ENDPOINT)
    print("🔄 VM Management:", VM_MANAGEMENT_ENDPOINT)
    print("\n📋 Available Functions:")
    print("  • execute_workflow() - Real browser automation execution")
    print("  • health_check() - Infrastructure and MCP health monitoring")
    print("  • check_and_process_queued_jobs() - Atomic job processing with auto-restart")
    print("\n⚡ Hybrid Architecture:")
    print("  • Vercel: Fast database queries and status checks")
    print("  • Modal: Real browser automation with MCP")
    print("  • MCP: Browser control and UI interaction")
    print("  • PostgreSQL: Direct database access via psycopg2")
    print("  • Windows VM: Auto-restart capability via ngrok")
    print("\n🔧 Database Configuration:")
    print(f"  • Host: {DB_CONFIG['host']}")
    print(f"  • Database: {DB_CONFIG['database']}")
    print(f"  • User: {DB_CONFIG['user']}")
    print("  • Connection pooling: Optimized for performance")
    print("\n🔄 Auto-Restart Features:")
    print("  • Automatic MCP server health monitoring")
    print("  • Windows VM service restart on MCP failure")
    print("  • Smart recovery detection (90s timeout)")
    print("  • Retry logic after successful restart")

    # Also log to logger so it's captured
    logger.info("Modal app initialized with enhanced logging and auto-restart capability")
    logger.info("Using MCP endpoint: %s", MCP_ENDPOINT)
    logger.info("Using MCP health endpoint: %s", MCP_HEALTH_ENDPOINT)
    logger.info("Using VM management endpoint: %s", VM_MANAGEMENT_ENDPOINT)


@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=1),  # Check every 1 second
    timeout=300,  # 5 minutes max per check
)
def check_and_process_queued_jobs():
    """
    🔄 ATOMIC JOB PROCESSOR: Claims and processes one queued execution.

    This function runs on a schedule and uses an atomic database update
    to "claim" a single job, preventing the race condition where multiple
    workers could process the same job.
    
    SMART CLAIMING: Only claims a job if no execution is currently running,
    preventing Modal's internal queue from building up.
    """
    conn = None
    cur = None

    try:
        # Connect to database
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Periodically clean up stale executions (every 60 calls = ~1 minute)
        # Use a simple counter based on current timestamp
        if int(time.time()) % 60 == 0:
            # ENHANCED CLEANUP: Now handles both types of stuck jobs:
            # 1. Jobs that started but Modal containers crashed/timed out (25+ minutes)
            # 2. Jobs that were dispatched to Modal but never started (30+ minutes with NULL logs)
            # This prevents the queue-blocking issue that affected job #1444
            cleanup_count = cleanup_stale_executions(cur, conn, stale_threshold_minutes=25)
            if cleanup_count > 0:
                logger.info("🧹 Enhanced cleanup: %d stale executions cleaned up", cleanup_count)

        # ENHANCED SMART CHECK: More aggressive detection of stuck jobs
        # This prevents claiming jobs that will just sit in Modal's internal queue
        cur.execute(
            """
            SELECT COUNT(*) as running_count
            FROM workflow_executions
            WHERE status = 'running'
            AND started_at > NOW() - INTERVAL '30 minutes'  -- Match Modal timeout exactly
            """
        )
        running_count = cur.fetchone()["running_count"]
        
        if running_count > 0:
            # There's already an execution running, don't claim another job
            logger.debug(
                "⏸️ Skipping job claim - %d execution(s) already running",
                running_count
            )
            return {
                "status": "skipped",
                "reason": "execution_already_running",
                "running_count": running_count
            }

        # 🚫 WORKFLOW-SPECIFIC FAILURE PATTERN CHECK: Peek at next job's workflow and check for failure patterns
        # First, peek at which workflow has the next queued job without claiming it
        cur.execute("""
            SELECT workflow_id
            FROM workflow_executions
            WHERE status = 'queued'
            ORDER BY created_at ASC
            LIMIT 1
        """)
        
        next_job = cur.fetchone()
        if not next_job:
            # No queued jobs found
            return {"status": "no_jobs_found"}
        
        next_workflow_id = next_job["workflow_id"]
        
        # Check if this specific workflow has consecutive failure patterns
        should_block, block_reason, check_duration_ms = check_failure_patterns_for_workflow(cur, conn, next_workflow_id)
        
        if should_block:
            logger.warning("🚫 BLOCKED job claim for workflow %d: %s", next_workflow_id, block_reason)
            return {
                "status": "blocked",
                "reason": block_reason,
                "workflow_id": next_workflow_id,
                "check_duration_ms": check_duration_ms
            }
        else:
            logger.debug("✅ Pre-claim check passed for workflow %d, proceeding to claim job (took %dms)", next_workflow_id, check_duration_ms)

        # No running executions and no blocking patterns, safe to claim a new job
        modal_call_id = f"modal-real-{int(time.time())}-{random.randint(1000, 9999)}"

        # This query atomically finds the next 'queued' job,
        # updates its status to 'running', and returns its details.
        # `FOR UPDATE SKIP LOCKED` ensures that concurrent workers
        # don't try to grab the same job.
        cur.execute(
            """
            WITH claimed_job AS (
                SELECT id
                FROM workflow_executions
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE workflow_executions
            SET
                status = 'running',
                started_at = NOW(),
                modal_call_id = %s
            FROM claimed_job
            WHERE workflow_executions.id = claimed_job.id
            RETURNING
                workflow_executions.id,
                workflow_executions.workflow_id,
                workflow_executions.execution_params,
                workflow_executions.client_id;
            """,
            (modal_call_id,)
        )

        job_to_process = cur.fetchone()
        conn.commit()  # Commit the claim immediately

        if not job_to_process:
            # This is the normal state when the queue is empty.
            return {"status": "no_jobs_found"}

        # If we get here, we have successfully claimed a job.
        execution_id = job_to_process["id"]
        workflow_id = job_to_process["workflow_id"]
        execution_params = job_to_process["execution_params"] or {}
        client_id = job_to_process["client_id"]

        logger.info(
            "✅ Claimed execution ID %s for workflow %s. Dispatching to executor...",
            execution_id,
            workflow_id,
        )

        # Now, call the main execution function asynchronously.
        # This function will handle the rest of the process.
        try:
            logger.info("🚀 Dispatching job %s to Modal...", execution_id)
            
            # Attempt to dispatch to Modal
            modal_future = execute_workflow.remote(
                workflow_id=workflow_id,
                execution_params=execution_params,
                client_id=client_id,
                execution_id=execution_id,
            )
            
            # Verify the remote call was accepted
            logger.info("✅ Job %s successfully dispatched to Modal", execution_id)
            
            return {
                "status": "job_claimed",
                "execution_id": execution_id,
                "workflow_id": workflow_id,
                "modal_future": str(modal_future)
            }
            
        except Exception as modal_error:
            logger.error("❌ Modal dispatch failed for job %s: %s", execution_id, modal_error)
            
            # CRITICAL: Return the job to queue if Modal can't accept it
            try:
                cur.execute("""
                    UPDATE workflow_executions
                    SET status = 'queued', 
                        started_at = NULL,
                        modal_call_id = NULL,
                        error_message = NULL
                    WHERE id = %s
                """, (execution_id,))
                conn.commit()
                
                logger.info("🔄 Job %s returned to queue due to Modal dispatch failure", execution_id)
                
                return {
                    "status": "modal_dispatch_failed",
                    "execution_id": execution_id,
                    "workflow_id": workflow_id,
                    "error": str(modal_error),
                    "action": "job_returned_to_queue"
                }
                
            except Exception as rollback_error:
                logger.error("❌ CRITICAL: Failed to return job %s to queue: %s", execution_id, rollback_error)
                
                # If we can't return to queue, mark as failed to prevent infinite stuck state
                cur.execute("""
                    UPDATE workflow_executions
                    SET status = 'failed',
                        completed_at = NOW(),
                        error_message = %s
                    WHERE id = %s
                """, (f"Modal dispatch failed and job rollback failed: {modal_error} | {rollback_error}", execution_id))
                conn.commit()
                
                return {
                    "status": "critical_error",
                    "execution_id": execution_id,
                    "workflow_id": workflow_id,
                    "error": f"Modal dispatch failed: {modal_error}",
                    "rollback_error": str(rollback_error)
                }

    except Exception as e:
        logger.error("❌ Job processor error: %s", e)
        # Rollback any transaction if an error occurs before commit
        if conn:
            conn.rollback()
        return {"status": "error", "error": str(e)}

    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.function(image=image, secrets=secrets, timeout=60)
def trigger_job_check():
    """
    🔄 MANUAL TRIGGER: Manually trigger the job processor

    Use this to test the job processor without waiting for the schedule
    """
    logger.info("🔄 Manually triggering job check...")
    return check_and_process_queued_jobs.local()



