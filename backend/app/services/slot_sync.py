"""Fan a slot-status change out to every consumer in one place:
browsers (WebSocket) and the physical indicator LEDs (retained MQTT messages
the gateway forwards to the zone controllers)."""

import logging
import threading

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.mqtt_client import publish_json
from app.services.slot_snapshot import build_slot_snapshot
from app.services.ws_manager import manager

logger = logging.getLogger("slot.sync")
settings = get_settings()

_lock = threading.Lock()
_last_published: dict[int, str] = {}


def publish_slot_states(snapshot: dict, force: bool = False) -> None:
    """Publish a retained `parking/slot/<n>/state` message for every slot whose
    status changed since the last publish (or for all slots when `force`)."""
    with _lock:
        changed = [
            slot
            for slot in snapshot["slots"]
            if force or _last_published.get(slot["index"]) != slot["status"]
        ]
        for slot in changed:
            _last_published[slot["index"]] = slot["status"]

    for slot in changed:
        try:
            publish_json(
                f"{settings.topic_slot_state_prefix}/{slot['index']}/state",
                {"slot_index": slot["index"], "label": slot["label"], "status": slot["status"]},
                retain=True,
            )
        except Exception as exc:  # broker briefly unavailable: retry on the next change
            logger.warning("could not publish state of slot %s: %s", slot["index"], exc)
            with _lock:
                _last_published.pop(slot["index"], None)


async def broadcast_slots(db: Session) -> dict:
    snapshot = build_slot_snapshot(db)
    publish_slot_states(snapshot)
    await manager.broadcast(snapshot)
    return snapshot
