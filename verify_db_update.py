import json

def compare_json_files(file1_path, file2_path):
    """
    Loads two JSON files, and prints whether they are identical or not.
    """
    try:
        with open(file1_path, 'r') as f1:
            data1 = json.load(f1)
        
        with open(file2_path, 'r') as f2:
            # The data from psql is a raw string, which needs to be parsed as JSON
            raw_content = f2.read().strip()
            data2 = json.loads(raw_content)

        if data1 == data2:
            print("✅ SUCCESS: The database content now programmatically matches the original file.")
        else:
            print("❌ FAILURE: The database content does not match the original file.")

    except FileNotFoundError as e:
        print(f"Error: Could not find file - {e.filename}")
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    compare_json_files("sequences/quoting_070325.json", "db_workflow_data.json") 