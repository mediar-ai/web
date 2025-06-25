import modal

def main():
    # Find the deployed function by its app name and function name
    print("Looking up deployed function 'trigger_full_parallel_processing'...")
    trigger_func = modal.Function.from_name("sequential-processor", "trigger_full_parallel_processing")

    print("Triggering a new processing run...")
    trigger_func.remote()
    print("New run successfully triggered.")

if __name__ == "__main__":
    main() 