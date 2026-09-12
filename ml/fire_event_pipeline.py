"""
AgniDrishti - Complete Fire Event Intelligence Pipeline
"""

from predict_fire_type import predict_fire_type
from geospatial_context import calculate_geospatial_support
from risk_scoring import calculate_risk_score
from explain_fire_type import explain_fire_type


def analyze_fire_event(hotspot_data):
    """
    Complete analysis of one hotspot.

    Returns:
        ML prediction
        Confidence
        Class probabilities
        SHAP explanation
        Geospatial context
        Risk score
    """

    prediction = predict_fire_type(hotspot_data)

    geospatial = calculate_geospatial_support(
        hotspot_data,
        prediction["fire_type"],
    )

    risk = calculate_risk_score(
        hotspot_data,
        prediction,
        geospatial,
    )

    explanation = explain_fire_type(hotspot_data)

    return {
        "prediction": prediction,
        "explainability": explanation,
        "geospatial": geospatial,
        "risk": risk,
    }


if __name__ == "__main__":

    sample_hotspot = {
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

        # Geospatial context only
        "distance_to_gas_km": 0.4,
        "near_gas_1km": 1,
        "distance_to_industrial_km": 3.2,
        "near_industrial_1km": 0,
        "distance_to_mining_km": 12.0,
        "near_mining_2km": 0,
    }

    result = analyze_fire_event(sample_hotspot)

    print("\nFIRE TYPE:")
    print(result["prediction"]["fire_type"])

    print("\nCONFIDENCE:")
    print(result["prediction"]["confidence"])

    print("\nRISK:")
    print(result["risk"])

    print("\nGEOSPATIAL EVIDENCE:")
    print(result["geospatial"])

    print("\nTOP SHAP FACTORS:")
    print(result["explainability"]["top_positive_factors"])