import importlib.util
import sys
import argparse
import json
from unittest.mock import MagicMock

def setup_modal_mock():
    """
    Sets up a mock for the 'modal' library.
    This allows modal scripts to be imported and run in a local environment
    without the modal client.
    """
    if 'modal' in sys.modules:
        print("Warning: 'modal' module already imported. Mock may not be effective.")
        return

    print("Setting up mock for 'modal' library...")
    mock_modal = MagicMock()

    def passthrough_decorator(fn):
        """A decorator that does nothing but return the original function."""
        return fn

    def decorator_factory(*args, **kwargs):
        """A factory that returns the passthrough_decorator."""
        return passthrough_decorator

    # When the script uses @app.function(...), it will call this factory,
    # which returns a decorator that does nothing.
    mock_modal.App.return_value.function = decorator_factory

    # Mock other modal components to prevent import errors.
    mock_modal.Image.debian_slim.return_value.pip_install.return_value = None
    mock_modal.Secret.from_name.return_value = None
    mock_modal.Period = MagicMock()

    # Insert the mock into Python's module cache. Any subsequent `import modal`
    # will get our mock instead of the real library.
    sys.modules['modal'] = mock_modal
    print("Mock for 'modal' library is now active.")

def run_local(module_path, function_name, function_args):
    """
    Loads a function from a module and runs it with the given arguments.
    """
    print(f"Attempting to run '{function_name}' from '{module_path}'...")

    try:
        # Dynamically import the module from the given path
        spec = importlib.util.spec_from_file_location("modal_app_module", module_path)
        if spec is None:
            raise ImportError(f"Could not load spec for module at path: {module_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module

        # The module's code is executed upon calling exec_module.
        # Our modal mock must be in place before this happens.
        spec.loader.exec_module(module)

        print(f"Successfully imported module from '{module_path}'.")

    except Exception as e:
        print(f"Error importing module '{module_path}':")
        import traceback
        traceback.print_exc()
        return

    # Get the function from the loaded module
    if not hasattr(module, function_name):
        print(f"Error: Function '{function_name}' not found in module '{module_path}'.")
        print("Available functions in module:")
        for name in dir(module):
            if not name.startswith('_') and callable(getattr(module, name)):
                print(f"  - {name}")
        return

    func_to_run = getattr(module, function_name)

    print(f"Running function '{function_name}' with args: {function_args}")
    try:
        result = func_to_run(**function_args)
        print("\n--- Function execution finished ---")
        print("Result:", result)
        print("---------------------------------")
    except Exception as e:
        print(f"\n--- Error executing function '{function_name}' ---")
        import traceback
        traceback.print_exc()
        print("-----------------------------------------")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run a function from a Modal script locally by mocking the Modal library.",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog="""
Example usage:
python scripts/run_modal_locally.py modal-apps/sequential_processor.py process_all_events_for_user '{"user_id": "user_12345"}'
"""
    )
    parser.add_argument("module_path", help="The path to the Modal Python script (e.g., modal-apps/sequential_processor.py).")
    parser.add_argument("function_name", help="The name of the function to run from the script.")
    parser.add_argument("function_args_json", help="A JSON string representing a dictionary of arguments for the function (e.g., '{\"user_id\": \"some-user-id\"}').")

    args = parser.parse_args()

    try:
        function_args = json.loads(args.function_args_json)
        if not isinstance(function_args, dict):
            raise ValueError("JSON arguments must be a dictionary (object).")
    except (json.JSONDecodeError, ValueError) as e:
        print(f"Error: Invalid JSON provided for function arguments: {e}")
        sys.exit(1)

    # Set up the mock *before* importing and running the script's function.
    setup_modal_mock()

    run_local(args.module_path, args.function_name, function_args) 