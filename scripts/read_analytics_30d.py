from pathlib import Path
import json
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "processed" / "firms_clean.parquet"
PREDICTIONS = ROOT / "data" / "processed" / "recent_fire_type_predictions.parquet"


def pick_column(columns, candidates):
    lower = {str(c).lower(): c for c in columns}
    for candidate in candidates:
        if candidate.lower() in lower:
            return lower[candidate.lower()]
    return None


LABELS = {
    "agricultural_burning": "Agricultural Burning",
    "gas_flare": "Gas Flare",
    "mining_thermal_source": "Mining Thermal Source",
    "wildfire": "Wildfire",
    "industrial_fire": "Industrial Fire",
}


def main():
    if not INPUT.exists():
        raise FileNotFoundError(f"Processed dataset not found: {INPUT}")

    frame = pd.read_parquet(INPUT)

    date_col = pick_column(frame.columns, ["timestamp", "observation_datetime", "datetime"])
    if date_col is None:
        date_col = pick_column(frame.columns, ["date"])
    if date_col is None:
        raise ValueError("No observation date/time field was found in firms_clean.parquet.")

    if date_col == pick_column(frame.columns, ["date"]):
        time_col = pick_column(frame.columns, ["time"])
        if time_col is not None:
            stamp = (
                frame[date_col].astype(str).str.strip()
                + " "
                + frame[time_col].astype(str).str.strip()
            )
            frame["_analytics_time"] = pd.to_datetime(stamp, errors="coerce", utc=True)
        else:
            frame["_analytics_time"] = pd.to_datetime(frame[date_col], errors="coerce", utc=True)
    else:
        frame["_analytics_time"] = pd.to_datetime(frame[date_col], errors="coerce", utc=True)

    frame = frame.dropna(subset=["_analytics_time"]).copy()
    if frame.empty:
        raise ValueError("The processed dataset contains no valid observation timestamps.")

    frame["_day"] = frame["_analytics_time"].dt.tz_convert(None).dt.normalize()

    latest = frame["_day"].max()
    first = latest - pd.Timedelta(days=29)

    frame = frame[(frame["_day"] >= first) & (frame["_day"] <= latest)].copy()

    # Merge in model-predicted fire types for rows the raw dataset never classified.
    # Predictions come from the project's own trained classifier (ml/predict_fire_type.py),
    # never invented. Labeled "(predicted)" so it's honest about being inferred, not raw FIRMS truth.
    
    if PREDICTIONS.exists():
        preds = pd.read_parquet(PREDICTIONS)

        frame["_lat_key"] = frame["latitude"].round(5)
        frame["_lon_key"] = frame["longitude"].round(5)
        preds["_lat_key"] = preds["latitude"].astype("float64").round(5)
        preds["_lon_key"] = preds["longitude"].astype("float64").round(5)

        join_keys = ["_lat_key", "_lon_key", "date", "time", "satellite"]
        frame = frame.merge(
            preds[join_keys + ["predicted_fire_type"]],
            on=join_keys,
            how="left",
        )
        frame = frame.drop(columns=["_lat_key", "_lon_key"])
    else:
        frame["predicted_fire_type"] = pd.NA

    type_col = pick_column(frame.columns, ["fire_type", "firms_type"])

    def resolve_label(row):
        raw = row.get(type_col) if type_col else None
        if pd.notna(raw) and str(raw).strip() != "":
            try:
                return f"Type {int(float(raw))}"
            except (ValueError, TypeError):
                return str(raw).strip()
        pred = row.get("predicted_fire_type")
        if pd.notna(pred) and str(pred).strip() != "":
            label = LABELS.get(str(pred), str(pred).replace("_", " ").title())
            return f"{label} (predicted)"
        return "Unclassified"

    frame["_fire_type"] = frame.apply(resolve_label, axis=1)

    fire_types = sorted(frame["_fire_type"].dropna().unique().tolist())

    days = []
    for day in pd.date_range(first, latest, freq="D"):
        subset = frame[frame["_day"] == day]
        type_counts = subset["_fire_type"].value_counts().to_dict()

        numeric = subset.copy()
        for column in ["frp", "brightness"]:
            if column in numeric.columns:
                numeric[column] = pd.to_numeric(numeric[column], errors="coerce")

        days.append(
            {
                "date": day.strftime("%Y-%m-%d"),
                "detections": int(len(subset)),
                "totalFrp": round(float(numeric["frp"].sum()), 4) if "frp" in numeric else 0,
                "maxFrp": round(float(numeric["frp"].max()), 4)
                if "frp" in numeric and numeric["frp"].notna().any()
                else 0,
                "meanFrp": round(float(numeric["frp"].mean()), 4)
                if "frp" in numeric and numeric["frp"].notna().any()
                else 0,
                "maxBrightness": round(float(numeric["brightness"].max()), 4)
                if "brightness" in numeric and numeric["brightness"].notna().any()
                else 0,
                "meanBrightness": round(float(numeric["brightness"].mean()), 4)
                if "brightness" in numeric and numeric["brightness"].notna().any()
                else 0,
                "types": {str(k): int(v) for k, v in type_counts.items()},
            }
        )

    payload = {
        "ok": True,
        "source": "data/processed/firms_clean.parquet",
        "metric": "detections",
        "typeField": str(type_col) if type_col else "predicted_fire_type",
        "dateField": str(date_col),
        "window": {
            "from": first.strftime("%Y-%m-%d"),
            "to": latest.strftime("%Y-%m-%d"),
        },
        "fireTypes": fire_types,
        "totalDetections": int(len(frame)),
        "days": days,
    }

    print(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise