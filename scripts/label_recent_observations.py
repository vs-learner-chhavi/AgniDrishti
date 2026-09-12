"""Predict firms_type for the last-30-day window using the existing trained model.
Never trains anything; only runs inference on real feature values already in the dataset."""
from pathlib import Path
import sys
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))

from observation_features import CONTRACT
from predict_fire_type import predictor

INPUT = ROOT / "data/processed/firms_features.parquet"
OUTPUT = ROOT / "data/processed/recent_fire_type_predictions.parquet"

frame = pd.read_parquet(INPUT)
frame["_time"] = pd.to_datetime(frame["timestamp"], utc=True, errors="coerce")
frame = frame.dropna(subset=["_time"]).copy()
frame["_day"] = frame["_time"].dt.tz_convert(None).dt.normalize()

latest = frame["_day"].max()
first = latest - pd.Timedelta(days=29)
window = frame[(frame["_day"] >= first) & (frame["_day"] <= latest)].copy()

need_predict = window[window["firms_type"].isna()].copy()
print(f"Window rows: {len(window)}, needing prediction: {len(need_predict)}")

base_cols = [
    "brightness", "bright_t31", "frp", "confidence_score", "log_frp", "thermal_excess",
    "hour", "month", "day_of_year", "is_night", "hotspot_count_7d", "active_days_7d",
    "hotspot_count_30d", "active_days_30d", "persistence_ratio_7d", "persistence_ratio_30d",
    "persistent_source_flag", "high_persistence_flag", "daily_total_frp",
    "daily_max_brightness", "daily_mean_confidence", "frp_per_detection_30d", "persistence_score",
]

feat_df = need_predict[base_cols].apply(pd.to_numeric, errors="coerce")
feat_df["night_fire_flag"] = feat_df["is_night"]
feat_df["persistent_activity"] = ((feat_df["active_days_7d"] >= 3) | (feat_df["active_days_30d"] >= 10)).astype(int)
feat_df["high_frp_flag"] = (feat_df["frp"] >= CONTRACT["high_frp_threshold"]).astype(int)
feat_df["low_persistence_flag"] = (feat_df["active_days_30d"] <= 2).astype(int)

valid_mask = feat_df.notna().all(axis=1)
print(f"Rows with complete model inputs: {valid_mask.sum()} of {len(feat_df)}")

predictable = need_predict[valid_mask].copy()
X = feat_df[valid_mask]

predictions = predictor.predict(X)

predictable["predicted_fire_type"] = [p["fire_type"] for p in predictions]
predictable["confidence"] = [p["confidence"] for p in predictions]

result = predictable[["latitude", "longitude", "date", "time", "satellite", "predicted_fire_type", "confidence"]]
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
result.to_parquet(OUTPUT, index=False)

print(f"Predicted {len(result)} rows, saved to {OUTPUT}")
print(result["predicted_fire_type"].value_counts())