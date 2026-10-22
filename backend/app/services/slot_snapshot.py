from sqlalchemy.orm import Session

from app.models.slot import Slot, SlotStatus


def build_slot_snapshot(db: Session) -> dict:
    slots = db.query(Slot).order_by(Slot.index).all()
    total = len(slots)
    occupied = sum(1 for s in slots if s.status == SlotStatus.OCCUPIED)
    booked = sum(1 for s in slots if s.status == SlotStatus.BOOKED)
    free = total - occupied - booked
    return {
        "type": "slot_update",
        "total": total,
        "free": free,
        "booked": booked,
        "occupied": occupied,
        "occupancy_pct": round((occupied / total) * 100, 1) if total else 0.0,
        "slots": [
            {
                "id": s.id,
                "index": s.index,
                "label": s.label,
                "location": s.location,
                "status": s.status.value,
                "updated_at": s.updated_at.isoformat(),
            }
            for s in slots
        ],
    }
