from pathlib import Path
import pandas as pd
import numpy as np

INPUT_FILE = Path("data/processed/firms_features.parquet")
OUTPUT_FILE = Path("data/processed/training_dataset_balanced.parquet")

NEGATIVE_RATIO = 2
RANDOM_STATE = 42


def build_dataset():
    print("Loading FIRMS features...")
    df = pd.read_parquet(INPUT_FILE)

    df["firms_type"] = df["firms_type"].fillna("UNKNOWN")
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])

    # Remove duplicate detections
    df = df.drop_duplicates(subset=["event_id"]).copy()

    # Aggregate detections by grid and date
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

    daily = daily.sort_values(["grid_id", "date"])

    # Label whether the same grid has a fire on the next day
    next_day = daily[["grid_id", "date"]].copy()
    next_day["date"] = next_day["date"] - pd.Timedelta(days=1)
    next_day["wildfire_next_24h"] = 1

    daily = daily.merge(
        next_day,
        on=["grid_id", "date"],
        how="left",
        suffixes=("", "_future")
    )

    daily["wildfire_next_24h"] = (
        daily["wildfire_next_24h"]
        .fillna(0)
        .astype(int)
    )

    # Temporal features
    daily["year"] = daily["date"].dt.year
    daily["month"] = daily["date"].dt.month
    daily["day_of_year"] = daily["date"].dt.dayofyear
    daily["is_weekend"] = (
        daily["date"].dt.dayofweek >= 5
    ).astype(int)

    # All existing rows are fire-observation days.
    # Create a negative pool from days where no next-day fire occurs.
    positives = daily[daily["wildfire_next_24h"] == 1]
    negatives = daily[daily["wildfire_next_24h"] == 0]

    target_negatives = min(
        len(negatives),
        len(positives) * NEGATIVE_RATIO
    )

    negatives = negatives.sample(
        n=target_negatives,
        random_state=RANDOM_STATE
    )

    balanced = pd.concat(
        [positives, negatives],
        ignore_index=True
    ).sample(
        frac=1,
        random_state=RANDOM_STATE
    ).reset_index(drop=True)

    balanced.to_parquet(OUTPUT_FILE, index=False)

    print("\nBalanced dataset created.")
    print("Shape:", balanced.shape)
    print("\nTarget distribution:")
    print(balanced["wildfire_next_24h"].value_counts())
    print("\nTarget proportions:")
    print(balanced["wildfire_next_24h"].value_counts(normalize=True))


if __name__ == "__main__":
    build_dataset()