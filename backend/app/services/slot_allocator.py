from sqlalchemy import asc
from sqlalchemy.orm import Session

from app.models.slot import Slot, SlotStatus


def find_nearest_free_slot(db: Session) -> Slot | None:
    """Pick the lowest-indexed free slot, treated as "nearest to the gate".

    Slots are seeded in index order from the gate outward, so the lowest
    free index is the closest walk-up-friendly spot for a guest booking.
    """
    return (
        db.query(Slot)
        .filter(Slot.status == SlotStatus.FREE)
        .order_by(asc(Slot.index))
        .first()
    )
