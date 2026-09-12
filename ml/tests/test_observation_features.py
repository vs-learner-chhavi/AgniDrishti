"""Feature parity, boundary validation, and real saved-model integration checks."""
import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observation_features import CONTRACT, ROOT, simulation_features, archive_features


def sample(**changes):
    values = dict(latitude=22.35, longitude=69.85, detectedAt='2026-09-10T00:00:00Z',
        brightness=330, bright_t31=300, frp=15, confidence_score=50, daynight='N',
        active_days_7d=2, active_days_30d=5, hotspot_count_7d=2, hotspot_count_30d=5,
        daily_total_frp=15, daily_max_brightness=330, daily_mean_confidence=50)
    return {**values, **changes}


class FeatureTests(unittest.TestCase):
    def test_zero_and_midnight_are_preserved(self):
        f = simulation_features(sample(frp=0, confidence_score=0, daily_total_frp=0,
            daily_mean_confidence=0, active_days_7d=0, active_days_30d=0,
            hotspot_count_7d=0, hotspot_count_30d=0))
        for key in ('frp', 'confidence_score', 'hour', 'persistence_score', 'frp_per_detection_30d'):
            self.assertEqual(f[key], 0)
        self.assertEqual(set(f), set(CONTRACT['features']))

    def test_impossible_history_and_invalid_observations_rejected(self):
        for change in [dict(active_days_7d=8), dict(active_days_30d=1), dict(hotspot_count_7d=1),
                       dict(hotspot_count_30d=3), dict(bright_t31=None), dict(latitude=91),
                       dict(detectedAt='2026-09-10'), dict(daynight='unknown'), dict(frp=float('nan'))]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                simulation_features(sample(**change))

    def test_training_parity(self):
        path = ROOT / 'data/processed/fire_type_features.parquet'
        if not path.exists() or path.stat().st_size < 1000:
            self.skipTest('Full training features require git lfs pull')
        columns = CONTRACT['features'] + ['latitude', 'longitude', 'timestamp', 'daynight']
        frame = pd.read_parquet(path, columns=columns).dropna().sample(100, random_state=42)
        for _, row in frame.iterrows():
            payload = {key: float(row[key]) for key in CONTRACT['features']}
            payload.update(latitude=float(row.latitude), longitude=float(row.longitude),
                detectedAt=row.timestamp.isoformat(), daynight=str(row.daynight))
            actual = simulation_features(payload)
            np.testing.assert_allclose([actual[k] for k in CONTRACT['features']],
                                       [row[k] for k in CONTRACT['features']], rtol=2e-6, atol=2e-5)

    def test_saved_model_deterministic_and_sensitive_to_evidence(self):
        from predict_fire_type import predict_fire_type
        from explain_fire_type import explain_fire_type
        f = simulation_features(sample())
        first = predict_fire_type(f)
        self.assertEqual(first, predict_fire_type(f))
        changed = simulation_features(sample(active_days_7d=7, active_days_30d=30,
            hotspot_count_7d=7, hotspot_count_30d=30))
        self.assertNotEqual(first['probabilities'], predict_fire_type(changed)['probabilities'])
        self.assertAlmostEqual(sum(first['probabilities'].values()), 1, places=5)
        self.assertEqual(len(explain_fire_type(f)['all_contributions']), len(CONTRACT['features']))
        with self.assertRaises(ValueError):
            predict_fire_type({'brightness': 330})


if __name__ == '__main__':
    unittest.main()
