import argparse
import json
import logging
import os
import sys


def _install_minimal_modal_stub():
    try:
        import modal  # noqa: F401
        return
    except Exception:
        pass

    import types

    modal = types.ModuleType("modal")

    class _App:
        def __init__(self, *_a, **_k):
            pass

        def function(self, *decorator_args, **decorator_kwargs):  # noqa: ARG002
            def _decorator(fn):
                def _local(**kwargs):
                    return fn(**kwargs)
                setattr(fn, "local", _local)
                return fn
            return _decorator

    class _Secret:
        @staticmethod
        def from_name(_name):
            return object()

    class _Image:
        @staticmethod
        def debian_slim():
            return _Image()
        def pip_install(self, _packages):
            return self
        def env(self, *_args, **_kwargs):
            return self
        def add_local_python_source(self, *_args, **_kwargs):
            return self

    class _Period:
        def __init__(self, **_kwargs):
            pass

    modal.App = _App
    modal.Secret = _Secret
    modal.Image = _Image
    modal.Period = _Period
    sys.modules['modal'] = modal


def parse_args():
    p = argparse.ArgumentParser(description="Run a real workflow execution via Python executor")
    p.add_argument("--version", required=True, help="Workflow version number, e.g. 1.0.71")
    p.add_argument("--endpoint", required=True, help="MCP base URL, e.g. http://20.36.178.60:8080")
    p.add_argument("--client-id", default="e2e_cli")
    p.add_argument("--enrich", action="store_true", help="Enable enrichment (off by default)")
    return p.parse_args()


def main():
    from dotenv import load_dotenv
    load_dotenv(".env.local")

    # Ensure we can import the executor even if modal package is missing locally
    _install_minimal_modal_stub()

    # Ensure project root on sys.path for 'modal_apps' imports
    PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    if PROJECT_ROOT not in sys.path:
        sys.path.insert(0, PROJECT_ROOT)

    args = parse_args()

    logging.getLogger().setLevel(logging.INFO)

    from modal_apps.workflow_executor import (
        execute_workflow_by_version,
    )

    execution_params = {"enrich_output": bool(args.enrich)}

    res = execute_workflow_by_version(
        version_number=args.version,
        mcp_endpoint=args.endpoint,
        execution_params=execution_params,
        client_id=args.client_id,
        status="deployed",
    )

    output = {
        "success": res.get("success"),
        "status": res.get("status"),
        "execution_id": res.get("execution_id"),
        "workflow_id": res.get("workflow_id"),
        "quotes_found": res.get("quotes_found"),
    }
    print(json.dumps(output))

    if not res.get("success"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()


