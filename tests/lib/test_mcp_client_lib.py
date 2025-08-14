import asyncio
import pytest

from modal_apps.lib import mcp_client


def test_normalize_endpoint_appends_once():
    assert mcp_client.normalize_endpoint("http://x") == "http://x/mcp"
    assert mcp_client.normalize_endpoint("http://x/") == "http://x/mcp"
    assert mcp_client.normalize_endpoint("http://x/mcp") == "http://x/mcp"


class DummyResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code


class DummyClient:
    def __init__(self, responses):
        # Keep a reference to the shared list so retries consume globally
        self.responses = responses
        self.closed = False

    async def post(self, url, json, headers):
        return self.responses.pop(0)

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_post_with_503_backoff_retries_then_succeeds(monkeypatch):
    # First two 503, then 200
    responses = [DummyResponse(503), DummyResponse(503), DummyResponse(200)]

    # client_factory returns a fresh client each attempt with same response queue semantics
    def client_factory():
        # Use a closure over responses list so each new client sees the shared remaining responses
        return DummyClient(responses)

    url = "http://example/mcp"
    payload = {"a": 1}
    headers = {"h": "v"}

    client, resp = await mcp_client.post_with_503_backoff(
        client_factory, url, payload, headers, max_retries=3, initial_backoff=0
    )

    assert isinstance(resp, DummyResponse)
    assert resp.status_code == 200
    # Client returned should be the last created one
    assert isinstance(client, DummyClient)


@pytest.mark.asyncio
async def test_post_with_503_backoff_exhausts_and_raises():
    responses = [DummyResponse(503), DummyResponse(503), DummyResponse(503), DummyResponse(503)]

    def client_factory():
        return DummyClient(responses)

    with pytest.raises(Exception) as exc:
        await mcp_client.post_with_503_backoff(client_factory, "u", {}, {}, max_retries=2, initial_backoff=0)
    assert "All workers busy" in str(exc.value)


