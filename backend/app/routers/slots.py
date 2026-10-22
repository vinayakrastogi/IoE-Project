from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.slot import SlotOut, SlotsLiveOut
from app.services.slot_snapshot import build_slot_snapshot

router = APIRouter(prefix="/slots", tags=["slots"])


@router.get("", response_model=list[SlotOut])
def list_slots(db: Session = Depends(get_db)):
    snapshot = build_slot_snapshot(db)
    return snapshot["slots"]


@router.get("/live", response_model=SlotsLiveOut)
def live_slots(db: Session = Depends(get_db)):
    """Point-in-time slot map, sourced from Postgres (kept fresh by the MQTT
    worker as sensor events arrive). The WebSocket endpoint pushes the same
    shape proactively; this is for initial page load / polling fallback."""
    return build_slot_snapshot(db)
