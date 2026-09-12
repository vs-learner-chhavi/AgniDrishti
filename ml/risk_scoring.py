"""
AgniDrishti - Thermal Event Risk Scoring Module
"""


def clamp(value, minimum=0, maximum=100):
    return max(minimum, min(maximum, value))


def calculate_risk_score(
    hotspot_data,
    prediction_result,
    geospatial_result,
):
    """
    Calculate an explainable risk score from 0 to 100.
    """

    confidence = float(
        prediction_result.get("confidence", 0)
    )

    frp = float(
        hotspot_data.get("frp", 0) or 0
    )

    persistence_score = float(
        hotspot_data.get("persistence_score", 0) or 0
    )

    persistent_activity = int(
        hotspot_data.get("persistent_activity", 0) or 0
    )

    near_gas = int(
        hotspot_data.get("near_gas_1km", 0) or 0
    )

    near_industrial = int(
        hotspot_data.get("near_industrial_1km", 0) or 0
    )

    near_mining = int(
        hotspot_data.get("near_mining_2km", 0) or 0
    )

    # Normalize FRP approximately to 0–100
    frp_score = clamp((frp / 300) * 100)

    # Persistence already expected between 0 and 1
    persistence_component = clamp(
        persistence_score * 100
    )

    confidence_component = confidence * 100

    infrastructure_component = (
        near_gas * 20
        + near_industrial * 20
        + near_mining * 15
    )

    risk_score = (
        confidence_component * 0.30
        + frp_score * 0.25
        + persistence_component * 0.25
        + infrastructure_component * 0.15
        + persistent_activity * 5
    )

    risk_score = round(
        clamp(risk_score),
        2
    )

    if risk_score >= 75:
        risk_level = "Critical"
    elif risk_score >= 55:
        risk_level = "High"
    elif risk_score >= 30:
        risk_level = "Moderate"
    else:
        risk_level = "Low"

    return {
        "risk_score": risk_score,
        "risk_level": risk_level,
        "components": {
            "model_confidence": round(confidence_component, 2),
            "frp_intensity": round(frp_score, 2),
            "persistence": round(persistence_component, 2),
            "infrastructure": round(infrastructure_component, 2),
        },
    }