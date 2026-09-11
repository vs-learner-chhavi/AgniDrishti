import pandas as pd
import numpy as np
from pathlib import Path

INPUT_FILE = Path("data/processed/fire_type_features.parquet")
OUTPUT_FILE = Path("data/processed/fire_type_dataset.parquet")


def assign_label(row):
    # Highest priority: known/persistent gas-related thermal sources
    if (
        row["near_gas_1km"] == 1
        and row["active_days_30d"] >= 5
    ):
        return "gas_flare"

    # Mining-related thermal activity
    if (
        row["near_mining_2km"] == 1
        and row["persistent_activity"] == 1
    ):
        return "mining_thermal_source"

    # Industrial thermal activity
    if (
        row["near_industrial_1km"] == 1
        and row["persistent_activity"] == 1
    ):
        return "industrial_fire"

    # Agricultural burning: low persistence and seasonal activity
    if (
        row["low_persistence_flag"] == 1
        and row["month"] in [3, 4, 5, 10, 11]
    ):
        return "agricultural_burning"

    # Wildfire: persistent activity away from infrastructure
    if (
        row["persistent_activity"] == 1
        and row["distance_to_industrial_km"] > 2
        and row["distance_to_mining_km"] > 2
        and row["distance_to_gas_km"] > 2
    ):
        return "wildfire"

    return "unknown"


def main():
    df = pd.read_parquet(INPUT_FILE)

    df["fire_type"] = df.apply(assign_label, axis=1)

    # Confidence is based on how strongly the rule matched
    df["label_confidence"] = np.select(
        [
            df["fire_type"].isin([
                "gas_flare",
                "mining_thermal_source"
            ]),
            df["fire_type"].isin([
                "industrial_fire",
                "agricultural_burning",
                "wildfire"
            ]),
        ],
        [
            "high",
            "medium",
        ],
        default="low"
    )

    df.to_parquet(OUTPUT_FILE, index=False)

    print("\nFire-type dataset created.")
    print("Shape:", df.shape)
    print("\nClass distribution:")
    print(df["fire_type"].value_counts())
    print("\nConfidence distribution:")
    print(df["label_confidence"].value_counts())


if __name__ == "__main__":
    main()