"""Loads the joblib artifacts produced by ml/train.py and serves predictions.

FEATURE_COLUMNS must stay in sync with the same constant in ml/train.py and
ml/feature_engineering.py -- the models were fit on exactly this column
order. See README.md for the shared feature contract.
"""

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.config import get_settings

logger = logging.getLogger("ml.predictor")
settings = get_settings()

FEATURE_COLUMNS = ["hour", "day_of_week", "is_weekend", "capacity_ratio", "rolling_avg_occupancy"]


class OccupancyPredictor:
    def __init__(self, model_dir: str):
        model_path = Path(model_dir)
        regressor_path = model_path / "occupancy_regressor.joblib"
        classifier_path = model_path / "threshold_classifier.joblib"
        meta_path = model_path / "feature_meta.json"

        if not regressor_path.exists() or not classifier_path.exists():
            raise FileNotFoundError(
                f"ML model artifacts not found in {model_path}. "
                "Run `python ml/train.py` first (see README)."
            )

        self.regressor = joblib.load(regressor_path)
        self.classifier = joblib.load(classifier_path)
        self.meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        self.max_capacity_seen = float(self.meta.get("max_capacity_seen", 1000))
        self.hourly_baseline = {
            int(k): v for k, v in self.meta.get("hourly_baseline_occupancy_pct", {}).items()
        }

    def _capacity_ratio(self, total_slots: int) -> float:
        return min(total_slots / self.max_capacity_seen, 1.0)

    def baseline_for_hour(self, hour: int, fallback: float) -> float:
        return self.hourly_baseline.get(hour, fallback)

    def predict_curve(
        self,
        total_slots: int,
        current_occupancy_pct: float,
        now: datetime,
        hours_ahead: int = 24,
        threshold_pct: float = 85.0,
    ) -> list[dict]:
        capacity_ratio = self._capacity_ratio(total_slots)
        history = [current_occupancy_pct]
        points: list[dict] = []

        for step in range(hours_ahead):
            ts = now + timedelta(hours=step)
            hour = ts.hour
            day_of_week = ts.weekday()
            is_weekend = 1 if day_of_week >= 5 else 0
            rolling_avg = float(np.mean(history[-3:]))

            row = pd.DataFrame(
                [[hour, day_of_week, is_weekend, capacity_ratio, rolling_avg]],
                columns=FEATURE_COLUMNS,
            )
            predicted = float(self.regressor.predict(row)[0])
            predicted = max(0.0, min(100.0, predicted))
            will_cross = bool(self.classifier.predict(row)[0])

            points.append(
                {
                    "timestamp": ts,
                    "hour": hour,
                    "predicted_occupancy_pct": round(predicted, 1),
                    "will_cross_threshold": will_cross,
                }
            )
            history.append(predicted)

        return points


_predictor: OccupancyPredictor | None = None


def get_predictor() -> OccupancyPredictor:
    global _predictor
    if _predictor is None:
        _predictor = OccupancyPredictor(settings.ml_model_dir)
    return _predictor
