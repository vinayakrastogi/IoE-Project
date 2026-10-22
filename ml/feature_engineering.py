"""Shared data loading + feature engineering for the occupancy models.

FEATURE_COLUMNS must stay in sync with backend/app/ml/predictor.py -- the
saved models are fit on exactly this column order, and the backend builds
inference rows with the same list.
"""

import io
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import requests

FEATURE_COLUMNS = ["hour", "day_of_week", "is_weekend", "capacity_ratio", "rolling_avg_occupancy"]
TARGET_REGRESSION = "occupancy_pct"
TARGET_CLASSIFICATION = "will_cross_threshold"

UCI_DATASET_ID = 482
UCI_FALLBACK_ZIP_URL = "https://archive.ics.uci.edu/static/public/482/parking+birmingham.zip"
DATA_DIR = Path(__file__).parent / "data"
RAW_CSV_PATH = DATA_DIR / "birmingham_raw.csv"

ROLLING_WINDOW = 3
DEFAULT_THRESHOLD_PCT = 85.0


def load_birmingham_dataset(force_download: bool = False) -> pd.DataFrame:
    """Load the UCI "Parking Birmingham" dataset (id=482).

    Tries `ucimlrepo.fetch_ucirepo` first, per the assignment brief. As of
    writing, that dataset id raises `DatasetNotFoundError` from ucimlrepo
    (the dataset predates ucimlrepo's standard tabular export), so we fall
    back to downloading the archive's static CSV export directly. Either
    way the result is cached to ml/data/birmingham_raw.csv so re-runs and
    the offline notebook don't need network access.
    """
    if RAW_CSV_PATH.exists() and not force_download:
        return pd.read_csv(RAW_CSV_PATH, parse_dates=["LastUpdated"])

    df = None
    try:
        from ucimlrepo import fetch_ucirepo

        dataset = fetch_ucirepo(id=UCI_DATASET_ID)
        df = dataset.data.features.copy()
        if dataset.data.targets is not None and len(dataset.data.targets.columns) > 0:
            df = df.join(dataset.data.targets)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        print(f"ucimlrepo.fetch_ucirepo failed ({exc}); falling back to direct CSV download.")

    if df is None:
        response = requests.get(UCI_FALLBACK_ZIP_URL, timeout=60)
        response.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            with zf.open("dataset.csv") as f:
                df = pd.read_csv(f)

    df["LastUpdated"] = pd.to_datetime(df["LastUpdated"])
    df = df.sort_values(["SystemCodeNumber", "LastUpdated"]).reset_index(drop=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(RAW_CSV_PATH, index=False)
    return df


def engineer_features(
    df: pd.DataFrame, threshold_pct: float = DEFAULT_THRESHOLD_PCT
) -> pd.DataFrame:
    """Turn raw (SystemCodeNumber, Capacity, Occupancy, LastUpdated) rows into
    the feature set the models are trained/served on.
    """
    out = df.copy()
    out["occupancy_pct"] = (out["Occupancy"] / out["Capacity"] * 100).clip(0, 100)
    out["hour"] = out["LastUpdated"].dt.hour
    out["day_of_week"] = out["LastUpdated"].dt.dayofweek
    out["is_weekend"] = (out["day_of_week"] >= 5).astype(int)

    max_capacity_seen = out["Capacity"].max()
    out["capacity_ratio"] = (out["Capacity"] / max_capacity_seen).clip(0, 1)

    out = out.sort_values(["SystemCodeNumber", "LastUpdated"])
    grouped = out.groupby("SystemCodeNumber")["occupancy_pct"]
    # shift(1) before the rolling mean so the feature only ever sees past
    # readings -- otherwise the target would leak into its own feature.
    out["rolling_avg_occupancy"] = (
        grouped.transform(lambda s: s.shift(1).rolling(ROLLING_WINDOW, min_periods=1).mean())
    )
    out["rolling_avg_occupancy"] = out["rolling_avg_occupancy"].fillna(out["occupancy_pct"])

    next_occupancy = out.groupby("SystemCodeNumber")["occupancy_pct"].shift(-1)
    out["will_cross_threshold"] = (next_occupancy >= threshold_pct).astype(int)
    # The last reading per lot has no real "next" row to compare against, so
    # drop it rather than keep a fabricated will_cross_threshold=0 label.
    out = out[out.groupby("SystemCodeNumber").cumcount(ascending=False) > 0]

    out.attrs["max_capacity_seen"] = float(max_capacity_seen)
    return out.reset_index(drop=True)


def time_based_split(df: pd.DataFrame, test_frac: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Chronological split (not random) so the test set is strictly later in
    time than train -- realistic for a forecasting task and avoids leaking
    future readings into training via the rolling-average feature.
    """
    cutoff = df["LastUpdated"].quantile(1 - test_frac)
    train_df = df[df["LastUpdated"] < cutoff]
    test_df = df[df["LastUpdated"] >= cutoff]
    return train_df, test_df


def hourly_baseline_occupancy(df: pd.DataFrame) -> dict[int, float]:
    return df.groupby("hour")["occupancy_pct"].mean().round(1).to_dict()


def compute_class_weight_note(df: pd.DataFrame) -> float:
    """Share of rows that are positive for the threshold-breach class, useful
    for sanity-checking the classifier isn't just always predicting 0."""
    return float(df[TARGET_CLASSIFICATION].mean())
