"""CLI bridge for invoking AgniDrishti's trained classifier and SHAP explainer."""
import json
import sys
from predict_fire_type import predict_fire_type
from explain_fire_type import explain_fire_type


def main():
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("Expected one JSON object")

    prediction = predict_fire_type(payload)
    explanation = explain_fire_type(payload)

    prediction["xai"] = {
        "source": "XGBoost native TreeSHAP",
        "top_positive_factors": explanation["top_positive_factors"],
        "top_negative_factors": explanation["top_negative_factors"],
        "all_contributions": explanation["all_contributions"],
    }
    prediction["explanations"] = explanation["all_contributions"]
    prediction["positiveFactors"] = explanation["top_positive_factors"]
    prediction["negativeFactors"] = explanation["top_negative_factors"]

    json.dump(prediction, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
