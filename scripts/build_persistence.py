"""
Build persistence and hotspot features from cleaned NASA FIRMS data.

Input:
    data/processed/firms_clean.parquet

Output:
    data/processed/firms_features.parquet

The script:
1. Loads cleaned FIRMS detections.
2. Aggregates detections into spatial cells and calendar days.
3. Calculates prior 7-day and 30-day persistence.
4. Avoids rolling().apply(), which is extremely slow for sparse spatial groups.
5. Merges persistence features back into every individual FIRMS detection.
"""

from pathlib import Path
import json
import time

import numpy as np
import pandas as pd


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[1]

INPUT_PATH = BASE_DIR / "data" / "processed" / "firms_clean.parquet"
OUTPUT_PATH = BASE_DIR / "data" / "processed" / "firms_features.parquet"
REPORT_PATH = BASE_DIR / "data" / "reports" / "persistence_report.json"

# Approximately 5 km spatial cells in India.
# This is appropriate for persistence analysis and reduces memory usage.
GRID_SIZE = 0.05

# Persistence windows in calendar days.
WINDOW_7 = 7
WINDOW_30 = 30

# A cell is considered persistent when it has repeated activity
# over the previous 30 calendar days.
PERSISTENT_ACTIVE_DAYS_THRESHOLD = 5

# A stronger persistent-source threshold.
PERSISTENT_DETECTIONS_THRESHOLD = 10


# ============================================================
# HELPERS
# ============================================================

def print_step(message: str):
    """Print a timestamped progress message."""
    elapsed = time.strftime("%H:%M:%S")
    print(f"[{elapsed}] {message}", flush=True)


def calculate_prior_window_features(
    daily: pd.DataFrame,
    window_days: int,
) -> pd.DataFrame:
    """
    Calculate persistence features using previous calendar days.

    Important:
    - The current day is excluded to reduce temporal leakage.
    - Sparse dates are handled correctly.
    - We do not use rolling().count(), because that counts rows,
      not necessarily distinct active calendar days.
    """

    print_step(
        f"Calculating previous {window_days}-day features "
        f"for {daily['grid_id'].nunique():,} spatial cells..."
    )

    window_ns = window_days * 24 * 60 * 60 * 1_000_000_000

    count_result = np.zeros(len(daily), dtype=np.int32)
    active_days_result = np.zeros(len(daily), dtype=np.int16)

    grouped = daily.groupby("grid_id", sort=False, observed=True)

    total_groups = daily["grid_id"].nunique()
    processed_groups = 0

    for _, group in grouped:
        indices = group.index.to_numpy()

        # Daily rows are already unique per grid/date.
        dates = (
            group["date_only"]
            .to_numpy(dtype="datetime64[ns]")
            .astype("int64")
        )

        counts = group["daily_hotspot_count"].to_numpy(dtype=np.int64)

        # Cumulative number of detections within this grid.
        cumulative = np.cumsum(counts, dtype=np.int64)

        # Number of previous records before the current day.
        previous_cumulative = np.empty(len(cumulative), dtype=np.int64)
        previous_cumulative[0] = 0

        if len(cumulative) > 1:
            previous_cumulative[1:] = cumulative[:-1]

        # Find the first date inside the previous N-day window.
        left_indices = np.searchsorted(
            dates,
            dates - window_ns,
            side="left",
        )

        # Exclude current day by using previous_cumulative.
        left_values = np.zeros(len(left_indices), dtype=np.int64)

        valid_left = left_indices > 0
        left_values[valid_left] = (
            cumulative[left_indices[valid_left] - 1]
        )

        previous_counts = previous_cumulative - left_values

        # Since each row represents one unique active calendar day,
        # this is the number of distinct active days.
        current_positions = np.arange(len(group), dtype=np.int64)
        previous_active_days = current_positions - left_indices

        count_result[indices] = previous_counts.astype(np.int32)
        active_days_result[indices] = previous_active_days.astype(np.int16)

        processed_groups += 1

        if processed_groups % 50_000 == 0:
            print_step(
                f"Processed {processed_groups:,}/{total_groups:,} spatial cells"
            )

    print_step(
        f"Finished previous {window_days}-day feature calculation."
    )

    return pd.DataFrame(
        {
            f"hotspot_count_{window_days}d": count_result,
            f"active_days_{window_days}d": active_days_result,
        },
        index=daily.index,
    )


# ============================================================
# MAIN PIPELINE
# ============================================================

def main():
    start_time = time.time()

    print_step("Starting persistence feature engineering.")

    if not INPUT_PATH.exists():
        raise FileNotFoundError(
            f"Input file not found:\n{INPUT_PATH}\n"
            "Run preprocess_firms.py first."
        )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # --------------------------------------------------------
    # 1. LOAD CLEANED FIRMS DATA
    # --------------------------------------------------------

    print_step(f"Loading cleaned FIRMS data from:\n{INPUT_PATH}")

    df = pd.read_parquet(INPUT_PATH)

    print_step(f"Loaded {len(df):,} FIRMS detections.")

    # --------------------------------------------------------
    # 2. VALIDATE REQUIRED COLUMNS
    # --------------------------------------------------------

    required_columns = [
        "latitude",
        "longitude",
        "timestamp",
        "frp",
        "brightness",
        "confidence_score",
        "event_id",
    ]

    missing_columns = [
        col for col in required_columns
        if col not in df.columns
    ]

    if missing_columns:
        raise ValueError(
            f"Missing required columns: {missing_columns}"
        )

    # --------------------------------------------------------
    # 3. OPTIMIZE DATA TYPES
    # --------------------------------------------------------

    print_step("Optimizing data types.")

    float_columns = [
        "latitude",
        "longitude",
        "brightness",
        "frp",
        "confidence_score",
        "bright_t31",
        "scan",
        "track",
        "log_frp",
        "thermal_excess",
    ]

    for col in float_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col],
                errors="coerce",
                downcast="float",
            )

    integer_columns = [
        "hour",
        "month",
        "day_of_year",
        "year",
        "is_night",
    ]

    for col in integer_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col],
                errors="coerce",
                downcast="integer",
            )

    df["timestamp"] = pd.to_datetime(
        df["timestamp"],
        errors="coerce",
        utc=True,
    )

    df = df.dropna(
        subset=[
            "latitude",
            "longitude",
            "timestamp",
        ]
    ).reset_index(drop=True)

    # --------------------------------------------------------
    # 4. CREATE SPATIAL GRID AND CALENDAR DATE
    # --------------------------------------------------------

    print_step(
        f"Creating {GRID_SIZE}-degree spatial grid."
    )

    # Integer grid coordinates avoid expensive string operations.
    df["grid_lat"] = np.floor(
        df["latitude"] / GRID_SIZE
    ).astype(np.int32)

    df["grid_lon"] = np.floor(
        df["longitude"] / GRID_SIZE
    ).astype(np.int32)

    # Unique integer ID for each spatial cell.
    # Multiplier is sufficiently large for India's coordinate range.
    df["grid_id"] = (
        df["grid_lat"].astype(np.int64) * 10000
        + df["grid_lon"].astype(np.int64)
    )

    # Calendar date in UTC.
    df["date_only"] = df["timestamp"].dt.floor("D")

    print_step(
        f"Created {df['grid_id'].nunique():,} spatial cells."
    )

    # --------------------------------------------------------
    # 5. BUILD DAILY SPATIAL ACTIVITY TABLE
    # --------------------------------------------------------

    print_step("Aggregating daily spatial activity.")

    daily = (
        df.groupby(
            ["grid_id", "date_only"],
            sort=True,
            observed=True,
        )
        .agg(
            daily_hotspot_count=(
                "event_id",
                "size",
            ),
            daily_total_frp=(
                "frp",
                "sum",
            ),
            daily_max_brightness=(
                "brightness",
                "max",
            ),
            daily_mean_confidence=(
                "confidence_score",
                "mean",
            ),
        )
        .reset_index()
    )

    daily["daily_hotspot_count"] = daily[
        "daily_hotspot_count"
    ].astype(np.int32)

    daily["daily_total_frp"] = daily[
        "daily_total_frp"
    ].astype(np.float32)

    daily["daily_max_brightness"] = daily[
        "daily_max_brightness"
    ].astype(np.float32)

    daily["daily_mean_confidence"] = daily[
        "daily_mean_confidence"
    ].astype(np.float32)

    daily = daily.sort_values(
        ["grid_id", "date_only"]
    ).reset_index(drop=True)

    print_step(
        f"Daily activity table contains {len(daily):,} rows."
    )

    # --------------------------------------------------------
    # 6. CALCULATE PREVIOUS 7-DAY FEATURES
    # --------------------------------------------------------

    previous_7d = calculate_prior_window_features(
        daily,
        WINDOW_7,
    )

    daily = pd.concat(
        [daily, previous_7d],
        axis=1,
    )

    # --------------------------------------------------------
    # 7. CALCULATE PREVIOUS 30-DAY FEATURES
    # --------------------------------------------------------

    previous_30d = calculate_prior_window_features(
        daily,
        WINDOW_30,
    )

    daily = pd.concat(
        [daily, previous_30d],
        axis=1,
    )

    # --------------------------------------------------------
    # 8. ADD PERSISTENCE RATIOS AND FLAGS
    # --------------------------------------------------------

    print_step("Creating persistence scores and flags.")

    daily["persistence_ratio_7d"] = (
        daily["active_days_7d"]
        .astype(np.float32)
        / WINDOW_7
    )

    daily["persistence_ratio_30d"] = (
        daily["active_days_30d"]
        .astype(np.float32)
        / WINDOW_30
    )

    daily["persistent_source_flag"] = (
        (
            daily["active_days_30d"]
            >= PERSISTENT_ACTIVE_DAYS_THRESHOLD
        )
        | (
            daily["hotspot_count_30d"]
            >= PERSISTENT_DETECTIONS_THRESHOLD
        )
    ).astype(np.int8)

    # Stronger signal for repeatedly active locations.
    daily["high_persistence_flag"] = (
        (
            daily["active_days_30d"] >= 10
        )
        | (
            daily["hotspot_count_30d"] >= 25
        )
    ).astype(np.int8)

    # --------------------------------------------------------
    # 9. PREPARE DAILY FEATURE TABLE FOR MERGING
    # --------------------------------------------------------

    feature_columns = [
        "grid_id",
        "date_only",
        "hotspot_count_7d",
        "active_days_7d",
        "hotspot_count_30d",
        "active_days_30d",
        "persistence_ratio_7d",
        "persistence_ratio_30d",
        "persistent_source_flag",
        "high_persistence_flag",
        "daily_total_frp",
        "daily_max_brightness",
        "daily_mean_confidence",
    ]

    daily_features = daily[feature_columns].copy()

    # --------------------------------------------------------
    # 10. MERGE FEATURES BACK TO EVENT-LEVEL DATA
    # --------------------------------------------------------

    print_step("Merging persistence features into individual detections.")

    df = df.merge(
        daily_features,
        on=["grid_id", "date_only"],
        how="left",
        sort=False,
        validate="many_to_one",
    )

    # --------------------------------------------------------
    # 11. ADD DERIVED EVENT-LEVEL FEATURES
    # --------------------------------------------------------

    print_step("Creating final event-level derived features.")

    df["frp_per_detection_30d"] = (
        df["daily_total_frp"]
        / df["hotspot_count_30d"].replace(0, np.nan)
    )

    df["frp_per_detection_30d"] = df[
        "frp_per_detection_30d"
    ].fillna(0).astype(np.float32)

    # Combine persistence and thermal strength into a useful
    # ranking feature for downstream classification.
    df["persistence_score"] = (
        0.5 * df["persistence_ratio_30d"]
        + 0.3 * np.minimum(
            df["hotspot_count_30d"] / 25.0,
            1.0,
        )
        + 0.2 * np.minimum(
            df["active_days_7d"] / 7.0,
            1.0,
        )
    ).clip(0, 1).astype(np.float32)

    # --------------------------------------------------------
    # 12. REMOVE TEMPORARY COLUMNS
    # --------------------------------------------------------

    temporary_columns = [
        "grid_lat",
        "grid_lon",
        "date_only",
    ]

    for col in temporary_columns:
        if col in df.columns:
            df.drop(columns=col, inplace=True)

    # Keep grid_id because it is useful for downstream spatial joins.
    # It can be removed later if not needed.

    # --------------------------------------------------------
    # 13. SAVE FINAL PARQUET
    # --------------------------------------------------------

    print_step(f"Saving final features to:\n{OUTPUT_PATH}")

    df.to_parquet(
        OUTPUT_PATH,
        index=False,
        engine="pyarrow",
        compression="snappy",
    )

    # --------------------------------------------------------
    # 14. SAVE REPORT
    # --------------------------------------------------------

    elapsed_seconds = round(time.time() - start_time, 2)

    report = {
        "input_file": str(INPUT_PATH),
        "output_file": str(OUTPUT_PATH),
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "spatial_grid_size_degrees": GRID_SIZE,
        "spatial_cells": int(daily["grid_id"].nunique()),
        "daily_activity_rows": int(len(daily)),
        "persistent_source_count": int(
            daily["persistent_source_flag"].sum()
        ),
        "high_persistence_count": int(
            daily["high_persistence_flag"].sum()
        ),
        "persistent_event_count": int(
            df["persistent_source_flag"].sum()
        ),
        "high_persistence_event_count": int(
            df["high_persistence_flag"].sum()
        ),
        "persistence_windows_days": [
            WINDOW_7,
            WINDOW_30,
        ],
        "active_days_30d_threshold": (
            PERSISTENT_ACTIVE_DAYS_THRESHOLD
        ),
        "detections_30d_threshold": (
            PERSISTENT_DETECTIONS_THRESHOLD
        ),
        "timestamp_start": (
            df["timestamp"].min().isoformat()
            if len(df) > 0
            else None
        ),
        "timestamp_end": (
            df["timestamp"].max().isoformat()
            if len(df) > 0
            else None
        ),
        "elapsed_seconds": elapsed_seconds,
    }

    with open(REPORT_PATH, "w", encoding="utf-8") as file:
        json.dump(
            report,
            file,
            indent=2,
            default=str,
        )

    print_step("Persistence feature engineering completed.")
    print_step(f"Final rows: {len(df):,}")
    print_step(f"Final columns: {len(df.columns):,}")
    print_step(f"Output: {OUTPUT_PATH}")
    print_step(f"Report: {REPORT_PATH}")
    print_step(f"Elapsed time: {elapsed_seconds} seconds")


if __name__ == "__main__":
    main()