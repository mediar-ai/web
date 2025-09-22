"""
Periodic cleanup tasks for workflow file management 
"""

import asyncio
import logging
from datetime import datetime

import modal
from lib.db import get_database_connection
from lib.file_manager import WorkflowFileManager

logger = logging.getLogger(__name__)

# Modal app for cleanup tasks
app = modal.App("workflow-cleanup-tasks")

# Image with required dependencies
image = modal.Image.debian_slim().pip_install(
    "psycopg2-binary",
    "aiohttp",
)


@app.function(
    image=image,
    # schedule=modal.Period(hours=6),  # DISABLED: Cron job limit reached
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=600,  # 10 minutes timeout
)
async def cleanup_file_cache():
    """Periodic cleanup of file cache on all machines"""
    logger.info("Starting scheduled file cache cleanup")

    try:
        # Get list of active machines
        conn = await get_database_connection()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT id, name
                    FROM remote_machines
                    WHERE status = 'active'
                    """
                )
                machines = await cur.fetchall()
        finally:
            await conn.close()

        total_deleted = 0
        total_freed_mb = 0.0

        # Cleanup cache on each machine
        for machine_id, machine_name in machines:
            logger.info(f"Cleaning cache on machine {machine_name} (ID: {machine_id})")

            file_manager = WorkflowFileManager(machine_id=machine_id)
            deleted_count, freed_mb = await file_manager.cleanup_old_cache(
                max_age_days=7,  # Remove files not used in 7 days
                max_size_mb=5000  # Keep cache under 5GB
            )

            total_deleted += deleted_count
            total_freed_mb += freed_mb

            logger.info(
                f"  Cleaned {deleted_count} files, freed {freed_mb:.2f}MB on {machine_name}"
            )

        # Update cleanup policy record
        conn = await get_database_connection()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE file_cleanup_policy
                    SET last_run_at = %s
                    WHERE policy_name = 'cache_cleanup'
                    """,
                    (datetime.now(),)
                )
                await conn.commit()
        finally:
            await conn.close()

        logger.info(
            f"Cache cleanup completed: {total_deleted} files deleted, "
            f"{total_freed_mb:.2f}MB freed across {len(machines)} machines"
        )

        return {
            "success": True,
            "machines_cleaned": len(machines),
            "total_deleted": total_deleted,
            "total_freed_mb": total_freed_mb,
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        logger.error(f"Cache cleanup failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.function(
    image=image,
    # schedule=modal.Period(days=1),  # DISABLED: Cron job limit reached
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=600,
)
async def cleanup_orphaned_files():
    """Clean up orphaned files in storage that are no longer referenced"""
    logger.info("Starting orphaned file cleanup")

    try:
        conn = await get_database_connection()

        # Find orphaned files
        async with conn.cursor() as cur:
            # Find files not referenced by any active workflow
            await cur.execute(
                """
                WITH active_workflow_files AS (
                    SELECT DISTINCT wf.file_hash
                    FROM workflow_files wf
                    JOIN remote_workflows rw ON wf.workflow_id = rw.id
                    WHERE rw.status IN ('deployed', 'paused')
                )
                DELETE FROM workflow_files
                WHERE file_hash NOT IN (SELECT file_hash FROM active_workflow_files)
                AND created_at < NOW() - INTERVAL '30 days'
                RETURNING file_hash, storage_path
                """
            )
            orphaned = await cur.fetchall()

            if orphaned:
                logger.info(f"Found {len(orphaned)} orphaned files to clean up")

                # Note: Actual storage deletion would need to be done via Supabase client
                # This is just marking them for deletion in the database

                await conn.commit()

                logger.info(f"Cleaned up {len(orphaned)} orphaned files")
            else:
                logger.info("No orphaned files found")

        return {
            "success": True,
            "orphaned_cleaned": len(orphaned) if orphaned else 0,
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        logger.error(f"Orphaned file cleanup failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
    finally:
        if conn:
            await conn.close()


@app.function(
    image=image,
    # schedule=modal.Period(hours=1),  # DISABLED: Cron job limit reached
    secrets=[modal.Secret.from_name("supabase-secret")],
)
async def update_cache_statistics():
    """Update cache statistics for monitoring"""
    logger.info("Updating cache statistics")

    try:
        conn = await get_database_connection()

        async with conn.cursor() as cur:
            # Update statistics for each machine
            await cur.execute(
                """
                INSERT INTO cache_statistics (
                    machine_id,
                    total_files,
                    total_size_mb,
                    avg_file_size_kb,
                    oldest_file_age_days,
                    most_accessed_count,
                    recorded_at
                )
                SELECT
                    machine_id,
                    COUNT(*) as total_files,
                    COALESCE(SUM(file_size) / 1048576.0, 0) as total_size_mb,
                    COALESCE(AVG(file_size) / 1024.0, 0) as avg_file_size_kb,
                    EXTRACT(DAY FROM NOW() - MIN(cached_at)) as oldest_file_age_days,
                    MAX(access_count) as most_accessed_count,
                    NOW() as recorded_at
                FROM machine_file_cache
                GROUP BY machine_id
                ON CONFLICT (machine_id, recorded_at) DO UPDATE
                SET
                    total_files = EXCLUDED.total_files,
                    total_size_mb = EXCLUDED.total_size_mb,
                    avg_file_size_kb = EXCLUDED.avg_file_size_kb
                """
            )

            await conn.commit()

        logger.info("Cache statistics updated")

        return {
            "success": True,
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        logger.error(f"Statistics update failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
    finally:
        if conn:
            await conn.close()


# Manual trigger functions for testing
@app.function(image=image, secrets=[modal.Secret.from_name("supabase-secret")])
async def manual_cleanup(machine_id: int = None, max_age_days: int = 7):
    """Manually trigger cache cleanup for testing"""
    if machine_id:
        file_manager = WorkflowFileManager(machine_id=machine_id)
        return await file_manager.cleanup_old_cache(max_age_days=max_age_days)
    else:
        return await cleanup_file_cache.remote()
