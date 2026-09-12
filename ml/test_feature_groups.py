from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
from xgboost import XGBClassifier


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = PROJECT_ROOT / "data" / "processed" / "fire_type_training.parquet"

df = pd.read_parquet(DATA_PATH)

target = "fire_type"

all_features = [
    col for col in df.columns
    if col != target
]

geospatial_features = [
    "distance_to_industrial_km",
    "distance_to_mining_km",
    "distance_to_gas_km",
    "near_industrial_1km",
    "near_mining_2km",
    "near_gas_1km",
]

thermal_features = [
    "brightness",
    "bright_t31",
    "frp",
    "confidence_score",
    "log_frp",
    "thermal_excess",
]

temporal_features = [
    "hour",
    "month",
    "day_of_year",
    "is_night",
    "night_fire_flag",
]

persistence_features = [
    "hotspot_count_7d",
    "active_days_7d",
    "hotspot_count_30d",
    "active_days_30d",
    "persistence_ratio_7d",
    "persistence_ratio_30d",
    "persistent_source_flag",
    "high_persistence_flag",
    "persistence_score",
    "persistent_activity",
    "low_persistence_flag",
]

def evaluate(feature_group, feature_names):
    X = df[feature_names]
    y = LabelEncoder().fit_transform(df[target])

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=y
    )

    model = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.05,
        objective="multi:softprob",
        eval_metric="mlogloss",
        num_class=5,
        random_state=42,
        n_jobs=-1
    )

    model.fit(X_train, y_train)

    predictions = model.predict(X_test)

    print(f"{feature_group}: {accuracy_score(y_test, predictions):.4f}")


evaluate("All Features", all_features)
evaluate("Geospatial Only", geospatial_features)
evaluate("Thermal Only", thermal_features)
evaluate("Temporal Only", temporal_features)
evaluate("Persistence Only", persistence_features)

evaluate(
    "Thermal + Temporal + Persistence",
    thermal_features + temporal_features + persistence_features
)