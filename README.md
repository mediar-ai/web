Web recorder
Windows app backend
User dashboard

---

## Modal Apps Setup and Usage

This project uses `uv` for Python environment and package management, and `modal` to run services in the cloud.

### 1. Initial Setup

Follow these steps to set up your local environment.

**a. Install `uv`:**

If you don't have `uv` installed, you can install it via `pip`:

```bash
pip install uv
```

**b. Create the Virtual Environment:**

Create a dedicated virtual environment for this project.

```bash
uv venv
```

**c. Install Dependencies:**

Install all required Python packages from the `pyproject.toml` file.

```bash
uv pip install -r requirements.txt
```
> **Note:** The command above assumes you have a `requirements.txt`. If you only have `pyproject.toml`, you can install the base dependencies like this:
> `uv pip install .` and `uv pip install -e ".[dev]"` to install dev dependencies.

**d. Authenticate with Modal:**

Log in to your Modal account. This will open a web browser for authentication.

```bash
uv run modal token new
```

### 2. Running Services

All commands should be run from the root of the project.

**a. Run a Health Check:**

Before running a full workflow, it's a good practice to run the health check to ensure all services are operational.

```bash
uv run modal run modal_apps/workflow_executor.py::health_check
```

**b. Execute a Specific Workflow:**

To trigger a specific workflow, use the `execute_workflow` function and provide a `workflow_id`.

```bash
# Replace '1' with the ID of the workflow you want to run
uv run modal run modal_apps/workflow_executor.py::execute_workflow --workflow-id 1
```

**c. Trigger the Queued Job Processor:**

To process any workflows that are waiting in the `queued` state in the database, run the following command:

```bash
uv run modal run modal_apps/workflow_executor.py::trigger_job_check
```

### 3. Running Tests

This project uses `pytest` for testing.

**a. Run All Tests:**

Execute the full test suite.

```bash
uv run pytest
```

**b. Skip Slow Tests:**

To run only the fast unit tests and skip any slow integration tests (marked with `@pytest.mark.slow`), use the following command:

```bash
uv run pytest -m "not slow"
```