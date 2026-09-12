"""
AgniDrishti - Fire Type Prediction Module
"""

from pathlib import Path
import pickle
import numpy as np
import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"

MODEL_PATH = MODEL_DIR / "fire_type_classifier_final.pkl"
ENCODER_PATH = MODEL_DIR / "fire_type_label_encoder_final.pkl"
FEATURES_PATH = MODEL_DIR / "fire_type_features_final.pkl"


class FireTypePredictor:
    def __init__(self):
        with open(MODEL_PATH, "rb") as file:
            self.model = pickle.load(file)
        # Training saved n_jobs=-1. Bound inference threads on laptops.
        self.model.set_params(n_jobs=2)

        with open(ENCODER_PATH, "rb") as file:
            self.label_encoder = pickle.load(file)

        with open(FEATURES_PATH, "rb") as file:
            self.feature_names = pickle.load(file)

    def prepare_features(self, data):
        """
        Prepare one hotspot or multiple hotspots for prediction.
        """

        if isinstance(data, dict):
            df = pd.DataFrame([data])
        elif isinstance(data, pd.DataFrame):
            df = data.copy()
        else:
            raise TypeError(
                "Input must be a dictionary or pandas DataFrame."
            )

        missing = set(self.feature_names) - set(df.columns)
        if missing:
            raise ValueError(f"Missing model inputs: {', '.join(sorted(missing))}")
        df = df[self.feature_names].apply(pd.to_numeric, errors="raise")
        if not np.isfinite(df.to_numpy(dtype=float)).all():
            raise ValueError("Model inputs must be finite numbers; missing evidence is not zero.")

        return df

    def predict(self, data):
        """
        Returns predicted fire type and confidence.
        """

        X = self.prepare_features(data)

        predictions = self.model.predict(X)
        probabilities = self.model.predict_proba(X)

        results = []

        for index, prediction in enumerate(predictions):
            predicted_label = self.label_encoder.inverse_transform(
                [int(prediction)]
            )[0]

            confidence = float(np.max(probabilities[index]))

            class_probabilities = {
                self.label_encoder.inverse_transform([class_index])[0]:
                float(probabilities[index][class_index])
                for class_index in range(
                    len(self.label_encoder.classes_)
                )
            }

            results.append({
                "fire_type": predicted_label,
                "confidence": confidence,
                "probabilities": class_probabilities,
            })

        return results[0] if isinstance(data, dict) else results


# Singleton instance for easy Streamlit integration
predictor = FireTypePredictor()


def predict_fire_type(data):
    return predictor.predict(data)


if __name__ == "__main__":
    sample = {
        "brightness": 330,
        "bright_t31": 300,
        "frp": 45,
        "confidence_score": 0.9,
        "log_frp": 3.8,
        "thermal_excess": 30,
        "hour": 14,
        "month": 6,
        "day_of_year": 170,
        "is_night": 0,
        "hotspot_count_7d": 10,
        "active_days_7d": 4,
        "hotspot_count_30d": 35,
        "active_days_30d": 15,
        "persistence_ratio_7d": 0.57,
        "persistence_ratio_30d": 0.50,
        "persistent_source_flag": 1,
        "high_persistence_flag": 1,
        "daily_total_frp": 500,
        "daily_max_brightness": 350,
        "daily_mean_confidence": 0.85,
        "frp_per_detection_30d": 14.28,
        "persistence_score": 0.55,
        "night_fire_flag": 0,
        "persistent_activity": 1,
        "high_frp_flag": 1,
        "low_persistence_flag": 0,
    }

    result = predict_fire_type(sample)

    print("\nPrediction:")
    print(result)