from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.slot import SlotStatus


class SlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    index: int
    label: str
    location: str
    status: SlotStatus
    updated_at: datetime


class SlotsLiveOut(BaseModel):
    total: int
    free: int
    booked: int
    occupied: int
    occupancy_pct: float
    slots: list[SlotOut]


class AdminSlotOut(SlotOut):
    booking_id: int | None = None
    booking_status: str | None = None
    occupant_name: str | None = None
