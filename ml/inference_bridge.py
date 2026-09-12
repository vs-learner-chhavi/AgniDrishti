"""CLI bridge for invoking AgniDrishti's trained classifier from Next.js."""
import json
import sys
from predict_fire_type import predict_fire_type


def main():
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("Expected one JSON object")
    result = predict_fire_type(payload)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
