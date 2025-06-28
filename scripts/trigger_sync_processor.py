#!/usr/bin/env python3
"""
Script to trigger Modal sync processor functions
"""

import modal
import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/trigger_sync_processor.py <function_name>")
        print("Available functions:")
        print("  - continuous_sync_processor  (starts continuous 2-second sync)")
        print("  - backup_sync               (runs backup sync once)")
        print("  - test_sync                 (runs test sync with production URL)")
        return

    function_name = sys.argv[1]
    
    try:
        # Get the deployed app
        app = modal.App.lookup("sync-processor", create_if_missing=False)
        
        if function_name == "continuous_sync_processor":
            print("🚀 Starting continuous sync processor (runs indefinitely every 2 seconds)...")
            func = app.continuous_sync_processor
            result = func.remote()
            print(f"✅ Continuous sync processor started: {result}")
            
        elif function_name == "backup_sync":
            print("🔄 Running backup sync once...")
            func = app.backup_sync
            result = func.remote()
            print(f"✅ Backup sync completed: {result}")
            
        elif function_name == "test_sync":
            print("🧪 Running test sync (10 iterations with production URL)...")
            func = app.test_sync
            result = func.remote()
            print(f"✅ Test sync completed: {result}")
            
        else:
            print(f"❌ Unknown function: {function_name}")
            print("Available functions: continuous_sync_processor, backup_sync, test_sync")
            
    except Exception as e:
        print(f"❌ Error triggering function: {e}")
        print("Make sure the sync-processor app is deployed to Modal")

if __name__ == "__main__":
    main() 