"""
AgniDrishti - Explainable AI Module

Generates SHAP explanations for the primary fire-type classifier.
"""

from pathlib import Path
import pickle

import numpy as np
import pandas as pd
import shap


BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"

MODEL_PATH = MODEL_DIR / "fire_type_classifier_final.pkl"
FEATURES_PATH = MODEL_DIR / "fire_type_features_final.pkl"


class FireTypeExplainer:

    def __init__(self):
        with open(MODEL_PATH, "rb") as file:
            self.model = pickle.load(file)

        with open(FEATURES_PATH, "rb") as file:
            self.feature_names = pickle.load(file)

        self.explainer = shap.TreeExplainer(self.model)

    def prepare_input(self, data):
        if isinstance(data, dict):
            df = pd.DataFrame([data])
        else:
            df = data.copy()

        for feature in self.feature_names:
            if feature not in df.columns:
                df[feature] = 0

        df = df[self.feature_names]
        df = df.apply(pd.to_numeric, errors="coerce")
        df = df.replace([np.inf, -np.inf], np.nan)
        df = df.fillna(0)

        return df

    def explain(self, data):
        X = self.prepare_input(data)

        shap_values = self.explainer.shap_values(X)

        # Handle different SHAP output formats
        if isinstance(shap_values, list):
            values = np.asarray(shap_values)
            predicted_class = int(
                self.model.predict(X)[0]
            )
            class_values = values[predicted_class][0]

        elif isinstance(shap_values, np.ndarray):

            if shap_values.ndim == 3:
                predicted_class = int(
                    self.model.predict(X)[0]
                )
                class_values = shap_values[0, :, predicted_class]

            elif shap_values.ndim == 2:
                class_values = shap_values[0]

            else:
                class_values = shap_values.flatten()

        else:
            raise ValueError(
                "Unsupported SHAP output format."
            )

        contributions = []

        for feature, value, shap_value in zip(
            self.feature_names,
            X.iloc[0].values,
            class_values,
        ):
            contributions.append({
                "feature": feature,
                "value": float(value),
                "shap_value": float(shap_value),
                "absolute_impact": abs(float(shap_value)),
                "direction": (
                    "increases_prediction"
                    if shap_value > 0
                    else "decreases_prediction"
                ),
            })

        contributions.sort(
            key=lambda item: item["absolute_impact"],
            reverse=True,
        )

        return {
            "top_positive_factors": [
                item
                for item in contributions
                if item["shap_value"] > 0
            ][:5],
            "top_negative_factors": [
                item
                for item in contributions
                if item["shap_value"] < 0
            ][:5],
            "all_contributions": contributions,
        }


explainer = FireTypeExplainer()


def explain_fire_type(data):
    return explainer.explain(data)