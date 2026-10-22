from sqlalchemy.orm import Session

from app.models import SystemEvent
from app.schemas.event import EventOut
from app.services.ws_manager import ConnectionManager

events_manager = ConnectionManager()


async def log_event(db: Session, category: str, message: str, meta: dict | None = None) -> None:
    row = SystemEvent(category=category, message=message, meta=meta)
    db.add(row)
    db.commit()
    db.refresh(row)
    await events_manager.broadcast({"type": "event", **EventOut.model_validate(row).model_dump(mode="json")})
