from pathlib import Path
import pandas as pd

INPUT_FILE = Path("data/processed/fire_type_dataset.parquet")
OUTPUT_FILE = Path("data/processed/fire_type_training.parquet")

df = pd.read_parquet(INPUT_FILE)

# Remove low-confidence unknown labels initially.
df = df[
    ~(
        (df["fire_type"] == "unknown")
        & (df["label_confidence"] == "low")
    )
].copy()

print("After removing low-confidence unknown labels:")
print(df["fire_type"].value_counts())

# Select useful numerical features.
FEATURES = [
    "brightness",
    "bright_t31",
    "frp",
    "confidence_score",
    "log_frp",
    "thermal_excess",
    "hour",
    "month",
    "day_of_year",
    "is_night",
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
    "frp_per_detection_30d",
    "persistence_score",
    "distance_to_industrial_km",
    "distance_to_mining_km",
    "distance_to_gas_km",
    "near_industrial_1km",
    "near_mining_2km",
    "near_gas_1km",
    "night_fire_flag",
    "persistent_activity",
    "high_frp_flag",
    "low_persistence_flag",
]

TARGET = "fire_type"

available_features = [
    col for col in FEATURES if col in df.columns
]

training_df = df[available_features + [TARGET]].copy()

# Remove rows with missing values in selected features.
training_df = training_df.dropna(subset=available_features)

# Limit every class to a manageable and balanced sample size.
MAX_PER_CLASS = 15000

parts = []

for fire_type, group in training_df.groupby(TARGET):
    if len(group) > MAX_PER_CLASS:
        group = group.sample(
            n=MAX_PER_CLASS,
            random_state=42
        )

    parts.append(group)

balanced_df = pd.concat(parts, ignore_index=True)

# Shuffle the final dataset.
balanced_df = balanced_df.sample(
    frac=1,
    random_state=42
).reset_index(drop=True)

balanced_df.to_parquet(
    OUTPUT_FILE,
    index=False
)

print("\nTraining dataset saved:")
print(OUTPUT_FILE)

print("\nShape:", balanced_df.shape)

print("\nClass distribution:")
print(balanced_df[TARGET].value_counts())