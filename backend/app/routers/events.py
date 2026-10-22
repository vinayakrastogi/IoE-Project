from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SystemEvent
from app.schemas.event import EventOut
from app.services.events import events_manager

router = APIRouter(prefix="/events", tags=["events"])
ws_router = APIRouter(tags=["websocket"])


@router.get("/recent", response_model=list[EventOut])
def recent_events(limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    return (
        db.query(SystemEvent)
        .order_by(SystemEvent.timestamp.desc())
        .limit(limit)
        .all()
    )


@ws_router.websocket("/ws/events")
async def events_ws(websocket: WebSocket, db: Session = Depends(get_db)):
    await events_manager.connect(websocket)
    try:
        backlog = (
            db.query(SystemEvent)
            .order_by(SystemEvent.timestamp.desc())
            .limit(20)
            .all()
        )
        backlog.reverse()
        await websocket.send_json(
            {
                "type": "event_backlog",
                "events": [EventOut.model_validate(e).model_dump(mode="json") for e in backlog],
            }
        )
        while True:
            # Keep the connection alive; clients don't need to send anything.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await events_manager.disconnect(websocket)
