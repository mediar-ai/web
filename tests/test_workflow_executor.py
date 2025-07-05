import pytest
import os
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

    # Act: Execute the workflow using Modal's .local() call
    # This will run the function in the Modal cloud
    result = execute_workflow.local(workflow_id=workflow_id_to_test)

    # Assert: Check the results for success and correctness
    assert result is not None, "The result should not be None"
    assert result.get('success') is True, "The 'success' flag should be True"
    assert result.get('execution_id') is not None, "An execution ID should be returned"
    assert result.get('workflow_id') == workflow_id_to_test, f"The workflow_id should be {workflow_id_to_test}"
    assert result.get('status') == 'completed', "The status should be 'completed'"
    
    # Check for successful execution summary
    execution_summary = result.get('results', {}).get('execution_summary', {})
    assert execution_summary.get('workflow_completed') is True, "The execution summary should indicate completion"
    assert execution_summary.get('quotes_found', 0) > 0, "At least one quote should have been found" 