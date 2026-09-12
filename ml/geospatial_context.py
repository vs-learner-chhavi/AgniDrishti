"""
AgniDrishti - Geospatial Context and Evidence Module
"""

import math


def safe_float(value):
    try:
        if value is None:
            return None

        value = float(value)

        if math.isnan(value) or math.isinf(value):
            return None

        return value

    except (ValueError, TypeError):
        return None


def get_geospatial_context(data):
    """
    Generate contextual evidence from proximity features.

    These features are NOT passed into the primary ML model.
    """

    distance_to_gas = safe_float(
        data.get("distance_to_gas_km")
    )

    distance_to_industrial = safe_float(
        data.get("distance_to_industrial_km")
    )

    distance_to_mining = safe_float(
        data.get("distance_to_mining_km")
    )

    near_gas = int(data.get("near_gas_1km", 0) or 0)
    near_industrial = int(data.get("near_industrial_1km", 0) or 0)
    near_mining = int(data.get("near_mining_2km", 0) or 0)

    evidence = []

    if near_gas:
        evidence.append({
            "type": "gas_infrastructure",
            "message": "Hotspot is within 1 km of gas infrastructure.",
            "distance_km": distance_to_gas,
            "strength": "high",
        })

    if near_industrial:
        evidence.append({
            "type": "industrial_infrastructure",
            "message": "Hotspot is within 1 km of industrial infrastructure.",
            "distance_km": distance_to_industrial,
            "strength": "high",
        })

    if near_mining:
        evidence.append({
            "type": "mining_activity",
            "message": "Hotspot is within 2 km of mining activity.",
            "distance_km": distance_to_mining,
            "strength": "high",
        })

    if not evidence:
        evidence.append({
            "type": "no_direct_proximity_evidence",
            "message": "No nearby gas, industrial, or mining infrastructure was detected.",
            "strength": "neutral",
        })

    return {
        "distances": {
            "gas_km": distance_to_gas,
            "industrial_km": distance_to_industrial,
            "mining_km": distance_to_mining,
        },
        "nearby_flags": {
            "near_gas_1km": near_gas,
            "near_industrial_1km": near_industrial,
            "near_mining_2km": near_mining,
        },
        "evidence": evidence,
    }


def calculate_geospatial_support(data, predicted_fire_type):
    """
    Compare ML prediction with geospatial evidence.

    Returns support, conflict, or neutral evidence.
    """

    context = get_geospatial_context(data)

    flags = context["nearby_flags"]

    gas_nearby = flags["near_gas_1km"] == 1
    industrial_nearby = flags["near_industrial_1km"] == 1
    mining_nearby = flags["near_mining_2km"] == 1

    reason = []
    conflicts = []

    # Gas flare verification
    if predicted_fire_type == "gas_flare":
        if gas_nearby:
            reason.append(
                "Nearby gas infrastructure supports gas flare classification."
            )
        else:
            conflicts.append(
                "ML predicted gas flare, but no nearby gas infrastructure was detected."
            )

    # Industrial fire verification
    elif predicted_fire_type == "industrial_fire":
        if industrial_nearby:
            reason.append(
                "Nearby industrial infrastructure supports industrial fire classification."
            )
        else:
            conflicts.append(
                "ML predicted industrial fire, but no nearby industrial infrastructure was detected."
            )

    # Mining source verification
    elif predicted_fire_type == "mining_thermal_source":
        if mining_nearby:
            reason.append(
                "Nearby mining activity supports mining thermal source classification."
            )
        else:
            conflicts.append(
                "ML predicted mining thermal source, but no nearby mining activity was detected."
            )

    # Natural/agricultural sources
    elif predicted_fire_type in [
        "wildfire",
        "agricultural_burning",
    ]:
        if gas_nearby:
            conflicts.append(
                "ML predicted a natural/agricultural source, but nearby gas infrastructure was detected."
            )

        if industrial_nearby:
            conflicts.append(
                "ML predicted a natural/agricultural source, but nearby industrial infrastructure was detected."
            )

        if mining_nearby:
            conflicts.append(
                "ML predicted a natural/agricultural source, but nearby mining activity was detected."
            )

        if not gas_nearby and not industrial_nearby and not mining_nearby:
            reason.append(
                "No nearby industrial, gas, or mining infrastructure supports the ML prediction."
            )

    if conflicts:
        support_level = "conflict"
    elif reason:
        support_level = "supported"
    else:
        support_level = "neutral"

    return {
        "support_score": len(reason),
        "support_level": support_level,
        "reason": reason,
        "conflicts": conflicts,
        "context": context,
    }