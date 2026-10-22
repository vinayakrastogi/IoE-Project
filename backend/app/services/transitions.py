"""Expected-transition windows.

A gate scan (or an operator action) changes a slot's status immediately, but
the physical world catches up later: after an entry scan the car still has to
drive to its bay, and after an exit scan it is still sitting in the bay for a
few seconds. During that window the ultrasonic sensor legitimately disagrees
with the database. Remembering "we just told this slot to change" lets the
MQTT worker ignore those stale readings instead of undoing the scan.

In-memory on purpose: it only has to cover a few seconds, and losing it on a
backend restart is harmless.
"""

import threading
import time

from app.config import get_settings

settings = get_settings()

_lock = threading.Lock()
_marks: dict[int, tuple[str, float]] = {}


def mark(slot_index: int, direction: str) -> None:
    """Record that slot `slot_index` was just told to enter ("entry") or leave ("exit")."""
    with _lock:
        _marks[slot_index] = (direction, time.monotonic())


def expected(slot_index: int) -> str | None:
    """Return "entry" / "exit" while the car is still expected to be on its way, else None."""
    with _lock:
        item = _marks.get(slot_index)
    if item is None:
        return None
    direction, marked_at = item
    grace = settings.arrival_grace_seconds if direction == "entry" else settings.departure_grace_seconds
    return direction if time.monotonic() - marked_at < grace else None


def clear(slot_index: int) -> None:
    with _lock:
        _marks.pop(slot_index, None)
