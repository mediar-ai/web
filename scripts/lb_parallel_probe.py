import argparse
import asyncio
import json
import time
from typing import Any, Dict, Tuple


def normalize_endpoint(base_or_full: str) -> str:
    return base_or_full if base_or_full.endswith("/mcp") else f"{base_or_full.rstrip('/')}/mcp"


async def post_with_503_backoff(url: str, payload: Dict[str, Any], headers: Dict[str, str],
                                max_retries: int = 3, initial_backoff: float = 0.2, timeout: float = 60.0
) -> Tuple[Any, Any]:
    import httpx  # use real httpx here (not the test stub)
    backoff = initial_backoff
    last_exc = None
    for attempt in range(max_retries + 1):
        client = httpx.AsyncClient(timeout=timeout)
        try:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 503:
                await client.aclose()
                if attempt == max_retries:
                    raise RuntimeError("All workers busy (503). Please retry shortly.")
                await asyncio.sleep(backoff)
                backoff *= 2
                continue
            return client, resp
        except Exception as e:  # capture and close
            last_exc = e
            try:
                await client.aclose()
            except Exception:
                pass
            if attempt == max_retries:
                raise e
            await asyncio.sleep(backoff)
            backoff *= 2
    if last_exc:
        raise last_exc
    raise RuntimeError("Unexpected retry loop exit")


async def init_session(base_url: str, max_retries: int, timeout: float) -> Tuple[str, float]:
    endpoint = normalize_endpoint(base_url)
    init_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"roots": {"listChanged": False}, "sampling": {}},
            "clientInfo": {"name": "lb-parallel-probe", "version": "0.1"},
        },
    }
    t0 = time.perf_counter()
    client, resp = await post_with_503_backoff(
        endpoint,
        init_request,
        {"Accept": "application/json, text/event-stream"},
        max_retries=max_retries,
        initial_backoff=0.2,
        timeout=timeout,
    )
    try:
        sess = resp.headers.get("Mcp-Session-Id", "")
        # Send initialized notification and close
        payload = {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
        await client.post(endpoint, json=payload, headers={"Accept": "application/json, text/event-stream", "Mcp-Session-Id": sess})
        return sess, (time.perf_counter() - t0)
    finally:
        try:
            await client.aclose()
        except Exception:
            pass


async def main_async(args):
    tasks = [init_session(args.url, args.retries, args.timeout) for _ in range(args.concurrency)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    ok = 0
    for idx, res in enumerate(results):
        if isinstance(res, Exception):
            print(f"[{idx}] FAIL: {res}")
        else:
            sess, dt = res
            print(f"[{idx}] OK  session={sess or 'no-header'}  dt={dt*1000:.0f}ms")
            ok += 1
    print(f"Summary: {ok}/{len(results)} succeeded")
    if ok != len(results):
        raise SystemExit(1)


def parse_args():
    p = argparse.ArgumentParser(description="Probe MCP LB with parallel initialize requests")
    p.add_argument("--url", required=True, help="Base LB URL, e.g. http://20.36.178.60:8080")
    p.add_argument("--concurrency", type=int, default=3)
    p.add_argument("--retries", type=int, default=3)
    p.add_argument("--timeout", type=float, default=60.0)
    return p.parse_args()


def main():
    args = parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()


