from datetime import datetime

from pydantic import BaseModel


class GateScanRequest(BaseModel):
    qr_token: str


class GateScanResponse(BaseModel):
    action: str  # "entry" | "exit"
    booking_id: int
    slot_index: int
    slot_label: str
    timestamp: datetime
    message: str
