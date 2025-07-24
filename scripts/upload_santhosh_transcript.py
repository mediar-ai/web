#!/usr/bin/env python3
"""
Upload Santhosh transcript to the database using the raw transcript API
"""
import os
import sys
import requests
import json
from datetime import datetime

# Configuration
API_BASE_URL = "http://localhost:3000"  # Will try 3000 first, then 3003
TRANSCRIPT_FILE = "transcripts/santhosh072225"
SESSION_ID = "santhosh072225_session"
USER_ID = "4d6b2fe0-5f24-3720-4d6b-2fe05f243720"
STARTING_TIMESTAMP = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.000Z")  # Use current timestamp

def get_api_key():
    """Get the INTERNAL_API_KEY from environment"""
    api_key = os.getenv('INTERNAL_API_KEY')
    if not api_key:
        print("❌ INTERNAL_API_KEY environment variable not set")
        print("Please run: export INTERNAL_API_KEY=your_key")
        sys.exit(1)
    return api_key

def find_server_port():
    """Find which port the dev server is running on"""
    ports_to_try = [3000, 3003, 3001]
    
    for port in ports_to_try:
        try:
            url = f"http://localhost:{port}/api/transcripts"
            response = requests.post(url, 
                json={"test": "ping"}, 
                headers={"Authorization": "Bearer invalid"},
                timeout=2
            )
            if response.status_code in [400, 401]:  # Server responds, even if unauthorized
                print(f"✅ Found dev server on port {port}")
                return port
        except requests.exceptions.RequestException:
            continue
    
    print("❌ Could not find running dev server on any port")
    sys.exit(1)

def read_transcript_file():
    """Read the raw transcript content"""
    if not os.path.exists(TRANSCRIPT_FILE):
        print(f"❌ Transcript file not found: {TRANSCRIPT_FILE}")
        sys.exit(1)
    
    with open(TRANSCRIPT_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    
    print(f"📄 Read transcript file: {len(content)} characters")
    return content

def upload_transcript(api_key, port, raw_content):
    """Upload the transcript using the raw format API"""
    url = f"http://localhost:{port}/api/transcripts"
    
    payload = {
        "session_id": SESSION_ID,
        "user_id": USER_ID,
        "starting_timestamp": STARTING_TIMESTAMP,
        "raw_content": raw_content
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    print(f"📤 Uploading transcript to {url}")
    print(f"📋 Session: {SESSION_ID}")
    print(f"👤 User: {USER_ID}")
    print(f"⏰ Start time: {STARTING_TIMESTAMP}")
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 201:
            result = response.json()
            print(f"✅ SUCCESS: Transcript uploaded successfully!")
            print(f"📊 Parsed {result.get('parsed_messages', 'unknown')} messages")
            return True
        else:
            print(f"❌ FAILED: {response.status_code}")
            try:
                error_detail = response.json()
                print(f"Error: {error_detail}")
            except:
                print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        return False

def main():
    print("🚀 Starting Santhosh transcript upload...")
    
    # Get API key
    api_key = get_api_key()
    print(f"🔑 API key loaded: {api_key[:10]}...")
    
    # Find server port
    port = find_server_port()
    
    # Read transcript
    raw_content = read_transcript_file()
    
    # Upload transcript
    success = upload_transcript(api_key, port, raw_content)
    
    if success:
        print("\n🎉 Transcript upload completed successfully!")
        print(f"🔍 You can now use this transcript in workflow synthesis for user {USER_ID}")
    else:
        print("\n💥 Upload failed!")
        sys.exit(1)

if __name__ == "__main__":
    main() 