#!/usr/bin/env python3

import psycopg2
from datetime import datetime

def cleanup_synthesis_redundancy():
    """
    Clean up synthesis status redundancy and clarify the two-system approach:
    1. Keep synthesis_status in low_level_workflows (for timeline mapping logic)
    2. Use saved_workflow_syntheses for comprehensive saved synthesis display
    3. Remove redundant columns from low_level_workflows that are better stored in the new table
    """
    
    # Database connection
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    try:
        print("🧹 Starting synthesis redundancy cleanup...")
        
        # Check current state
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'low_level_workflows' 
            AND column_name IN ('synthesis_status', 'saved_at', 'saved_by_user_id');
        """)
        
        existing_columns = [row[0] for row in cursor.fetchall()]
        print(f"📋 Found synthesis-related columns in low_level_workflows: {existing_columns}")
        
        # Check saved_workflow_syntheses table
        cursor.execute("""
            SELECT COUNT(*) FROM saved_workflow_syntheses;
        """)
        
        saved_syntheses_count = cursor.fetchone()[0]
        print(f"💾 Found {saved_syntheses_count} records in saved_workflow_syntheses table")
        
        # Decision: Keep both systems but clarify their purposes
        print("\n🎯 SYSTEM CLARIFICATION:")
        print("✅ KEEPING: synthesis_status in low_level_workflows")
        print("   Purpose: Timeline mapping logic (only map to 'draft' workflows)")
        print("   Values: 'draft' (for active work), 'saved' (for completed work)")
        print()
        print("✅ KEEPING: saved_workflow_syntheses table") 
        print("   Purpose: Comprehensive synthesis storage (steps 1-5)")
        print("   Contains: Full process data, context, boundaries, conversations")
        print()
        print("🗑️  REMOVING: Redundant metadata columns from low_level_workflows")
        print("   Reason: This data is better stored in saved_workflow_syntheses")
        
        # Remove redundant columns that are better in the new table
        redundant_columns_to_remove = []
        
        if 'saved_at' in existing_columns:
            redundant_columns_to_remove.append('saved_at')
            
        if 'saved_by_user_id' in existing_columns:
            redundant_columns_to_remove.append('saved_by_user_id')
        
        if redundant_columns_to_remove:
            print(f"\n⚡ Removing redundant columns: {redundant_columns_to_remove}")
            
            for column in redundant_columns_to_remove:
                cursor.execute(f"""
                    ALTER TABLE low_level_workflows 
                    DROP COLUMN IF EXISTS {column};
                """)
                print(f"   ✅ Removed {column}")
        
        # Commit changes
        conn.commit()
        
        print(f"\n🎉 Synthesis redundancy cleanup completed at {datetime.now()}")
        print("\n📝 FINAL ARCHITECTURE:")
        print("1. 🎯 low_level_workflows.synthesis_status: Controls timeline mapping")
        print("2. 💾 saved_workflow_syntheses: Stores complete synthesis process data")
        print("3. 🧹 Removed redundant metadata columns")
        
        # Verify final state
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'low_level_workflows' 
            AND column_name LIKE '%synthesis%' OR column_name LIKE '%saved%';
        """)
        
        remaining_columns = [row[0] for row in cursor.fetchall()]
        print(f"\n📋 Remaining synthesis columns in low_level_workflows: {remaining_columns}")
        
    except Exception as e:
        print(f"❌ Error during cleanup: {e}")
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    cleanup_synthesis_redundancy() 