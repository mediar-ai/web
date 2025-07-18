import os
import json
import psycopg2
from psycopg2.extras import Json
from dotenv import load_dotenv

load_dotenv()

def fix_workflow_json_in_db_correctly():
    """
    Reads the correctly formatted workflow from a JSON file and updates the
    automation_sequence in the database, ensuring it is stored as a
    proper JSONB object by passing the Python object directly to the driver.
    """
    try:
        conn_string = os.environ.get("SUPABASE_CONN_STRING")
        if not conn_string:
            print("Error: SUPABASE_CONN_STRING environment variable not set.")
            return

        with psycopg2.connect(conn_string) as conn:
            with conn.cursor() as cur:
                # Read the correctly structured workflow data from the file
                file_path = "sequences/quoting_070325.json"
                with open(file_path, 'r') as f:
                    correct_sequence_object = json.load(f)

                # The ID of the workflow to update
                workflow_id = 1

                # Update the automation_sequence field. By passing the Python
                # object directly, wrapped in psycopg2.extras.Json, we ensure
                # it is correctly serialized for the JSONB column.
                cur.execute(
                    "UPDATE deployed_workflows SET automation_sequence = %s WHERE id = %s",
                    (Json(correct_sequence_object), workflow_id)
                )
                conn.commit()
                print(f"Successfully fixed and updated automation_sequence for workflow_id: {workflow_id}")

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    fix_workflow_json_in_db_correctly() 