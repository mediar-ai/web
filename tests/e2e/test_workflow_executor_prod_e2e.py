import os
import subprocess
import sys


def test_run_workflow_version_against_lb():
    version = os.environ.get("WF_VERSION", "1.0.71")
    endpoint = os.environ.get("LB_URL")
    if not endpoint:
        import pytest
        pytest.skip("Set LB_URL to run this executor e2e test")

    cmd = [
        sys.executable,
        "scripts/run_workflow_e2e.py",
        "--version",
        version,
        "--endpoint",
        endpoint,
        "--client-id",
        "pytest_e2e",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    assert proc.returncode == 0, f"Execution failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"


