#!/usr/bin/env python3

import modal
import sys

def main():
    # Connect to the sync-processor app
    app = modal.App.lookup("sync-processor", create_if_missing=False)
    
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        print("🧪 Running test sync (10 iterations)...")
        # Run the test function
        with app.run():
            result = app.test_sync.remote()
            print("✅ Test sync completed")
    else:
        print("🚀 Starting continuous sync processor...")
        print("⚠️  This will run indefinitely until manually stopped")
        print("   Use Ctrl+C to stop or check Modal dashboard")
        
        # Start the continuous processor
        with app.run():
            result = app.continuous_sync_processor.remote()
            print("✅ Continuous sync processor started")

if __name__ == "__main__":
    main() 