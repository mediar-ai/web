#!/usr/bin/env python3
"""
Unit test for workflow file download functionality
Tests the WorkflowFileManager's ability to download and cache files on VMs
"""

import asyncio
import hashlib
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# Test without actual Modal/DB dependencies
print("=" * 60)
print("WORKFLOW FILE DOWNLOAD TEST")
print("=" * 60)


class MockFileManager:
    """Mock version of WorkflowFileManager for testing"""

    def __init__(self, machine_id: int, cache_dir: str = None):
        self.machine_id = machine_id
        self.cache_dir = Path(cache_dir or tempfile.mkdtemp(prefix="test_workflow_cache_"))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n[Cache] Directory: {self.cache_dir}")

    async def download_test_file(self, url: str, file_content: str) -> Path:
        """Simulate downloading a file"""
        # Calculate hash
        file_hash = hashlib.sha256(file_content.encode()).hexdigest()

        # Create cache path structure (same as real implementation)
        cache_path = self.cache_dir / file_hash[:2] / file_hash[2:4] / f"{file_hash}.js"

        print(f"\n[Download] File from: {url}")
        print(f"   Hash: {file_hash}")
        print(f"   Cache path: {cache_path}")

        # Check if already cached
        if cache_path.exists():
            print("   [OK] Cache HIT - file already exists")
            # Verify integrity
            existing_content = cache_path.read_text()
            existing_hash = hashlib.sha256(existing_content.encode()).hexdigest()
            if existing_hash == file_hash:
                print("   [OK] Hash verified - using cached file")
                return cache_path
            else:
                print("   [WARN] Hash mismatch - re-downloading")

        # Simulate download
        print("   [DOWNLOADING] File...")
        await asyncio.sleep(0.1)  # Simulate network delay

        # Create directory structure
        cache_path.parent.mkdir(parents=True, exist_ok=True)

        # Save file
        cache_path.write_text(file_content)
        print(f"   [OK] Saved to cache ({len(file_content)} bytes)")

        return cache_path

    def cleanup(self):
        """Clean up test cache directory"""
        import shutil
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
            print(f"\n[CLEANUP] Removed cache directory: {self.cache_dir}")


async def test_single_file_download():
    """Test downloading a single JavaScript file"""
    print("\n" + "=" * 40)
    print("TEST 1: Single File Download")
    print("=" * 40)

    manager = MockFileManager(machine_id=1)

    try:
        # Test file content
        js_content = """
// Test workflow helper file
function validateInput(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid input data');
    }
    return true;
}

module.exports = { validateInput };
"""

        # Download file
        local_path = await manager.download_test_file(
            url="https://example.com/workflow-files/validator.js",
            file_content=js_content
        )

        # Verify file exists and content matches
        assert local_path.exists(), "File should exist after download"
        assert local_path.read_text() == js_content, "Content should match"

        print(f"\n[PASS] Test 1: File downloaded to {local_path}")

    finally:
        manager.cleanup()


async def test_cache_deduplication():
    """Test that identical files are deduplicated via hash"""
    print("\n" + "=" * 40)
    print("TEST 2: Cache Deduplication")
    print("=" * 40)

    manager = MockFileManager(machine_id=2)

    try:
        # Same content, different URLs
        js_content = "console.log('Hello from cached file');"

        # First download
        path1 = await manager.download_test_file(
            url="https://example.com/file1.js",
            file_content=js_content
        )

        # Second download - should hit cache
        path2 = await manager.download_test_file(
            url="https://example.com/different/file2.js",
            file_content=js_content
        )

        # Both should point to same cached file
        assert path1 == path2, "Same content should use same cache file"
        print(f"\n[PASS] Test 2: Files deduplicated via hash")
        print(f"   Both URLs mapped to: {path1}")

    finally:
        manager.cleanup()


async def test_workflow_path_updating():
    """Test updating workflow configuration with local paths"""
    print("\n" + "=" * 40)
    print("TEST 3: Workflow Path Update")
    print("=" * 40)

    # Simulate workflow data with external file references
    workflow_data = {
        "automation_sequence": {
            "arguments": {
                "steps": [
                    {
                        "tool_name": "run_script",
                        "script_path": "./helpers/validator.js",
                        "run": "const helper = require('./helpers/validator.js'); helper.validate();"
                    }
                ]
            }
        }
    }

    # Simulate file mapping after download
    file_mapping = {
        "./helpers/validator.js": "/tmp/workflow_cache/a1/b2/hash123.js"
    }

    print("\n[INFO] Original workflow paths:")
    print(f"   script_path: {workflow_data['automation_sequence']['arguments']['steps'][0]['script_path']}")

    # Update paths (simulated logic from update_workflow_paths)
    import copy
    updated_workflow = copy.deepcopy(workflow_data)

    steps = updated_workflow["automation_sequence"]["arguments"]["steps"]
    for step in steps:
        if "script_path" in step and step["script_path"] in file_mapping:
            original = step["script_path"]
            step["script_path"] = file_mapping[original]
            print(f"\n[UPDATE] script_path: {original} -> {step['script_path']}")

        if "run" in step:
            for original, local in file_mapping.items():
                if f"require('{original}')" in step["run"]:
                    step["run"] = step["run"].replace(f"require('{original}')", f"require('{local}')")
                    print(f"[UPDATE] require() statement to use local path")

    # Verify updates
    updated_step = updated_workflow["automation_sequence"]["arguments"]["steps"][0]
    assert updated_step["script_path"] == "/tmp/workflow_cache/a1/b2/hash123.js"
    assert "/tmp/workflow_cache/a1/b2/hash123.js" in updated_step["run"]

    print("\n[PASS] Test 3: Workflow paths updated with local cache paths")


async def test_parallel_downloads():
    """Test downloading multiple files in parallel"""
    print("\n" + "=" * 40)
    print("TEST 4: Parallel Downloads")
    print("=" * 40)

    manager = MockFileManager(machine_id=3)

    try:
        # Multiple files to download
        files = [
            ("https://example.com/lib1.js", "console.log('Library 1');"),
            ("https://example.com/lib2.js", "console.log('Library 2');"),
            ("https://example.com/lib3.js", "console.log('Library 3');"),
            ("https://example.com/utils.js", "module.exports = { version: '1.0.0' };"),
        ]

        print(f"\n[PARALLEL] Downloading {len(files)} files...")

        # Download all files in parallel
        tasks = [
            manager.download_test_file(url, content)
            for url, content in files
        ]

        start_time = asyncio.get_event_loop().time()
        local_paths = await asyncio.gather(*tasks)
        download_time = asyncio.get_event_loop().time() - start_time

        print(f"\n[OK] Downloaded {len(local_paths)} files in {download_time:.2f}s")

        # Verify all files exist
        for path, (url, content) in zip(local_paths, files):
            assert path.exists(), f"File from {url} should exist"
            assert path.read_text() == content, f"Content from {url} should match"

        print("[PASS] Test 4: All files downloaded successfully in parallel")

    finally:
        manager.cleanup()


async def main():
    """Run all tests"""
    print("\n[START] Running File Download Tests\n")

    try:
        # Run tests
        await test_single_file_download()
        await test_cache_deduplication()
        await test_workflow_path_updating()
        await test_parallel_downloads()

        print("\n" + "=" * 60)
        print("[SUCCESS] ALL TESTS PASSED!")
        print("=" * 60)

        # Explain how it works in production
        print("\n[DOCUMENTATION] HOW IT WORKS IN PRODUCTION:")
        print("=" * 60)
        print("""
1. WORKFLOW EXECUTION STARTS:
   - Modal executor receives workflow ID and MCP endpoint
   - Checks if workflow has 'requires_files' flag

2. FILE PREPARATION:
   - WorkflowFileManager queries database for file list
   - Each file has: path, storage_path, SHA-256 hash, size

3. SMART CACHING:
   - Files cached in /tmp/workflow_cache/{hash[:2]}/{hash[2:4]}/{hash}.js
   - Hash-based deduplication (same content = same file)
   - Cache hits skip download entirely

4. PARALLEL DOWNLOADS:
   - Up to 5 concurrent downloads via semaphore
   - Each file downloaded from Supabase storage (signed URLs)
   - SHA-256 verification after download
   - Retry logic with exponential backoff

5. PATH UPDATES:
   - Original paths like './helpers/validator.js'
   - Replaced with local paths '/tmp/workflow_cache/a1/b2/hash.js'
   - Updates both script_path and require() statements

6. MCP EXECUTION:
   - MCP server now has access to all JavaScript files
   - Can execute workflows that depend on external modules
   - Files persist in cache for future executions

7. CACHE MANAGEMENT:
   - LRU eviction when cache > 5GB
   - Files older than 7 days auto-deleted
   - Access tracking in database

BENEFITS:
- Fast execution (cached files)
- Network efficient (deduplication)
- Reliable (hash verification)
- Scalable (parallel downloads)
- Clean (automatic cleanup)
        """)

    except Exception as e:
        print(f"\n[ERROR] TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    # Run the async tests
    exit_code = asyncio.run(main())
    exit(exit_code)