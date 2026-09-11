from pathlib import Path
import zipfile
import pandas as pd
import numpy as np
from tqdm import tqdm
import json

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
REPORTS = DATA / "reports"

RAW.mkdir(parents=True, exist_ok=True)
PROCESSED.mkdir(parents=True, exist_ok=True)
REPORTS.mkdir(parents=True, exist_ok=True)

print("\n🔥 AgniDrishti FIRMS Preprocessor")
print("=" * 55)

# ---------------------------------------------------------
# 1. Find ZIP files
# ---------------------------------------------------------

zips = list(DATA.glob("*.zip"))

if not zips:
    print("\n❌ No ZIP files found.")
    print(f"Put your FIRMS ZIP files inside:\n{DATA}")
    raise SystemExit(1)

print(f"\n📦 Found {len(zips)} ZIP file(s):")

csv_files = []

for z in zips:
    print(f"   → {z.name}")

    with zipfile.ZipFile(z, "r") as archive:
        members = archive.namelist()

        for member in members:
            if member.lower().endswith(".csv"):
                archive.extract(member, RAW)
                csv_files.append(RAW / member)

print(f"\n📄 Extracted {len(csv_files)} CSV file(s).")

# ---------------------------------------------------------
# 2. Process each CSV
# ---------------------------------------------------------

frames = []

for csv in csv_files:
    print(f"\n🔎 Reading {csv.name}")

    df = pd.read_csv(csv)

    print(f"   Rows: {len(df):,}")

    # Normalize column names
    df.columns = (
        df.columns
        .str.strip()
        .str.lower()
        .str.replace(" ", "_")
    )

    # -----------------------------------------------------
    # Standardize column names
    # -----------------------------------------------------

    rename = {
        "bright_ti4": "brightness",
        "bright_ti5": "brightness_ti5",
        "acq_date": "date",
        "acq_time": "time",
        "satellite": "satellite",
        "confidence": "confidence",
        "frp": "frp",
        "latitude": "latitude",
        "longitude": "longitude",
        "daynight": "daynight",
        "type": "firms_type",
    }

    df = df.rename(columns=rename)

    # Add missing columns
    required = [
        "latitude",
        "longitude",
        "brightness",
        "date",
        "time",
        "satellite",
        "confidence",
        "frp",
        "daynight",
    ]

    for col in required:
        if col not in df.columns:
            df[col] = np.nan

    # -----------------------------------------------------
    # Numeric conversion
    # -----------------------------------------------------

    numeric_cols = [
        "latitude",
        "longitude",
        "brightness",
        "brightness_ti5",
        "frp",
    ]

    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # -----------------------------------------------------
    # Timestamp
    # -----------------------------------------------------

    df["date"] = df["date"].astype(str)

    df["time"] = (
        df["time"]
        .astype(str)
        .str.replace(r"\.0$", "", regex=True)
        .str.zfill(4)
    )

    df["timestamp"] = pd.to_datetime(
        df["date"] + " " + df["time"],
        format="%Y-%m-%d %H%M",
        errors="coerce",
        utc=True,
    )

    # -----------------------------------------------------
    # Confidence encoding
    # -----------------------------------------------------

    conf = df["confidence"].astype(str).str.lower().str.strip()

    confidence_map = {
        "l": 0,
        "n": 50,
        "h": 100,
        "low": 0,
        "nominal": 50,
        "high": 100,
    }

    df["confidence_score"] = conf.map(confidence_map)

    # -----------------------------------------------------
    # Thermal features
    # -----------------------------------------------------

    df["log_frp"] = np.log1p(df["frp"].clip(lower=0))

    df["thermal_excess"] = df["brightness"] - 300.0

    # -----------------------------------------------------
    # Temporal features
    # -----------------------------------------------------

    df["hour"] = df["timestamp"].dt.hour
    df["month"] = df["timestamp"].dt.month
    df["day_of_year"] = df["timestamp"].dt.dayofyear
    df["year"] = df["timestamp"].dt.year

    def season(month):
        if month in [12, 1, 2]:
            return "winter"
        elif month in [3, 4, 5]:
            return "summer"
        elif month in [6, 7, 8, 9]:
            return "monsoon"
        else:
            return "post_monsoon"

    df["season"] = df["month"].apply(
        lambda x: season(int(x)) if pd.notna(x) else "unknown"
    )

    # -----------------------------------------------------
    # Day/night encoding
    # -----------------------------------------------------

    df["is_night"] = (
        df["daynight"]
        .astype(str)
        .str.upper()
        .eq("N")
        .astype("int8")
    )

    # -----------------------------------------------------
    # Data source
    # -----------------------------------------------------

    df["data_quality"] = np.where(
        df["timestamp"] < pd.Timestamp("2026-01-01", tz="UTC"),
        "ARCHIVE",
        "NRT",
    )

    # -----------------------------------------------------
    # Basic validity
    # -----------------------------------------------------

    df = df[
        df["latitude"].between(6, 38)
        & df["longitude"].between(65, 100)
    ]

    df = df[df["timestamp"].notna()]

    frames.append(df)

# ---------------------------------------------------------
# 3. Combine
# ---------------------------------------------------------

print("\n🔗 Combining datasets...")

df = pd.concat(frames, ignore_index=True)

print(f"Combined rows: {len(df):,}")

# ---------------------------------------------------------
# 4. Remove exact duplicates
# ---------------------------------------------------------

before = len(df)

dedup_cols = [
    "latitude",
    "longitude",
    "timestamp",
    "satellite",
    "brightness",
    "frp",
]

df = df.drop_duplicates(subset=dedup_cols)

removed = before - len(df)

print(f"Duplicates removed: {removed:,}")

# ---------------------------------------------------------
# 5. Sort
# ---------------------------------------------------------

df = df.sort_values(
    ["timestamp", "latitude", "longitude"],
    kind="stable"
).reset_index(drop=True)

# ---------------------------------------------------------
# 6. Create unique event ID
# ---------------------------------------------------------

df["event_id"] = (
    "FIRMS_"
    + df["timestamp"].dt.strftime("%Y%m%d%H%M")
    + "_"
    + df["latitude"].round(4).astype(str)
    + "_"
    + df["longitude"].round(4).astype(str)
)
# ---------------------------------------------------------
# Normalize mixed-type metadata columns for Parquet
# ---------------------------------------------------------

for col in ["version", "instrument", "daynight", "confidence", "satellite"]:
    if col in df.columns:
        df[col] = df[col].astype("string")

# ---------------------------------------------------------
# 7. Save Parquet
# ---------------------------------------------------------

output = PROCESSED / "firms_clean.parquet"

print("\n💾 Saving:")
print(output)

df.to_parquet(
    output,
    engine="pyarrow",
    compression="snappy",
    index=False,
)

# ---------------------------------------------------------
# 8. Generate report
# ---------------------------------------------------------

report = {
    "total_rows": int(len(df)),
    "columns": list(df.columns),
    "date_min": str(df["timestamp"].min()),
    "date_max": str(df["timestamp"].max()),
    "satellites": df["satellite"].value_counts(dropna=False).to_dict(),
    "confidence": df["confidence"].value_counts(dropna=False).to_dict(),
    "daynight": df["daynight"].value_counts(dropna=False).to_dict(),
    "data_quality": df["data_quality"].value_counts().to_dict(),
    "missing_values": {
        k: int(v)
        for k, v in df.isna().sum().items()
        if v > 0
    },
}

report_path = REPORTS / "preprocessing_report.json"

with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2, default=str)

# ---------------------------------------------------------
# 9. Summary
# ---------------------------------------------------------

print("\n" + "=" * 55)
print("✅ PREPROCESSING COMPLETE")
print("=" * 55)

print(f"\nRows:       {len(df):,}")
print(f"Columns:    {len(df.columns)}")
print(f"Start:      {df['timestamp'].min()}")
print(f"End:        {df['timestamp'].max()}")

print("\nSatellites:")
print(df["satellite"].value_counts().to_string())

print("\nConfidence:")
print(df["confidence"].value_counts(dropna=False).to_string())

print("\nOutput:")
print(f"   {output}")

print("\nReport:")
print(f"   {report_path}")

print("\n🔥 Next stage: OSM + land-cover enrichment")