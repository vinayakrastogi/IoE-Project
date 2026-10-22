from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.booking import Booking, BookingStatus
from app.models.entry_log import EntryLog
from app.models.slot import Slot, SlotStatus
from app.schemas.gate import GateScanRequest, GateScanResponse
from app.services import transitions
from app.services.events import log_event
from app.services.mqtt_client import publish_json
from app.services.qr import decode_qr_token
from app.services.slot_sync import broadcast_slots

router = APIRouter(prefix="/gate", tags=["gate"])
settings = get_settings()


async def _reject(db: Session, status_code: int, detail: str, display: str) -> HTTPException:
    """Make the gate hardware show and sound a rejection, log it, and return the
    API error for the caller to raise. `display` has to fit the 16-character LCD."""
    try:
        publish_json(
            settings.topic_gate_command,
            {"action": "deny", "reason": display, "timestamp": datetime.now(timezone.utc).isoformat()},
        )
    except Exception:  # the HTTP error matters more than the buzzer
        pass
    await log_event(db, "gate", f"QR scan rejected: {detail}")
    return HTTPException(status_code=status_code, detail=detail)


@router.post("/scan", response_model=GateScanResponse)
async def scan_qr(payload: GateScanRequest, db: Session = Depends(get_db)):
    data = decode_qr_token(payload.qr_token)
    if data is None:
        raise await _reject(db, 400, "Invalid or tampered QR code", "Invalid QR code")

    booking = db.query(Booking).filter(Booking.id == data["booking_id"]).first()
    if booking is None or booking.qr_token != payload.qr_token:
        raise await _reject(db, 404, "Booking not found for this QR code", "Unknown booking")

    slot = db.query(Slot).filter(Slot.id == booking.slot_id).first()
    if slot is None:
        raise HTTPException(status_code=404, detail="Slot for this booking no longer exists")

    now = datetime.now(timezone.utc)

    if booking.status in (BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.EXPIRED):
        display = {
            BookingStatus.COMPLETED: "Already used",
            BookingStatus.CANCELLED: "Cancelled",
            BookingStatus.EXPIRED: "Booking expired",
        }[booking.status]
        raise await _reject(db, 409, f"Booking already {booking.status.value}", display)

    if booking.status == BookingStatus.PENDING and now > booking.end_time:
        booking.status = BookingStatus.EXPIRED
        if slot.status == SlotStatus.BOOKED:
            slot.status = SlotStatus.FREE
        db.commit()
        await broadcast_slots(db)
        raise await _reject(db, 409, "Booking window has expired", "Booking expired")

    open_entry_log = (
        db.query(EntryLog)
        .filter(EntryLog.booking_id == booking.id, EntryLog.exit_time.is_(None))
        .first()
    )

    if booking.status == BookingStatus.PENDING and open_entry_log is None:
        action = "entry"
        entry_log = EntryLog(booking_id=booking.id, entry_time=now)
        db.add(entry_log)
        booking.status = BookingStatus.ACTIVE
        slot.status = SlotStatus.OCCUPIED
        message = f"Welcome. Gate opening for slot {slot.label}."
    elif booking.status == BookingStatus.ACTIVE and open_entry_log is not None:
        action = "exit"
        open_entry_log.exit_time = now
        booking.status = BookingStatus.COMPLETED
        slot.status = SlotStatus.FREE
        message = f"Goodbye. Gate opening for slot {slot.label}."
    else:
        raise await _reject(db, 409, "Booking is in an inconsistent state", "Try again")

    db.commit()

    # The slot status just changed on paper; the car is still on its way to / out
    # of the bay. Let the sensor-reconciliation logic know to be patient.
    transitions.mark(slot.index, action)

    publish_json(
        settings.topic_gate_command,
        {
            "action": "open",
            "direction": action,
            "booking_id": booking.id,
            "slot_index": slot.index,
            "timestamp": now.isoformat(),
        },
    )
    await broadcast_slots(db)

    display_name = booking.guest_name if booking.is_guest else (booking.user.full_name if booking.user else "unknown user")
    if action == "entry":
        await log_event(
            db,
            "gate",
            f"Slot {slot.label}: entry granted for booking #{booking.id} ({display_name})",
            meta={"booking_id": booking.id, "slot_index": slot.index},
        )
    if action == "exit":
        await log_event(
            db,
            "gate",
            f"Slot {slot.label}: exit completed for booking #{booking.id} ({display_name})",
            meta={"booking_id": booking.id, "slot_index": slot.index},
        )

    return GateScanResponse(
        action=action,
        booking_id=booking.id,
        slot_index=slot.index,
        slot_label=slot.label,
        timestamp=now,
        message=message,
    )
