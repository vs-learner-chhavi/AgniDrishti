"""
AgniDrishti - Final Fire Type Classification Model

Purpose:
    Train an XGBoost classifier for thermal hotspot classification.

Classes:
    - industrial_fire
    - gas_flare
    - wildfire
    - crop_burning
    - mining

Important:
    Geospatial proximity features are excluded from the primary ML model
    because they can create target leakage when labels are generated using
    industrial/gas/mining proximity rules.

The excluded features can still be used separately in the GIS/context layer.
"""

import os
import json
import pickle
import warnings

import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)

from xgboost import XGBClassifier

warnings.filterwarnings("ignore")


# ============================================================
# CONFIGURATION
# ============================================================

from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent

DATA_PATH = PROJECT_DIR / "data" / "processed" / "fire_type_training.parquet"

MODEL_DIR = SCRIPT_DIR / "models"

MODEL_PATH = MODEL_DIR / "fire_type_classifier_final.pkl"
ENCODER_PATH = MODEL_DIR / "fire_type_label_encoder_final.pkl"
FEATURES_PATH = MODEL_DIR / "fire_type_features_final.pkl"
METRICS_PATH = MODEL_DIR / "fire_type_training_metrics.json"




RANDOM_STATE = 42
TEST_SIZE = 0.20


# ============================================================
# FEATURES
# ============================================================

# These features are intentionally excluded from the primary model:
#
# distance_to_gas_km
# near_gas_1km
# distance_to_industrial_km
# near_industrial_1km
# distance_to_mining_km
# near_mining_2km
#
# Reason:
# These features are highly correlated with the generated target labels
# and may allow the model to memorize the label-generation rules.

EXCLUDED_FEATURES = [
    "distance_to_gas_km",
    "near_gas_1km",
    "distance_to_industrial_km",
    "near_industrial_1km",
    "distance_to_mining_km",
    "near_mining_2km",
]


# ============================================================
# LOAD DATASET
# ============================================================

def load_dataset():
    print("=" * 70)
    print("LOADING DATASET")
    print("=" * 70)

    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(
            f"Dataset not found: {DATA_PATH}\n"
            "Run this script from the ml folder."
        )

    df = pd.read_parquet(DATA_PATH)

    print(f"Dataset shape: {df.shape}")
    print(f"Columns: {len(df.columns)}")

    print("\nTarget column candidates:")

    possible_targets = [
        "fire_type",
        "target",
        "label",
        "class",
        "category",
    ]

    target_column = None

    for column in possible_targets:
        if column in df.columns:
            target_column = column
            break

    if target_column is None:
        raise ValueError(
            "Could not find target column. Expected one of: "
            + ", ".join(possible_targets)
        )

    print(f"Target column detected: {target_column}")

    return df, target_column


# ============================================================
# PREPARE FEATURES
# ============================================================

def prepare_features(df, target_column):
    print("\n" + "=" * 70)
    print("PREPARING FEATURES")
    print("=" * 70)

    # Remove target from input features
    X = df.drop(columns=[target_column]).copy()
    y = df[target_column].copy()

    # Remove excluded proximity features if present
    features_to_remove = [
        feature
        for feature in EXCLUDED_FEATURES
        if feature in X.columns
    ]

    if features_to_remove:
        print("\nExcluded geospatial features:")
        for feature in features_to_remove:
            print(f"  - {feature}")

        X = X.drop(columns=features_to_remove)

    # Remove non-numeric columns
    non_numeric_columns = X.select_dtypes(
        exclude=[np.number]
    ).columns.tolist()

    if non_numeric_columns:
        print("\nDropping non-numeric columns:")
        for column in non_numeric_columns:
            print(f"  - {column}")

        X = X.drop(columns=non_numeric_columns)

    # Replace infinite values
    X = X.replace([np.inf, -np.inf], np.nan)

    # Fill missing numeric values using median
    missing_count = X.isna().sum().sum()

    if missing_count > 0:
        print(f"\nMissing values found: {missing_count}")
        print("Filling missing values using column medians.")

        X = X.fillna(X.median(numeric_only=True))

    # Drop columns that are completely empty or constant
    constant_columns = [
        column
        for column in X.columns
        if X[column].nunique(dropna=False) <= 1
    ]

    if constant_columns:
        print("\nDropping constant columns:")
        for column in constant_columns:
            print(f"  - {column}")

        X = X.drop(columns=constant_columns)

    feature_names = X.columns.tolist()

    print(f"\nFinal feature count: {len(feature_names)}")
    print("\nFinal features:")

    for index, feature in enumerate(feature_names, start=1):
        print(f"{index:02d}. {feature}")

    return X, y, feature_names


# ============================================================
# ENCODE LABELS
# ============================================================

def encode_target(y):
    print("\n" + "=" * 70)
    print("ENCODING TARGET LABELS")
    print("=" * 70)

    label_encoder = LabelEncoder()
    y_encoded = label_encoder.fit_transform(y.astype(str))

    print("\nClasses:")

    for index, class_name in enumerate(label_encoder.classes_):
        count = int((y == class_name).sum())
        print(f"{index}: {class_name} -> {count} samples")

    return y_encoded, label_encoder


# ============================================================
# TRAIN MODEL
# ============================================================

def train_model(X_train, y_train, num_classes):
    print("\n" + "=" * 70)
    print("TRAINING XGBOOST MODEL")
    print("=" * 70)

    model = XGBClassifier(
        n_estimators=350,
        max_depth=8,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.85,
        min_child_weight=2,
        gamma=0.05,
        reg_alpha=0.1,
        reg_lambda=1.0,
        objective="multi:softprob",
        num_class=num_classes,
        eval_metric="mlogloss",
        tree_method="hist",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )

    model.fit(
        X_train,
        y_train,
        verbose=False
    )

    print("Model training completed.")

    return model


# ============================================================
# EVALUATE MODEL
# ============================================================

def evaluate_model(model, X_test, y_test, label_encoder):
    print("\n" + "=" * 70)
    print("MODEL EVALUATION")
    print("=" * 70)

    predictions = model.predict(X_test)

    accuracy = accuracy_score(y_test, predictions)
    macro_f1 = f1_score(
        y_test,
        predictions,
        average="macro"
    )

    weighted_f1 = f1_score(
        y_test,
        predictions,
        average="weighted"
    )

    print(f"\nAccuracy: {accuracy:.4f}")
    print(f"Macro F1 Score: {macro_f1:.4f}")
    print(f"Weighted F1 Score: {weighted_f1:.4f}")

    print("\nClassification Report:\n")

    report = classification_report(
        y_test,
        predictions,
        target_names=label_encoder.classes_,
        digits=4,
        zero_division=0,
    )

    print(report)

    print("Confusion Matrix:\n")

    matrix = confusion_matrix(
        y_test,
        predictions
    )

    matrix_df = pd.DataFrame(
        matrix,
        index=label_encoder.classes_,
        columns=label_encoder.classes_,
    )

    print(matrix_df)

    metrics = {
        "accuracy": float(accuracy),
        "macro_f1": float(macro_f1),
        "weighted_f1": float(weighted_f1),
        "classification_report": classification_report(
            y_test,
            predictions,
            target_names=label_encoder.classes_,
            output_dict=True,
            zero_division=0,
        ),
        "confusion_matrix": matrix.tolist(),
    }

    return metrics


# ============================================================
# FEATURE IMPORTANCE
# ============================================================

def print_feature_importance(model, feature_names):
    print("\n" + "=" * 70)
    print("FEATURE IMPORTANCE")
    print("=" * 70)

    importance = model.feature_importances_

    importance_df = pd.DataFrame({
        "feature": feature_names,
        "importance": importance,
    })

    importance_df = importance_df.sort_values(
        by="importance",
        ascending=False
    )

    print("\nTop features:\n")

    for _, row in importance_df.head(20).iterrows():
        print(
            f"{row['feature']:<40} "
            f"{row['importance']:.6f}"
        )

    return importance_df


# ============================================================
# SAVE ARTIFACTS
# ============================================================

def save_artifacts(
    model,
    label_encoder,
    feature_names,
    metrics,
):
    print("\n" + "=" * 70)
    print("SAVING MODEL ARTIFACTS")
    print("=" * 70)

    os.makedirs(MODEL_DIR, exist_ok=True)

    with open(MODEL_PATH, "wb") as file:
        pickle.dump(model, file)

    with open(ENCODER_PATH, "wb") as file:
        pickle.dump(label_encoder, file)

    with open(FEATURES_PATH, "wb") as file:
        pickle.dump(feature_names, file)

    with open(METRICS_PATH, "w") as file:
        json.dump(metrics, file, indent=4)

    print(f"\nSaved model: {MODEL_PATH}")
    print(f"Saved encoder: {ENCODER_PATH}")
    print(f"Saved features: {FEATURES_PATH}")
    print(f"Saved metrics: {METRICS_PATH}")


# ============================================================
# MAIN
# ============================================================

def main():
    print("\n")
    print("=" * 70)
    print("AGNIDRISHTI FINAL FIRE TYPE CLASSIFIER")
    print("=" * 70)

    # 1. Load dataset
    df, target_column = load_dataset()

    # 2. Prepare features
    X, y, feature_names = prepare_features(
        df,
        target_column
    )

    # 3. Encode target
    y_encoded, label_encoder = encode_target(y)

    # 4. Train-test split
    print("\n" + "=" * 70)
    print("CREATING TRAIN-TEST SPLIT")
    print("=" * 70)

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y_encoded,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=y_encoded,
    )

    print(f"Training samples: {len(X_train)}")
    print(f"Testing samples: {len(X_test)}")

    # 5. Train model
    model = train_model(
        X_train,
        y_train,
        len(label_encoder.classes_)
    )

    # 6. Evaluate model
    metrics = evaluate_model(
        model,
        X_test,
        y_test,
        label_encoder
    )

    # 7. Feature importance
    importance_df = print_feature_importance(
        model,
        feature_names
    )

    # 8. Save artifacts
    save_artifacts(
        model,
        label_encoder,
        feature_names,
        metrics,
    )

    print("\n" + "=" * 70)
    print("TRAINING FINISHED SUCCESSFULLY")
    print("=" * 70)

    print("\nFinal model summary:")
    print(f"  Features used: {len(feature_names)}")
    print(f"  Classes: {len(label_encoder.classes_)}")
    print(f"  Accuracy: {metrics['accuracy']:.4f}")
    print(f"  Macro F1: {metrics['macro_f1']:.4f}")

    print("\nNext step:")
    print("Use the saved model in your Streamlit/GIS application.")


if __name__ == "__main__":
    main()