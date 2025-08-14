import os
import re
import subprocess
import sys
import time


def _run_probe(url: str, concurrency: int, retries: int = 3, timeout: int = 60):
    cmd = [
        sys.executable,
        "scripts/lb_parallel_probe.py",
        "--url",
        url,
        "--concurrency",
        str(concurrency),
        "--retries",
        str(retries),
        "--timeout",
        str(timeout),
    ]
    return subprocess.run(cmd, capture_output=True, text=True)


def test_lb_parallel_initialize_runs_without_dashboard():
    url = os.environ.get("LB_URL")
    if not url:
        import pytest
        pytest.skip("Set LB_URL to run this e2e LB probe test")

    concurrency = int(os.environ.get("LB_CONCURRENCY", "3"))

    # Run once; if it flakes due to probe window, allow one retry
    for attempt in range(2):
        proc = _run_probe(url, concurrency)
        out = proc.stdout
        err = proc.stderr
        if proc.returncode == 0:
            break
        time.sleep(0.5)
    assert proc.returncode == 0, f"Probe failed:\nSTDOUT:\n{out}\nSTDERR:\n{err}"

    # Validate we saw N successful session initializations
    ok_lines = [line for line in out.splitlines() if re.search(r"\[\d+\]\s+OK\s+session=", line)]
    assert len(ok_lines) >= concurrency, f"Expected {concurrency} successes, got {len(ok_lines)}\n{out}"

    # Ensure summary reports all succeeded
    assert f"Summary: {concurrency}/{concurrency} succeeded" in out


