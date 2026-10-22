import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import SessionLocal
from app.mqtt.worker import start_mqtt_worker, stop_mqtt_worker
from app.routers import admin, auth, bookings, events, gate, predictions, slots, ws
from app.services.mqtt_client import shutdown_publisher
from app.services.slot_snapshot import build_slot_snapshot
from app.services.slot_sync import publish_slot_states

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    try:
        start_mqtt_worker(loop)
    except Exception as exc:  # pragma: no cover - broker may be briefly unavailable
        logging.getLogger("main").error("Failed to start MQTT worker: %s", exc)

    # Re-publish every slot's status (retained) so indicator LEDs agree with
    # the database after a restart, whatever state they were left in.
    db = SessionLocal()
    try:
        publish_slot_states(build_slot_snapshot(db), force=True)
    except Exception as exc:  # pragma: no cover - broker/db may be briefly unavailable
        logging.getLogger("main").warning("Initial slot-state publish failed: %s", exc)
    finally:
        db.close()
    yield
    stop_mqtt_worker()
    shutdown_publisher()


app = FastAPI(title="Smart Parking Allocation System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(bookings.router)
app.include_router(events.router)
app.include_router(events.ws_router)
app.include_router(gate.router)
app.include_router(slots.router)
app.include_router(predictions.router)
app.include_router(ws.router)


@app.get("/health")
def health():
    return {"status": "ok"}
