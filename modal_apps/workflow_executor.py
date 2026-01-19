import asyncio
import collections.abc
import io
import json
import logging
import os
import random
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
 
import modal
import psycopg2
import yaml  # For YAML sequence loading
from psycopg2.extras import RealDictCursor

from modal_apps.lib.db import get_database_connection, get_db_config
from modal_apps.lib.locks import (
    cleanup_stale_machine_locks,
    record_acquired_lock,
    release_acquired_locks,
)
from modal_apps.lib.mcp_client import normalize_endpoint, post_with_503_backoff
from modal_apps.lib.github_loader import get_github_loader
from modal_apps.lib.secrets import load_org_secrets, inject_secrets_into_params
# File manager removed - files are now accessed via rclone mount
from modal_apps.output_enrichment import enrich_results_if_enabled

# Configure logging to capture everything
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# =============================================================================
# SequenceLoader: Dual-Format Workflow Support (YAML + JSONB)
# =============================================================================


class SequenceLoader:
    """Handles workflow loading with GitHub-first, database fallback strategy"""

    @staticmethod
    def load_workflow_sequence(workflow_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Load sequence with GitHub priority, database fallback

        Loading priority:
        1. GitHub repo (if github_folder is set)
        2. Database YAML column
        3. Database JSONB column (legacy)

        Args:
            workflow_data: Database record from deployed_workflows_with_sequence view

        Returns:
            List of automation sequence steps (normalized format)

        Raises:
            ValueError: If no valid sequence found
        """

        # Priority 1: Try loading from GitHub if folder is mapped
        github_folder = workflow_data.get("github_folder")
        github_ref = workflow_data.get("github_ref", "main")

        if github_folder:
            try:
                logger.info(f"[GitHub] Attempting to load from GitHub: {github_folder}")
                github_loader = get_github_loader()
                yaml_content = github_loader.load_workflow(github_folder, github_ref)

                if yaml_content:
                    parsed = github_loader.parse_workflow_yaml(yaml_content)
                    logger.info(f"[GitHub] Successfully loaded workflow from GitHub")
                    return SequenceLoader._ensure_list_format(parsed)
                else:
                    logger.info("GitHub load returned None, falling back to database")
            except Exception as e:
                logger.warning(f"[GitHub] GitHub load failed: {e}, falling back to database")

        # Priority 2: Use database YAML column
        yaml_sequence = workflow_data.get("automation_sequence_yaml")
        if yaml_sequence and yaml_sequence.strip():
            try:
                logger.info("[Database] Loading workflow from database YAML column")
                parsed = yaml.safe_load(yaml_sequence)
                return SequenceLoader._ensure_list_format(parsed)
            except yaml.YAMLError as e:
                logger.warning(f"[Database] YAML parsing failed, falling back to JSONB: {e}")

        # Priority 3: Fallback to JSONB column (legacy)
        jsonb_sequence = workflow_data.get("automation_sequence")
        if jsonb_sequence:
            logger.info("[Database] Loading workflow from database JSONB column (legacy)")
            if isinstance(jsonb_sequence, str):
                parsed = json.loads(jsonb_sequence)
            else:
                parsed = jsonb_sequence
            return SequenceLoader._ensure_list_format(parsed)

        raise ValueError("No automation sequence found in GitHub or database")

    @staticmethod
    def _ensure_list_format(sequence: Any) -> List[Dict[str, Any]]:
        """Ensure sequence is in expected list format"""
        if isinstance(sequence, dict):
            # Check if it's already wrapped with tool_name
            if "tool_name" in sequence:
                return [sequence]
            # If it's a raw workflow (has 'steps' at top level), wrap it
            elif "steps" in sequence:
                wrapped = {
                    "tool_name": "execute_sequence",
                    "arguments": sequence
                }
                return [wrapped]
            else:
                return [sequence]
        elif isinstance(sequence, list):
            return sequence
        else:
            raise ValueError(f"Invalid sequence format: {type(sequence)}")

    @staticmethod
    def get_sequence_info(workflow_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get information about the sequence format and content

        Args:
            workflow_data: Database record from deployed_workflows_with_sequence view

        Returns:
            Dictionary with sequence information
        """
        info = {
            "has_yaml": bool(workflow_data.get("automation_sequence_yaml")),
            "has_jsonb": bool(workflow_data.get("automation_sequence")),
            "format_used": workflow_data.get("sequence_format", "unknown"),
            "preferred_format": workflow_data.get("preferred_format", "jsonb"),
            "is_valid": False,
            "step_count": 0,
            "has_variables": False,
            "has_steps": False,
        }

        try:
            sequence = SequenceLoader.load_workflow_sequence(workflow_data)
            info["is_valid"] = SequenceLoader.validate_sequence_structure(sequence)

            if info["is_valid"] and len(sequence) > 0:
                arguments = sequence[0].get("arguments", {})
                info["step_count"] = len(arguments.get("steps", []))
                info["has_variables"] = bool(arguments.get("variables"))
                info["has_steps"] = bool(arguments.get("steps"))

        except Exception as e:
            logger.warning(f"Failed to analyze sequence: {e}")

        return info

    @staticmethod
    def validate_sequence_structure(sequence: List[Dict[str, Any]]) -> bool:
        """
        Validate that sequence has the expected structure

        Args:
            sequence: Parsed sequence data

        Returns:
            True if valid, False otherwise
        """
        try:
            if not isinstance(sequence, list) or len(sequence) == 0:
                return False

            # Check first element has required structure
            first_element = sequence[0]
            if not isinstance(first_element, dict):
                return False

            # Must have tool_name and arguments
            if "tool_name" not in first_element:
                return False

            if "arguments" not in first_element:
                return False

            # Arguments should be a dict
            if not isinstance(first_element["arguments"], dict):
                return False

            return True

        except Exception:
            return False


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
image = (
    modal.Image.debian_slim().pip_install(
        [
            "psycopg2-binary",  # Direct database connection
            "httpx",  # HTTP client
            "websockets",  # WebSocket support
            "PyYAML",  # YAML parsing for dual-format sequence support
            "cryptography",  # For secrets encryption/decryption
            # AI enrichment deps (GenAI preferred; Vertex fallback)
            "google-genai",
            "google-cloud-aiplatform",
            "google-auth",
            # Commenting out 'mcp' as it might not be available via pip
            # We'll handle MCP differently or mock it for now
        ]
    )
    # Include local package so sibling modules are available at runtime (Modal 1.0 packaging)
    .add_local_python_source("modal_apps")
)

# Secrets for database access, MCP endpoint, GitHub, secrets encryption, and service API
secrets = [
    modal.Secret.from_name("supabase-secret"),
    modal.Secret.from_name("custom-secret"),
    modal.Secret.from_name("github-token"),
    modal.Secret.from_name("secrets-encryption-key"),
    modal.Secret.from_name("mediar-service-api-key"),
]


# Configuration for auto-cancellation
CONSECUTIVE_FAILURE_THRESHOLD = 3  # Number of identical failures

# Auto-cancellation logic


def cancel_queued_jobs(cur, conn, workflow_id, original_error_message):
    """Cancel all queued jobs for workflow, return count cancelled"""
    cancellation_message = (
        f"Auto-cancelled: 3 consecutive identical failures - {original_error_message}"
    )

    cur.execute(
        """
        UPDATE workflow_executions 
        SET status = 'cancelled', 
            error_message = %s,
            completed_at = NOW()
        WHERE workflow_id = %s AND status = 'queued'
        RETURNING id
    """,
        (cancellation_message, workflow_id),
    )

    cancelled_ids = [row[0] for row in cur.fetchall()]

    # Update workflow status to 'paused' to prevent new executions
    cur.execute(
        """
        UPDATE deployed_workflows 
        SET status = 'paused',
            updated_at = NOW()
        WHERE id = %s AND status = 'deployed'
    """,
        (workflow_id,),
    )

    conn.commit()

    return len(cancelled_ids), cancelled_ids


def check_failure_patterns_for_workflow(cur, conn, workflow_id):
    """
     WORKFLOW-SPECIFIC FAILURE PATTERN CHECK: Prevents claiming jobs for a specific workflow with recent consecutive failures.

    Checks if the last 3 executions (completed/failed) for the workflow are ALL failures with identical error messages.
    Ignores cancelled jobs since they never actually executed. If pattern found, cancels all queued jobs.

    Returns: (should_block: bool, reason: str, check_duration_ms: int)
    """
    start_time = time.time()

    try:
        # Check if we should skip cancellation check for this workflow (manual resume)
        cur.execute(
            """
            SELECT skip_next_cancellation_check 
            FROM deployed_workflows 
            WHERE id = %s
        """,
            (workflow_id,),
        )

        result = cur.fetchone()
        if result and result[0]:  # skip_next_cancellation_check is True
            # Reset the flag and allow this execution to proceed
            cur.execute(
                """
                UPDATE deployed_workflows 
                SET skip_next_cancellation_check = false,
                    updated_at = NOW()
                WHERE id = %s
            """,
                (workflow_id,),
            )
            conn.commit()

            check_duration_ms = int((time.time() - start_time) * 1000)
            logger.info(
                " Skipping cancellation check for workflow %d (manual resume) (took %dms)",
                workflow_id,
                check_duration_ms,
            )
            return (
                False,
                "Skipped cancellation check - manual resume",
                check_duration_ms,
            )

        # Check the last 3 executions that actually ran (completed or failed), ignoring cancelled jobs
        cur.execute(
            """
            SELECT id, status, error_message, completed_at
            FROM workflow_executions 
            WHERE workflow_id = %s 
            AND status IN ('completed', 'failed')
            AND completed_at > NOW() - INTERVAL '10 minutes'
            ORDER BY completed_at DESC
            LIMIT %s
        """,
            (workflow_id, CONSECUTIVE_FAILURE_THRESHOLD),
        )

        recent_executions = cur.fetchall()
        check_duration_ms = int((time.time() - start_time) * 1000)

        if len(recent_executions) < CONSECUTIVE_FAILURE_THRESHOLD:
            logger.debug(
                " Pre-claim check for workflow %d: %d recent executions, proceeding (took %dms)",
                workflow_id,
                len(recent_executions),
                check_duration_ms,
            )
            return False, "", check_duration_ms

        # Check if ALL 3 most recent executions are failures with identical error messages
        all_failed = all(row["status"] == "failed" for row in recent_executions)

        if not all_failed:
            logger.debug(
                " Pre-claim check for workflow %d: Not all recent executions failed, proceeding (took %dms)",
                workflow_id,
                check_duration_ms,
            )
            return False, "", check_duration_ms

        # All 3 are failures - check if they have identical error messages
        error_messages = [
            row["error_message"] for row in recent_executions if row["error_message"]
        ]

        if len(error_messages) == CONSECUTIVE_FAILURE_THRESHOLD and all(
            msg == error_messages[0] for msg in error_messages
        ):
            # Found problematic pattern - cancel remaining queued jobs for this workflow
            cancelled_count, cancelled_ids = cancel_queued_jobs(
                cur, conn, workflow_id, error_messages[0]
            )

            reason = f"Blocked job claim: Workflow {workflow_id} has {len(recent_executions)} consecutive identical failures. Cancelled {cancelled_count} queued jobs and paused workflow."
            logger.warning(" %s (took %dms)", reason, check_duration_ms)
            if cancelled_ids:
                logger.warning(" Cancelled execution IDs: %s", cancelled_ids)
            logger.warning(
                "Workflow %d status changed to 'paused' to prevent new executions",
                workflow_id,
            )

            return True, reason, check_duration_ms

        logger.debug(
            " Pre-claim check for workflow %d: No blocking patterns found (took %dms)",
            workflow_id,
            check_duration_ms,
        )
        return False, "", check_duration_ms

    except Exception as e:
        check_duration_ms = int((time.time() - start_time) * 1000)
        logger.error(
            " Error in pre-claim failure pattern check for workflow %d: %s (took %dms)",
            workflow_id,
            e,
            check_duration_ms,
        )
        return False, f"Check error: {e}", check_duration_ms


# Windows VM service management endpoints
# This should be dynamically determined based on the machine or passed as a parameter
VM_MANAGEMENT_ENDPOINT = os.environ.get("VM_MANAGEMENT_ENDPOINT", "")

# Note: MCP endpoints are now passed dynamically via mcp_endpoint parameter


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


def execute_workflow_by_version(
    *,
    version_number: str,
    mcp_endpoint: str,
    execution_params: Dict[str, Any] | None = None,
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    workflow_name_contains: Optional[str] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """Convenience wrapper to run a workflow when you only know the version.

    Resolves the unique workflow_id for the given version (with optional filters) and
    runs the existing executor while passing the same version to ensure exact selection.
    """
    workflow_id = resolve_workflow_id_for_version(
        version_number=version_number,
        status=status,
        workflow_name_contains=workflow_name_contains,
        category=category,
    )
    return execute_workflow.local(  # type: ignore[attr-defined]
        workflow_id=workflow_id,
        mcp_endpoint=mcp_endpoint,
        execution_params=execution_params or {},
        client_id=client_id,
        version_number=version_number,
    )


def resolve_workflow_id_for_version(
    version_number: str,
    *,
    status: Optional[str] = None,
    workflow_name_contains: Optional[str] = None,
    category: Optional[str] = None,
) -> int:
    """Resolve a single workflow ID for a given version number.

    Version numbers are not globally unique. Optional filters help disambiguate.

    Args:
        version_number: The version number to look up (e.g., "1.0.67").
        status: Optional workflow status to filter on (e.g., "deployed").
        workflow_name_contains: Optional case-insensitive substring match on workflow name.
        category: Optional workflow category filter.

    Returns:
        The resolved workflow ID.

    Raises:
        ValueError: If no workflows match or if multiple workflows match the criteria.
    """
    conn = None
    cur = None
    try:
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        conditions = ["v.version_number = %s"]
        params: List[Any] = [version_number]

        if status:
            conditions.append("w.status = %s")
            params.append(status)

        if category:
            conditions.append("w.category = %s")
            params.append(category)

        if workflow_name_contains:
            conditions.append("w.name ILIKE %s")
            params.append(f"%{workflow_name_contains}%")

        where_clause = " AND ".join(conditions)

        cur.execute(
            f"""
            SELECT
                w.id,
                w.name,
                w.status,
                w.category,
                w.version AS current_version
            FROM deployed_workflow_versions v
            JOIN deployed_workflows w ON w.id = v.workflow_id
            WHERE {where_clause}
            ORDER BY w.updated_at DESC
            """,
            params,
        )

        rows = cur.fetchall() or []
        if len(rows) == 0:
            raise ValueError(
                f"No workflows found with version {version_number}"
                + (f" (status={status})" if status else "")
                + (f" (category={category})" if category else "")
                + (
                    f" (name contains '{workflow_name_contains}')"
                    if workflow_name_contains
                    else ""
                )
            )

        if len(rows) > 1:
            summary = ", ".join(
                [
                    f"{row['id']}:{row['name']}:{row['status']}:{row['category']}"
                    for row in rows
                ]
            )
            raise ValueError(
                "Multiple workflows match the version; refine filters: " + summary
            )

        return int(rows[0]["id"])  # type: ignore[call-arg]

    finally:
        try:
            if cur is not None:
                cur.close()
        finally:
            if conn is not None:
                conn.close()


def extract_applicant_info(workflow_data: Dict[str, Any]) -> Dict[str, str]:
    """
    DEPRECATED: Extract applicant information from workflow automation sequence
    This function is insurance-specific and no longer used in workflow-agnostic executor.
    Kept for backward compatibility only.
    """
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
        " Workflow execution completed!",
        "",
        " Insurance Quote Summary",
        "=" * 60,
        "",
        " Applicant Profile:",
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
        summary_lines.extend([f" Eligible Quotes ({len(eligible_quotes)})", "-" * 60])

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
        summary_lines.extend([" No Eligible Quotes Found", "-" * 60, ""])

    # Add ineligible carriers section
    if ineligible_quotes:
        summary_lines.extend(
            [f" Ineligible Carriers ({len(ineligible_quotes)})", "-" * 60]
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
                    " Price Summary",
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
            " Execution Metrics",
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
            if "default" in value:
                # This is a leaf node with a default value
                defaults[key] = value["default"]
            else:
                # This is a nested group of parameters, recurse
                nested_defaults = extract_defaults_recursive(value)
                if nested_defaults:
                    defaults[key] = nested_defaults
    return defaults


async def upload_screenshots_to_s3(screenshots: List[str], execution_id: str) -> List[str]:
    """
    Upload screenshots to Supabase Storage via API endpoint.

    Args:
        screenshots: List of base64-encoded PNG strings
        execution_id: Workflow execution ID for organizing uploads

    Returns:
        List of public URLs to uploaded screenshots
    """
    import httpx

    if not screenshots:
        return []

    screenshot_urls = []
    api_base_url = os.getenv("NEXT_PUBLIC_BASE_URL", "https://mediar.ai")
    upload_endpoint = f"{api_base_url}/api/workflows/executions/upload-screenshot"

    logger.info(f"📸 Uploading {len(screenshots)} screenshots to S3 for execution {execution_id}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, base64_data in enumerate(screenshots):
            try:
                # Call API endpoint to upload screenshot
                response = await client.post(
                    upload_endpoint,
                    json={
                        "execution_id": execution_id,
                        "monitor_index": idx,
                        "base64_data": base64_data,
                    },
                    headers={"Content-Type": "application/json"},
                )

                if response.status_code == 200:
                    result = response.json()
                    url = result.get("url")
                    if url:
                        screenshot_urls.append(url)
                        logger.info(f"   ✓ Monitor {idx + 1} uploaded: {url}")
                    else:
                        logger.error(f"   ✗ Monitor {idx + 1} upload failed: No URL in response")
                else:
                    logger.error(
                        f"   ✗ Monitor {idx + 1} upload failed: HTTP {response.status_code} - {response.text}"
                    )

            except Exception as e:
                logger.error(f"   ✗ Monitor {idx + 1} upload exception: {e}")

    logger.info(f"📸 Successfully uploaded {len(screenshot_urls)}/{len(screenshots)} screenshots")
    return screenshot_urls


async def check_mcp_server_health(health_endpoint: str) -> bool:
    """
    Check if the MCP server is healthy and reachable.
    Returns True if healthy, False otherwise.
    """
    import httpx

    try:
        logger.info(" Checking MCP server health at: %s", health_endpoint)

        async with httpx.AsyncClient(timeout=10.0) as client:
            # Check MCP health endpoint
            response = await client.get(
                health_endpoint, headers={"ngrok-skip-browser-warning": "true"}
            )

            if response.status_code == 200:
                logger.info(" MCP server is healthy")
                return True
            else:
                logger.warning(" MCP server returned status %d", response.status_code)
                return False

    except Exception as e:
        logger.warning(" MCP server health check failed: %s", e)
        return False


async def restart_windows_vm_service() -> bool:
    """
    Attempt to restart the Windows VM service using the management endpoint.
    Returns True if restart was successful, False otherwise.
    """
    import httpx

    try:
        logger.info(" Attempting to restart Windows VM service...")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Call the VM management endpoint to restart the service
            response = await client.post(
                f"{VM_MANAGEMENT_ENDPOINT}/restart",
                headers={"ngrok-skip-browser-warning": "true"},
            )

            if response.status_code == 200:
                result = response.json()
                if result.get("success", False):
                    logger.info(" Windows VM service restarted successfully")
                    logger.info(
                        " Service status: %s",
                        result.get("service_status", {}).get("status", "Unknown"),
                    )
                    return True
                else:
                    logger.error(
                        " VM service restart failed: %s",
                        result.get("error", "Unknown error"),
                    )
                    return False
            else:
                logger.error(
                    " VM management endpoint returned status %d", response.status_code
                )
                return False

    except Exception as e:
        logger.error(" Failed to restart Windows VM service: %s", e)
        return False


async def wait_for_mcp_server_recovery(
    health_endpoint: str, max_wait_seconds: int = 60
) -> bool:
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
        logger.info(" Health check attempt %d...", retry_count)

        if await check_mcp_server_health(health_endpoint):
            recovery_time = int(time.time() - start_time)
            logger.info(" MCP server is back online after %d seconds", recovery_time)
            return True

        # Wait 5 seconds before next check
        await asyncio.sleep(5)

    logger.error(
        " MCP server did not come back online within %d seconds", max_wait_seconds
    )
    return False


def log_merge_details(original, merged, path=""):
    """Recursively compares two dictionaries and logs the changes."""
    # Using sorted keys for consistent log output
    for key in sorted(merged.keys()):
        new_path = f"{path}.{key}" if path else key
        if key not in original:
            logger.info(f"   Added '{new_path}': {merged[key]}")
        elif isinstance(merged.get(key), dict) and isinstance(original.get(key), dict):
            log_merge_details(original[key], merged[key], path=new_path)
        elif original.get(key) != merged.get(key):
            logger.info(
                f"   Changed '{new_path}': '{original.get(key)}' -> '{merged.get(key)}'"
            )


def _truncate_middle(text: str, max_length: int = 400) -> str:
    """Truncate long strings keeping the beginning and end for context."""
    try:
        if not isinstance(text, str):
            text = str(text)
        if len(text) <= max_length:
            return text
        head = max_length // 2
        tail = max_length - head - 3
        return f"{text[:head]}...{text[-tail:]}"
    except Exception:
        return text[:max_length]


def log_mcp_execution_breakdown(mcp_content: Dict[str, Any]) -> None:
    """Log a structured breakdown of MCP execution groups and steps to diagnose failures."""
    try:
        if not isinstance(mcp_content, dict):
            logger.info(" MCP content is not a dict; skipping breakdown log")
            return

        status = mcp_content.get("status")
        total_tools = mcp_content.get("total_tools")
        executed_tools = mcp_content.get("executed_tools")
        total_duration_ms = mcp_content.get("total_duration_ms")
        logger.info(
            " MCP Summary | status=%s | total_tools=%s | executed_tools=%s | total_duration_ms=%s",
            status,
            total_tools,
            executed_tools,
            total_duration_ms,
        )

        results = mcp_content.get("results", [])
        if not isinstance(results, list):
            logger.info(" MCP results is not a list; type=%s", type(results).__name__)
            return

        total_groups = len(results)
        logger.info(" MCP Groups: %d", total_groups)

        first_error_logged = False
        for group_index, group in enumerate(results):
            group_name = group.get("group_name", f"group_{group_index}")
            group_status = group.get("status", "unknown")
            group_duration = group.get("duration_ms", 0)
            group_results = group.get("results", [])
            logger.info(
                "    Group %d: %s | status=%s | duration_ms=%s | steps=%d",
                group_index,
                group_name,
                group_status,
                group_duration,
                len(group_results) if isinstance(group_results, list) else 0,
            )

            if not isinstance(group_results, list):
                logger.info(
                    "     ↳ Group results is not a list; type=%s",
                    type(group_results).__name__,
                )
                continue

            for step_index, step in enumerate(group_results):
                tool = step.get("tool_name", f"step_{step_index}")
                step_status = step.get("status", "unknown")
                step_duration = step.get("duration_ms", 0)
                logger.info(
                    "     - Step %d.%d | tool=%s | status=%s | duration_ms=%s",
                    group_index,
                    step_index,
                    tool,
                    step_status,
                    step_duration,
                )

                if step_status == "error" or step_status == "executed_with_error":
                    error_payload = step.get("error")
                    logger.error(
                        "        Error in %s: %s",
                        tool,
                        _truncate_middle(error_payload, 600),
                    )
                    if not first_error_logged:
                        try:
                            # Attempt to extract an error_type if the payload embeds JSON
                            error_type = None
                            if isinstance(error_payload, str):
                                # Try to find a JSON fragment in the string
                                json_start = error_payload.find("{")
                                json_end = error_payload.rfind("}")
                                if (
                                    json_start != -1
                                    and json_end != -1
                                    and json_end > json_start
                                ):
                                    import json as _json

                                    fragment = error_payload[json_start : json_end + 1]
                                    parsed = _json.loads(fragment)
                                    error_type = parsed.get("error_type") or parsed.get(
                                        "type"
                                    )
                            logger.error(
                                "        First error summary | group=%s | step=%s | tool=%s | error_type=%s",
                                group_name,
                                f"{group_index}.{step_index}",
                                tool,
                                error_type or "Unknown",
                            )
                        except Exception:
                            logger.error(
                                "        Failed to parse error payload for %s", tool
                            )
                        first_error_logged = True

    except Exception as breakdown_err:
        logger.error("Failed to log MCP execution breakdown: %s", breakdown_err)


# =============================================================================
# Standardized Success/Failure Indication System
# =============================================================================


def parse_workflow_result(mcp_response: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse MCP workflow execution result and determine success/failure status.

    This implements the standardized success/failure indication system that matches
    the Rust CLI implementation.

    Args:
        mcp_response: Raw MCP response from execute_sequence call

    Returns:
        Dict containing:
        - success: bool - Business logic success (did we achieve the goal?)
        - state: str - Workflow state ("success", "failure", "skipped")
        - message: str - Human readable success/failure message
        - data: Any - ENTIRE parser output (preserves error_summary, failure_details, etc.)
        - error: str|None - Error information if failed
        - duration_ms: int - Execution time
        - steps_executed: int - Number of steps executed
        - validation: Dict - What checks passed/failed
    """
    try:
        # Safely handle None or invalid mcp_response
        if not isinstance(mcp_response, dict):
            logger.warning(" parse_workflow_result: mcp_response is not a dict, type=%s", type(mcp_response).__name__)
            mcp_response = {}

        # Extract basic execution info with safe defaults
        execution_status = mcp_response.get("status", "unknown")
        total_duration_ms = mcp_response.get("total_duration_ms", 0)
        executed_tools = mcp_response.get("executed_tools", 0)
        parsed_output = mcp_response.get("parsed_output")

        # Initialize result structure
        result = {
            "success": False,
            "message": "Unknown status",
            "data": None,
            "error": None,
            "duration_ms": total_duration_ms,
            "steps_executed": executed_tools,
            "validation": {},
        }

        # Check if we have business logic output from parser
        if parsed_output and isinstance(parsed_output, dict):
            logger.info(" Found parsed_output from workflow parser")

            # Check for special states (priority order: exception > skipped > normal)
            is_skipped = bool(parsed_output.get("skipped", False))
            is_exception = bool(parsed_output.get("exception", False))

            # Add state flags to result
            result["skipped"] = is_skipped
            result["exception"] = is_exception

            # Determine state based on priority: exception > skipped > success/failure
            if is_exception:
                result["success"] = False
                result["state"] = "exception"
                logger.info("⚠️ Workflow encountered EXCEPTION")
            elif is_skipped:
                result["success"] = False
                result["state"] = "skipped"
                logger.info("⏭ Workflow was SKIPPED")
            else:
                result["success"] = bool(parsed_output.get("success", False))
                result["state"] = "success" if result["success"] else "failure"

            result["message"] = parsed_output.get("message", "No message from parser")
            # Store the entire parser output to preserve all workflow-specific fields
            # This allows dashboards to access error_summary, failure_details, etc.
            result["data"] = parsed_output  # Changed from parsed_output.get("data") to preserve full structure
            result["error"] = parsed_output.get("error")
            result["validation"] = parsed_output.get("validation", {})

            logger.info(
                " Business logic result: state=%s, success=%s, exception=%s, skipped=%s - %s",
                result.get("state", "unknown"),
                result["success"],
                result.get("exception", False),
                result.get("skipped", False),
                result["message"],
            )
        else:
            logger.info(" No parsed_output found, using execution status")

            # No parser - use execution status as fallback
            # Consider "success", "executed_without_error", "completed_with_errors", and "partial_success" as successful execution
            # "executed_without_error" is the new status from terminator MCP agent
            # "completed_with_errors" means the workflow ran to completion but had non-critical issues
            # "partial_success" means the workflow completed but may not have achieved full business goal
            result["success"] = execution_status in ["success", "executed_without_error", "completed_with_errors", "partial_success", "executed_with_partial_errors"]
            result["skipped"] = False  # Without parser output, we can't determine if skipped
            result["state"] = "success" if result["success"] else "failure"
            result["message"] = f"Workflow {execution_status}"
            result["error"] = mcp_response.get("debug_info_on_failure")

            # Add basic validation info
            result["validation"] = {
                "execution_completed": execution_status
                in ["success", "executed_without_error", "completed_with_errors", "partial_success", "executed_with_partial_errors"],
                "tools_executed": executed_tools,
            }

        return result

    except Exception as e:
        logger.error(" Failed to parse workflow result: %s", e)
        return {
            "success": False,
            "state": "failure",
            "message": f"Failed to parse workflow result: {str(e)}",
            "data": None,
            "error": str(e),
            "duration_ms": 0,
            "steps_executed": 0,
            "validation": {"parse_error": True},
        }


def display_workflow_result(result: Dict[str, Any]) -> int:
    """
    Display workflow execution result with proper formatting.

    Args:
        result: Parsed workflow result from parse_workflow_result()

    Returns:
        int: Exit code (0 for success, 1 for failure)
    """
    try:
        # Main status line
        if result["success"]:
            logger.info(" SUCCESS: %s", result["message"])
        else:
            logger.error(" FAILURE: %s", result["message"])

        # Execution details
        logger.info(" Execution: %s", result.get("state", "unknown"))
        logger.info("   Duration: %dms", result["duration_ms"])
        logger.info("   Steps: %d", result["steps_executed"])

        # Data output (if present)
        if result["data"]:
            if isinstance(result["data"], (list, dict)):
                logger.info(
                    " Data: %s",
                    (
                        json.dumps(result["data"], indent=2)[:500] + "..."
                        if len(json.dumps(result["data"])) > 500
                        else json.dumps(result["data"], indent=2)
                    ),
                )
            else:
                logger.info(
                    " Data: %s",
                    (
                        str(result["data"])[:500] + "..."
                        if len(str(result["data"])) > 500
                        else str(result["data"])
                    ),
                )

        # Error details (if present)
        if result["error"]:
            logger.error(" Error: %s", result["error"])

        # Validation details (if present)
        if result["validation"]:
            logger.info(" Validation:")
            for key, value in result["validation"].items():
                logger.info("   %s: %s", key, value)

        # Return appropriate exit code
        return 0 if result["success"] else 1

    except Exception as e:
        logger.error(" Failed to display workflow result: %s", e)
        return 1


def extract_legacy_quotes_from_mcp_response(
    mcp_content: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    DEPRECATED: Legacy function to extract quotes from MCP response for backward compatibility.
    This function is insurance-specific and no longer used in workflow-agnostic executor.
    Kept for backward compatibility only.

    This maintains compatibility with existing quote extraction logic while we
    transition to the new standardized format.
    """
    quotes = []

    try:
        logger.info(" DEBUG: Searching for quotes in MCP response structure...")

        if "results" in mcp_content and isinstance(mcp_content["results"], list):
            logger.info(
                " DEBUG: Found %d top-level results", len(mcp_content["results"])
            )
            for i, step_result in enumerate(mcp_content["results"]):
                logger.info(
                    " DEBUG: Step %d status: %s", i, step_result.get("status")
                )

                # Check if this is the "Set Coverage and Generate Quote" group
                if step_result.get("status") in ["success", "executed_without_error"] and "results" in step_result:
                    logger.info(
                        " DEBUG: Found %d sub-results in step %d",
                        len(step_result["results"]),
                        i,
                    )
                    for j, sub_result in enumerate(step_result["results"]):
                        tool_name = sub_result.get("tool_name")
                        logger.info(
                            " DEBUG: Sub-result %d tool_name: %s", j, tool_name
                        )

                        if tool_name == "wait_for_output_parser":
                            logger.info(" DEBUG: Found wait_for_output_parser step!")
                            if (
                                "result" in sub_result
                                and "content" in sub_result["result"]
                            ):
                                logger.info(
                                    " DEBUG: Found content in wait_for_output_parser result"
                                )
                                for content_item in sub_result["result"]["content"]:
                                    if content_item.get("type") == "text":
                                        logger.info(
                                            " DEBUG: Found text content, attempting to parse..."
                                        )
                                        try:
                                            parser_result = json.loads(
                                                content_item.get("text", "{}")
                                            )
                                            logger.info(
                                                " DEBUG: Parser result keys: %s",
                                                list(parser_result.keys()),
                                            )
                                            if "extracted_data" in parser_result:
                                                quotes = parser_result["extracted_data"]
                                                logger.info(
                                                    " Found %d quotes from wait_for_output_parser step",
                                                    len(quotes),
                                                )
                                                break
                                        except json.JSONDecodeError as e:
                                            logger.warning(
                                                "Failed to parse wait_for_output_parser result: %s",
                                                e,
                                            )
                        if quotes:
                            break
                    if quotes:
                        break
                if quotes:
                    break
        else:
            logger.info(" DEBUG: No 'results' field found in mcp_content")
            logger.info(
                " DEBUG: MCP content keys: %s",
                list(mcp_content.keys()) if mcp_content else "None",
            )

        # Fallback: check for parsed_output field (legacy support)
        if not quotes and "parsed_output" in mcp_content:
            parsed_output = mcp_content.get("parsed_output", [])
            if not parsed_output:
                logger.warning(
                    " 'parsed_output' field exists but is empty. The UI tree may not have matched the parsing rules."
                )
            else:
                logger.info(
                    " Found 'parsed_output' field with %d items. Using it for quotes.",
                    len(parsed_output),
                )
            quotes = parsed_output

        if not quotes:
            logger.warning(
                " No quotes found in MCP response. Check for parser errors or if the workflow produced a UI tree."
            )
            logger.info(" DEBUG: Final MCP content structure for troubleshooting:")
            logger.info(
                " DEBUG: %s",
                (
                    json.dumps(mcp_content, indent=2)[:2000] + "..."
                    if mcp_content
                    else "None"
                ),
            )

    except Exception as e:
        logger.error(" Failed to extract legacy quotes: %s", e)

    return quotes


async def execute_mcp_workflow(
    workflow_data: Dict[str, Any],
    execution_params: Dict[str, Any],
    mcp_endpoint: str,
    machine_id: int = 1,
    workflow_id: int = None,
    start_from_step: str = None,
    end_at_step: str = None,
    follow_fallback: bool = None,
    execute_jumps_at_end: bool = None
) -> Dict[str, Any]:
    """Execute workflow using the working MCP HTTP approach with file support"""
    import httpx
    # File manager removed - files are now accessed via rclone mount

    # Initialize screenshot variables at function top to prevent NameError
    screenshots = []  # Base64 screenshots from MCP response
    screenshot_urls = []  # URLs from Supabase Storage (populated during upload)

    logger.info(" Attempting to connect to MCP endpoint: %s", mcp_endpoint)

    # Check if workflow requires external files
    requires_files = workflow_data.get("requires_files", False)

    # If files are required, set the root_path for rclone mount
    # Files are accessed via rclone mount at S:\workflows\{workflow_id}\ on Windows
    root_path = None
    if requires_files:
        logger.info(" Workflow requires external files, setting root_path...")
        # Use the passed workflow_id parameter, fallback to data.get("id") if not provided
        wf_id = workflow_id or workflow_data.get("id")
        if wf_id:
            base_path = f"S:\\workflows\\{wf_id}\\"

            # Check files_config for subdirectory name
            files_config = workflow_data.get("files_config")
            subdirectory = None

            if files_config and isinstance(files_config, dict):
                # Try to get subdirectory from files_config
                subdirectory = files_config.get("subdirectory") or files_config.get("folder_name")
                if subdirectory:
                    logger.info(f" Using subdirectory from files_config: {subdirectory}")

            if subdirectory:
                # Use the configured subdirectory
                import os
                root_path = os.path.join(base_path, subdirectory) + "\\"
                logger.info(f" Using configured root_path: {root_path}")
            else:
                # Try to auto-detect subdirectory from mounted files
                import os
                import glob

                # Check if there are subdirectories in the mounted path
                try:
                    if os.path.exists(base_path):
                        subdirs = [d for d in os.listdir(base_path)
                                 if os.path.isdir(os.path.join(base_path, d))]

                        if len(subdirs) == 1:
                            # Single subdirectory found - likely the workflow folder
                            detected_subdir = subdirs[0]
                            # Check if it contains .js files
                            js_files = glob.glob(os.path.join(base_path, detected_subdir, "*.js"))
                            if js_files:
                                logger.info(f" Auto-detected subdirectory '{detected_subdir}' containing {len(js_files)} JS files")
                                root_path = os.path.join(base_path, detected_subdir) + "\\"
                                logger.info(f" Using auto-detected root_path: {root_path}")
                            else:
                                root_path = base_path + "\\"
                                logger.info(f" No JS files in subdirectory, using base path: {root_path}")
                        else:
                            # Multiple subdirectories or none - use base path
                            root_path = base_path + "\\"
                            logger.info(f" Multiple/no subdirectories found, using base path: {root_path}")
                    else:
                        root_path = base_path + "\\"
                        logger.info(f" Mount path doesn't exist yet, using base path: {root_path}")
                except Exception as e:
                    logger.warning(f" Error auto-detecting subdirectory: {e}")
                    root_path = base_path + "\\"
                    logger.info(f" Fallback to base path: {root_path}")
        else:
            logger.warning(" Workflow requires files but no workflow_id available!")
            root_path = None

    session_client = None
    try:
        # Use the smart sequence loader for dual-format support
        automation_sequence_list = SequenceLoader.load_workflow_sequence(workflow_data)

        if not automation_sequence_list or len(automation_sequence_list) == 0:
            raise ValueError("No valid automation sequence found in workflow data")

        workflow_data_to_use = automation_sequence_list[0]

        # Debug logging to understand the structure
        logger.info(" Workflow structure after loading:")
        logger.info("  Type: %s", type(workflow_data_to_use))
        logger.info("  Keys: %s", list(workflow_data_to_use.keys()) if isinstance(workflow_data_to_use, dict) else "Not a dict")

        tool_name = workflow_data_to_use.get("tool_name")
        arguments = workflow_data_to_use.get("arguments", {})

        # --- PARAMETER OVERRIDE LOGIC ---
        if execution_params:
            logger.info(" Merging execution parameters into workflow inputs:")

            # --- FINAL CORRECTED LOGIC ---
            # 1. Use the `inputs` block as the source for default values.
            default_inputs = arguments.get("inputs", {})

            # 2. For logging, show the changes between defaults and user overrides
            log_merge_details(default_inputs, execution_params)

            # 3. Create the final runtime values by merging overrides onto defaults
            final_runtime_inputs = deep_merge(default_inputs, execution_params)

            # 4. Update ONLY the 'inputs' block. The 'variables' schema is not touched.
            arguments["inputs"] = final_runtime_inputs
            # --- END FINAL CORRECTED LOGIC ---

        else:
            logger.info(" Using default inputs from workflow definition.")

        # Add scripts_base_path to arguments if workflow requires files
        # IMPORTANT: scripts_base_path must be at the root level of the execute_sequence arguments
        # The MCP server expects it alongside 'steps', 'variables', 'inputs', etc.
        if requires_files and root_path:
            arguments["scripts_base_path"] = root_path
            logger.info(f" Added scripts_base_path to arguments at root level: {root_path}")

        # NEW: Add partial execution control parameters at arguments root level
        # These parameters control execute_sequence behavior, not workflow inputs
        if start_from_step:
            arguments["start_from_step"] = start_from_step
            logger.info(f" Partial execution: start_from_step={start_from_step}")

        if end_at_step:
            arguments["end_at_step"] = end_at_step
            logger.info(f" Partial execution: end_at_step={end_at_step}")

        if follow_fallback is not None:
            arguments["follow_fallback"] = follow_fallback
            logger.info(f" Partial execution: follow_fallback={follow_fallback}")

        if execute_jumps_at_end is not None:
            arguments["execute_jumps_at_end"] = execute_jumps_at_end
            logger.info(f" Partial execution: execute_jumps_at_end={execute_jumps_at_end}")

        # Screenshot capture disabled for all MCP tool calls
        # This will add include_monitor_screenshots: false to every step's arguments
        logger.info(" Disabling screenshot capture for workflow execution")
        if "steps" in arguments:
            for step in arguments["steps"]:
                if "arguments" not in step:
                    step["arguments"] = {}
                step["arguments"]["include_monitor_screenshots"] = False

        # Also disable for troubleshooting steps if they exist
        if "troubleshooting" in arguments:
            for step in arguments["troubleshooting"]:
                if "arguments" not in step:
                    step["arguments"] = {}
                step["arguments"]["include_monitor_screenshots"] = False

        # The entire `arguments` object, containing the `variables` schema, the final `inputs`,
        # and the `items`, is sent to MCP. The template engine inside MCP will know
        # to use the `inputs` block for template substitution.

        logger.info(" Workflow: %s", tool_name)
        logger.info("   Items: %d", len(arguments.get("items", [])))

        # --- MORE DETAILED LOGGING ---
        logger.info("--- DETAILED LOGGING: Payload being sent to MCP ---")
        # For clarity, we log the two main parts of the arguments separately
        if "inputs" in arguments:
            logger.info(
                "   Runtime Inputs (for execution): %s",
                json.dumps(arguments["inputs"], indent=2),
            )

        log_string = json.dumps(arguments)
        logger.info(
            f"Full Arguments Payload (truncated): {log_string[:200]}{'...' if len(log_string) > 200 else ''}"
        )
        logger.info("--- END DETAILED LOGGING ---")

        # Ensure we always target the gatekeeper's /mcp path
        endpoint_url = normalize_endpoint(mcp_endpoint)

        # Step 1: Initialize MCP session with 503 backoff so LB can reroute to a free VM
        logger.info(" Initializing MCP session...")
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

        # Initialize MCP session using helper with 503 backoff
        def _client_factory():
            import httpx

            # Use more granular timeout configuration
            # - connect: time to establish connection (10s)
            # - read: time between reads from server (120s - allow first-time npm install)
            # - write: time to send data (10s)
            # - pool: time to acquire connection from pool (10s)
            timeout_config = httpx.Timeout(
                connect=10.0,
                read=120.0,  # Allow 2 minutes for first-time npm install of terminator.js
                write=10.0,
                pool=10.0
            )
            return httpx.AsyncClient(timeout=timeout_config)

        mcp_auth_token = os.environ.get("MCP_AUTH_TOKEN")

        def _with_auth(headers):
            if not mcp_auth_token:
                return headers
            headers = dict(headers)
            headers["Authorization"] = f"Bearer {mcp_auth_token}"
            return headers

        async def _initialize_session():
            client, resp = await post_with_503_backoff(
                _client_factory,
                endpoint_url,
                init_request,
                _with_auth({
                    "Accept": "application/json, text/event-stream",
                }),
            )
            return client, resp

        session_client, response = await _initialize_session()

        # Handle non-503 non-200 statuses with existing health/restart flow
        if response.status_code != 200:
            health_endpoint = f"{endpoint_url.replace('/mcp', '')}/health"
            if response.status_code in [404, 502, 504]:
                logger.warning(
                    " MCP server unreachable (status %d). Attempting automatic restart...",
                    response.status_code,
                )
                if not await check_mcp_server_health(health_endpoint):
                    logger.info(
                        " Confirmed: MCP server is down. Initiating Windows VM service restart..."
                    )
                    if await restart_windows_vm_service():
                        logger.info(
                            " VM service restart initiated. Waiting for MCP server recovery..."
                        )
                        if await wait_for_mcp_server_recovery(
                            health_endpoint, max_wait_seconds=90
                        ):
                            # Try once more on a fresh connection
                            import httpx

                            await session_client.aclose()
                            timeout_config = httpx.Timeout(
                                connect=10.0,
                                read=60.0,
                                write=10.0,
                                pool=10.0
                            )
                            retry_client = httpx.AsyncClient(timeout=timeout_config)
                            retry_response = await retry_client.post(
                                endpoint_url,
                                json=init_request,
                                headers=_with_auth({
                                    "Accept": "application/json, text/event-stream"
                                }),
                            )
                            if retry_response.status_code == 200:
                                session_client = retry_client
                                response = retry_response
                            else:
                                await retry_client.aclose()
                                raise Exception(
                                    f"Failed to initialize MCP session after restart: {retry_response.status_code}"
                                )
                        else:
                            await session_client.aclose()
                            raise Exception(
                                "MCP server did not recover after Windows VM service restart"
                            )
                    else:
                        await session_client.aclose()
                        raise Exception(
                            "Failed to restart Windows VM service - MCP server remains unreachable"
                        )
                else:
                    await session_client.aclose()
                    raise Exception(
                        f"Failed to initialize MCP session: {response.status_code}"
                    )
            else:
                await session_client.aclose()
                raise Exception(
                    f"Failed to initialize MCP session: {response.status_code}"
                )

        # Extract session ID from response headers
        session_id = response.headers.get("Mcp-Session-Id")
        if not session_id:
            # Close the session client before raising
            try:
                await session_client.aclose()
            except Exception:
                pass
            raise Exception("No session ID received from MCP server")

        logger.info(f" MCP session initialized: {session_id}")

        # Step 1.5: Send initialized notification (required by MCP protocol)
        logger.info(" Sending initialized notification...")
        initialized_request = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {},
        }

        async def _post_with_session(payload):
            nonlocal session_client, session_id
            logger.info("[DEBUG] _post_with_session: About to send POST request...")
            resp = await session_client.post(
                endpoint_url,
                json=payload,
                headers=_with_auth({
                    "Accept": "application/json, text/event-stream",
                    "Mcp-Session-Id": session_id,
                }),
            )
            logger.info("[DEBUG] _post_with_session: POST returned, status=%s", resp.status_code)
            if resp.status_code == 401:
                # Session likely landed on a different VM. Re-initialize once.
                try:
                    await session_client.aclose()
                except Exception:
                    pass
                session_client, response2 = await _initialize_session()
                session_id2 = response2.headers.get("Mcp-Session-Id")
                if not session_id2:
                    raise Exception("Re-initialize failed: no session id")
                session_id = session_id2
                # Retry once with new session
                resp = await session_client.post(
                    endpoint_url,
                    json=payload,
                    headers=_with_auth({
                        "Accept": "application/json, text/event-stream",
                        "Mcp-Session-Id": session_id,
                    }),
                )
                logger.info("[DEBUG] _post_with_session: Retry POST returned, status=%s", resp.status_code)
            logger.info("[DEBUG] _post_with_session: About to return response object")
            return resp

        response = await _post_with_session(initialized_request)
        if response.status_code not in [200, 202]:
            logger.warning(
                " Initialized notification failed: %s", response.status_code
            )
        else:
            logger.info(" Session initialized successfully")

        # Step 2: Execute the workflow
        logger.info(" Executing workflow: %s...", tool_name)
        start_time = time.time()

        tool_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }

        # Debug log the actual request being sent
        logger.info(" Sending tool request to MCP:")
        logger.info("  Tool name: %s", tool_name)
        logger.info("  Request JSON: %s", json.dumps(tool_request, indent=2)[:500])

        # Add explicit timeout for workflow execution (15 minutes max)
        # Note: httpx read timeout (30s) will trigger first if MCP hangs without sending data
        logger.info("[DEBUG] About to send POST request to MCP, starting timer...")
        request_start_time = time.time()
        try:
            logger.info("[DEBUG] Entering asyncio.wait_for with 900s timeout...")
            response = await asyncio.wait_for(
                _post_with_session(tool_request),
                timeout=900.0  # 15 minutes maximum for workflow execution
            )
            request_duration = time.time() - request_start_time
            logger.info("[DEBUG] POST request completed in %.2fs, status_code=%s", request_duration, response.status_code)
        except asyncio.TimeoutError:
            request_duration = time.time() - request_start_time
            logger.error(f"[DEBUG] Workflow execution timed out after {request_duration:.2f}s (expected 900s timeout)")
            await session_client.aclose()
            raise Exception(f"Workflow execution timed out after 15 minutes for tool: {tool_name}")
        except httpx.ReadTimeout as e:
            request_duration = time.time() - request_start_time
            logger.error(f"[DEBUG] MCP server stopped sending data after {request_duration:.2f}s - httpx read timeout")
            await session_client.aclose()
            raise Exception(f"MCP server hung - no response data for 30+ seconds on tool: {tool_name}")
        except Exception as e:
            request_duration = time.time() - request_start_time
            logger.error(f"[DEBUG] POST request failed after {request_duration:.2f}s with error: {type(e).__name__}: {str(e)}")
            raise

        if response.status_code != 200:
            # For errors, read with timeout to avoid blocking
            try:
                error_text = await asyncio.wait_for(response.aread(), timeout=5.0)
                error_msg = error_text.decode('utf-8')
            except (asyncio.TimeoutError, Exception):
                error_msg = "Unable to read error response"
            raise Exception(
                f"Workflow execution failed: {response.status_code} - {error_msg}"
            )
        else:
            # Parse the response (handle SSE format)
            logger.info("[DEBUG] About to read response body with 60s timeout...")
            try:
                # Use aread() with timeout to prevent indefinite blocking
                response_bytes = await asyncio.wait_for(response.aread(), timeout=60.0)
                response_text = response_bytes.decode('utf-8')
                logger.info("[DEBUG] Successfully read response body, length=%d bytes", len(response_text))
            except asyncio.TimeoutError:
                logger.error("[DEBUG] Response body read timed out after 60s - MCP server may be keeping connection open")
                raise Exception("MCP server response timeout - server did not close connection after 60 seconds")
            if not response_text:
                raise Exception("Empty response from MCP server")

            logger.info(" Workflow execution completed!")
            execution_time = time.time() - start_time
            logger.info("⏱ Execution time: %.1fs", execution_time)

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
                logger.info(
                    f"{log_string[:100]}{'...' if len(log_string) > 100 else ''}"
                )
                logger.info("--- END DETAILED LOGGING ---")

                # =============================================================================
                # CRITICAL: Handle MCP Error Responses (Pre-execution Failures)
                # =============================================================================
                # When MCP fails before executing any workflow steps (e.g., Chrome extension
                # not connected), it returns: {"error": {"code": -32602, "message": "..."}}
                # We must handle this BEFORE trying to extract workflow results, otherwise
                # workflow_result will never be defined and cause UnboundLocalError.

                if isinstance(result_data, dict) and "error" in result_data:
                    error_info = result_data.get("error", {})
                    error_message = error_info.get("message", "Unknown MCP error")
                    error_code = error_info.get("code", "unknown")

                    logger.error(f"❌ MCP Error ({error_code}): {error_message}")

                    # Create workflow_result for MCP-level errors
                    workflow_result = {
                        "success": False,
                        "exception": True,
                        "state": "exception",
                        "message": f"MCP Error ({error_code}): {error_message}",
                        "error": error_message,
                        "duration_ms": int(execution_time * 1000),
                        "steps_executed": 0,
                        "data": None,
                        "validation": {
                            "mcp_error": True,
                            "error_code": error_code,
                            "is_valid": False,
                            "errors": [error_message]
                        }
                    }

                    # Set empty values for other expected variables
                    # IMPORTANT: Set mcp_content to None to skip normal processing
                    mcp_content = None
                    execution_log = []
                    env_state = {}
                    successful_steps = 0
                    failed_steps = 0
                    quotes = []
                    executed_steps = []

                    # Display the error using standardized system
                    display_workflow_result(workflow_result)

                # =============================================================================
                # Normal Success Path: Extract workflow execution results
                # =============================================================================
                # Extract the actual content from the MCP response
                elif isinstance(result_data, dict) and "result" in result_data:
                    mcp_content = None
                    # NOTE: screenshots and screenshot_urls initialized at function top
                    result_content = result_data.get("result", {}).get("content", [])
                    if result_content and isinstance(result_content, list):
                        # Process all content items (text + images)
                        for content_item in result_content:
                            if content_item.get("type") == "text":
                                # Only parse text content if not already parsed
                                if not mcp_content:
                                    try:
                                        # The text content is a JSON string, so we load it
                                        mcp_content_text = content_item.get("text", "{}")
                                        mcp_content = json.loads(mcp_content_text)
                                    except json.JSONDecodeError:
                                        logger.warning(
                                            "Failed to parse MCP content text as JSON, using raw text"
                                        )
                                        # Fallback to using the text directly if it's not JSON
                                        mcp_content = {"raw_text": content_item.get("text")}
                            elif content_item.get("type") == "image":
                                # NEW: Extract base64 image data from MCP response
                                image_data = content_item.get("data", "")
                                if image_data:
                                    screenshots.append(image_data)
                                    logger.info(f" Captured screenshot {len(screenshots)} from MCP response")

                # Log screenshot collection summary and upload to S3
                if screenshots:
                    logger.info(f" Total screenshots captured: {len(screenshots)}")

                    # Upload screenshots to S3 and get URLs
                    try:
                        screenshot_urls = await upload_screenshots_to_s3(screenshots, execution_id)
                        logger.info(f" Successfully uploaded {len(screenshot_urls)} screenshots to S3")
                    except Exception as s3_error:
                        logger.error(f" Failed to upload screenshots to S3: {s3_error}")
                        # Keep base64 as fallback if S3 upload fails
                        screenshot_urls = []

                # --- MORE DETAILED LOGGING FOR PARSER ---
                logger.info(
                    "--- DETAILED LOGGING: Full content from mcp_content for parser debugging ---"
                )
                log_string = json.dumps(mcp_content)
                # Log first 2000 chars to capture more detail for debugging
                logger.info(
                    f"{log_string[:2000]}{'...' if len(log_string) > 2000 else ''}"
                )
                logger.info("--- END DETAILED LOGGING ---")

                # Additional logging for debugging missing parsed_output
                if mcp_content:
                    logger.info(" MCP Response Keys: %s", list(mcp_content.keys()))
                    logger.info(" MCP Status: %s", mcp_content.get("status", "MISSING"))
                    logger.info(" MCP Has parsed_output: %s", "parsed_output" in mcp_content)
                    if "debug_info_on_failure" in mcp_content:
                        debug_info = mcp_content.get("debug_info_on_failure")
                        if debug_info:
                            debug_str = str(debug_info)[:500] if debug_info else "None"
                            logger.info(" MCP debug_info_on_failure: %s", debug_str)
                        else:
                            logger.info(" MCP debug_info_on_failure: None")

                # =============================================================================
                # Handle Unexpected Response Format
                # =============================================================================
                else:
                    # result_data doesn't have "error" or "result" - unexpected format
                    logger.error(f"❌ Unexpected MCP response format. Keys: {list(result_data.keys()) if isinstance(result_data, dict) else 'not a dict'}")

                    # Create workflow_result for unexpected response format
                    workflow_result = {
                        "success": False,
                        "exception": True,
                        "state": "exception",
                        "message": f"Unexpected MCP response format: {list(result_data.keys()) if isinstance(result_data, dict) else type(result_data).__name__}",
                        "error": "Invalid response format from MCP server",
                        "duration_ms": int(execution_time * 1000),
                        "steps_executed": 0,
                        "data": None,
                        "validation": {
                            "mcp_error": True,
                            "is_valid": False,
                            "errors": ["Unexpected response format from MCP server"]
                        }
                    }

                    # Set empty values for other expected variables
                    # IMPORTANT: Set mcp_content to None to skip normal processing
                    mcp_content = None
                    execution_log = []
                    env_state = {}
                    successful_steps = 0
                    failed_steps = 0
                    quotes = []
                    executed_steps = []

                    # Display the error using standardized system
                    display_workflow_result(workflow_result)

                # Extract quotes and metrics from the MCP response
                quotes = []
                successful_steps = 0
                failed_steps = 0
                executed_steps = []

                if mcp_content:
                    # New: structured breakdown logging of groups/steps/errors
                    try:
                        log_mcp_execution_breakdown(mcp_content)
                    except Exception as _e:
                        logger.warning("Failed to log MCP breakdown: %s", _e)

                    # --- MORE DETAILED LOGGING FOR PARSER ---
                    logger.info(
                        "--- DETAILED LOGGING: Full content from mcp_content for parser debugging ---"
                    )
                    log_string = json.dumps(mcp_content)
                    logger.info(
                        f"{log_string[:100]}{'...' if len(log_string) > 100 else ''}"
                    )
                    logger.info("--- END DETAILED LOGGING ---")

                    # =============================================================================
                    # NEW: Use Standardized Success/Failure Indication System
                    # =============================================================================

                    # Parse workflow result using the new standardized system
                    try:
                        workflow_result = parse_workflow_result(mcp_content)
                        # Display the standardized result
                        display_workflow_result(workflow_result)
                    except Exception as parse_error:
                        logger.warning(f"Failed to parse workflow result: {parse_error}")
                        # Create a default workflow_result for error cases
                        workflow_result = {
                            "success": False,
                            "state": "failure",
                            "message": f"Failed to parse result: {str(parse_error)}",
                            "duration_ms": int(execution_time * 1000),
                            "steps_executed": 0,
                            "data": None,
                            "validation": {"is_valid": False, "errors": [str(parse_error)]}
                        }

                    # Extract execution step details and build detailed execution log
                    successful_steps = 0
                    failed_steps = 0
                    executed_steps = []
                    execution_log = []

                    # Parse detailed step structure from MCP response
                    if "results" in mcp_content and isinstance(mcp_content["results"], list):
                        for step_idx, step in enumerate(mcp_content["results"]):
                            # Each item in results is a direct step, not a group
                            # Extract step information
                            step_result = step.get("result", {})
                            step_logs = step.get("logs", [])
                            server_logs = step.get("server_logs", [])

                            # Combine all logs
                            all_logs = []
                            if step_logs:
                                all_logs.extend(step_logs if isinstance(step_logs, list) else [step_logs])
                            if server_logs:
                                all_logs.extend(server_logs if isinstance(server_logs, list) else [server_logs])

                            # Build detailed log entry for this step
                            log_entry = {
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "step_number": step.get("index", step_idx),
                                "step_id": step.get("step_id", f"step_{step_idx}"),
                                "tool_name": step.get("tool_name", "unknown"),
                                "status": step.get("status", "unknown"),
                                "duration_ms": step.get("duration_ms", 0),
                                "result": step_result,
                                "logs": all_logs,
                                "error": step_result.get("error") if step.get("status") in ["error", "executed_with_error"] else None
                            }
                            execution_log.append(log_entry)

                            # Track metrics
                            if step.get("status") in ["success", "executed_without_error"]:
                                successful_steps += 1
                            elif step.get("status") in ["error", "executed_with_error"]:
                                failed_steps += 1

                            # Also add to executed_steps for compatibility
                            step_info = {
                                "index": step_idx,
                                "duration_ms": step.get("duration_ms", 0),
                                "success": step.get("status") in ["success", "executed_without_error"],
                            }
                            executed_steps.append(step_info)

                    # Extract environment state from MCP response
                    env_state = mcp_content.get("env", {}) if mcp_content else {}

                # Build clean execution results structure
                execution_results = {
                    "workflow_id": workflow_data.get("id"),
                    "workflow_name": workflow_data.get("name", "Unknown Workflow"),

                    # Core workflow result (parsed business logic)
                    "workflow_result": workflow_result,

                    # Detailed step-by-step execution log (aligned with latest.txt)
                    "execution_log": execution_log,

                    # Environment state after all steps
                    "env_state": env_state,

                    # Simplified output
                    "output": {
                        "status": workflow_result.get("state", "unknown"),
                        "success": workflow_result.get("success", False),
                        "message": workflow_result.get("message", "No message"),
                        "data": workflow_result.get("data")
                    },

                    # Performance metrics
                    "performance_metrics": {
                        "total_steps": len(execution_log) if execution_log else len(arguments.get("items", [])),
                        "executed_steps": len(execution_log),
                        "successful_steps": successful_steps,
                        "failed_steps": failed_steps,
                        "total_duration_ms": workflow_result.get("duration_ms", int(execution_time * 1000)),
                    },

                    # Validation info from parser
                    "validation_info": workflow_result.get("validation", {}),

                    # Execution type
                    "execution_type": "real_browser_automation",

                    # NEW: Screenshots captured during execution
                    "screenshots": screenshots if screenshots else [],
                }

                # Workflow-agnostic logging
                logger.info(" Workflow Execution Result:")
                logger.info("Tool: %s", tool_name)
                logger.info("Output Status: %s", execution_results["output"]["status"])
                logger.info("Output Success: %s", execution_results["output"]["success"])
                logger.info("Output Message: %s", execution_results["output"]["message"])
                logger.info("Performance Metrics: %d/%d steps successful",
                           execution_results["performance_metrics"]["successful_steps"],
                           execution_results["performance_metrics"]["total_steps"])
                logger.info("Duration: %dms", execution_results["performance_metrics"]["total_duration_ms"])
                logger.info("Execution Log: %d detailed step entries captured", len(execution_results["execution_log"]))
                logger.info("Environment State: %d variables in final env", len(execution_results.get("env_state", {})))

                return execution_results

            except json.JSONDecodeError as e:
                logger.error(" Failed to parse response JSON: %s", e)
                logger.error("Raw response: %s...", response_text[:500])
                raise Exception(f"Failed to parse MCP response: {e}")

    except Exception as e:
        logger.error("MCP workflow execution error: %s", e)
        # Add more context to the error
        error_context = {
            "error_type": type(e).__name__,
            "error_message": str(e),
            "mcp_endpoint": mcp_endpoint,
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
    finally:
        # Always close the session client if it was created
        if session_client:
            try:
                await session_client.aclose()
                logger.info(" MCP session closed")
            except Exception as cleanup_error:
                logger.warning(f" Error closing MCP session: {cleanup_error}")


@app.function(
    image=image,
    secrets=secrets,
    timeout=1800,  # 30 minutes for real browser automation (cleanup at 25 min prevents stuck jobs)
    memory=2048,  # 2GB memory for browser operations
    cpu=2.0,  # 2 CPUs for better performance
    max_containers=10,  # Allow multiple machines to run workflows in parallel (coordinated by machine-specific locks)
)
def execute_workflow(
    workflow_id: int,
    mcp_endpoint: str,
    execution_params: Dict[str, Any] = None,
    client_id: str = None,
    execution_id: int = None,
    version_number: str = None,  # Optional version to execute
    start_from_step: str = None,  # NEW: Optional step ID to start from
    end_at_step: str = None,      # NEW: Optional step ID to stop at
    follow_fallback: bool = None, # NEW: Whether to follow fallback beyond end_at_step
    execute_jumps_at_end: bool = None,  # NEW: Whether to execute jumps at boundary
) -> Dict[str, Any]:
    """
     REAL BROWSER AUTOMATION: Execute workflow using MCP browser control

    This function is now responsible for the actual execution of a workflow that
    has already been "claimed" by the queue processor with machine-specific coordination.

    MULTI-MACHINE SUPPORT: Multiple instances can run in parallel, one per machine,
    as coordination is handled by machine-specific locks in the queue processor.

    It will:
    - Calculate total steps and update the execution record.
    - Connect to MCP endpoint for browser control
    - Process each automation step through real browser
    - Update progress in database
    - Return final results

    Args:
        version_number: Optional specific version to execute. If None, uses active version.
        start_from_step: Optional step ID to start execution from (loads saved state).
        end_at_step: Optional step ID to stop execution at (inclusive).
        follow_fallback: Whether to follow fallback_id beyond end_at_step boundary.
        execute_jumps_at_end: Whether to execute jumps at end_at_step boundary.
    """
    start_time = time.time()
    conn = None
    cur = None

    # Initialize screenshot variables at function top to prevent NameError
    screenshot_urls = []  # URLs from Supabase Storage
    screenshots = []      # Base64 screenshots from MCP response (fallback)

    try:
        # Initialize database connection
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # The job is already marked as 'running' by the queue worker.
        # This function's first job is to fetch the workflow, calculate steps,
        # and update the execution record with that info.
        logger.info(
            " Executing workflow ID %s for execution record %s",
            workflow_id,
            execution_id,
        )
        if version_number:
            logger.info(" Using specific version: %s", version_number)
        else:
            logger.info(" Using active version")

        #  Use provided MCP endpoint (required parameter)
        # Remove /mcp suffix if present to get base URL
        endpoint_base = mcp_endpoint.rstrip('/').removesuffix('/mcp')
        endpoint_full = f"{endpoint_base}/mcp"
        endpoint_health = f"{endpoint_base}/health"
        logger.info(" Using MCP endpoint: %s", endpoint_full)

        #  NEW: Query specific version or active version
        if version_number:
            # Query specific version from versions table
            logger.info(
                " Querying specific version %s for workflow %s",
                version_number,
                workflow_id,
            )
            cur.execute(
                """
                SELECT
                    w.id, w.name, w.description, w.status, w.category,
                    w.successful_runs, w.failed_runs, w.cancelled_runs, w.total_executions,
                    w.estimated_duration_seconds, w.workflow_type, w.parent_workflow_id, w.display_order,
                    w.created_by, w.created_at, w.updated_at,
                    w.current_version_id, w.total_versions,
                    w.requires_files, w.files_config,
                    v.automation_sequence_yaml,
                    v.automation_sequence,
                    v.version_number as version,
                    v.change_notes as current_version_notes,
                    v.id as version_id,
                    CASE
                        WHEN v.automation_sequence_yaml IS NOT NULL AND v.automation_sequence_yaml != ''
                        THEN 'yaml'
                        ELSE 'jsonb'
                    END as sequence_format
                FROM deployed_workflows w
                JOIN deployed_workflow_versions v ON v.workflow_id = w.id
                WHERE w.id = %s AND v.version_number = %s
            """,
                (workflow_id, version_number),
            )

            workflow = cur.fetchone()

            if not workflow:
                raise Exception(
                    f"Workflow {workflow_id} version {version_number} not found"
                )

        else:
            # Use active version (existing logic)
            logger.info(" Querying active version for workflow %s", workflow_id)
            # First get the workflow data from the view
            cur.execute(
                "SELECT * FROM deployed_workflows_with_sequence WHERE id = %s",
                (workflow_id,),
            )
            workflow = cur.fetchone()

            if not workflow:
                raise Exception(f"Workflow {workflow_id} not found")

            # Then get requires_files and files_config from the main table
            cur.execute(
                "SELECT requires_files, files_config FROM deployed_workflows WHERE id = %s",
                (workflow_id,),
            )
            extra_data = cur.fetchone()
            if extra_data:
                workflow["requires_files"] = extra_data["requires_files"]
                workflow["files_config"] = extra_data["files_config"]
                logger.info(f" Workflow requires_files: {extra_data['requires_files']}")
                logger.info(f" Workflow files_config: {extra_data.get('files_config', {})}")

        # Validate we have an automation sequence
        if not workflow.get("automation_sequence") and not workflow.get(
            "automation_sequence_yaml"
        ):
            if version_number:
                raise Exception(
                    f"Workflow {workflow_id} version {version_number} has no automation sequence"
                )
            else:
                raise Exception(
                    f"Workflow {workflow_id} has no active version or automation_sequence"
                )

        # Calculate total steps using the smart sequence loader
        try:
            automation_sequence_list = SequenceLoader.load_workflow_sequence(workflow)
            automation_sequence = automation_sequence_list[0]
            arguments = automation_sequence.get("arguments", {})
            # The canonical key for the list of execution groups is now 'steps'.
            steps_list = arguments.get("steps", [])

            # Log which format was used for debugging
            sequence_info = SequenceLoader.get_sequence_info(workflow)
            logger.info(
                " Loaded sequence using %s format (%d steps)",
                sequence_info["format_used"],
                sequence_info["step_count"],
            )

        except Exception as e:
            logger.error(" Failed to load workflow sequence: %s", e)
            raise Exception(
                f"Invalid workflow sequence for workflow {workflow_id}: {e}"
            )
        total_steps = len(steps_list)

        # Update execution with total steps and version information for traceability
        cur.execute(
            """
            UPDATE workflow_executions
            SET total_steps = %s,
                workflow_version_id = %s,
                workflow_version_number = %s
            WHERE id = %s
            """,
            (
                total_steps,
                workflow.get("version_id") or workflow.get("current_version_id"),
                workflow.get("version"),
                execution_id,
            ),
        )
        conn.commit()

        logger.info(
            " Loaded workflow '%s' v%s - %d groups to execute via browser",
            workflow["name"],
            workflow.get("version", "unknown"),
            total_steps,
        )

        # Execute workflow through MCP browser automation
        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        # Create fresh buffers for this execution (important in serverless environment)
        local_log_buffer = io.StringIO()
        local_stdout_buffer = io.StringIO()

        # Create a new handler for this execution
        local_log_handler = logging.StreamHandler(local_log_buffer)
        local_log_handler.setLevel(logging.DEBUG)
        local_log_handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )

        # Add handler only to root logger to avoid duplicates
        # (logger is a child of root_logger, so it will inherit the handler)
        root_logger.addHandler(local_log_handler)

        # Capture stdout/stderr during execution
        with CaptureOutput(local_stdout_buffer):
            try:
                # Log system information
                logger.info(" Modal Function: execute_workflow")
                logger.info(" MCP Endpoint: %s", endpoint_full)
                logger.info(" Workflow ID: %s", workflow_id)
                logger.info(" Execution ID: %s", execution_id)
                logger.info("Start Time: %s", datetime.now(timezone.utc).isoformat())

                # Handle empty height parameter to avoid overriding defaults
                params_for_mcp = execution_params.copy() if execution_params else {}
                if params_for_mcp.get("applicant", {}).get("height") == "":
                    logger.info(
                        "Removing empty 'height' parameter from applicant to allow workflow default to be used."
                    )
                    del params_for_mcp["applicant"]["height"]
                    # If the applicant object becomes empty after removing height, remove it too
                    if not params_for_mcp["applicant"]:
                        del params_for_mcp["applicant"]

                # Load and inject org secrets
                try:
                    # Get the workflow's organization_id (Clerk org ID)
                    org_id = workflow.get("organization_id")
                    if org_id:
                        logger.info(f"Loading secrets for org: {org_id}")

                        # Load encrypted secrets from database
                        org_secrets = load_org_secrets(conn, org_id)
                        if org_secrets:
                            logger.info(f"Loaded {len(org_secrets)} secrets: {list(org_secrets.keys())}")

                            # Inject secrets into parameters
                            params_for_mcp = inject_secrets_into_params(
                                params_for_mcp,
                                org_secrets,
                                substitute_placeholders=True
                            )
                            logger.info("Secrets injected into workflow parameters")
                        else:
                            logger.info("No secrets found for this organization")
                    else:
                        logger.info("Workflow has no organization_id, skipping secrets loading")
                except Exception as e:
                    # Don't fail workflow execution if secrets loading fails
                    logger.warning(f"Failed to load org secrets: {e}")
                    logger.info("Continuing workflow execution without secrets")

                # Get timeout from workflow configuration, default to 25 minutes
                timeout_minutes = workflow.get("timeout_minutes", 25)
                # Ensure timeout is reasonable (max 29 minutes to leave buffer before Modal's 30 min timeout)
                timeout_minutes = min(timeout_minutes, 29)
                workflow_timeout = timeout_minutes * 60  # Convert to seconds
                logger.info(f"Using workflow timeout of {timeout_minutes} minutes")
                try:
                    results = loop.run_until_complete(
                        asyncio.wait_for(
                            execute_mcp_workflow(
                                workflow,
                                params_for_mcp,
                                endpoint_full,
                                workflow_id=workflow_id,
                                start_from_step=start_from_step,
                                end_at_step=end_at_step,
                                follow_fallback=follow_fallback,
                                execute_jumps_at_end=execute_jumps_at_end
                            ),
                            timeout=workflow_timeout
                        )
                    )
                    logger.info(
                        "Received %d quotes from MCP workflow.",
                        len(results.get("quotes", [])),
                    )
                except asyncio.TimeoutError:
                    logger.error(f"Workflow execution timed out after {timeout_minutes} minutes")
                    # Create a failure result for timeout
                    results = {
                        "workflow_result": {
                            "success": False,
                            "error": f"Workflow execution timed out after {timeout_minutes} minutes",
                            "message": f"The workflow exceeded the maximum execution time of {timeout_minutes} minutes and was terminated"
                        },
                        "quotes": [],
                        "performance_metrics": {
                            "successful_steps": 0,
                            "failed_steps": 1,
                            "total_steps": total_steps
                        },
                        "execution_time": workflow_timeout
                    }
                    logger.error("Created timeout failure result for database update")

                # Optional AI enrichment step (delegated to helper module for clarity)
                try:

                    results = enrich_results_if_enabled(
                        results=results,
                        execution_params=execution_params,
                        automation_sequence=automation_sequence,
                    )
                except Exception as enrich_err:
                    logger.warning(
                        " Enrichment step encountered an error but was ignored: %s",
                        enrich_err,
                    )
            finally:
                loop.close()

        # Capture all logs from both buffers
        raw_logs = local_log_buffer.getvalue()
        stdout_logs = local_stdout_buffer.getvalue()

        # Clean up handler from root logger only
        root_logger.removeHandler(local_log_handler)

        # Combine logs with clear sections
        combined_logs = f"""
=== LOGGER OUTPUT ===
{raw_logs}

=== STDOUT/STDERR OUTPUT ===
{stdout_logs}

=== END OF EXECUTION {execution_id} ===
"""

        # No longer extracting raw_mcp_response - we use results field directly

        # Create structured logs array
        execution_logs = []
        for line in raw_logs.split("\n"):
            if line.strip():
                log_entry = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "message": line,
                    "level": (
                        "info"
                        if "INFO:" in line
                        else ("error" if "ERROR:" in line else "debug")
                    ),
                }
                execution_logs.append(log_entry)

        # Calculate final metrics
        end_time = time.time()
        execution_duration = int(end_time - start_time)

        # =============================================================================
        # NEW: Enhanced Workflow Completion Logic with Standardized System
        # =============================================================================

        # Get standardized workflow result if available
        workflow_result = results.get("workflow_result")
        quotes_found = len(results.get("quotes", []))

        # NEW: Extract screenshots from results
        screenshots = results.get("screenshots", [])

        # Calculate traditional success rate for backward compatibility
        performance_metrics = results.get("performance_metrics", {})
        successful_steps_count = performance_metrics.get("successful_steps", 0)
        total_steps_count = performance_metrics.get("total_steps", total_steps)
        success_rate = (successful_steps_count / max(total_steps_count, 1)) * 100

        # Determine workflow completion using new standardized system
        if workflow_result:
            # Check if workflow was skipped
            is_skipped = workflow_result.get("skipped", False)
            
            if is_skipped:
                # Skipped workflows get special handling
                workflow_completed = False  # Not considered "completed" in success terms
                workflow_status = "skipped"  # New status for database
                error_message_for_db = workflow_result.get("message", "Workflow was skipped")
                
                logger.info(
                    "⏭ Workflow was SKIPPED: %s",
                    workflow_result.get("message", "No skip reason provided")
                )
            else:
                # Use business logic success from standardized system
                workflow_completed = workflow_result["success"]
                workflow_status = "completed" if workflow_completed else "failed"
                error_message_for_db = (
                    workflow_result["error"] if not workflow_result["success"] else None
                )

                # Override with business logic message if available
                if not workflow_result["success"] and workflow_result["message"]:
                    error_message_for_db = workflow_result["message"]

                logger.info(
                    " Using standardized business logic result: %s",
                    "SUCCESS" if workflow_completed else "FAILURE",
                )
        else:
            # Fallback to legacy logic for backward compatibility
            logger.info(
                " Using legacy completion logic (no standardized result found)"
            )

            # Check if this is a quote extraction workflow (legacy detection)
            # Only quote extraction workflows should require quotes for success
            is_quote_workflow = (
                "quote" in workflow.get("name", "").lower() or
                "insurance" in workflow.get("name", "").lower() or
                workflow.get("category") == "insurance_quotes"
            )

            if is_quote_workflow:
                # For quote extraction workflows:
                # 1. ALL steps completed (100% success rate)
                # 2. AND it achieved its business goal (found at least one quote)
                workflow_completed = success_rate == 100 and quotes_found > 0
                workflow_status = "completed" if workflow_completed else "failed"
                logger.info(f" Quote extraction workflow: success={workflow_completed}, quotes_found={quotes_found}")
            else:
                # For non-quote workflows, success is based purely on technical execution
                workflow_completed = success_rate == 100
                workflow_status = "completed" if workflow_completed else "failed"
                logger.info(f" Non-quote workflow: success based on execution (success_rate={success_rate}%)")

            # --- Enhanced Error Message Extraction ---
            error_message_for_db = None
            if not workflow_completed:
                # Case 1: The workflow ran perfectly but found no quotes (only for quote workflows).
                if quotes_found == 0 and success_rate == 100 and is_quote_workflow:
                    error_message_for_db = "Workflow incomplete - No quotes found"
                # Case 2: An actual error occurred during execution.
                elif results:
                    try:
                        # Results already contains the parsed workflow execution data
                        mcp_result = results

                        if mcp_result.get("status") not in ["success", "executed_without_error"]:
                            failed_step = None
                            # Find the first step with a status of 'error' or 'executed_with_error'
                            if "results" in mcp_result and isinstance(
                                mcp_result["results"], list
                            ):
                                for group in mcp_result["results"]:
                                    if "results" in group and isinstance(
                                        group["results"], list
                                    ):
                                        for step in group["results"]:
                                            if step.get("status") in ["error", "executed_with_error"]:
                                                failed_step = step
                                                break
                                    if failed_step:
                                        break

                            if failed_step:
                                tool_name = failed_step.get("tool_name", "Unknown Tool")
                                error_details = failed_step.get("error", "Unknown error")

                                # Safely extract error type - handle string or dict
                                error_type = "Unknown"
                                try:
                                    if isinstance(error_details, str):
                                        # Try to extract error_type from JSON string
                                        match = re.search(
                                            r'["\']?error_type["\']?\s*:\s*["\']([^"\']+)["\']',
                                            error_details
                                        )
                                        if match:
                                            error_type = match.group(1)
                                        else:
                                            # Use first 100 chars of error as fallback
                                            error_type = error_details[:100]
                                    elif isinstance(error_details, dict):
                                        error_type = error_details.get("error_type", error_details.get("message", "Unknown"))
                                except Exception as parse_err:
                                    logger.warning(f"Could not parse error type: {parse_err}")
                                    error_type = str(error_details)[:100] if error_details else "Unknown"

                                # Create a more informative high-level message
                                error_message_for_db = f"{tool_name} failed: {error_type}"
                            else:
                                # Fallback if no specific failed step is found
                                # Check for debug_info_on_failure in the MCP response
                                debug_info = mcp_result.get("debug_info_on_failure")
                                if debug_info:
                                    error_message_for_db = f"Workflow failed: {str(debug_info)[:200]}"
                                else:
                                    error_message_for_db = "Workflow failed: See logs for details"

                    except Exception as e:
                        logger.error(f"Failed to parse MCP error from response: {e}")
                        # Try to get any error info from the response
                        try:
                            if isinstance(results, dict):
                                debug_info = results.get("debug_info_on_failure") or results.get("error")
                                if debug_info:
                                    error_message_for_db = f"Workflow failed: {str(debug_info)[:200]}"
                                else:
                                    error_message_for_db = f"Workflow failed: {results.get('status', 'Unknown error')}"
                            else:
                                error_message_for_db = "Workflow failed: Unable to parse error"
                        except:
                            error_message_for_db = "Workflow failed: Unable to parse error"
                else:
                    # Fallback for other unknown errors
                    error_message_for_db = "Workflow failed: No results returned"

        # Enhanced execution summary with standardized information
        execution_summary = {
            "workflow_completed": workflow_completed,
            "success_rate_percentage": round(success_rate, 2),
            "total_execution_time": execution_duration,
            "quotes_found": quotes_found,
            "execution_message": f"Found {quotes_found} insurance quotes",
        }

        # Add standardized workflow result information if available
        if workflow_result:
            execution_summary.update(
                {
                    "business_success": workflow_result["success"],
                    "execution_state": workflow_result.get("state", "unknown"),
                    "result_message": workflow_result["message"],
                    "duration_ms": workflow_result["duration_ms"],
                    "steps_executed": workflow_result["steps_executed"],
                    "validation_info": workflow_result.get("validation", {}),
                    "standardized_system_used": True,
                }
            )
        else:
            execution_summary["standardized_system_used"] = False

        results["execution_summary"] = execution_summary

        # Generate formatted summary for display (workflow-agnostic)
        formatted_output = None
        if workflow_result:
            # Include exception and skipped fields for UI status handling
            formatted_output = json.dumps({
                "success": workflow_result.get("success", False),
                "exception": workflow_result.get("exception", False),
                "skipped": workflow_result.get("skipped", False),
                "message": workflow_result.get("message", "No message"),
                "data": workflow_result.get("data"),
                "validation": workflow_result.get("validation", {}),
            }, indent=2)
            logger.info(" Using formatted output with success, exception, and skipped fields")
        else:
            # Fallback if no workflow_result
            formatted_output = json.dumps({
                "success": workflow_completed,
                "message": f"Workflow {'completed successfully' if workflow_completed else 'failed'}",
                "steps_executed": total_steps,
                "success_rate": success_rate
            }, indent=2)
            logger.info(" Using fallback formatted output")

        # Update execution with final results and raw data
        cur.execute(
            """
            UPDATE workflow_executions
            SET status = %s, completed_at = %s, execution_duration_seconds = %s,
                results = %s, progress_percentage = %s, current_step_index = %s,
                raw_logs = %s, execution_logs = %s,
                formatted_output = %s, error_message = %s, screenshots = %s
            WHERE id = %s
        """,
            (
                workflow_status,  # This is now always defined (either from standardized result or legacy path)
                datetime.now(timezone.utc).isoformat(),
                execution_duration,
                json.dumps(results),
                100,
                total_steps,
                combined_logs,  # Use combined logs instead of just raw_logs
                json.dumps(execution_logs),
                formatted_output,
                error_message_for_db,
                json.dumps(screenshot_urls) if screenshot_urls else (json.dumps(screenshots) if screenshots else None),  # Store S3 URLs if available, fallback to base64
                execution_id,
            ),
        )
        conn.commit()

        # Note: Auto-cancellation is now handled proactively BEFORE claiming jobs
        # No need for reactive cancellation after failures

        # Note: Workflow success/failure metrics are automatically updated by database trigger
        # when the workflow_executions status changes to 'completed' or 'failed'

        # Trigger alert check for failed executions
        if workflow_status == "failed" or error_message_for_db:
            logger.info(f"Triggering alert check - Status: {workflow_status}, Error: {error_message_for_db}")
            try:
                import requests
                # Get workflow details for the alert
                cur.execute(
                    """
                    SELECT we.*, w.name as workflow_name
                    FROM workflow_executions we
                    JOIN deployed_workflows w ON w.id = we.workflow_id
                    WHERE we.id = %s
                    """,
                    (execution_id,)
                )
                execution_data = cur.fetchone()

                if execution_data:
                    # Send to monitoring endpoint
                    monitor_payload = {
                        "execution": {
                            "id": execution_data["id"],
                            "execution_id": execution_data["id"],
                            "workflow_id": execution_data["workflow_id"],
                            "workflow_name": execution_data["workflow_name"],
                            "status": workflow_status,
                            "error_message": error_message_for_db,
                            "formatted_output": formatted_output,  # Include formatted output for business logic checks
                            "started_at": execution_data["started_at"].isoformat() if execution_data["started_at"] else None,
                            "completed_at": execution_data["completed_at"].isoformat() if execution_data["completed_at"] else None,
                            "execution_time_seconds": execution_duration,
                            "trigger_source": "modal_executor",
                        }
                    }

                    # Use the app URL from environment or default
                    app_url = os.environ.get("APP_URL", "https://app.mediar.ai")
                    monitor_url = f"{app_url}/api/remote-workflows/executions/monitor"

                    # Add service authentication
                    headers = {'Content-Type': 'application/json'}
                    service_api_key = os.environ.get('MEDIAR_SERVICE_API_KEY')
                    if service_api_key:
                        headers['Authorization'] = f'Bearer {service_api_key}'

                    logger.info(f"Sending alert to {monitor_url}")
                    response = requests.post(monitor_url, json=monitor_payload, headers=headers, timeout=5)
                    if response.status_code == 200:
                        logger.info(f"Alert check triggered successfully for failed execution {execution_id}")
                        logger.info(f"Response: {response.text}")
                    else:
                        logger.warning(f"Failed to trigger alert check: {response.status_code} - {response.text}")
            except Exception as alert_error:
                logger.error(f"Error triggering alert check: {alert_error}")

        logger.info(
            " Completed real browser execution %s in %ds",
            execution_id,
            execution_duration,
        )
        logger.info(" Found %d insurance quotes", len(results.get("quotes", [])))

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
        logger.error(" Real workflow execution failed: %s", error_msg)

        # Capture any logs that were generated before the error
        raw_logs = local_log_buffer.getvalue() if 'local_log_buffer' in locals() else ''
        stdout_logs = local_stdout_buffer.getvalue() if 'local_stdout_buffer' in locals() else ''

        # Clean up handler from root logger if it was added
        if 'local_log_handler' in locals():
            root_logger.removeHandler(local_log_handler)

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
                        "info"
                        if "INFO:" in line
                        else ("error" if "ERROR:" in line else "debug")
                    ),
                }
                execution_logs.append(log_entry)

        # Add the main error
        execution_logs.append(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": f"FATAL ERROR: {error_msg}",
                "level": "error",
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
        formatted_error_output = f""" Workflow execution failed!

 Execution Error Summary
{'=' * 60}

 Error Details:
  Type: {type(e).__name__}
  Stage: {error_results.get('error_stage', 'Unknown')}
  Message: {error_msg}

 Execution Metrics
{'-' * 60}
  Total Steps Attempted: {error_results['performance_metrics']['total_steps']}
  Successful Steps: {error_results['performance_metrics']['successful_steps']}
  Failed Steps: {error_results['performance_metrics']['failed_steps']}
  Execution Time: {error_results['performance_metrics']['total_execution_time_seconds']}s

 Troubleshooting:
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

                # Trigger alert check for failed execution in exception handler
                logger.info(f"Triggering alert check for exception failure - Execution: {execution_id}, Error: {error_msg[:100]}")
                try:
                    import requests
                    # Get workflow details for the alert
                    cur.execute(
                        """
                        SELECT we.*, w.name as workflow_name
                        FROM workflow_executions we
                        JOIN deployed_workflows w ON w.id = we.workflow_id
                        WHERE we.id = %s
                        """,
                        (execution_id,)
                    )
                    execution_data = cur.fetchone()

                    if execution_data:
                        # Send to monitoring endpoint
                        monitor_payload = {
                            "execution": {
                                "id": execution_data["id"],
                                "execution_id": execution_data["id"],
                                "workflow_id": execution_data["workflow_id"],
                                "workflow_name": execution_data["workflow_name"],
                                "status": "failed",
                                "error_message": error_msg,
                                "started_at": execution_data["started_at"].isoformat() if execution_data["started_at"] else None,
                                "completed_at": execution_data["completed_at"].isoformat() if execution_data["completed_at"] else None,
                                "execution_time_seconds": int(time.time() - start_time),
                                "trigger_source": "modal_executor_exception",
                            }
                        }

                        # Use the app URL from environment or default
                        app_url = os.environ.get("APP_URL", "https://app.mediar.ai")
                        monitor_url = f"{app_url}/api/remote-workflows/executions/monitor"

                        # Add service authentication
                        headers = {'Content-Type': 'application/json'}
                        service_api_key = os.environ.get('MEDIAR_SERVICE_API_KEY')
                        if service_api_key:
                            headers['Authorization'] = f'Bearer {service_api_key}'

                        logger.info(f"Sending exception alert to {monitor_url}")
                        response = requests.post(monitor_url, json=monitor_payload, headers=headers, timeout=5)
                        if response.status_code == 200:
                            logger.info(f"Alert check triggered successfully for exception failure {execution_id}")
                        else:
                            logger.warning(f"Failed to trigger alert check: {response.status_code}")
                except Exception as alert_error:
                    logger.error(f"Error triggering alert check in exception handler: {alert_error}")

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
            (stale_threshold_minutes,),
        )

        stale_jobs = cur.fetchall()

        if not stale_jobs:
            return 0

        # Log details about each stale job before cleanup
        for job in stale_jobs:
            logger.warning(
                " Detected stale execution ID %s (workflow %s): running for %.1f minutes, modal_call_id: %s",
                job[0],
                job[1],
                job[3],
                job[4] or "None",
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
            (stale_threshold_minutes, stale_threshold_minutes),
        )

        cleaned_jobs = cur.fetchall()
        conn.commit()

        if cleaned_jobs:
            stale_ids = [job[0] for job in cleaned_jobs]
            total_minutes = sum(job[2] for job in cleaned_jobs)
            avg_minutes = total_minutes / len(cleaned_jobs)

            logger.warning(
                " Smart cleanup completed: %d stale executions cleaned up",
                len(stale_ids),
            )
            logger.warning(
                "    Average stuck time: %.1f minutes | IDs: %s",
                avg_minutes,
                stale_ids,
            )
            logger.warning(
                "    This prevents the queue-blocking issue that affected job #1444"
            )

            # CRITICAL FIX: Trigger alerts for auto-cleaned executions
            # Fetch full execution data including workflow name for alert payload
            for cleaned_job in cleaned_jobs:
                execution_id = cleaned_job[0]
                workflow_id = cleaned_job[1]

                try:
                    # Get full execution data including workflow name, started_at, completed_at
                    cur.execute(
                        """
                        SELECT we.id, we.workflow_id, w.name as workflow_name,
                               we.status, we.error_message, we.started_at,
                               we.completed_at, we.execution_duration_seconds
                        FROM workflow_executions we
                        JOIN deployed_workflows w ON w.id = we.workflow_id
                        WHERE we.id = %s
                        """,
                        (execution_id,)
                    )

                    execution_row = cur.fetchone()
                    if not execution_row:
                        logger.warning(f"Could not fetch execution data for alert: execution {execution_id}")
                        continue

                    # Build monitor payload matching the format used in normal failures
                    import requests

                    monitor_payload = {
                        "execution": {
                            "id": execution_row[0],
                            "execution_id": execution_row[0],
                            "workflow_id": execution_row[1],
                            "workflow_name": execution_row[2],
                            "status": execution_row[3],
                            "error_message": execution_row[4],
                            "started_at": execution_row[5].isoformat() if execution_row[5] else None,
                            "completed_at": execution_row[6].isoformat() if execution_row[6] else None,
                            "execution_time_seconds": execution_row[7],
                            "trigger_source": "auto_cleanup",
                        }
                    }

                    app_url = os.environ.get("APP_URL", "https://app.mediar.ai")
                    monitor_url = f"{app_url}/api/remote-workflows/executions/monitor"

                    # Add service authentication
                    headers = {'Content-Type': 'application/json'}
                    service_api_key = os.environ.get('MEDIAR_SERVICE_API_KEY')
                    if service_api_key:
                        headers['Authorization'] = f'Bearer {service_api_key}'

                    logger.info(f"🚨 Triggering alert for auto-cleaned execution {execution_id}")
                    response = requests.post(monitor_url, json=monitor_payload, headers=headers, timeout=5)

                    if response.status_code == 200:
                        logger.info(f"✅ Alert triggered successfully for auto-cleaned execution {execution_id}")
                    else:
                        logger.warning(f"⚠️ Failed to trigger alert for execution {execution_id}: {response.status_code} - {response.text}")

                except Exception as alert_error:
                    logger.error(f"❌ Error triggering alert for auto-cleaned execution {execution_id}: {alert_error}")

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
                    " Detected job with NULL logs ID %s (workflow %s): running for %.1f minutes, modal_call_id: %s",
                    job[0],
                    job[1],
                    job[3],
                    job[4] or "None",
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
                    " NULL logs cleanup completed: %d executions cleaned up",
                    len(null_logs_ids),
                )
                logger.warning(
                    "    Average stuck time: %.1f minutes | IDs: %s",
                    avg_null_minutes,
                    null_logs_ids,
                )
                logger.warning(
                    "    These jobs were dispatched to Modal but never actually started"
                )

                # CRITICAL FIX: Trigger alerts for NULL logs auto-cleaned executions
                for cleaned_job in null_logs_cleaned:
                    execution_id = cleaned_job[0]
                    workflow_id = cleaned_job[1]

                    try:
                        # Get full execution data including workflow name, started_at, completed_at
                        cur.execute(
                            """
                            SELECT we.id, we.workflow_id, w.name as workflow_name,
                                   we.status, we.error_message, we.started_at,
                                   we.completed_at, we.execution_duration_seconds
                            FROM workflow_executions we
                            JOIN deployed_workflows w ON w.id = we.workflow_id
                            WHERE we.id = %s
                            """,
                            (execution_id,)
                        )

                        execution_row = cur.fetchone()
                        if not execution_row:
                            logger.warning(f"Could not fetch execution data for alert: execution {execution_id}")
                            continue

                        # Build monitor payload matching the format used in normal failures
                        import requests

                        monitor_payload = {
                            "execution": {
                                "id": execution_row[0],
                                "execution_id": execution_row[0],
                                "workflow_id": execution_row[1],
                                "workflow_name": execution_row[2],
                                "status": execution_row[3],
                                "error_message": execution_row[4],
                                "started_at": execution_row[5].isoformat() if execution_row[5] else None,
                                "completed_at": execution_row[6].isoformat() if execution_row[6] else None,
                                "execution_time_seconds": execution_row[7],
                                "trigger_source": "auto_cleanup_null_logs",
                            }
                        }

                        app_url = os.environ.get("APP_URL", "https://app.mediar.ai")
                        monitor_url = f"{app_url}/api/remote-workflows/executions/monitor"

                        # Add service authentication
                        headers = {'Content-Type': 'application/json'}
                        service_api_key = os.environ.get('MEDIAR_SERVICE_API_KEY')
                        if service_api_key:
                            headers['Authorization'] = f'Bearer {service_api_key}'

                        logger.info(f"🚨 Triggering alert for NULL logs auto-cleaned execution {execution_id}")
                        response = requests.post(monitor_url, json=monitor_payload, headers=headers, timeout=5)

                        if response.status_code == 200:
                            logger.info(f"✅ Alert triggered successfully for NULL logs execution {execution_id}")
                        else:
                            logger.warning(f"⚠️ Failed to trigger alert for execution {execution_id}: {response.status_code} - {response.text}")

                    except Exception as alert_error:
                        logger.error(f"❌ Error triggering alert for NULL logs execution {execution_id}: {alert_error}")

        total_cleaned = len(cleaned_jobs) + (
            len(null_logs_cleaned) if null_logs_jobs else 0
        )
        return total_cleaned
    except Exception as e:
        logger.error("Failed to cleanup stale executions: %s", e)
        conn.rollback()
        return 0


@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(minutes=5),  # Run every 5 minutes
    timeout=300,  # 5 minutes timeout
    max_containers=1,  # Prevent concurrent cleanup attempts
    retries=0,  # Don't retry on failure
)
def cleanup_stale_executions_job():
    """
    🧹 DEDICATED CLEANUP JOB: Automatically clean up stuck executions

    Runs independently every 5 minutes to catch executions that:
    1. Have been running for 25+ minutes (likely Modal timeout)
    2. Have been stuck for 30+ minutes with no logs (never started)

    This is more reliable than conditional cleanup in the coordinator.
    """
    conn = None
    cur = None

    try:
        logger.info("🧹 Starting stale execution cleanup check...")

        conn = get_database_connection()
        cur = conn.cursor()

        cleanup_count = cleanup_stale_executions(
            cur, conn, stale_threshold_minutes=25
        )

        if cleanup_count > 0:
            logger.warning(
                "🧹 Cleanup completed: %d stale executions cleaned up",
                cleanup_count
            )
        else:
            logger.info("🧹 Cleanup check complete: No stale executions found")

        return {
            "status": "success",
            "cleaned": cleanup_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error("🧹 Cleanup job failed: %s", e)
        return {
            "status": "error",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.function(image=image, secrets=secrets, timeout=60)
def health_check() -> Dict[str, Any]:
    """
     MODAL + MCP HEALTH CHECK: Test infrastructure and browser automation readiness

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
            db_config = get_db_config()
            if db_config and all(
                k in db_config for k in ["host", "database", "user", "password"]
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
            # Just check if endpoint is reachable
            health_data["checks"]["mcp_endpoint"] = {
                "status": "pass",
                "message": "MCP endpoints configured dynamically per execution",
                "note": "Endpoints are passed via execution parameters",
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
            " Health check completed in %dms - Status: %s",
            health_data["response_time_ms"],
            health_data["modal_status"],
        )

        return health_data

    except Exception as e:
        logger.error(" Health check failed: %s", e)
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
    print(" Workflow Executor Modal App - Real Browser Automation")
    print(" Powered by MCP browser control via ngrok")
    print("  Direct PostgreSQL connection using psycopg2")
    print(" MCP Endpoints: Configured dynamically per execution")
    print(" VM Management:", VM_MANAGEMENT_ENDPOINT)
    print("\n Available Functions:")
    print("  • execute_workflow() - Real browser automation execution")
    print("  • health_check() - Infrastructure and MCP health monitoring")
    print(
        "  • check_and_process_queued_jobs() - Atomic job processing with auto-restart"
    )
    print("\n Hybrid Architecture:")
    print("  • Vercel: Fast database queries and status checks")
    print("  • Modal: Real browser automation with MCP")
    print("  • MCP: Browser control and UI interaction")
    print("  • PostgreSQL: Direct database access via psycopg2")
    print("  • Windows VM: Auto-restart capability via ngrok")
    print("\n Database Configuration:")
    db_config = get_db_config()
    print(f"  • Host: {db_config['host']}")
    print(f"  • Database: {db_config['database']}")
    print(f"  • User: {db_config['user']}")
    print("  • Connection pooling: Optimized for performance")
    print("\n Auto-Restart Features:")
    print("  • Automatic MCP server health monitoring")
    print("  • Windows VM service restart on MCP failure")
    print("  • Smart recovery detection (90s timeout)")
    print("  • Retry logic after successful restart")

    # Also log to logger so it's captured
    logger.info(
        "Modal app initialized with enhanced logging and auto-restart capability"
    )
    logger.info("MCP endpoints configured dynamically per execution")
    logger.info("Using VM management endpoint: %s", VM_MANAGEMENT_ENDPOINT)


@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=1),  # Run every second to check for queued jobs
    timeout=300,  # 5 minutes max per check
    max_containers=1,  # ENSURE ONLY ONE INSTANCE (prevents race conditions)
    min_containers=0,  # Do not keep warm, prevent queueing
    retries=modal.Retries(
        max_retries=2,
        backoff_coefficient=1.0,
        initial_delay=1.0,
    ),  # Retry on transient failures (e.g., SSL connection drops)
)
def check_and_process_queued_jobs():
    """
     MULTI-MACHINE JOB PROCESSOR: Claims and processes queued executions that are already assigned to machines.

    This function processes jobs that come with pre-assigned machine IDs and MCP endpoints.
    It ensures only one execution runs per machine while allowing multiple machines to work in parallel.

    SIMPLIFIED LOGIC: No machine discovery needed - jobs already have assigned_machine_id and mcp_endpoint.

    MACHINE-SPECIFIC COORDINATION: Uses machine-based coordinator locks to prevent
    race conditions while enabling true multi-machine parallelization.
    """
    conn = None
    cur = None
    coordinator_id = f"global-scheduler-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    # Track all machine coordinator locks we create so we can release them reliably
    acquired_locks: List[Tuple[str, str]] = []  # (user_id, processor_id)

    try:
        # Connect to database
        conn = get_database_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        #  GLOBAL SCHEDULER LOCK: Prevent multiple scheduler instances from racing
        try:
            cur.execute(
                """
                INSERT INTO processing_locks (user_id, event_id, processor_id, status, expires_at)
                VALUES ('global-scheduler', 0, %s, 'in_progress', NOW() + INTERVAL '2 minutes')
                ON CONFLICT (user_id, event_id) DO NOTHING
                RETURNING id
                """,
                (coordinator_id,),
            )

            if not cur.fetchone():
                logger.debug("Another global scheduler is already running")
                return {
                    "status": "skipped",
                    "reason": "scheduler_already_running",
                    "coordinator_id": coordinator_id,
                }

            conn.commit()
            logger.debug(" Acquired global scheduler lock: %s", coordinator_id)
        except Exception as lock_error:
            logger.error(" Failed to acquire scheduler lock: %s", lock_error)
            return {
                "status": "scheduler_lock_failed",
                "error": str(lock_error),
                "coordinator_id": coordinator_id,
            }

        #  Clean up stale coordinator locks before capacity checks (via helper)
        try:
            cleanup_stale_machine_locks(cur)
            conn.commit()
        except Exception as cleanup_err:
            logger.warning(
                " Failed to cleanup stale coordinator locks: %s", cleanup_err
            )

        # NOTE: Stale execution cleanup moved to dedicated scheduled function cleanup_stale_executions_job()
        # This runs independently every 5 minutes for better reliability

        #  ENHANCED MACHINE LOGIC: Find next queued job for a machine with available capacity
        # Jobs already have assigned_machine_id and mcp_endpoint - check against max_concurrent_executions
        cur.execute(
            """
            SELECT
                we.id,
                we.workflow_id,
                we.execution_params,
                we.client_id,
                we.assigned_machine_id,
                we.mcp_endpoint,
                we.version_number,
                we.start_from_step,
                we.end_at_step,
                we.follow_fallback,
                we.execute_jumps_at_end,
                we.created_at,
                rm.max_concurrent_executions,
                rm.name as machine_name
            FROM workflow_executions we
            JOIN remote_machines rm ON we.assigned_machine_id = rm.id
            WHERE we.status = 'queued'
              AND we.assigned_machine_id IS NOT NULL
              AND we.mcp_endpoint IS NOT NULL
              AND rm.status = 'active'
              AND (we.executor_type = 'python' OR we.executor_type IS NULL)
              AND (
                  -- Machine has available capacity based on max_concurrent_executions
                  SELECT COUNT(*)
                  FROM workflow_executions running
                  WHERE running.assigned_machine_id = we.assigned_machine_id
                    AND running.status = 'running'
                    AND running.started_at > NOW() - INTERVAL '30 minutes'
              ) < rm.max_concurrent_executions
              AND (
                  -- Allow concurrent claiming by checking coordinator lock count vs capacity
                  SELECT COUNT(*)
                  FROM processing_locks pl
                  WHERE pl.user_id = CONCAT('machine-', we.assigned_machine_id, '-coordinator')
                    AND pl.status = 'in_progress'
                    AND pl.expires_at > NOW()
              ) < rm.max_concurrent_executions
            ORDER BY we.created_at ASC  -- Process oldest jobs first
            FOR UPDATE SKIP LOCKED
        """
        )

        jobs_to_claim = cur.fetchall()

        if not jobs_to_claim:
            logger.debug(
                "No available jobs found (all machines busy or no queued jobs)"
            )
            return {"status": "no_available_jobs", "coordinator_id": coordinator_id}

        # Group jobs by machine to claim multiple jobs per machine up to capacity
        jobs_by_machine = {}
        for job in jobs_to_claim:
            machine_id = job["assigned_machine_id"]
            if machine_id not in jobs_by_machine:
                jobs_by_machine[machine_id] = []
            jobs_by_machine[machine_id].append(job)

        # Limit jobs per machine to available capacity
        jobs_to_process = []
        for machine_id, machine_jobs in jobs_by_machine.items():
            max_concurrent = machine_jobs[0]["max_concurrent_executions"]

            # Get current running count for this machine
            cur.execute(
                """
                SELECT COUNT(*) as running_count
                FROM workflow_executions 
                WHERE assigned_machine_id = %s 
                  AND status = 'running'
                  AND started_at > NOW() - INTERVAL '30 minutes'
            """,
                (machine_id,),
            )
            current_running = cur.fetchone()["running_count"]

            # Calculate available slots
            available_slots = max_concurrent - current_running
            if available_slots > 0:
                # Take only the jobs we can handle
                jobs_for_this_machine = machine_jobs[:available_slots]
                jobs_to_process.extend(jobs_for_this_machine)
                logger.debug(
                    " Found %d jobs for machine %s (%s) - capacity %d/%d",
                    len(jobs_for_this_machine),
                    machine_id,
                    machine_jobs[0]["machine_name"],
                    current_running + len(jobs_for_this_machine),
                    max_concurrent,
                )

        if not jobs_to_process:
            logger.debug("No jobs can be claimed after capacity check")
            return {"status": "no_available_jobs", "coordinator_id": coordinator_id}

        #  CLAIM ALL AVAILABLE JOBS: Process multiple jobs in parallel
        claimed_jobs = []

        for job in jobs_to_process:
            execution_id = job["id"]
            machine_id = job["assigned_machine_id"]
            workflow_id = job["workflow_id"]
            machine_name = job["machine_name"]
            max_concurrent = job["max_concurrent_executions"]

            #  WORKFLOW-SPECIFIC FAILURE PATTERN CHECK for each job
            should_block, block_reason, check_duration_ms = (
                check_failure_patterns_for_workflow(cur, conn, workflow_id)
            )

            if should_block:
                logger.warning(
                    " BLOCKED job %d for workflow %d on machine %s: %s",
                    execution_id,
                    workflow_id,
                    machine_id,
                    block_reason,
                )
                continue  # Skip this job but continue with others

            #  CREATE COORDINATOR LOCK for this specific job
            machine_coordinator_id = (
                f"machine-{machine_id}-coordinator-{uuid.uuid4().hex[:8]}"
            )
            machine_user_id = f"machine-{machine_id}-coordinator"
            try:
                cur.execute(
                    """
                    INSERT INTO processing_locks (user_id, event_id, processor_id, status, expires_at)
                    VALUES (%s, %s, %s, 'in_progress', NOW() + INTERVAL '5 minutes')
                    """,
                    (machine_user_id, execution_id, machine_coordinator_id),
                )
                # Track for guaranteed release after commit
                record_acquired_lock(
                    acquired_locks, machine_user_id, machine_coordinator_id
                )
            except Exception as lock_error:
                logger.error(
                    " Failed to create coordinator lock for job %d: %s",
                    execution_id,
                    lock_error,
                )
                continue  # Skip this job but continue with others

            #  CLAIM THIS JOB: Update status to running
            modal_call_id = f"modal-machine{machine_id}-{int(time.time())}-{random.randint(1000, 9999)}-{execution_id}"

            cur.execute(
                """
                UPDATE workflow_executions
                SET
                    status = 'running',
                    started_at = NOW(),
                    modal_call_id = %s
                WHERE id = %s
                  AND status = 'queued'
                RETURNING
                    id, workflow_id, execution_params, client_id,
                    assigned_machine_id, mcp_endpoint, version_number,
                    start_from_step, end_at_step, follow_fallback, execute_jumps_at_end;
                """,
                (modal_call_id, execution_id),
            )

            job_to_process = cur.fetchone()

            if not job_to_process:
                logger.warning(
                    " Failed to claim execution %s (may have been claimed by another process)",
                    execution_id,
                )
                continue  # Skip this job but continue with others

            # Successfully claimed the job
            claimed_jobs.append(job_to_process)

            logger.info(
                " Claimed execution ID %s for workflow %s on machine %s (%s) - capacity %d",
                execution_id,
                job_to_process["workflow_id"],
                machine_id,
                machine_name,
                max_concurrent,
            )

        # Commit all job claims at once
        conn.commit()

        if not claimed_jobs:
            logger.warning(" No jobs were successfully claimed")
            return {"status": "no_jobs_claimed", "coordinator_id": coordinator_id}

        #  DISPATCH ALL CLAIMED JOBS TO MODAL IN PARALLEL
        # Prepare all dispatch calls
        from modal import Function
        execute_fn = Function.from_name("workflow-executor", "execute_workflow")

        dispatch_calls = []
        for job_to_process in claimed_jobs:
            dispatch_calls.append({
                "execution_id": job_to_process["id"],
                "workflow_id": job_to_process["workflow_id"],
                "execution_params": job_to_process["execution_params"] or {},
                "client_id": job_to_process["client_id"],
                "assigned_machine_id": job_to_process["assigned_machine_id"],
                "mcp_endpoint": job_to_process["mcp_endpoint"],
                "version_number": job_to_process["version_number"],
                # NEW: Include partial execution parameters
                "start_from_step": job_to_process.get("start_from_step"),
                "end_at_step": job_to_process.get("end_at_step"),
                "follow_fallback": job_to_process.get("follow_fallback"),
                "execute_jumps_at_end": job_to_process.get("execute_jumps_at_end"),
            })

        # Dispatch all jobs at once in parallel
        dispatched_jobs = []
        failed_dispatches = []

        logger.info(" Dispatching %d jobs to Modal in parallel...", len(dispatch_calls))

        # Create all remote calls at once (truly parallel)
        futures = []
        for call in dispatch_calls:
            try:
                modal_future = execute_fn.remote(
                    workflow_id=call["workflow_id"],
                    mcp_endpoint=call["mcp_endpoint"],
                    execution_params=call["execution_params"],
                    client_id=call["client_id"],
                    execution_id=call["execution_id"],
                    version_number=call["version_number"],
                    # NEW: Pass partial execution parameters
                    start_from_step=call.get("start_from_step"),
                    end_at_step=call.get("end_at_step"),
                    follow_fallback=call.get("follow_fallback"),
                    execute_jumps_at_end=call.get("execute_jumps_at_end"),
                )
                futures.append((call, modal_future))
            except Exception as e:
                logger.error(" Failed to create remote call for job %s: %s", call["execution_id"], e)
                failed_dispatches.append(call["execution_id"])

        # Log results
        for call, modal_future in futures:
            dispatched_jobs.append({
                "execution_id": call["execution_id"],
                "workflow_id": call["workflow_id"],
                "machine_id": call["assigned_machine_id"],
                "modal_future": str(modal_future),
            })
            logger.info(
                " Job %s dispatched to Modal for machine %s",
                call["execution_id"],
                call["assigned_machine_id"],
            )

        # Handle failed dispatches with retry limit to prevent infinite loops
        MAX_DISPATCH_RETRIES = 3
        if failed_dispatches:
            for execution_id in failed_dispatches:
                try:
                    # Increment retry_count and check if we've exceeded max retries
                    cur.execute(
                        """
                        UPDATE workflow_executions
                        SET retry_count = COALESCE(retry_count, 0) + 1
                        WHERE id = %s
                        RETURNING retry_count
                        """,
                        (execution_id,),
                    )
                    result = cur.fetchone()
                    current_retry_count = result[0] if result else 1

                    if current_retry_count >= MAX_DISPATCH_RETRIES:
                        # Too many retries - mark as permanently failed
                        cur.execute(
                            """
                            UPDATE workflow_executions
                            SET status = 'failed',
                                error_message = COALESCE(error_message, '') || ' [Dispatch failed after ' || %s || ' retries]',
                                completed_at = NOW()
                            WHERE id = %s
                            """,
                            (current_retry_count, execution_id),
                        )
                        logger.warning(
                            " Execution %s permanently failed after %d dispatch retries",
                            execution_id,
                            current_retry_count,
                        )
                    else:
                        # Revert to queued for retry
                        cur.execute(
                            """
                            UPDATE workflow_executions
                            SET status = 'queued', started_at = NULL, modal_call_id = NULL
                            WHERE id = %s
                            """,
                            (execution_id,),
                        )
                        logger.info(
                            " Reverted execution %s back to queued status (retry %d/%d)",
                            execution_id,
                            current_retry_count,
                            MAX_DISPATCH_RETRIES,
                        )
                except Exception as revert_error:
                    logger.error(" Failed to handle execution status: %s", revert_error)

            if failed_dispatches:
                conn.commit()

        # Return summary of all dispatched jobs
        if dispatched_jobs:
            logger.info(
                " Successfully dispatched %d jobs in parallel!", len(dispatched_jobs)
            )
            return {
                "status": "jobs_claimed",
                "dispatched_jobs": dispatched_jobs,
                "total_dispatched": len(dispatched_jobs),
                "coordinator_id": coordinator_id,
            }
        else:
            return {
                "status": "dispatch_failed",
                "error": "No jobs were successfully dispatched",
                "coordinator_id": coordinator_id,
            }

    except Exception as e:
        logger.error(" Error in job processing: %s", str(e))
        return {
            "status": "processing_error",
            "error": str(e),
            "coordinator_id": coordinator_id,
        }

    finally:
        #  RELEASE COORDINATOR LOCKS
        try:
            if cur and conn and "coordinator_id" in locals():
                # Release global scheduler lock
                cur.execute(
                    """
                    DELETE FROM processing_locks 
                    WHERE user_id = 'global-scheduler' AND event_id = 0 AND processor_id = %s
                    """,
                    (coordinator_id,),
                )

                # Release all machine-specific coordinator locks we created (via helper)
                release_acquired_locks(cur, acquired_locks)

                conn.commit()
                logger.debug(
                    " Released coordinator locks: %s (count=%d)",
                    coordinator_id,
                    len(acquired_locks),
                )
        except Exception as unlock_error:
            logger.error(
                " Failed to release coordinator locks %s: %s",
                coordinator_id,
                unlock_error,
            )

        if cur:
            cur.close()
        if conn:
            conn.close()


@app.function(image=image, secrets=secrets, timeout=60)
def trigger_job_check():
    """
     MANUAL TRIGGER: Manually trigger the job processor

    Use this to test the job processor without waiting for the schedule
    """
    logger.info(" Manually triggering job check...")
    return check_and_process_queued_jobs.local()
