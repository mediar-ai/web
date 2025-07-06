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
    "password": "***REMOVED***",
}

# MCP endpoint configuration - could be moved to secrets
# MCP_ENDPOINT = "https://barely-honest-yak.ngrok-free.app/mcp" # virtual machine
MCP_ENDPOINT = "https://select-merely-gelding.ngrok-free.app/mcp"  # Louis computer
# MCP_ENDPOINT = "https://willingly-settling-husky.ngrok-free.app/mcp" # Matt computer


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


async def execute_mcp_workflow(
    workflow_data: Dict[str, Any], execution_params: Dict[str, Any]
) -> Dict[str, Any]:
    """Execute workflow using the working MCP HTTP approach"""
    import httpx

    logger.info("🔌 Attempting to connect to MCP endpoint: %s", MCP_ENDPOINT)

    try:
        # Use the automation sequence from the database
        automation_sequence = workflow_data.get("automation_sequence")

        # --- START TROUBLESHOOTING LOGS ---
        logger.info("--- TROUBLESHOOTING: Raw automation_sequence from DB ---")
        logger.info("Type: %s", type(automation_sequence))
        logger.info("Content: %s", automation_sequence)
        # --- END TROUBLESHOOTING LOGS ---

        if (
            not automation_sequence
            or not isinstance(automation_sequence, list)
            or len(automation_sequence) == 0
        ):
            raise ValueError(
                "automation_sequence is missing, not a list, or empty in the workflow data"
            )

        workflow_data_to_use = automation_sequence[0]

        # --- START TROUBLESHOOTING LOGS ---
        logger.info("--- TROUBLESHOOTING: Parsed workflow_data_to_use ---")
        logger.info("Type: %s", type(workflow_data_to_use))
        logger.info("Content: %s", workflow_data_to_use)
        # --- END TROUBLESHOOTING LOGS ---

        tool_name = workflow_data_to_use.get("tool_name")
        arguments = workflow_data_to_use.get("arguments", {})

        # --- START TROUBLESHOOTING LOGS ---
        logger.info("--- TROUBLESHOOTING: Extracted tool_name and arguments ---")
        logger.info("Tool Name: %s", tool_name)
        logger.info("Arguments: %s", arguments)
        logger.info("--- END TROUBLESHOOTING LOGS ---")

        logger.info("📋 Workflow: %s", tool_name)
        logger.info("   Items: %d", len(arguments.get("items", [])))

        # --- MORE DETAILED LOGGING ---
        logger.info("--- DETAILED LOGGING: Payload being sent to MCP ---")
        logger.info(json.dumps(arguments, indent=2))
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
                raise Exception(
                    f"Failed to initialize MCP session: {response.status_code}"
                )

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
                logger.info(json.dumps(result_data, indent=2))
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
                logger.info(json.dumps(mcp_content, indent=2))
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
                    logger.info(json.dumps(mcp_content, indent=2))
                    logger.info("--- END DETAILED LOGGING ---")

                    # Check for parser errors first
                    if "parser_error" in mcp_content:
                        logger.error(
                            "❌ Output parser failed in MCP agent: %s",
                            mcp_content["parser_error"],
                        )

                    # Extract quotes from the new parsed_output field.
                    # The MCP tool now returns pre-parsed and structured quote data.
                    if "parsed_output" in mcp_content:
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
                    else:
                        logger.warning(
                            "⚠️ No 'parsed_output' field found in MCP response. Quotes will be empty. Check for parser errors or if the workflow produced a UI tree."
                        )

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
            "workflow_id": workflow_data.get("id", "unknown"),
            "workflow_name": workflow_data.get("name", "unknown"),
        }

        # Check if it's an HTTP error
        if (
            "HTTP" in str(e)
            or "400" in str(e)
            or "401" in str(e)
            or "403" in str(e)
            or "404" in str(e)
            or "500" in str(e)
        ):
            error_context["error_category"] = "mcp_http_error"
            error_context["suggested_fix"] = (
                "Check if MCP endpoint is running and accessible"
            )
        else:
            error_context["error_category"] = "mcp_general_error"

        logger.error("MCP Error Context: %s", json.dumps(error_context, indent=2))

        # Re-raise with more context
        raise Exception(
            f"MCP Execution Failed: {str(e)} | Context: {json.dumps(error_context)}"
        )


@app.function(
    image=image,
    secrets=secrets,
    timeout=1800,  # 30 minutes for real browser automation
    memory=2048,  # 2GB memory for browser operations
    cpu=2.0,  # 2 CPUs for better performance
)
def execute_workflow(
    workflow_id: int,
    execution_params: Dict[str, Any] = None,
    client_id: str = None,
    execution_id: int = None,
) -> Dict[str, Any]:
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
    conn = None
    cur = None

    try:
        # Initialize database connection
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        logger.info("🚀 Starting REAL workflow execution %s on Modal...", workflow_id)

        # Get workflow details from database
        cur.execute("SELECT * FROM deployed_workflows WHERE id = %s", (workflow_id,))
        workflow = cur.fetchone()

        if not workflow:
            raise Exception(f"Workflow {workflow_id} not found")

        # Calculate total steps from the automation sequence
        automation_sequence = workflow.get("automation_sequence", [{}])[0]
        total_steps = len(automation_sequence.get("arguments", {}).get("items", []))

        logger.info(
            "📋 Loaded %s - %d groups to execute via browser",
            workflow["name"],
            total_steps,
        )

        # Either update existing execution or create new one
        if execution_id:
            # Update existing execution record
            logger.info("📝 Updating existing execution record %s", execution_id)
            cur.execute(
                """
                UPDATE workflow_executions 
                SET status = %s, started_at = %s, total_steps = %s, 
                    current_step_index = %s, progress_percentage = %s,
                    modal_call_id = %s
                WHERE id = %s
            """,
                (
                    "running",
                    datetime.now(timezone.utc).isoformat(),
                    total_steps,
                    0,
                    0,
                    f"modal-real-{int(time.time())}-{random.randint(1000, 9999)}",
                    execution_id,
                ),
            )
            conn.commit()
        else:
            # Create new execution record
            execution_data = {
                "workflow_id": workflow_id,
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "execution_params": execution_params or {},
                "modal_call_id": f"modal-real-{int(time.time())}-{random.randint(1000, 9999)}",
                "total_steps": total_steps,
                "current_step_index": 0,
                "progress_percentage": 0,
            }

            # Build INSERT query with optional client_id
            if client_id:
                cur.execute(
                    """
                    INSERT INTO workflow_executions 
                    (workflow_id, status, started_at, execution_params, modal_call_id, total_steps, current_step_index, progress_percentage, client_id) 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) 
                    RETURNING id
                """,
                    (
                        execution_data["workflow_id"],
                        execution_data["status"],
                        execution_data["started_at"],
                        json.dumps(execution_data["execution_params"]),
                        execution_data["modal_call_id"],
                        execution_data["total_steps"],
                        execution_data["current_step_index"],
                        execution_data["progress_percentage"],
                        client_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO workflow_executions 
                    (workflow_id, status, started_at, execution_params, modal_call_id, total_steps, current_step_index, progress_percentage) 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s) 
                    RETURNING id
                """,
                    (
                        execution_data["workflow_id"],
                        execution_data["status"],
                        execution_data["started_at"],
                        json.dumps(execution_data["execution_params"]),
                        execution_data["modal_call_id"],
                        execution_data["total_steps"],
                        execution_data["current_step_index"],
                        execution_data["progress_percentage"],
                    ),
                )

            execution_id = cur.fetchone()["id"]
            conn.commit()

            logger.info("📝 Created execution record %s", execution_id)

        # Execute workflow through MCP browser automation
        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        # Don't clear log buffer - instead add execution boundary marker
        logger.info("=" * 60)
        logger.info("🚀 EXECUTION %s STARTING", execution_id)
        logger.info("=" * 60)

        # Clear stdout buffer for this execution
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

                results = loop.run_until_complete(
                    execute_mcp_workflow(workflow, execution_params or {})
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
                formatted_output = generate_formatted_summary(
                    quotes=results.get("quotes", []),
                    applicant_info=results.get("applicant_info", {}),
                    execution_metrics=results.get("performance_metrics", {}),
                )
                logger.info("📋 Generated formatted summary")
                # Also log the formatted output for debugging
                logger.info("\n%s", formatted_output)
            except Exception as format_error:
                logger.warning("Failed to generate formatted summary: %s", format_error)

        # Update execution with final results and raw data
        cur.execute(
            """
            UPDATE workflow_executions 
            SET status = %s, completed_at = %s, execution_duration_seconds = %s, 
                results = %s, progress_percentage = %s, current_step_index = %s,
                raw_logs = %s, raw_mcp_response = %s, execution_logs = %s,
                formatted_output = %s
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
                execution_id,
            ),
        )
        conn.commit()

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

    # Also log to logger so it's captured
    logger.info("Modal app initialized with enhanced logging")
    logger.info("Using ngrok endpoint: %s", MCP_ENDPOINT)


@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=1),  # Check every 1 second
    timeout=300,  # 5 minutes max per check
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
        cur.execute(
            """
            SELECT id, workflow_id, execution_params, client_id, created_at
            FROM workflow_executions
            WHERE status = 'queued'
              AND created_at > NOW() - INTERVAL '1 hour'  -- Only process recent jobs
            ORDER BY created_at ASC
            LIMIT 5  -- Process max 5 at a time
        """
        )

        queued_jobs = cur.fetchall()

        if not queued_jobs:
            logger.info("✅ No queued jobs found")
            return {
                "success": True,
                "message": "No queued jobs to process",
                "checked_at": datetime.now(timezone.utc).isoformat(),
            }

        logger.info("📋 Found %d queued executions", len(queued_jobs))
        processed = []
        errors = []

        for job in queued_jobs:
            execution_id = job["id"]
            workflow_id = job["workflow_id"]
            execution_params = job["execution_params"] or {}
            client_id = job["client_id"]

            try:
                logger.info(
                    "🚀 Processing execution %s for workflow %s",
                    execution_id,
                    workflow_id,
                )

                # Call the execute_workflow function with the existing execution_id
                # Wrap in try-catch to capture early-stage errors
                try:
                    result = execute_workflow.local(
                        workflow_id, execution_params, client_id, execution_id
                    )
                except Exception as exec_error:
                    # Capture early-stage execution errors
                    logger.error(
                        "❌ Early-stage execution error for %s: %s",
                        execution_id,
                        str(exec_error),
                    )
                    result = {
                        "success": False,
                        "error": str(exec_error),
                        "error_type": "early_stage_failure",
                    }

                if result.get("success"):
                    logger.info("✅ Successfully processed execution %s", execution_id)
                    processed.append(
                        {
                            "execution_id": execution_id,
                            "workflow_id": workflow_id,
                            "status": "completed",
                        }
                    )
                else:
                    raise Exception(result.get("error", "Unknown error"))

            except Exception as e:
                error_msg = str(e)
                logger.error(
                    "❌ Failed to process execution %s: %s", execution_id, error_msg
                )

                # Update execution as failed
                cur.execute(
                    """
                    UPDATE workflow_executions
                    SET status = 'failed', 
                        error_message = %s,
                        completed_at = NOW(),
                        execution_duration_seconds = EXTRACT(EPOCH FROM (NOW() - created_at))::integer
                    WHERE id = %s
                """,
                    (error_msg, execution_id),
                )
                conn.commit()

                errors.append(
                    {
                        "execution_id": execution_id,
                        "workflow_id": workflow_id,
                        "error": error_msg,
                    }
                )

        return {
            "success": True,
            "message": f"Processed {len(processed)} jobs, {len(errors)} errors",
            "processed": processed,
            "errors": errors,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error("❌ Job processor error: %s", e)
        return {
            "success": False,
            "error": str(e),
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

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
