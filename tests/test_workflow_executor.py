import pytest
import sys
import json
import logging
from modal_apps.workflow_executor import (
    execute_workflow_by_version,
    resolve_workflow_id_for_version,
)


def _safe_json(value, limit: int = 2000) -> str:
    try:
        s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    except Exception:
        s = str(value)
    if s is None:
        return ""
    return s if len(s) <= limit else s[:limit] + "…"


def configure_test_logging(level: int = logging.INFO) -> None:
    """Ensure logs from our modules and root go to stdout with a verbose formatter."""
    root = logging.getLogger()
    root.setLevel(level)

    # Add a console handler to stdout even if other handlers exist
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(
        logging.Formatter("%(asctime)s | %(name)s | %(levelname)s | %(message)s")
    )
    root.addHandler(console)

    # Raise levels for our modules
    logging.getLogger("modal_apps.workflow_executor").setLevel(level)
    logging.getLogger("modal_apps.output_enrichment").setLevel(level)
# load .env*
from dotenv import load_dotenv
# try .env or .env.local
load_dotenv(".env.local")

# Mark this as a slow test since it runs a real workflow
@pytest.mark.slow
def test_execute_workflow_end_to_end():
    """
    Runs an end-to-end integration test by version only.
    This executes the full workflow in Modal using just the version number.
    """
    # Arrange: Define the version to test (latest non-active)
    configure_test_logging(logging.DEBUG)
    log = logging.getLogger("tests.test_workflow_executor")

    version_to_test = "1.0.70"
    mcp_endpoint = "http://20.36.178.60:8080"
    client_id = "test_client"
    log.info("Starting end-to-end test for version: %s", version_to_test)
    
    # Configure execution parameters with enrichment enabled
    execution_params = {
        "enrich_output": True,
        "enrichment": {
            "mode": "sync",
            "model": "gemini-2.5-flash",
            "schema": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "carrier_product": {"type": "string"},
                        "quote_value": {"type": "string"},
                        "quote_type": {"type": "string"},
                        "status": {"type": "string", "enum": ["Available", "Discontinued", "Ineligible", "Excluded", "Unknown"]}
                    },
                    "required": ["carrier_product", "quote_value", "quote_type", "status"]
                }
            },
            "instructions": "Extract all insurance quotes. Map carrier and product names to carrier_product. Include price as quote_value. Set quote_type to 'Monthly Price' for monthly quotes. Set status based on availability.",
            "max_tokens": 50000,
            "output_key": "quotes"
        }
    }

    # Act: Execute the workflow using Modal's .local() call
    # This will run the function in the Modal cloud
    log.info(
        "Executing workflow (version-only) | version=%s | endpoint=%s | client_id=%s",
        version_to_test,
        mcp_endpoint,
        client_id,
    )
    # Optional: Resolve the workflow ID for validation
    resolved_workflow_id = resolve_workflow_id_for_version(
        version_number=version_to_test,
        status="deployed",
    )
    log.info("Resolved workflow_id=%s for version=%s", resolved_workflow_id, version_to_test)

    # Use Azure VM Desktop Balancer MCP endpoint from Supabase
    result = execute_workflow_by_version(
        version_number=version_to_test,
        mcp_endpoint=mcp_endpoint,  # Azure MCP base endpoint
        execution_params=execution_params,
        client_id=client_id,
        status="deployed",
    )
    # just log raw result
    log.debug("Raw result: %s", result.get("quotes"))
    log.info(
        "Completed execution | success=%s | status=%s | execution_id=%s",
        result.get("success"), result.get("status"), result.get("execution_id"),
    )
    log.debug("Result keys: %s", list(result.keys()))

    # Assert: Check the results for success and correctness
    print("Validating test results...")
    assert result is not None, "The result should not be None"
    print("OK Result is not None")

    assert result.get("success") is True, "The 'success' flag should be True"
    print("OK Success flag is True")

    # execution_id may be None for direct .local() calls; assert key presence only
    assert "execution_id" in result
    print(f"OK Execution ID present (may be None for local calls): {result.get('execution_id')}")

    assert (
        result.get("workflow_id") == resolved_workflow_id
    ), f"The workflow_id should be {resolved_workflow_id}"
    print(f"OK Workflow ID matches resolved ID: {resolved_workflow_id}")

    assert result.get("status") == "completed", "The status should be 'completed'"
    print("OK Status is 'completed'")

    # Check for successful execution summary
    execution_summary = result.get("results", {}).get("execution_summary", {})
    log.info("Execution summary: %s", _safe_json(execution_summary, 2000))

    assert (
        execution_summary.get("workflow_completed") is True
    ), "The execution summary should indicate completion"
    print("OK Workflow completion confirmed")

    assert (
        execution_summary.get("quotes_found", 0) > 0
    ), "At least one quote should have been found"
    print(f"OK Quotes found: {execution_summary.get('quotes_found', 0)}")
    
    # Check for enrichment if enabled
    if execution_params.get("enrich_output"):
        results = result.get("results", {})
        enrichment = results.get("enrichment", {})
        
        print(f"\n=== ENRICHMENT STATUS ===")
        print(f"Status: {enrichment.get('status')}")
        print(f"Model: {enrichment.get('model')}")
        log.info(
            "Enrichment | status=%s | model=%s | error=%s",
            enrichment.get("status"), enrichment.get("model"), enrichment.get("error_message"),
        )
        
        if enrichment.get("status") == "succeeded":
            # Check for mediar_parser at root level
            assert "mediar_parser" in results, "mediar_parser should be at root level"
            assert "mediarParser" in results, "mediarParser (camelCase) should be at root level"
            print("OK Both mediar_parser and mediarParser present at root level")
            
            parser_data = results.get("mediar_parser")
            if isinstance(parser_data, list) and len(parser_data) > 0:
                print(f"OK Found {len(parser_data)} enriched quotes")
                
                # Check first item has dual-case keys
                first_item = parser_data[0]
                if "carrier_product" in first_item:
                    assert "carrierProduct" in first_item, "Missing camelCase carrierProduct"
                    print(f"OK Dual-case: carrier_product = carrierProduct = '{first_item['carrier_product']}'")
                
                if "quote_value" in first_item:
                    assert "quoteValue" in first_item, "Missing camelCase quoteValue"
                    print(f"OK Dual-case: quote_value = quoteValue = '{first_item['quote_value']}'")
                
                if "quote_type" in first_item:
                    assert "quoteType" in first_item, "Missing camelCase quoteType"
                    print(f"OK Dual-case: quote_type = quoteType = '{first_item['quote_type']}'")
                
                # Print sample of enriched data
                print("\n=== SAMPLE ENRICHED QUOTE ===")
                print(json.dumps(first_item, indent=2))
                log.debug("Sample enriched quote: %s", _safe_json(first_item, 1000))
        else:
            print(f"WARN Enrichment failed: {enrichment.get('error_message', 'Unknown error')}")
            log.warning("Enrichment failed: %s", enrichment.get("error_message", "Unknown error"))

    print("\nOK All assertions passed - test completed successfully!")
