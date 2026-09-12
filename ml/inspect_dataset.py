from pathlib import Path
import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "processed"

files = [
    "fire_type_dataset.parquet",
    "fire_type_features.parquet",
    "fire_type_training.parquet",
    "training_dataset.parquet",
    "training_dataset_balanced.parquet",
    "fire_type_training_preview.csv",
]

for filename in files:
    path = DATA_DIR / filename

    if not path.exists():
        continue

    print("\n" + "=" * 70)
    print(filename)

    if path.suffix == ".csv":
        df = pd.read_csv(path)
    else:
        df = pd.read_parquet(path)

    print("Shape:", df.shape)
    print("Columns:")
    print(df.columns.tolist())

    print("\nData types:")
    print(df.dtypes)

    print("\nFirst 3 rows:")
    print(df.head(3).to_string())

    print("\nMissing values:")
    print(df.isnull().sum())

    print("\nUnique values:")
    for col in df.columns:
        if df[col].nunique() <= 20:
            print(col, "=>", df[col].unique()[:20])