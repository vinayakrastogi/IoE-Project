from datetime import datetime

from pydantic import BaseModel


class PredictionPoint(BaseModel):
    timestamp: datetime
    hour: int
    predicted_occupancy_pct: float
    will_cross_threshold: bool


class PeakPrediction(BaseModel):
    generated_at: datetime
    threshold_pct: float
    current_occupancy_pct: float
    peak_hour: int
    peak_occupancy_pct: float
    next_threshold_breach: datetime | None
    curve: list[PredictionPoint]
