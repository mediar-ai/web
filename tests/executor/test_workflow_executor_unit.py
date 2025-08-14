import asyncio
import json
import pytest


# Helper fakes
class DummyResponse:
    def __init__(self, status_code=200, text="", headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}


class DummySessionClient:
    def __init__(self, sse_payload_json):
        self._sse_payload_json = sse_payload_json
        self.closed = False

    async def post(self, url, json=None, headers=None):  # noqa: A002 - matches signature used
        # emulate notifications/initialized
        if isinstance(json, dict) and json.get("method") == "notifications/initialized":
            return DummyResponse(status_code=200)

        # emulate tools/call with SSE-wrapped JSON data
        if isinstance(json, dict) and json.get("method") == "tools/call":
            sse_text = f"data: {self._sse_payload_json}\n\n"
            return DummyResponse(status_code=200, text=sse_text)

        return DummyResponse(status_code=400)

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_execute_mcp_workflow_parses_sse_without_network(monkeypatch):
    # Import target after monkeypatch planning
    from modal_apps import workflow_executor as we

    # Prepare minimal workflow with sequence in JSONB style
    workflow_data = {
        "id": 1,
        "name": "Unit Test Workflow",
        "automation_sequence": [
            {
                "tool_name": "run_sequence",
                "arguments": {
                    "items": [],
                    "inputs": {"foo": "bar"},
                },
            }
        ],
    }

    # Craft mcp_content that contains quotes via the wait_for_output_parser step
    extracted = [{"carrier": "Acme", "product": "Term", "monthly_price": "$12.34", "status": ["Available"]}]
    parser_payload = json.dumps({"extracted_data": extracted})
    mcp_content = {
        "results": [
            {
                "status": "success",
                "results": [
                    {
                        "tool_name": "wait_for_output_parser",
                        "result": {"content": [{"type": "text", "text": parser_payload}]},
                    }
                ],
            }
        ]
    }

    # Wrap in outer result_data expected from SSE line
    result_data = {"result": {"content": [{"type": "text", "text": json.dumps(mcp_content)}]}}
    sse_payload_json = json.dumps(result_data)

    captured_url = {"value": None}

    async def fake_post_with_503_backoff(client_factory, url, payload, headers, max_retries=3, initial_backoff=0.0):
        captured_url["value"] = url
        client = DummySessionClient(sse_payload_json)
        # Initial response must carry a session header
        init_resp = DummyResponse(status_code=200, headers={"Mcp-Session-Id": "sess-1"})
        return client, init_resp

    # Monkeypatch helper used inside executor
    monkeypatch.setattr(we, "post_with_503_backoff", fake_post_with_503_backoff)

    # Execute
    results = await we.execute_mcp_workflow(
        workflow_data=workflow_data,
        execution_params={"over": "ride"},
        mcp_endpoint="http://lb-endpoint",  # should be normalized to /mcp
    )

    # Assert parsing and endpoint normalization
    assert results["quotes"], "Expected quotes parsed from SSE payload"
    assert captured_url["value"].endswith("/mcp"), "Endpoint should be normalized to /mcp"


@pytest.mark.asyncio
async def test_execute_mcp_workflow_raises_without_session_id(monkeypatch):
    from modal_apps import workflow_executor as we

    workflow_data = {
        "id": 1,
        "name": "No Session Workflow",
        "automation_sequence": [
            {"tool_name": "run_sequence", "arguments": {"items": []}},
        ],
    }

    async def fake_post_with_503_backoff(client_factory, url, payload, headers, max_retries=3, initial_backoff=0.0):
        return DummySessionClient("{}"), DummyResponse(status_code=200, headers={})

    monkeypatch.setattr(we, "post_with_503_backoff", fake_post_with_503_backoff)

    with pytest.raises(Exception) as exc:
        await we.execute_mcp_workflow(workflow_data, {}, "http://x")
    assert "No session ID" in str(exc.value)


def test_resolve_workflow_id_for_version_single_match(monkeypatch):
    from modal_apps import workflow_executor as we

    class FakeCursor:
        def __init__(self):
            self._rows = [
                {"id": 42, "name": "W", "status": "deployed", "category": "cat", "current_version": "1.0.0"}
            ]

        def execute(self, *_args, **_kwargs):
            pass

        def fetchall(self):
            return list(self._rows)

        def close(self):
            pass

    class FakeConn:
        def cursor(self, cursor_factory=None):  # noqa: ARG002
            return FakeCursor()

        def close(self):
            pass

    monkeypatch.setattr(we, "get_database_connection", lambda: FakeConn())

    out = we.resolve_workflow_id_for_version("1.0.0", status="deployed")
    assert out == 42



