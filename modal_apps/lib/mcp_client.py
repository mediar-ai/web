import asyncio
import random
from typing import Dict, Any, Tuple, Optional
import logging


logger = logging.getLogger(__name__)


def normalize_endpoint(base_or_full: str) -> str:
    """Ensure the MCP URL targets /mcp exactly once."""
    return base_or_full if base_or_full.endswith("/mcp") else f"{base_or_full.rstrip('/')}/mcp"


async def post_with_503_backoff(
    client_factory,
    url: str,
    payload: Dict[str, Any],
    headers: Dict[str, str],
    max_retries: int = 5,
    initial_backoff: float = 0.5,
) -> Any:
    """POST with exponential backoff on 503, recreating the client each attempt so LB can reroute."""
    backoff = initial_backoff
    for attempt in range(max_retries + 1):
        client = client_factory()
        try:
            # Create a fresh client per attempt (LB reroute on 503). Keep the
            # successful client's connection open to preserve MCP session.
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 503:
                await client.aclose()
                if attempt == max_retries:
                    raise Exception("All workers busy (503). Please retry shortly.")
                # Add a little jitter to avoid consistent hashing to the same VM
                await asyncio.sleep(backoff + random.uniform(0.0, 0.2))
                backoff *= 2
                continue
            return client, resp
        except Exception:
            try:
                await client.aclose()
            except Exception:
                pass
            raise


