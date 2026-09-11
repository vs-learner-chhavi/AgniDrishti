import pandas as pd
from pathlib import Path

FEATURES_FILE = Path("data/processed/fire_type_features.parquet")
LABEL_FILE = Path("data/processed/fire_type_dataset.parquet")

# Check which output actually contains fire_type
if LABEL_FILE.exists():
    INPUT_FILE = LABEL_FILE
else:
    INPUT_FILE = FEATURES_FILE

df = pd.read_parquet(INPUT_FILE)

print(f"\nReading: {INPUT_FILE}")
print("Shape:", df.shape)

print("\nColumns:")
print(df.columns.tolist())

if "fire_type" not in df.columns:
    print("\nERROR: fire_type column is missing.")
    print("The labeling script probably saved the dataset under another filename.")
    raise SystemExit

print("\nFire-type distribution:")
print(df["fire_type"].value_counts())

print("\nConfidence distribution:")
print(df["label_confidence"].value_counts())

print("\nFire type × confidence:")
print(pd.crosstab(df["fire_type"], df["label_confidence"]))

print("\nSample records:")
sample_cols = [
    col for col in [
        "latitude",
        "longitude",
        "fire_type",
        "label_confidence",
        "industrial_distance_km",
        "mining_distance_km",
        "gas_distance_km",
    ]
    if col in df.columns
]

print(df[sample_cols].head(20).to_string())

print("\nMissing values:")
print(df.isna().sum().sort_values(ascending=False).head(20))