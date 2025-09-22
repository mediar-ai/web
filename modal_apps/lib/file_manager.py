"""
File Manager for Workflow Execution
Handles downloading, caching, and cleanup of workflow files on execution machines
"""

import asyncio
import hashlib
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import aiohttp
import psycopg2
from psycopg2.extras import RealDictCursor

from .db import get_database_connection, get_db_config

logger = logging.getLogger(__name__)


class WorkflowFileManager:
    """Manages file downloads and caching for workflow execution"""

    def __init__(self, machine_id: int, cache_dir: str = "/tmp/workflow_cache"):
        self.machine_id = machine_id
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.file_locks = {}  # Prevent duplicate concurrent downloads
        self.session = None  # Reusable aiohttp session

    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()

    async def prepare_workflow_files(
        self, workflow_id: int, version: str, timeout: float = 30.0
    ) -> Dict[str, str]:
        """
        Download and cache all files required for a workflow

        Args:
            workflow_id: ID of the workflow
            version: Version string of the workflow
            timeout: Maximum time to wait for all downloads

        Returns:
            Dictionary mapping original file paths to local cached paths
        """
        try:
            # Get file list from database
            files = await self.get_workflow_files(workflow_id, version)

            if not files:
                logger.info(f"No external files for workflow {workflow_id} v{version}")
                return {}

            logger.info(f" Preparing {len(files)} files for workflow {workflow_id}")

            # Create semaphore for parallel downloads (max 5 concurrent)
            semaphore = asyncio.Semaphore(5)

            # Download files in parallel
            tasks = []
            for file_info in files:
                task = self.download_with_cache(file_info, semaphore)
                tasks.append(task)

            # Wait for all downloads with timeout
            start_time = time.time()
            local_paths = await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
            download_time = time.time() - start_time

            # Create mapping
            file_mapping = {}
            for file_info, local_path in zip(files, local_paths):
                if local_path:
                    file_mapping[file_info["file_path"]] = str(local_path)

            logger.info(
                f" Files ready in {download_time:.2f}s "
                f"({len(file_mapping)}/{len(files)} files cached)"
            )

            return file_mapping

        except asyncio.TimeoutError:
            logger.error(f"File download timeout after {timeout}s")
            raise Exception("File download timeout - files too large or network issue")
        except Exception as e:
            logger.error(f"Error preparing workflow files: {e}")
            raise

    async def download_with_cache(
        self, file_info: dict, semaphore: asyncio.Semaphore
    ) -> Optional[Path]:
        """
        Download a file with caching and deduplication

        Args:
            file_info: File metadata from database
            semaphore: Semaphore for concurrent download limiting

        Returns:
            Path to the cached file, or None if download failed
        """
        file_hash = file_info["file_hash"]
        file_path = file_info["file_path"]

        # Build cache path based on hash (distributed directory structure)
        cache_path = (
            self.cache_dir / file_hash[:2] / file_hash[2:4] / f"{file_hash}.js"
        )

        try:
            # Check if file exists in cache
            if cache_path.exists():
                # Verify file integrity
                if self._verify_file_hash(cache_path, file_hash):
                    logger.debug(f" Cache hit for {file_path}")
                    await self.update_cache_access(file_hash)
                    return cache_path
                else:
                    logger.warning(f"Cache corrupted for {file_path}, re-downloading")
                    cache_path.unlink()

            # Acquire or create lock for this file hash
            if file_hash not in self.file_locks:
                self.file_locks[file_hash] = asyncio.Lock()

            async with self.file_locks[file_hash]:
                # Double-check after acquiring lock
                if cache_path.exists() and self._verify_file_hash(cache_path, file_hash):
                    return cache_path

                # Download file
                async with semaphore:
                    logger.info(f" Downloading {file_path}")

                    # Get signed URL
                    signed_url = await self.get_signed_url(
                        file_info["storage_path"], file_info.get("storage_url")
                    )

                    if not signed_url:
                        logger.error(f"Failed to get signed URL for {file_path}")
                        return None

                    # Download with retry logic
                    content = await self._download_with_retry(signed_url, file_path)

                    if not content:
                        return None

                    # Verify hash
                    actual_hash = hashlib.sha256(content).hexdigest()
                    if actual_hash != file_hash:
                        logger.error(
                            f"Hash mismatch for {file_path}: "
                            f"expected {file_hash}, got {actual_hash}"
                        )
                        return None

                    # Save to cache
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    cache_path.write_bytes(content)

                    # Record in cache table
                    await self.record_cache_entry(file_hash, str(cache_path), len(content))

                    logger.info(f" Cached {file_path} ({len(content)} bytes)")
                    return cache_path

        except Exception as e:
            logger.error(f"Error caching file {file_path}: {e}")
            return None

    async def _download_with_retry(
        self, url: str, file_path: str, max_retries: int = 3
    ) -> Optional[bytes]:
        """Download file with retry logic"""
        if not self.session:
            self.session = aiohttp.ClientSession()

        for attempt in range(max_retries):
            try:
                async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as response:
                    if response.status == 200:
                        return await response.read()
                    else:
                        logger.warning(
                            f"HTTP {response.status} downloading {file_path} (attempt {attempt + 1})"
                        )
            except asyncio.TimeoutError:
                logger.warning(f"Timeout downloading {file_path} (attempt {attempt + 1})")
            except Exception as e:
                logger.warning(f"Error downloading {file_path}: {e} (attempt {attempt + 1})")

            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)  # Exponential backoff

        logger.error(f"Failed to download {file_path} after {max_retries} attempts")
        return None

    def _verify_file_hash(self, file_path: Path, expected_hash: str) -> bool:
        """Verify file integrity by checking hash"""
        try:
            content = file_path.read_bytes()
            actual_hash = hashlib.sha256(content).hexdigest()
            return actual_hash == expected_hash
        except Exception:
            return False

    async def get_workflow_files(self, workflow_id: int, version: str) -> List[dict]:
        """Get list of files for a workflow from database"""
        conn = await get_database_connection()
        try:
            async with conn.cursor(cursor_factory=RealDictCursor) as cur:
                await cur.execute(
                    """
                    SELECT
                        file_path,
                        storage_path,
                        file_hash,
                        file_size,
                        content_type
                    FROM workflow_files
                    WHERE workflow_id = %s AND version_number = %s
                    ORDER BY file_path
                    """,
                    (workflow_id, version),
                )
                return await cur.fetchall()
        finally:
            await conn.close()

    async def get_signed_url(
        self, storage_path: str, existing_url: Optional[str] = None
    ) -> Optional[str]:
        """Get signed URL for storage file"""
        # If URL is already signed, return it
        if existing_url and existing_url.startswith("http"):
            return existing_url

        # Generate signed URL using Supabase
        conn = await get_database_connection()
        try:
            async with conn.cursor(cursor_factory=RealDictCursor) as cur:
                await cur.execute(
                    "SELECT get_file_signed_url(%s, 3600) as url", (storage_path,)
                )
                result = await cur.fetchone()
                return result["url"] if result else None
        finally:
            await conn.close()

    async def update_cache_access(self, file_hash: str):
        """Update last accessed time for cached file"""
        conn = await get_database_connection()
        try:
            async with conn.cursor() as cur:
                # Update file access time
                await cur.execute(
                    "UPDATE workflow_files SET last_accessed_at = NOW() WHERE file_hash = %s",
                    (file_hash,),
                )

                # Update cache entry
                await cur.execute(
                    """
                    UPDATE machine_file_cache
                    SET last_used_at = NOW(), access_count = access_count + 1
                    WHERE machine_id = %s AND file_hash = %s
                    """,
                    (self.machine_id, file_hash),
                )

                await conn.commit()
        finally:
            await conn.close()

    async def record_cache_entry(self, file_hash: str, local_path: str, file_size: int):
        """Record new cache entry in database"""
        conn = await get_database_connection()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO machine_file_cache
                        (machine_id, file_hash, local_path, file_size, cached_at, last_used_at)
                    VALUES (%s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (machine_id, file_hash)
                    DO UPDATE SET
                        local_path = EXCLUDED.local_path,
                        last_used_at = NOW(),
                        access_count = machine_file_cache.access_count + 1
                    """,
                    (self.machine_id, file_hash, local_path, file_size),
                )
                await conn.commit()
        finally:
            await conn.close()

    async def cleanup_old_cache(
        self, max_age_days: int = 7, max_size_mb: int = 5000
    ) -> Tuple[int, float]:
        """
        Clean up old cached files

        Args:
            max_age_days: Maximum age of cached files in days
            max_size_mb: Maximum total cache size in MB

        Returns:
            Tuple of (deleted_count, freed_space_mb)
        """
        logger.info(f" Starting cache cleanup (max_age={max_age_days}d, max_size={max_size_mb}MB)")

        conn = await get_database_connection()
        deleted_count = 0
        freed_space = 0

        try:
            async with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get old cache entries
                cutoff_date = datetime.now() - timedelta(days=max_age_days)
                await cur.execute(
                    """
                    DELETE FROM machine_file_cache
                    WHERE machine_id = %s AND last_used_at < %s
                    RETURNING local_path, file_size
                    """,
                    (self.machine_id, cutoff_date),
                )
                old_entries = await cur.fetchall()

                # Delete files from filesystem
                for entry in old_entries:
                    try:
                        file_path = Path(entry["local_path"])
                        if file_path.exists():
                            file_path.unlink()
                            deleted_count += 1
                            freed_space += entry["file_size"] or 0
                    except Exception as e:
                        logger.warning(f"Failed to delete cache file {entry['local_path']}: {e}")

                # Check total cache size and clean LRU if needed
                cache_size = sum(
                    f.stat().st_size for f in self.cache_dir.rglob("*") if f.is_file()
                )

                if cache_size > max_size_mb * 1024 * 1024:
                    # Delete least recently used files
                    target_size = (max_size_mb * 1024 * 1024) * 0.8  # Free up to 80% of limit

                    await cur.execute(
                        """
                        SELECT local_path, file_size
                        FROM machine_file_cache
                        WHERE machine_id = %s
                        ORDER BY last_used_at ASC
                        """,
                        (self.machine_id,),
                    )

                    lru_entries = await cur.fetchall()
                    current_size = cache_size

                    for entry in lru_entries:
                        if current_size <= target_size:
                            break

                        try:
                            file_path = Path(entry["local_path"])
                            if file_path.exists():
                                file_path.unlink()
                                deleted_count += 1
                                freed_space += entry["file_size"] or 0
                                current_size -= entry["file_size"] or 0

                                # Remove from database
                                await cur.execute(
                                    """
                                    DELETE FROM machine_file_cache
                                    WHERE machine_id = %s AND local_path = %s
                                    """,
                                    (self.machine_id, entry["local_path"]),
                                )
                        except Exception as e:
                            logger.warning(f"Failed to delete LRU file {entry['local_path']}: {e}")

                await conn.commit()

        finally:
            await conn.close()

        freed_space_mb = freed_space / (1024 * 1024)
        logger.info(f" Cleaned {deleted_count} files, freed {freed_space_mb:.2f}MB")
        return deleted_count, freed_space_mb

    def update_workflow_paths(self, workflow_data: dict, file_mapping: Dict[str, str]) -> dict:
        """
        Update workflow steps with local file paths

        Args:
            workflow_data: Workflow configuration
            file_mapping: Mapping of original paths to local cached paths

        Returns:
            Updated workflow configuration
        """
        if not file_mapping:
            return workflow_data

        # Deep copy to avoid modifying original
        import copy
        updated_workflow = copy.deepcopy(workflow_data)

        # Update automation sequence
        if "automation_sequence" in updated_workflow:
            sequence = updated_workflow["automation_sequence"]

            # Handle both dict and list formats
            steps = []
            if isinstance(sequence, dict):
                if "steps" in sequence:
                    steps = sequence["steps"]
                elif "arguments" in sequence and "steps" in sequence["arguments"]:
                    steps = sequence["arguments"]["steps"]
            elif isinstance(sequence, list):
                steps = sequence

            # Update paths in steps
            for step in steps:
                # Update script_path references
                if "script_path" in step:
                    original_path = step["script_path"]
                    if original_path in file_mapping:
                        step["script_path"] = file_mapping[original_path]
                        logger.debug(f"Updated script_path: {original_path} -> {file_mapping[original_path]}")

                # Update require() statements in inline code
                if "run" in step and isinstance(step["run"], str):
                    for original, local in file_mapping.items():
                        patterns = [
                            f"require('./{original}')",
                            f'require("./{original}")',
                            f"require('{original}')",
                            f'require("{original}")',
                        ]
                        for pattern in patterns:
                            if pattern in step["run"]:
                                step["run"] = step["run"].replace(pattern, f"require('{local}')")
                                logger.debug(f"Updated require() for {original}")

                # Update arguments if present
                if "arguments" in step:
                    args = step["arguments"]
                    if "script_path" in args and args["script_path"] in file_mapping:
                        args["script_path"] = file_mapping[args["script_path"]]
                    if "run" in args and isinstance(args["run"], str):
                        for original, local in file_mapping.items():
                            args["run"] = args["run"].replace(f"require('./{original}')", f"require('{local}')")

        return updated_workflow