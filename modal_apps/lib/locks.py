from typing import List, Tuple
import logging


logger = logging.getLogger(__name__)


def cleanup_stale_machine_locks(cur) -> None:
    """Delete expired or non in_progress machine coordinator locks.

    Matches the SQL used inline previously to avoid changing semantics.
    """
    try:
        cur.execute(
            """
            DELETE FROM processing_locks
            WHERE (status <> 'in_progress' OR expires_at <= NOW())
              AND user_id LIKE 'machine-%-coordinator'
            """
        )
    except Exception as e:
        logger.warning("⚠️ Failed to cleanup stale coordinator locks: %s", e)


def record_acquired_lock(acquired: List[Tuple[str, str]], user_id: str, processor_id: str) -> None:
    acquired.append((user_id, processor_id))


def release_acquired_locks(cur, acquired: List[Tuple[str, str]]) -> None:
    if not acquired:
        return
    cur.executemany(
        """
        DELETE FROM processing_locks 
        WHERE user_id = %s AND processor_id = %s
        """,
        acquired,
    )



