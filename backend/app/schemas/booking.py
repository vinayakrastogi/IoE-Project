from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.booking import BookingStatus
from app.schemas.slot import SlotOut


class BookingCreate(BaseModel):
    slot_id: int
    start_time: datetime
    end_time: datetime

    @field_validator("end_time")
    @classmethod
    def end_after_start(cls, v: datetime, info):
        start = info.data.get("start_time")
        if start and v <= start:
            raise ValueError("end_time must be after start_time")
        return v


class GuestBookingCreate(BaseModel):
    guest_name: str
    guest_phone: str
    duration_minutes: int = Field(default=120, gt=0, le=24 * 60)


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None
    slot_id: int
    start_time: datetime
    end_time: datetime
    is_guest: bool
    guest_name: str | None
    status: BookingStatus
    created_at: datetime
    slot: SlotOut


class BookingWithQR(BookingOut):
    qr_token: str
