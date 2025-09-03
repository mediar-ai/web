#!/usr/bin/env python3
"""
Test script for the new standardized success/failure indication system.

This script tests the new parse_workflow_result and display_workflow_result functions
to ensure they work correctly with various MCP response formats.
"""

import json
import os
import sys

# Add the modal_apps directory to the path so we can import the functions
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from modal_apps.workflow_executor import display_workflow_result, parse_workflow_result


def test_successful_workflow_with_standardized_parser():
    """Test a successful workflow with standardized output parser"""
    print("\n" + "=" * 60)
    print("TEST 1: Successful workflow with standardized parser")
    print("=" * 60)

    mcp_response = {
        "status": "success",
        "total_duration_ms": 15000,
        "executed_tools": 4,
        "parsed_output": {
            "success": True,
            "data": [
                {
                    "plan_name": "Basic Health",
                    "monthly_premium": "$299",
                    "provider": "Example Insurance",
                },
                {
                    "plan_name": "Premium Health",
                    "monthly_premium": "$499",
                    "provider": "Example Insurance",
                },
            ],
            "message": "Successfully found 2 insurance quotes",
            "error": None,
            "validation": {"quotes_found": 2, "has_error": False, "page_loaded": True},
        },
    }

    result = parse_workflow_result(mcp_response)
    exit_code = display_workflow_result(result)

    print(f"\nResult: {result}")
    print(f"Exit code: {exit_code}")
    assert result["success"] == True
    assert exit_code == 0
    assert len(result["data"]) == 2
    print("✅ TEST 1 PASSED")


def test_failed_workflow_with_standardized_parser():
    """Test a failed workflow with standardized output parser"""
    print("\n" + "=" * 60)
    print("TEST 2: Failed workflow with standardized parser")
    print("=" * 60)

    mcp_response = {
        "status": "completed_with_errors",
        "total_duration_ms": 8000,
        "executed_tools": 3,
        "parsed_output": {
            "success": False,
            "data": [],
            "message": "No quotes found - applicant may not qualify",
            "error": "Age criteria not met for available plans",
            "validation": {
                "quotes_found": 0,
                "has_error": False,
                "page_loaded": True,
                "age_check_failed": True,
            },
        },
    }

    result = parse_workflow_result(mcp_response)
    exit_code = display_workflow_result(result)

    print(f"\nResult: {result}")
    print(f"Exit code: {exit_code}")
    assert result["success"] == False
    assert exit_code == 1
    assert result["data"] == []
    print("✅ TEST 2 PASSED")


def test_workflow_without_parser():
    """Test workflow without standardized parser (legacy mode)"""
    print("\n" + "=" * 60)
    print("TEST 3: Workflow without standardized parser (legacy)")
    print("=" * 60)

    mcp_response = {
        "status": "success",
        "total_duration_ms": 12000,
        "executed_tools": 5,
        # No parsed_output field - should use execution status
    }

    result = parse_workflow_result(mcp_response)
    exit_code = display_workflow_result(result)

    print(f"\nResult: {result}")
    print(f"Exit code: {exit_code}")
    assert result["success"] == True  # Based on execution status
    assert exit_code == 0
    assert result["data"] is None
    print("✅ TEST 3 PASSED")


def test_execution_failure():
    """Test workflow with execution failure"""
    print("\n" + "=" * 60)
    print("TEST 4: Workflow with execution failure")
    print("=" * 60)

    mcp_response = {
        "status": "error",
        "total_duration_ms": 3000,
        "executed_tools": 1,
        "debug_info_on_failure": "Element not found: role:Button|name:Submit",
    }

    result = parse_workflow_result(mcp_response)
    exit_code = display_workflow_result(result)

    print(f"\nResult: {result}")
    print(f"Exit code: {exit_code}")
    assert result["success"] == False
    assert exit_code == 1
    assert "Element not found" in result["error"]
    print("✅ TEST 4 PASSED")


def test_parse_error():
    """Test workflow result parsing error"""
    print("\n" + "=" * 60)
    print("TEST 5: Parse error handling")
    print("=" * 60)

    # Invalid response that should cause parsing error
    mcp_response = None

    result = parse_workflow_result(mcp_response)
    exit_code = display_workflow_result(result)

    print(f"\nResult: {result}")
    print(f"Exit code: {exit_code}")
    assert result["success"] == False
    assert result["execution_status"] == "parse_error"
    assert exit_code == 1
    print("✅ TEST 5 PASSED")


def main():
    """Run all tests"""
    print("🚀 Testing Standardized Success/Failure Indication System")
    print("=" * 80)

    try:
        test_successful_workflow_with_standardized_parser()
        test_failed_workflow_with_standardized_parser()
        test_workflow_without_parser()
        test_execution_failure()
        test_parse_error()

        print("\n" + "=" * 80)
        print("🎉 ALL TESTS PASSED! Standardized system is working correctly.")
        print("=" * 80)

        return 0

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())

