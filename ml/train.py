"""Train the occupancy regressor + threshold classifier served by the backend.

Usage:
    python train.py

Produces, under ml/models/:
    occupancy_regressor.joblib   RandomForestRegressor -> predicted occupancy %
    threshold_classifier.joblib  RandomForestClassifier -> will cross 85% next reading
    feature_meta.json            max_capacity_seen, hourly baseline, metrics

See feature_engineering.py for the shared feature contract (FEATURE_COLUMNS)
that this script and backend/app/ml/predictor.py both rely on.
"""

import json
import os
from pathlib import Path

import joblib
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    precision_score,
    recall_score,
    roc_auc_score,
    root_mean_squared_error,
    r2_score,
)

from feature_engineering import (
    FEATURE_COLUMNS,
    TARGET_CLASSIFICATION,
    TARGET_REGRESSION,
    engineer_features,
    hourly_baseline_occupancy,
    load_birmingham_dataset,
    time_based_split,
)

MODELS_DIR = Path(__file__).parent / "models"


def _artifacts_exist() -> bool:
    return (MODELS_DIR / "occupancy_regressor.joblib").exists() and (
        MODELS_DIR / "threshold_classifier.joblib"
    ).exists()


def train() -> dict:
    if _artifacts_exist() and os.environ.get("FORCE_RETRAIN") != "1":
        print(f"Model artifacts already exist in {MODELS_DIR}; skipping training.")
        print("Set FORCE_RETRAIN=1 to retrain anyway.")
        meta_path = MODELS_DIR / "feature_meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        return meta.get("metrics", meta)

    print("Loading Birmingham dataset...")
    raw = load_birmingham_dataset()
    print(f"  {len(raw)} raw readings across {raw['SystemCodeNumber'].nunique()} car parks")

    print("Engineering features...")
    features = engineer_features(raw)
    train_df, test_df = time_based_split(features, test_frac=0.2)
    print(f"  train={len(train_df)} test={len(test_df)} (chronological split)")

    X_train, y_train_reg = train_df[FEATURE_COLUMNS], train_df[TARGET_REGRESSION]
    X_test, y_test_reg = test_df[FEATURE_COLUMNS], test_df[TARGET_REGRESSION]
    y_train_clf, y_test_clf = train_df[TARGET_CLASSIFICATION], test_df[TARGET_CLASSIFICATION]

    print("Training RandomForestRegressor (occupancy %)...")
    regressor = RandomForestRegressor(
        n_estimators=200, max_depth=12, min_samples_leaf=3, n_jobs=-1, random_state=42
    )
    regressor.fit(X_train, y_train_reg)
    reg_preds = regressor.predict(X_test)

    print("Training RandomForestClassifier (will cross threshold)...")
    classifier = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        min_samples_leaf=3,
        class_weight="balanced",
        n_jobs=-1,
        random_state=42,
    )
    classifier.fit(X_train, y_train_clf)
    clf_preds = classifier.predict(X_test)
    clf_proba = classifier.predict_proba(X_test)[:, 1]

    metrics = {
        "regression": {
            "rmse": round(float(root_mean_squared_error(y_test_reg, reg_preds)), 3),
            "mae": round(float(mean_absolute_error(y_test_reg, reg_preds)), 3),
            "r2": round(float(r2_score(y_test_reg, reg_preds)), 3),
        },
        "classification": {
            "accuracy": round(float(accuracy_score(y_test_clf, clf_preds)), 3),
            "precision": round(float(precision_score(y_test_clf, clf_preds, zero_division=0)), 3),
            "recall": round(float(recall_score(y_test_clf, clf_preds, zero_division=0)), 3),
            "f1": round(float(f1_score(y_test_clf, clf_preds, zero_division=0)), 3),
            "roc_auc": round(float(roc_auc_score(y_test_clf, clf_proba)), 3),
        },
    }

    print("Test metrics:")
    print(json.dumps(metrics, indent=2))

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(regressor, MODELS_DIR / "occupancy_regressor.joblib")
    joblib.dump(classifier, MODELS_DIR / "threshold_classifier.joblib")

    feature_meta = {
        "feature_columns": FEATURE_COLUMNS,
        "max_capacity_seen": features.attrs["max_capacity_seen"],
        "hourly_baseline_occupancy_pct": hourly_baseline_occupancy(features),
        "trained_on_rows": len(features),
        "metrics": metrics,
    }
    (MODELS_DIR / "feature_meta.json").write_text(json.dumps(feature_meta, indent=2))
    print(f"Saved model artifacts to {MODELS_DIR}")

    return metrics


if __name__ == "__main__":
    train()
