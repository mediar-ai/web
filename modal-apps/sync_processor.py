import modal
import asyncio
import aiohttp
import os
from datetime import datetime

# Create Modal app
app = modal.App("sync-processor")

# Define the image with required dependencies
image = modal.Image.debian_slim().pip_install([
    "aiohttp",
])

@app.function(
    image=image,
    timeout=86400,  # 24 hours
    keep_warm=1,    # Keep one instance warm
    allow_concurrent_inputs=1,
)
async def continuous_sync_processor():
    """
    Run continuous sync every 2 seconds - this is the main function that should be kept running
    """
    print("🚀 Starting continuous sync processor (every 2 seconds)...")
    
    base_url = "https://browser-workflow-capture-app.vercel.app"
    endpoint = f"{base_url}/api/sync-processed-counts"
    
    iteration = 0
    
    async with aiohttp.ClientSession() as session:
        while True:  # Run indefinitely
            try:
                iteration += 1
                print(f"🔄 [{datetime.now().isoformat()}] Sync iteration {iteration}")
                
                async with session.post(endpoint, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        result = await response.json()
                        print(f"✅ Sync successful: {result.get('message', 'OK')}")
                    else:
                        error_text = await response.text()
                        print(f"❌ Sync failed with status {response.status}: {error_text}")
                        
                # Wait 2 seconds before next iteration
                await asyncio.sleep(2)
                
            except asyncio.TimeoutError:
                print(f"⏰ Sync timed out")
                await asyncio.sleep(2)  # Still wait before retry
            except Exception as e:
                print(f"💥 Sync error: {str(e)}")
                await asyncio.sleep(5)  # Wait longer on errors
                
            # Log progress every 100 iterations (200 seconds)
            if iteration % 100 == 0:
                print(f"📊 Completed {iteration} sync iterations ({iteration * 2} seconds of runtime)")

@app.function(
    image=image,
    schedule=modal.Cron("*/5 * * * *"),  # Every 5 minutes as backup
    timeout=30,
    retries=3
)
async def backup_sync():
    """
    Backup sync that runs every 5 minutes in case the continuous processor goes down
    """
    try:
        base_url = "https://browser-workflow-capture-app.vercel.app"
        endpoint = f"{base_url}/api/sync-processed-counts"
        
        print(f"🔄 [{datetime.now().isoformat()}] Backup sync running...")
        
        async with aiohttp.ClientSession() as session:
            async with session.post(endpoint, timeout=aiohttp.ClientTimeout(total=25)) as response:
                if response.status == 200:
                    result = await response.json()
                    print(f"✅ [{datetime.now().isoformat()}] Backup sync successful: {result.get('message', 'OK')}")
                else:
                    error_text = await response.text()
                    print(f"❌ [{datetime.now().isoformat()}] Backup sync failed with status {response.status}: {error_text}")
                    
    except asyncio.TimeoutError:
        print(f"⏰ [{datetime.now().isoformat()}] Backup sync timed out after 25 seconds")
    except Exception as e:
        print(f"💥 [{datetime.now().isoformat()}] Backup sync error: {str(e)}")

@app.function(
    image=image,
    timeout=300  # 5 minutes
)
async def test_sync():
    """
    Test function to run a few sync iterations for testing
    """
    print("🧪 Starting test sync process (10 iterations)...")
    
    # Use localhost for testing, production for real runs
    base_url = "http://localhost:3001"  # Use local dev server for testing
    endpoint = f"{base_url}/api/sync-processed-counts"
    
    async with aiohttp.ClientSession() as session:
        for i in range(10):
            try:
                print(f"🔄 [{datetime.now().isoformat()}] Test sync iteration {i+1}/10")
                
                async with session.post(endpoint, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        result = await response.json()
                        print(f"✅ Test sync successful: {result.get('message', 'OK')}")
                    else:
                        error_text = await response.text()
                        print(f"❌ Test sync failed with status {response.status}: {error_text}")
                        
                if i < 9:  # Don't wait after the last iteration
                    await asyncio.sleep(2)
                
            except Exception as e:
                print(f"💥 Test sync error: {str(e)}")
    
    print(f"🏁 Test sync completed")

def test_sync_local():
    """
    Synchronous wrapper for local testing - tests the sync endpoint once
    """
    import requests
    
    print("🧪 Testing sync endpoint locally...")
    
    # Use localhost for testing
    base_url = "http://localhost:3001"  
    endpoint = f"{base_url}/api/sync-processed-counts"
    
    try:
        print(f"🔄 [{datetime.now().isoformat()}] Making sync request to {endpoint}")
        
        response = requests.post(endpoint, timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Local sync test successful: {result.get('message', 'OK')}")
            return True
        else:
            print(f"❌ Local sync test failed with status {response.status_code}: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection error - make sure local dev server is running on port 3001")
        return False
    except Exception as e:
        print(f"💥 Local sync test error: {str(e)}")
        return False

if __name__ == "__main__":
    # For local testing
    import asyncio
    
    async def local_test():
        print("Testing sync locally...")
        await test_sync.local()
    
    asyncio.run(local_test()) 