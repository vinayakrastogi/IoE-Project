from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.slot_snapshot import build_slot_snapshot
from app.services.ws_manager import manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/slots")
async def slots_ws(websocket: WebSocket, db: Session = Depends(get_db)):
    await manager.connect(websocket)
    try:
        await websocket.send_json(build_slot_snapshot(db))
        while True:
            # Keep the connection alive; clients don't need to send anything.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
