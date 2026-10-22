from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.ml.predictor import get_predictor
from app.schemas.prediction import PeakPrediction, PredictionPoint
from app.services.slot_snapshot import build_slot_snapshot

router = APIRouter(prefix="/predictions", tags=["predictions"])
settings = get_settings()


@router.get("/peak", response_model=PeakPrediction)
def predict_peak(hours_ahead: int = 24, db: Session = Depends(get_db)):
    snapshot = build_slot_snapshot(db)
    now = datetime.now(timezone.utc)

    try:
        predictor = get_predictor()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    curve = predictor.predict_curve(
        total_slots=snapshot["total"] or settings.total_slots,
        current_occupancy_pct=snapshot["occupancy_pct"],
        now=now,
        hours_ahead=hours_ahead,
        threshold_pct=settings.peak_threshold_pct,
    )

    peak_point = max(curve, key=lambda p: p["predicted_occupancy_pct"])
    breach = next((p["timestamp"] for p in curve if p["will_cross_threshold"]), None)

    return PeakPrediction(
        generated_at=now,
        threshold_pct=settings.peak_threshold_pct,
        current_occupancy_pct=snapshot["occupancy_pct"],
        peak_hour=peak_point["hour"],
        peak_occupancy_pct=peak_point["predicted_occupancy_pct"],
        next_threshold_breach=breach,
        curve=[PredictionPoint(**p) for p in curve],
    )
