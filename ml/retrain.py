"""Retrain the occupancy models on OUR OWN accumulated data instead of the
Birmingham dataset, once enough entry/exit history has built up.

The Birmingham dataset teaches the model a *shape* (commuter lots fill
through the morning, peak around midday, drain in the evening) but its car
parks have capacities in the hundreds/thousands -- very different from our
`TOTAL_SLOTS`-slot simulated lot. `capacity_ratio` lets the model account
for lot size, but a 20-slot lot is still far outside the training
distribution. This script closes that gap by reconstructing an hourly
occupancy time series from our own entry_logs table and retraining on it,
falling back to blending with the Birmingham data when we don't yet have
enough real history for a stable fit.

Usage:
    DATABASE_URL=postgresql+psycopg2://parking:parking@localhost:5432/parking \
        python retrain.py
"""

import json
import os
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sqlalchemy import create_engine

from feature_engineering import (
    FEATURE_COLUMNS,
    TARGET_CLASSIFICATION,
    TARGET_REGRESSION,
    DEFAULT_THRESHOLD_PCT,
    engineer_features,
    hourly_baseline_occupancy,
    load_birmingham_dataset,
)

MODELS_DIR = Path(__file__).parent / "models"
MIN_REAL_ROWS = 500  # below this we blend with Birmingham data instead of training alone

ENTRY_LOGS_SQL = """
    SELECT b.slot_id, e.entry_time, e.exit_time
    FROM entry_logs e
    JOIN bookings b ON b.id = e.booking_id
    WHERE e.entry_time IS NOT NULL
"""


def _database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql+psycopg2://parking:parking@localhost:5432/parking"
    )


def build_hourly_occupancy_from_logs(total_slots: int) -> pd.DataFrame:
    """Bucket real entry/exit events into hourly lot-wide occupancy %.

    For each observed hour, occupancy_pct = (slots with an active
    entry/exit interval overlapping that hour) / total_slots * 100.
    """
    engine = create_engine(_database_url())
    logs = pd.read_sql(ENTRY_LOGS_SQL, engine, parse_dates=["entry_time", "exit_time"])
    if logs.empty:
        return pd.DataFrame(columns=["LastUpdated", "SystemCodeNumber", "Capacity", "Occupancy"])

    # Postgres returns tz-aware timestamps; normalize to naive UTC so the
    # hour-bucket arithmetic below doesn't have to reason about tz at all.
    for col in ("entry_time", "exit_time"):
        if isinstance(logs[col].dtype, pd.DatetimeTZDtype):
            logs[col] = logs[col].dt.tz_convert("UTC").dt.tz_localize(None)

    logs["exit_time"] = logs["exit_time"].fillna(pd.Timestamp.now("UTC").tz_localize(None))
    start = logs["entry_time"].min().floor("h")
    end = logs["exit_time"].max().ceil("h")
    hours = pd.date_range(start, end, freq="h")

    rows = []
    for hour in hours:
        active = logs[(logs["entry_time"] < hour + pd.Timedelta(hours=1)) & (logs["exit_time"] >= hour)]
        occupied_slots = active["slot_id"].nunique()
        rows.append({"LastUpdated": hour, "Occupancy": occupied_slots})

    df = pd.DataFrame(rows)
    df["SystemCodeNumber"] = "OUR_LOT"
    df["Capacity"] = total_slots
    return df[["SystemCodeNumber", "Capacity", "Occupancy", "LastUpdated"]]


def retrain(total_slots: int = 20) -> dict:
    real_raw = build_hourly_occupancy_from_logs(total_slots)
    print(f"Reconstructed {len(real_raw)} hourly readings from our own entry_logs.")

    if len(real_raw) >= MIN_REAL_ROWS:
        print("Enough real data -- training on our own lot's history only.")
        raw = real_raw
    else:
        print(
            f"Only {len(real_raw)} real rows (< {MIN_REAL_ROWS}); "
            "blending with the Birmingham dataset for a stable fit."
        )
        birmingham = load_birmingham_dataset()
        raw = pd.concat([birmingham, real_raw], ignore_index=True) if len(real_raw) else birmingham

    features = engineer_features(raw, threshold_pct=DEFAULT_THRESHOLD_PCT)
    X, y_reg = features[FEATURE_COLUMNS], features[TARGET_REGRESSION]
    y_clf = features[TARGET_CLASSIFICATION]

    regressor = RandomForestRegressor(
        n_estimators=200, max_depth=12, min_samples_leaf=3, n_jobs=-1, random_state=42
    )
    regressor.fit(X, y_reg)

    classifier = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        min_samples_leaf=3,
        class_weight="balanced",
        n_jobs=-1,
        random_state=42,
    )
    classifier.fit(X, y_clf)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(regressor, MODELS_DIR / "occupancy_regressor.joblib")
    joblib.dump(classifier, MODELS_DIR / "threshold_classifier.joblib")

    feature_meta = {
        "feature_columns": FEATURE_COLUMNS,
        "max_capacity_seen": float(features["Capacity"].max()),
        "hourly_baseline_occupancy_pct": hourly_baseline_occupancy(features),
        "trained_on_rows": len(features),
        "real_rows_used": len(real_raw),
        "source": "own_data" if len(real_raw) >= MIN_REAL_ROWS else "blended_with_birmingham",
    }
    (MODELS_DIR / "feature_meta.json").write_text(json.dumps(feature_meta, indent=2))
    print(f"Retrained and saved model artifacts to {MODELS_DIR}")
    print(json.dumps(feature_meta, indent=2, default=str))
    return feature_meta


if __name__ == "__main__":
    retrain()
