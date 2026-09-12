"""Shared inference boundary for hypothetical scenarios and exact archive replay."""
import hashlib
import json
import sys
from pathlib import Path


def run(payload):
    from observation_features import (CONTRACT, ROOT, archive_features, coordinates,
                                      location_context, simulation_features, timestamp)
    if not isinstance(payload, dict):
        raise ValueError('Expected a JSON object.')
    mode = payload.get('mode')
    if mode not in ('simulation', 'archive'):
        raise ValueError('mode must be simulation or archive.')
    lat, lon = coordinates(payload)
    at = timestamp(payload)
    features = simulation_features(payload) if mode == 'simulation' else archive_features(payload)
    digest = hashlib.sha256((ROOT / 'ml/models/fire_type_classifier_final.pkl').read_bytes()).hexdigest()
    if digest != CONTRACT['model_sha256']:
        raise ValueError('Model changed. Export and verify the matching inference contract before running predictions.')
    from predict_fire_type import predict_fire_type
    from explain_fire_type import explain_fire_type
    prediction = predict_fire_type(features)
    explanation = explain_fire_type(features)
    context = location_context(lat, lon)
    return {'ok': True, 'mode': mode, 'observation': {'latitude': lat, 'longitude': lon,
        'detectedAt': at.isoformat()}, 'prediction': prediction, 'explanation': explanation,
        'features': features, 'context': context,
        'provenance': {'modelSha256': digest, 'featureContractVersion': CONTRACT['version'],
            'inputs': 'User-defined hypothetical observation and history' if mode == 'simulation' else 'Exact archived observation with precomputed training features',
            'historyWindow': CONTRACT['history_window'], 'gridSizeDegrees': CONTRACT['grid_size_degrees'],
            'highFrpThreshold': CONTRACT['high_frp_threshold'],
            'explanationSource': 'SHAP TreeExplainer', 'persisted': False}}


if __name__ == '__main__':
    try:
        result = run(json.load(sys.stdin))
    except (ValueError, KeyError, TypeError) as error:
        result = {'ok': False, 'error': str(error), 'status': 422}
    except FileNotFoundError as error:
        result = {'ok': False, 'error': str(error), 'status': 503}
    except Exception as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        result = {'ok': False, 'error': 'Trained model could not run. Check the Python environment and model files.', 'status': 503}
    print(json.dumps(result, allow_nan=False))
