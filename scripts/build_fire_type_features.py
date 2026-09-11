from pathlib import Path
import pandas as pd
import numpy as np
from sklearn.neighbors import BallTree

FIRMS_FILE = Path("data/processed/firms_features.parquet")
OUTPUT_FILE = Path("data/processed/fire_type_features.parquet")

OSM_DIR = Path("data/raw/osm")

EARTH_RADIUS_KM = 6371.0


def nearest_distance_km(df, points):
    if points.empty:
        return np.full(len(df), np.nan)

    fire_coords = np.radians(
        df[["latitude", "longitude"]].to_numpy()
    )

    point_coords = np.radians(
        points[["latitude", "longitude"]].to_numpy()
    )

    tree = BallTree(point_coords, metric="haversine")
    distances, _ = tree.query(fire_coords, k=1)

    return distances[:, 0] * EARTH_RADIUS_KM


def main():
    print("Loading FIRMS features...")
    df = pd.read_parquet(FIRMS_FILE)

    df["firms_type"] = df["firms_type"].fillna("UNKNOWN")

    for category in ["industrial", "mining", "gas"]:
        path = OSM_DIR / f"{category}.parquet"

        if not path.exists():
            print(f"Missing {path}; filling distances with NaN.")
            df[f"distance_to_{category}_km"] = np.nan
            continue

        points = pd.read_parquet(path)

        print(
            f"Calculating distance to {category}: "
            f"{len(points):,} infrastructure points"
        )

        df[f"distance_to_{category}_km"] = nearest_distance_km(
            df,
            points
        )

    # Useful proximity flags
    df["near_industrial_1km"] = (
        df["distance_to_industrial_km"] <= 1
    ).astype(int)

    df["near_mining_2km"] = (
        df["distance_to_mining_km"] <= 2
    ).astype(int)

    df["near_gas_1km"] = (
        df["distance_to_gas_km"] <= 1
    ).astype(int)

    # Thermal and temporal features
    df["night_fire_flag"] = (df["daynight"] == "N").astype(int)

    df["persistent_activity"] = (
        (df["active_days_7d"] >= 3) |
        (df["active_days_30d"] >= 10)
    ).astype(int)

    df["high_frp_flag"] = (
        df["frp"] >= df["frp"].quantile(0.90)
    ).astype(int)

    df["low_persistence_flag"] = (
        df["active_days_30d"] <= 2
    ).astype(int)


    # Ensure mixed-type columns can be safely saved to Parquet
    for col in df.columns:
        if df[col].dtype == "object":
            df[col] = df[col].astype("string")
    df.to_parquet(OUTPUT_FILE, index=False)

    print("\nSaved:")
    print(OUTPUT_FILE)
    print("Shape:", df.shape)


if __name__ == "__main__":
    main()