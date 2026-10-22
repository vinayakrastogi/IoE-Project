"""Background MQTT subscriber.

Runs paho-mqtt's network loop on its own thread (paho is not asyncio-native).
Each incoming sensor message updates Postgres directly, then hands the
resulting slot-map snapshot back to the FastAPI event loop via
`asyncio.run_coroutine_threadsafe` so it can be broadcast over WebSocket.

Slot-status reconciliation rules (see README for the full rationale):
  FREE     + occupied=True  -> OCCUPIED   (ambient walk-in car, no booking)
  FREE     + occupied=False -> FREE       (no-op)
  BOOKED   + occupied=True  -> OCCUPIED   (reserved car physically arrived)
  BOOKED   + occupied=False -> BOOKED     (no-op, reserved but not arrived yet)
  OCCUPIED + occupied=False -> FREE       (car left; auto-close any open entry log)
  OCCUPIED + occupied=True  -> OCCUPIED   (no-op)

A gate scan changes the slot status at once, but the car is still driving to
(or out of) the bay. While that transition is expected (see
app.services.transitions) readings that merely contradict the scan are ignored:
  after an entry scan: "empty" readings are ignored until the car shows up
  after an exit scan / admin free: "occupied" readings are ignored until it leaves
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models.booking import Booking, BookingStatus
from app.models.entry_log import EntryLog
from app.models.slot import Slot, SlotStatus
from app.services import transitions
from app.services.events import log_event
from app.services.slot_snapshot import build_slot_snapshot
from app.services.slot_sync import publish_slot_states
from app.services.ws_manager import manager

logger = logging.getLogger("mqtt.worker")
settings = get_settings()

_loop: asyncio.AbstractEventLoop | None = None
_client: mqtt.Client | None = None


def _close_open_entry_log(db: Session, slot: Slot) -> None:
    booking = (
        db.query(Booking)
        .filter(Booking.slot_id == slot.id, Booking.status == BookingStatus.ACTIVE)
        .order_by(Booking.created_at.desc())
        .first()
    )
    if booking is None:
        return
    entry_log = (
        db.query(EntryLog)
        .filter(EntryLog.booking_id == booking.id, EntryLog.exit_time.is_(None))
        .first()
    )
    now = datetime.now(timezone.utc)
    if entry_log is not None:
        entry_log.exit_time = now
    booking.status = BookingStatus.COMPLETED


def _apply_sensor_event(slot_index: int, occupied: bool) -> tuple[dict | None, str | None]:
    db = SessionLocal()
    try:
        slot = db.query(Slot).filter(Slot.index == slot_index).first()
        if slot is None:
            logger.warning("sensor event for unknown slot index=%s", slot_index)
            return None, None

        event_message: str | None = None
        expected = transitions.expected(slot_index)

        if expected == "entry":
            if occupied:
                # The car the gate let in has reached its bay.
                transitions.clear(slot_index)
                event_message = f"Slot {slot.label}: sensor confirmed the car reached its bay"
            elif slot.status == SlotStatus.OCCUPIED:
                return None, None  # still driving in
        elif expected == "exit":
            if not occupied:
                transitions.clear(slot_index)
                event_message = f"Slot {slot.label}: sensor confirmed the bay is clear"
            elif slot.status == SlotStatus.FREE:
                return None, None  # still pulling out

        if slot.status == SlotStatus.FREE and occupied:
            slot.status = SlotStatus.OCCUPIED
            event_message = f"Slot {slot.label}: ambient sensor detected arrival"
        elif slot.status == SlotStatus.BOOKED and occupied:
            slot.status = SlotStatus.OCCUPIED
            event_message = f"Slot {slot.label}: sensor confirmed reserved arrival"
        elif slot.status == SlotStatus.OCCUPIED and not occupied:
            slot.status = SlotStatus.FREE
            _close_open_entry_log(db, slot)
            event_message = f"Slot {slot.label}: ambient sensor detected departure"
        # FREE+not occupied and BOOKED+not occupied are no-ops.

        db.commit()
        return build_slot_snapshot(db), event_message
    finally:
        db.close()


async def _log_event_threadsafe(category: str, message: str, meta: dict | None = None) -> None:
    """Open a fresh session on the event-loop side and log an event.

    Scheduled via `asyncio.run_coroutine_threadsafe` from the MQTT thread, so
    the session must be opened here (not passed in from that thread).
    """
    db = SessionLocal()
    try:
        await log_event(db, category, message, meta)
    finally:
        db.close()


def _on_connect(client: mqtt.Client, userdata, flags, reason_code, properties=None):
    logger.info("mqtt worker connected: %s", reason_code)
    client.subscribe(settings.topic_sensor_wildcard, qos=1)
    client.subscribe(settings.topic_gate_ack, qos=1)
    client.subscribe(settings.topic_node_status_wildcard, qos=1)


_seen_nodes: set[str] = set()


def _on_node_status(node: str, payload: dict) -> None:
    """Log a controller coming online: on a real boot, or the first time this
    backend run hears from it (the gateway's status messages are retained, so a
    controller that booted before the backend started is announced too).
    Later heartbeats are noise."""
    first_contact = node not in _seen_nodes
    _seen_nodes.add(node)
    if (payload.get("event") != "boot" and not first_contact) or _loop is None:
        return
    first, count = payload.get("first_slot"), payload.get("slots")
    if node == "gate":
        message = f"Gate controller online (firmware {payload.get('firmware')})"
    elif first and count:
        message = (
            f"Zone controller {node.split('-')[-1].upper()} online "
            f"(firmware {payload.get('firmware')}, sensors for slots {first}-{first + count - 1})"
        )
    else:
        message = f"Controller {node} online"
    asyncio.run_coroutine_threadsafe(_log_event_threadsafe("hardware", message, {"node": node}), _loop)


def _on_message(client: mqtt.Client, userdata, msg: mqtt.MQTTMessage):
    try:
        payload = json.loads(msg.payload.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("bad payload on %s: %r", msg.topic, msg.payload)
        return

    if msg.topic == settings.topic_gate_ack:
        logger.info("gate ack: %s", payload)
        if _loop is not None:
            asyncio.run_coroutine_threadsafe(
                _log_event_threadsafe(
                    "hardware",
                    f"Gate hardware acknowledged {payload.get('direction', 'entry')} cycle for slot index {payload.get('slot_index')}",
                    {"slot_index": payload.get("slot_index")},
                ),
                _loop,
            )
        return

    parts = msg.topic.split("/")

    # topic shape: parking/node/{node}/status  (controller boot / heartbeat)
    if len(parts) == 4 and parts[1] == "node":
        _on_node_status(parts[2], payload)
        return

    # topic shape: parking/sensor/{slot_index}/status
    if len(parts) != 4 or parts[1] != "sensor":
        return
    try:
        slot_index = int(parts[2])
    except ValueError:
        return

    occupied = bool(payload.get("occupied"))
    snapshot, event_message = _apply_sensor_event(slot_index, occupied)
    if snapshot is not None and _loop is not None:
        publish_slot_states(snapshot)
        asyncio.run_coroutine_threadsafe(manager.broadcast(snapshot), _loop)
        if event_message is not None:
            asyncio.run_coroutine_threadsafe(
                _log_event_threadsafe("sensor", event_message, {"slot_index": slot_index}), _loop
            )


def start_mqtt_worker(loop: asyncio.AbstractEventLoop) -> mqtt.Client:
    global _loop, _client
    _loop = loop
    client = mqtt.Client(
        client_id=f"{settings.mqtt_client_id}-sub",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    client.on_connect = _on_connect
    client.on_message = _on_message
    client.connect(settings.mqtt_host, settings.mqtt_port, settings.mqtt_keepalive)
    client.loop_start()
    _client = client
    return client


def stop_mqtt_worker() -> None:
    global _client
    if _client is not None:
        _client.loop_stop()
        _client.disconnect()
        _client = None
