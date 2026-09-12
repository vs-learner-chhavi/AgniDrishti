"""
AgniDrishti - Explainable AI Module

Generates SHAP explanations for the primary fire-type classifier.
"""

from xgboost import DMatrix
from predict_fire_type import predictor


class FireTypeExplainer:
    def __init__(self):
        # Reuse the loaded model. Native XGBoost TreeSHAP avoids importing
        # SHAP/Numba and loading a second pickle for each dashboard request.
        self.model = predictor.model
        self.feature_names = predictor.feature_names

    def prepare_input(self, data):
        return predictor.prepare_features(data)

    def explain(self, data):
        X = self.prepare_input(data)
        if len(X) != 1:
            raise ValueError("Explain one observation at a time.")
        booster = self.model.get_booster()
        matrix = DMatrix(X, nthread=2)
        predicted_class = int(self.model.predict(X)[0])
        # shape: observations, classes, features + expected value.
        shap_values = booster.predict(matrix, pred_contribs=True, strict_shape=True)
        class_values = shap_values[0, predicted_class, :-1]
        base_value = float(shap_values[0, predicted_class, -1])

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
            "base_value": base_value,
            "source": "XGBoost native TreeSHAP",
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