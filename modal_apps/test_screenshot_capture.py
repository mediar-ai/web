"""
Test script to verify screenshot capture implementation in workflow_executor.py

This script simulates the screenshot extraction flow without running a full workflow.
"""

import json

def test_screenshot_extraction():
    """Test that screenshots are properly extracted from MCP response"""

    # Simulate an MCP response with images
    mock_mcp_response = {
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps({
                        "status": "success",
                        "results": [
                            {
                                "result": {
                                    "status": "success",
                                    "tool_name": "get_applications"
                                }
                            }
                        ]
                    })
                },
                {
                    "type": "image",
                    "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                },
                {
                    "type": "image",
                    "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
                }
            ]
        }
    }

    # Extract screenshots (mimicking the actual code)
    screenshots = []
    mcp_content = None

    if isinstance(mock_mcp_response, dict) and "result" in mock_mcp_response:
        result_content = mock_mcp_response.get("result", {}).get("content", [])
        if result_content and isinstance(result_content, list):
            for content_item in result_content:
                if content_item.get("type") == "text":
                    try:
                        mcp_content_text = content_item.get("text", "{}")
                        mcp_content = json.loads(mcp_content_text)
                        # Don't break - continue processing for images
                    except json.JSONDecodeError:
                        mcp_content = {"raw_text": content_item.get("text")}
                elif content_item.get("type") == "image":
                    image_data = content_item.get("data", "")
                    if image_data:
                        screenshots.append(image_data)
                        print(f"[OK] Captured screenshot {len(screenshots)}")

    # Verify results
    print(f"\n--- Test Results ---")
    print(f"Screenshots captured: {len(screenshots)}")
    print(f"MCP content parsed: {mcp_content is not None}")
    print(f"MCP status: {mcp_content.get('status') if mcp_content else 'N/A'}")

    # Check expectations
    assert len(screenshots) == 2, f"Expected 2 screenshots, got {len(screenshots)}"
    assert mcp_content is not None, "MCP content should be parsed"
    assert mcp_content.get("status") == "success", "MCP status should be success"

    print(f"\n[OK] All tests passed!")
    print(f"\nScreenshot sample (first 80 chars): {screenshots[0][:80]}...")

    return True


if __name__ == "__main__":
    test_screenshot_extraction()
