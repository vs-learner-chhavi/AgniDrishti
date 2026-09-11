from pathlib import Path
import pandas as pd
import numpy as np

INPUT_FILE = Path("data/processed/firms_features.parquet")
OUTPUT_FILE = Path("data/processed/training_dataset.parquet")

GRID_SIZE = 0.05


def create_grid_id(latitude, longitude):
    lat_grid = np.floor(latitude / GRID_SIZE).astype(int)
    lon_grid = np.floor(longitude / GRID_SIZE).astype(int)
    return lat_grid.astype(str) + "_" + lon_grid.astype(str)


def build_dataset():
    print("Loading FIRMS features...")
    df = pd.read_parquet(INPUT_FILE)

    # Basic cleanup
    df["firms_type"] = df["firms_type"].fillna("UNKNOWN")
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"]).dt.date

    # Remove exact duplicate event IDs
    before = len(df)
    df = df.drop_duplicates(subset=["event_id"]).copy()
    print(f"Removed {before - len(df)} duplicate event IDs")

    # Ensure grid ID exists
    if "grid_id" not in df.columns:
        df["grid_id"] = create_grid_id(
            df["latitude"],
            df["longitude"]
        )

    # Aggregate satellite detections into grid-day records
    print("Aggregating detections into grid-day records...")

    daily = (
        df.groupby(["grid_id", "date"], as_index=False)
        .agg(
            latitude=("latitude", "mean"),
            longitude=("longitude", "mean"),

            fire_count=("event_id", "count"),

            frp_sum=("frp", "sum"),
            frp_mean=("frp", "mean"),
            frp_max=("frp", "max"),

            brightness_mean=("brightness", "mean"),
            brightness_max=("brightness", "max"),

            confidence_mean=("confidence_score", "mean"),
            confidence_max=("confidence_score", "max"),

            hotspot_count_7d=("hotspot_count_7d", "max"),
            active_days_7d=("active_days_7d", "max"),

            hotspot_count_30d=("hotspot_count_30d", "max"),
            active_days_30d=("active_days_30d", "max"),

            persistence_ratio_7d=("persistence_ratio_7d", "max"),
            persistence_ratio_30d=("persistence_ratio_30d", "max"),

            persistent_source_flag=("persistent_source_flag", "max"),
            high_persistence_flag=("high_persistence_flag", "max"),
            persistence_score=("persistence_score", "max"),

            daily_total_frp=("daily_total_frp", "max"),
            daily_max_brightness=("daily_max_brightness", "max"),
            daily_mean_confidence=("daily_mean_confidence", "max"),
        )
    )

    daily["date"] = pd.to_datetime(daily["date"])

    # Temporal features
    daily["year"] = daily["date"].dt.year
    daily["month"] = daily["date"].dt.month
    daily["day_of_year"] = daily["date"].dt.dayofyear
    daily["is_weekend"] = (daily["date"].dt.dayofweek >= 5).astype(int)

    # Create next-24-hour fire label.
    # A positive label means another detection occurs in the same grid
    # during the following day.
    daily = daily.sort_values(["grid_id", "date"])

    daily["next_date"] = daily["date"] + pd.Timedelta(days=1)

    future_events = daily[
        ["grid_id", "date"]
    ].rename(
        columns={"date": "next_date"}
    )

    future_events["wildfire_next_24h"] = 1

    daily = daily.merge(
        future_events,
        on=["grid_id", "next_date"],
        how="left"
    )

    daily["wildfire_next_24h"] = (
        daily["wildfire_next_24h"]
        .fillna(0)
        .astype(int)
    )

    daily = daily.drop(columns=["next_date"])

    # Remove rows without useful fire observations
    daily = daily[daily["fire_count"] > 0].copy()

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    daily.to_parquet(OUTPUT_FILE, index=False)

    print("\nDataset created successfully.")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Shape: {daily.shape}")
    print("\nTarget distribution:")
    print(daily["wildfire_next_24h"].value_counts())
    print("\nColumns:")
    print(daily.columns.tolist())


if __name__ == "__main__":
    build_dataset()