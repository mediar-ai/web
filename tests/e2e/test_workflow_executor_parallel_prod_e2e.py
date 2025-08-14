import os
import subprocess
import sys
import time


def _spawn(version: str, endpoint: str, client_id: str):
    cmd = [
        sys.executable,
        "scripts/run_workflow_e2e.py",
        "--version",
        version,
        "--endpoint",
        endpoint,
        "--client-id",
        client_id,
    ]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def test_parallel_three_executor_runs_against_lb():
    version = os.environ.get("WF_VERSION", "1.0.71")
    endpoint = os.environ.get("LB_URL")
    if not endpoint:
        import pytest
        pytest.skip("Set LB_URL to run parallel executor e2e test")

    procs = []
    start = time.time()
    for i in range(3):
        procs.append(_spawn(version, endpoint, f"pytest_parallel_{i}"))

    outs = []
    errs = []
    codes = []
    for p in procs:
        out, err = p.communicate()
        outs.append(out)
        errs.append(err)
        codes.append(p.returncode)

    duration = time.time() - start
    # All should succeed
    assert all(c == 0 for c in codes), f"At least one run failed\nCODES={codes}\nOUTS={outs}\nERRS={errs}"
    # Sanity: should complete within a reasonable window for parallelism
    assert duration < 600, f"Parallel runs took too long ({duration:.1f}s)\nOUTS={outs}\nERRS={errs}"


