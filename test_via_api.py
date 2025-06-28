#!/usr/bin/env python3
"""
Test the database fix via API endpoints
"""

import requests
import json
import time

def test_sync_api():
    """Test the sync API endpoint"""
    print("🧪 Testing sync API endpoint...")
    
    try:
        # Test production endpoint
        response = requests.post("https://browser-workflow-capture-app.vercel.app/api/sync-processed-counts")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Sync API working: {result}")
            return True
        else:
            print(f"❌ Sync API failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Sync API error: {e}")
        return False

def check_admin_dashboard():
    """Check the admin dashboard for the problematic user"""
    print("🔍 Checking admin dashboard data...")
    
    try:
        # Get session data for our test user
        response = requests.get("https://browser-workflow-capture-app.vercel.app/api/sessions")
        
        if response.status_code == 200:
            data = response.json()
            
            # Check our problematic user
            test_user_id = "942cf301-e977-707d-942c-f301e977707d"
            if test_user_id in data:
                user_data = data[test_user_id]
                print(f"📊 User data: {user_data['name']}")
                
                # Check sessions for inconsistencies
                for session in user_data['sessions']:
                    processed = session['processed_event_count']
                    labeled = session['llm_labeled_steps']
                    
                    if labeled > processed:
                        print(f"❌ Session {session['id']}: {processed} processed, {labeled} labeled (INCONSISTENT)")
                        return False
                    else:
                        print(f"✅ Session {session['id']}: {processed} processed, {labeled} labeled (OK)")
                
                print("✅ All sessions are consistent!")
                return True
            else:
                print(f"❌ Test user {test_user_id} not found")
                return False
                
        else:
            print(f"❌ Dashboard API failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Dashboard check error: {e}")
        return False

def main():
    print("🚀 Testing database fix via API...")
    
    # Test 1: Sync API
    sync_ok = test_sync_api()
    
    # Test 2: Check dashboard consistency
    dashboard_ok = check_admin_dashboard()
    
    if sync_ok and dashboard_ok:
        print("\n🎉 ALL TESTS PASSED: Database fix appears to be working!")
        return True
    else:
        print("\n❌ SOME TESTS FAILED: Database fix may need more work")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1) 