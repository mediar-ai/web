import modal
from modal import exception
import argparse
import sys

def trigger_deployment_function(app_name: str, function_name: str):
    """
    Looks up a deployed Modal function by its app and function name and triggers it
    using a non-blocking spawn call.
    """
    try:
        print(f"Looking up deployed function '{app_name}::{function_name}'...")
        f = modal.Function.from_name(app_name, function_name)
        print("Spawning remote function on the deployment (fire-and-forget)...")
        f.spawn()
        print(f"✅ Successfully submitted function '{function_name}' to app '{app_name}'.")
    except exception.NotFoundError:
        print(f"❌ Error: Could not find the deployed app '{app_name}' or function '{function_name}'.")
        sys.exit(1)
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trigger a Modal function on a deployed app.")
    parser.add_argument("app_name", type=str, help="The name of the deployed Modal app (e.g., 'labeling-data-processor').")
    parser.add_argument("function_name", type=str, help="The name of the function to trigger (e.g., 'trigger_labeling_for_all_users').")

    args = parser.parse_args()
    
    trigger_deployment_function(args.app_name, args.function_name) 