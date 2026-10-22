"""Operator controls for running a live demo: force any slot back to free
without waiting for a real exit scan or for the ambient sensor sim to catch
up. Gated behind a shared X-Admin-Token header (see app.deps.require_admin) --
this is a single-operator demo tool, not a multi-role production admin panel.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models.booking import Booking, BookingStatus
from app.models.entry_log import EntryLog
from app.models.slot import Slot, SlotStatus
from app.config import get_settings
from app.schemas.slot import AdminSlotOut
from app.services import transitions
from app.services.events import log_event
from app.services.mqtt_client import publish_json
from app.services.slot_sync import broadcast_slots

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
settings = get_settings()


def _announce_cleared(slot: Slot) -> None:
    """Tell whatever is watching the physical world that an operator forced this
    slot free. A real attendant would walk over and move the car; in the hardware
    lab the world model listens for this and drives the virtual car away, so the
    ultrasonic sensor doesn't immediately re-occupy the slot."""
    transitions.mark(slot.index, "exit")
    try:
        publish_json(settings.topic_admin_cleared, {"slot_index": slot.index})
    except Exception:
        pass


def _occupant_name(booking: Booking) -> str:
    if booking.is_guest:
        return booking.guest_name or "guest"
    return booking.user.full_name if booking.user else "unknown user"


def _active_booking(db: Session, slot: Slot) -> Booking | None:
    return (
        db.query(Booking)
        .filter(
            Booking.slot_id == slot.id,
            Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACTIVE]),
        )
        .order_by(Booking.created_at.desc())
        .first()
    )


def _free_slot(db: Session, slot: Slot) -> str | None:
    """Force one slot back to FREE, closing out whatever booking currently
    holds it. Returns a human-readable summary, or None if the slot was
    already free (no-op)."""
    if slot.status == SlotStatus.FREE:
        return None

    booking = _active_booking(db, slot)
    previous_status = slot.status.value
    occupant = None

    if booking is not None:
        occupant = _occupant_name(booking)
        if booking.status == BookingStatus.ACTIVE:
            open_entry_log = (
                db.query(EntryLog)
                .filter(EntryLog.booking_id == booking.id, EntryLog.exit_time.is_(None))
                .first()
            )
            if open_entry_log is not None:
                open_entry_log.exit_time = datetime.now(timezone.utc)
            booking.status = BookingStatus.COMPLETED
        elif booking.status == BookingStatus.PENDING:
            booking.status = BookingStatus.CANCELLED

    slot.status = SlotStatus.FREE

    if occupant:
        return f"Slot {slot.label} manually freed by admin (was {previous_status}, occupant: {occupant})"
    return f"Slot {slot.label} manually freed by admin (was {previous_status})"


@router.get("/slots", response_model=list[AdminSlotOut])
def list_admin_slots(db: Session = Depends(get_db)):
    slots = db.query(Slot).order_by(Slot.index).all()
    out = []
    for slot in slots:
        booking = _active_booking(db, slot) if slot.status != SlotStatus.FREE else None
        out.append(
            AdminSlotOut(
                id=slot.id,
                index=slot.index,
                label=slot.label,
                location=slot.location,
                status=slot.status,
                updated_at=slot.updated_at,
                booking_id=booking.id if booking else None,
                booking_status=booking.status.value if booking else None,
                occupant_name=_occupant_name(booking) if booking else None,
            )
        )
    return out


@router.post("/slots/{slot_id}/free")
async def free_slot(slot_id: int, db: Session = Depends(get_db)):
    slot = db.query(Slot).filter(Slot.id == slot_id).first()
    if slot is None:
        raise HTTPException(status_code=404, detail="Slot not found")

    message = _free_slot(db, slot)
    db.commit()

    if message is not None:
        _announce_cleared(slot)
        await log_event(db, "system", message, meta={"slot_index": slot.index})
        await broadcast_slots(db)

    return {"freed": message is not None, "slot_index": slot.index, "slot_label": slot.label}


@router.post("/slots/reset-all")
async def free_all_slots(db: Session = Depends(get_db)):
    slots = db.query(Slot).filter(Slot.status != SlotStatus.FREE).all()
    freed_count = 0
    freed_slots = []
    for slot in slots:
        if _free_slot(db, slot) is not None:
            freed_count += 1
            freed_slots.append(slot)
    db.commit()

    if freed_count > 0:
        for slot in freed_slots:
            _announce_cleared(slot)
        await log_event(
            db, "system", f"Admin reset all slots to free ({freed_count} slot(s) cleared)"
        )
        await broadcast_slots(db)

    return {"freed_count": freed_count}
