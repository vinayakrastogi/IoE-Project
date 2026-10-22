from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user
from app.models.booking import Booking, BookingStatus
from app.models.slot import Slot, SlotStatus
from app.models.user import User
from app.schemas.booking import BookingCreate, BookingOut, BookingWithQR, GuestBookingCreate
from app.services.events import log_event
from app.services.qr import generate_qr_token
from app.services.slot_allocator import find_nearest_free_slot
from app.services.slot_sync import broadcast_slots

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _finalize_booking(db: Session, booking: Booking) -> Booking:
    """Flush to get an id, mint the QR token, then persist it on the row."""
    db.flush()
    booking.qr_token = generate_qr_token(booking.id, booking.slot_id)
    db.commit()
    db.refresh(booking)
    return booking


@router.post("", response_model=BookingWithQR, status_code=status.HTTP_201_CREATED)
async def create_booking(
    payload: BookingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    slot = db.query(Slot).filter(Slot.id == payload.slot_id).first()
    if slot is None:
        raise HTTPException(status_code=404, detail="Slot not found")
    if slot.status != SlotStatus.FREE:
        raise HTTPException(status_code=409, detail="Slot is not available")

    booking = Booking(
        user_id=current_user.id,
        slot_id=slot.id,
        start_time=payload.start_time,
        end_time=payload.end_time,
        qr_token="",
        is_guest=False,
        status=BookingStatus.PENDING,
    )
    slot.status = SlotStatus.BOOKED
    db.add(booking)
    booking = _finalize_booking(db, booking)

    await broadcast_slots(db)
    await log_event(
        db,
        "booking",
        f"Slot {slot.label} booked by {current_user.full_name}",
        meta={"booking_id": booking.id, "slot_index": slot.index},
    )
    return BookingWithQR(
        **BookingOut.model_validate(booking).model_dump(),
        qr_token=booking.qr_token,
    )


@router.post("/guest", response_model=BookingWithQR, status_code=status.HTTP_201_CREATED)
async def create_guest_booking(payload: GuestBookingCreate, db: Session = Depends(get_db)):
    slot = find_nearest_free_slot(db)
    if slot is None:
        raise HTTPException(status_code=409, detail="No free slots available")

    now = datetime.now(timezone.utc)
    booking = Booking(
        user_id=None,
        slot_id=slot.id,
        start_time=now,
        end_time=now + timedelta(minutes=payload.duration_minutes),
        qr_token="",
        is_guest=True,
        guest_name=payload.guest_name,
        guest_phone=payload.guest_phone,
        status=BookingStatus.PENDING,
    )
    slot.status = SlotStatus.BOOKED
    db.add(booking)
    booking = _finalize_booking(db, booking)

    await broadcast_slots(db)
    await log_event(
        db,
        "booking",
        f"Slot {slot.label} booked by guest {payload.guest_name}",
        meta={"booking_id": booking.id, "slot_index": slot.index},
    )
    return BookingWithQR(
        **BookingOut.model_validate(booking).model_dump(),
        qr_token=booking.qr_token,
    )


@router.get("/me", response_model=list[BookingOut])
def list_my_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Booking)
        .options(joinedload(Booking.slot))
        .filter(Booking.user_id == current_user.id)
        .order_by(Booking.created_at.desc())
        .all()
    )
