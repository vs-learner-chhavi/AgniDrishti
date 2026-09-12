"""Export fitted preprocessing constants without retraining the classifier."""
from pathlib import Path
import hashlib
import json
import pickle
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
models = ROOT / 'ml/models'
source = ROOT / 'data/processed/firms_features.parquet'
frp = pd.read_parquet(source, columns=['frp']).frp
contract = {
    'version': 1,
    'model_sha256': hashlib.sha256((models / 'fire_type_classifier_final.pkl').read_bytes()).hexdigest(),
    'features': pickle.loads((models / 'fire_type_features_final.pkl').read_bytes()),
    'high_frp_threshold': float(frp.quantile(.90)),
    'high_frp_source': '90th percentile of data/processed/firms_features.parquet, as in scripts/build_fire_type_features.py',
    'grid_size_degrees': .05,
    'history_window': 'Previous 7/30 UTC calendar days, excluding observation day',
    'confidence_scale': '0–100; VIIRS low=0, nominal=50, high=100',
    'thermal_excess': 'brightness - 300 K',
}
(models / 'inference_contract.json').write_text(json.dumps(contract, indent=2) + '\n')
print('Exported inference contract; model weights unchanged.')
