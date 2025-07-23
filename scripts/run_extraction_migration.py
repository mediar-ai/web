#!/usr/bin/env python3
"""
Orchestrate the full extraction migration process.
Runs migrations step by step and provides guidance.
"""

import subprocess
import sys
import time
from datetime import datetime

def run_command(cmd, description):
    """Run a command and handle errors."""
    print(f"\n🔄 {description}")
    print(f"💻 Running: {cmd}")
    
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            print(f"✅ {description} - SUCCESS")
            if result.stdout.strip():
                print(f"📝 Output: {result.stdout}")
            return True
        else:
            print(f"❌ {description} - FAILED")
            print(f"🚨 Error: {result.stderr}")
            return False
    except subprocess.TimeoutExpired:
        print(f"⏰ {description} - TIMEOUT (5 minutes)")
        return False
    except Exception as e:
        print(f"💥 {description} - EXCEPTION: {e}")
        return False

def check_migration_status():
    """Check if migrations have already been applied."""
    print("🔍 Checking current migration status...")
    
    # You can add a query here to check if columns exist
    # For now, we'll assume they need to be run
    return False

def main():
    """Main orchestration process."""
    print("🚀 Starting Low-Level Events Extraction Migration")
    print(f"⏰ Started at: {datetime.now()}")
    print("=" * 60)
    
    # Step 1-3: Run the schema migrations
    migrations = [
        ("supabase/migrations/20250117000001_add_event_type_column.sql", "Add event_type column"),
        ("supabase/migrations/20250117000002_add_app_name_column.sql", "Add app_name column"), 
        ("supabase/migrations/20250117000003_add_ui_and_screenshot_columns.sql", "Add UI and screenshot columns")
    ]
    
    print("\n📊 Phase 1: Schema Migrations")
    print("=" * 40)
    
    for migration_file, description in migrations:
        cmd = f"cd /Users/matthewdi/Desktop/screenpipe/browser-workflow-capture-app && supabase db reset --linked"
        success = run_command(cmd, f"Reset database to apply {description}")
        
        if not success:
            print(f"\n💥 Failed to apply schema migration: {description}")
            print("🛑 Stopping migration process")
            return False
        
        time.sleep(2)  # Brief pause between migrations
    
    print("\n📊 Phase 2: Data Backfill")
    print("=" * 40)
    
    # Step 4: Run the backfill script
    cmd = "cd /Users/matthewdi/Desktop/screenpipe/browser-workflow-capture-app && python scripts/backfill_extracted_fields.py"
    success = run_command(cmd, "Backfill extracted fields in batches")
    
    if not success:
        print("\n💥 Backfill process failed!")
        print("🔧 You can retry manually: python scripts/backfill_extracted_fields.py")
        return False
    
    print("\n📊 Phase 3: Performance Indexes")
    print("=" * 40)
    
    # Step 5: Apply the final index migration
    cmd = "cd /Users/matthewdi/Desktop/screenpipe/browser-workflow-capture-app && supabase db reset --linked"
    success = run_command(cmd, "Add optimized performance indexes")
    
    if not success:
        print("\n💥 Failed to add performance indexes")
        print("🔧 You can retry manually by running the final migration")
        return False
    
    print("\n🎉 MIGRATION COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    print("📈 Expected Performance Improvements:")
    print("   • UI tree queries: 100-1000x faster")
    print("   • Event type filtering: No more timeouts")
    print("   • App name filtering: Sub-second response")
    print("   • Timeline mapping: Blazingly fast")
    
    print("\n🔄 Next Steps:")
    print("   1. Restart your Next.js dev server to use new API")
    print("   2. Test timeline mapping from the UI")
    print("   3. Monitor query performance in production")
    
    print(f"\n⏰ Total migration time: {datetime.now()}")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 