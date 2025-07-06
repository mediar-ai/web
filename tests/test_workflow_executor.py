import pytest
from modal_apps.workflow_executor import execute_workflow


# Mark this as a slow test since it runs a real workflow
@pytest.mark.slow
def test_execute_workflow_end_to_end():
    """
    Runs an end-to-end integration test for workflow ID 1.
    This test executes the full workflow in a real Modal environment,
    which can take a few minutes.
    """
    # Arrange: Define the workflow to test
    workflow_id_to_test = 1
    print(f"Starting end-to-end test for workflow ID: {workflow_id_to_test}")

    # Act: Execute the workflow using Modal's .local() call
    # This will run the function in the Modal cloud
    print("Executing workflow in Modal cloud...")
    result = execute_workflow.local(
        workflow_id=workflow_id_to_test, client_id="test_client"
    )
    print(f"Workflow execution completed. Result: {result}")

    # Assert: Check the results for success and correctness
    print("Validating test results...")
    assert result is not None, "The result should not be None"
    print("✓ Result is not None")

    assert result.get("success") is True, "The 'success' flag should be True"
    print("✓ Success flag is True")

    assert result.get("execution_id") is not None, "An execution ID should be returned"
    print(f"✓ Execution ID returned: {result.get('execution_id')}")

    assert (
        result.get("workflow_id") == workflow_id_to_test
    ), f"The workflow_id should be {workflow_id_to_test}"
    print(f"✓ Workflow ID matches expected: {workflow_id_to_test}")

    assert result.get("status") == "completed", "The status should be 'completed'"
    print("✓ Status is 'completed'")

    # Check for successful execution summary
    execution_summary = result.get("results", {}).get("execution_summary", {})
    print(f"Execution summary: {execution_summary}")

    assert (
        execution_summary.get("workflow_completed") is True
    ), "The execution summary should indicate completion"
    print("✓ Workflow completion confirmed")

    assert (
        execution_summary.get("quotes_found", 0) > 0
    ), "At least one quote should have been found"
    print(f"✓ Quotes found: {execution_summary.get('quotes_found', 0)}")

    print("✅ All assertions passed - test completed successfully!")
