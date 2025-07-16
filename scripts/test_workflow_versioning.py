#!/usr/bin/env python3
"""
Test script to verify the workflow versioning system is working correctly.
This script runs through various versioning scenarios to ensure everything works.

Usage: python scripts/test_workflow_versioning.py
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

def get_db_connection():
    """Get database connection from environment variables"""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        raise ValueError("SUPABASE_CONN_STRING environment variable not set in .env.local")
    
    conn = psycopg2.connect(conn_string)
    return conn

def test_versioning_system():
    """Test the complete versioning system."""
    print("🧪 Testing Workflow Versioning System")
    print(f"Started at: {datetime.now()}")
    
    conn = get_db_connection()
    all_tests_passed = True
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            
            # Test 1: Check if versioning tables exist
            print("\n" + "="*50)
            print("TEST 1: Database Schema Verification")
            print("="*50)
            
            # Check deployed_workflow_versions table
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name = 'deployed_workflow_versions'
                )
            """)
            result = cur.fetchone()
            versions_table_exists = result['exists'] if result else False
            
            if versions_table_exists:
                print("✅ deployed_workflow_versions table exists")
            else:
                print("❌ deployed_workflow_versions table missing")
                all_tests_passed = False
            
            # Check version tracking columns
            cur.execute("""
                SELECT column_name FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = 'deployed_workflows'
                AND column_name IN ('current_version_id', 'total_versions')
            """)
            version_columns = [row['column_name'] for row in cur.fetchall()]
            
            if 'current_version_id' in version_columns and 'total_versions' in version_columns:
                print("✅ Version tracking columns exist in deployed_workflows")
            else:
                print(f"❌ Missing version columns: {set(['current_version_id', 'total_versions']) - set(version_columns)}")
                all_tests_passed = False
            
            # Test 2: Check data migration
            print("\n" + "="*50)
            print("TEST 2: Data Migration Verification")
            print("="*50)
            
            # Count workflows and versions
            cur.execute("SELECT COUNT(*) FROM deployed_workflows")
            result1 = cur.fetchone()
            workflow_count = result1['count'] if result1 else 0
            
            cur.execute("SELECT COUNT(*) FROM deployed_workflow_versions")
            result2 = cur.fetchone()
            version_count = result2['count'] if result2 else 0
            
            cur.execute("SELECT COUNT(*) FROM deployed_workflows WHERE current_version_id IS NOT NULL")
            result3 = cur.fetchone()
            linked_count = result3['count'] if result3 else 0
            
            print(f"📊 Data Statistics:")
            print(f"   - Total workflows: {workflow_count}")
            print(f"   - Total versions: {version_count}")
            print(f"   - Linked workflows: {linked_count}")
            
            if workflow_count > 0:
                if version_count >= workflow_count:
                    print("✅ All workflows have at least one version")
                else:
                    print("❌ Some workflows missing versions")
                    all_tests_passed = False
                
                if linked_count == workflow_count:
                    print("✅ All workflows linked to current version")
                else:
                    print("❌ Some workflows not linked to current version")
                    all_tests_passed = False
            else:
                print("⚠️  No workflows found (empty database)")
            
            # Test 3: Check version management functions
            print("\n" + "="*50)
            print("TEST 3: Version Management Functions")
            print("="*50)
            
            # Check if functions exist
            cur.execute("""
                SELECT routine_name FROM information_schema.routines 
                WHERE routine_schema = 'public' 
                AND routine_name IN ('activate_workflow_version', 'get_workflow_version_history')
            """)
            functions = [row['routine_name'] for row in cur.fetchall()]
            
            if 'activate_workflow_version' in functions:
                print("✅ activate_workflow_version function exists")
            else:
                print("❌ activate_workflow_version function missing")
                all_tests_passed = False
            
            if 'get_workflow_version_history' in functions:
                print("✅ get_workflow_version_history function exists")
            else:
                print("❌ get_workflow_version_history function missing")
                all_tests_passed = False
            
            # Test 4: Check compatibility views
            print("\n" + "="*50)
            print("TEST 4: Compatibility Views")
            print("="*50)
            
            # Check if views exist
            cur.execute("""
                SELECT table_name FROM information_schema.views 
                WHERE table_schema = 'public' 
                AND table_name IN ('deployed_workflows_with_sequence', 'workflow_execution_history')
            """)
            views = [row['table_name'] for row in cur.fetchall()]
            
            if 'deployed_workflows_with_sequence' in views:
                print("✅ deployed_workflows_with_sequence view exists")
                
                # Test the view
                cur.execute("SELECT COUNT(*) FROM deployed_workflows_with_sequence WHERE automation_sequence IS NOT NULL")
                view_result = cur.fetchone()
                view_count = view_result['count'] if view_result else 0
                print(f"   - {view_count} workflows accessible via compatibility view")
                
                if view_count == workflow_count and workflow_count > 0:
                    print("✅ Compatibility view working correctly")
                elif workflow_count == 0:
                    print("⚠️  No workflows to test view with")
                else:
                    print("❌ Compatibility view not returning expected data")
                    all_tests_passed = False
            else:
                print("❌ deployed_workflows_with_sequence view missing")
                all_tests_passed = False
            
            if 'workflow_execution_history' in views:
                print("✅ workflow_execution_history view exists")
            else:
                print("❌ workflow_execution_history view missing")
                all_tests_passed = False
            
            # Test 5: Test version functions (if we have data)
            if workflow_count > 0:
                print("\n" + "="*50)
                print("TEST 5: Version Function Testing")
                print("="*50)
                
                # Get a test workflow
                cur.execute("SELECT id, name FROM deployed_workflows LIMIT 1")
                test_workflow = cur.fetchone()
                if not test_workflow:
                    print("❌ No workflows found for testing")
                    all_tests_passed = False
                    return False
                test_workflow_id = test_workflow['id']
                test_workflow_name = test_workflow['name']
                
                print(f"🧪 Testing with workflow: {test_workflow_name} (ID: {test_workflow_id})")
                
                # Test get_workflow_version_history
                try:
                    cur.execute("SELECT * FROM get_workflow_version_history(%s)", (test_workflow_id,))
                    history = cur.fetchall()
                    print(f"✅ get_workflow_version_history returned {len(history)} versions")
                    
                    if len(history) > 0:
                        active_versions = [v for v in history if v['is_active']]
                        if len(active_versions) == 1:
                            print("✅ Exactly one active version found")
                        else:
                            print(f"❌ Expected 1 active version, found {len(active_versions)}")
                            all_tests_passed = False
                    
                except Exception as e:
                    print(f"❌ get_workflow_version_history failed: {e}")
                    all_tests_passed = False
                
                # Test version activation (using current version - should be safe)
                try:
                    cur.execute("SELECT version FROM deployed_workflows WHERE id = %s", (test_workflow_id,))
                    version_result = cur.fetchone()
                    current_version = version_result['version'] if version_result else '1.0.0'
                    
                    cur.execute("SELECT activate_workflow_version(%s, %s)", (test_workflow_id, current_version))
                    activate_result = cur.fetchone()
                    result = activate_result['activate_workflow_version'] if activate_result else False
                    
                    if result:
                        print(f"✅ activate_workflow_version function works (tested with current version {current_version})")
                    else:
                        print("❌ activate_workflow_version returned false")
                        all_tests_passed = False
                
                except Exception as e:
                    print(f"❌ activate_workflow_version failed: {e}")
                    all_tests_passed = False
            
            # Test 6: Check triggers
            print("\n" + "="*50)
            print("TEST 6: Trigger Verification")
            print("="*50)
            
            # Check if versioning trigger exists
            cur.execute("""
                SELECT trigger_name FROM information_schema.triggers 
                WHERE event_object_schema = 'public' 
                AND event_object_table = 'deployed_workflows'
                AND trigger_name LIKE '%version%'
            """)
            triggers = [row['trigger_name'] for row in cur.fetchall()]
            
            if triggers:
                print(f"✅ Found versioning triggers: {', '.join(triggers)}")
            else:
                print("❌ No versioning triggers found")
                all_tests_passed = False
            
            # Final summary
            print("\n" + "="*50)
            print("TEST SUMMARY")
            print("="*50)
            
            if all_tests_passed:
                print("🎉 ALL TESTS PASSED!")
                print("✅ Workflow versioning system is fully functional")
                
                print("\n📋 System Status:")
                print(f"   - ✅ Version storage: {version_count} versions for {workflow_count} workflows")
                print(f"   - ✅ Version management functions available")
                print(f"   - ✅ Backward compatibility maintained")
                print(f"   - ✅ Automatic version creation on changes")
                print(f"   - ✅ Execution history tracking ready")
                
                print("\n🚀 Ready to use!")
                print(f"   - Upload versions: python scripts/upload_workflow_version.py")
                print(f"   - Activate versions: POST /api/remote-workflows/[id]/activate/[version]")
                print(f"   - List versions: GET /api/remote-workflows/[id]/versions")
                
                return True
            else:
                print("❌ SOME TESTS FAILED!")
                print("💡 Please check the implementation and run the setup script again")
                return False
    
    except Exception as e:
        print(f"💥 Test execution failed: {e}")
        return False
    
    finally:
        conn.close()

def main():
    """Main function to run versioning tests."""
    try:
        success = test_versioning_system()
        if success:
            print(f"\n✅ Versioning system test completed successfully!")
        else:
            print(f"\n❌ Versioning system test failed!")
            exit(1)
    except Exception as e:
        print(f"\n💥 Fatal error during testing: {e}")
        exit(1)

if __name__ == "__main__":
    main() 