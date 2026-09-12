"""Exercise real HTTP inference against a temporary local production server."""
from pathlib import Path
import json
import os
import subprocess
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
PORT = 3187
BASE = f'http://127.0.0.1:{PORT}'


def post(path, payload):
    request = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        response = urllib.request.urlopen(request, timeout=65)
    except urllib.error.HTTPError as error:
        response = error
    return response.status, json.load(response)


if __name__ == '__main__':
    server = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start',
        '--hostname', '127.0.0.1', '--port', str(PORT)], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={**os.environ, 'PYTHON_BIN': os.environ.get('PYTHON_BIN', os.sys.executable)})
    try:
        for _ in range(40):
            try:
                with urllib.request.urlopen(BASE, timeout=1) as response:
                    assert response.status == 200
                break
            except OSError:
                time.sleep(.25)
        else:
            raise RuntimeError('Preview server did not start; run npm run build first.')
        payload = dict(latitude=22.35, longitude=69.85, detectedAt='2026-09-10T00:00:00Z',
            brightness=330, bright_t31=300, frp=15, confidence_score=50, daynight='N',
            active_days_7d=2, active_days_30d=5, hotspot_count_7d=2, hotspot_count_30d=5,
            daily_total_frp=15, daily_max_brightness=330, daily_mean_confidence=50)
        status, first = post('/api/simulate', payload)
        assert status == 200, first
        assert first['provenance']['persisted'] is False
        assert len(first['explanation']['all_contributions']) == 27
        assert any('Reliance' in f['name'] for f in first['context']['facilities'])
        status, repeat = post('/api/simulate', payload)
        assert status == 200 and first['prediction'] == repeat['prediction']
        status, moved = post('/api/simulate', {**payload, 'latitude': 26.5, 'longitude': 80.5})
        assert status == 200 and moved['observation']['latitude'] == 26.5
        assert moved['prediction'] == first['prediction'], 'Coordinates should change context, not primary classifier features'
        status, invalid = post('/api/simulate', {**payload, 'active_days_7d': 8})
        assert status == 422 and invalid['ok'] is False
        status, missing = post('/api/analyze', {'latitude': 22.35, 'longitude': 69.85})
        assert status == 422 and missing['ok'] is False
        status, archive = post('/api/analyze', {'latitude': 24.8279209137, 'longitude': 93.7563781738, 'detectedAt': '2024-01-01T06:13:00Z'})
        assert status == 200, archive
        assert archive['event']['source'] == 'NASA_ARCHIVE'
        assert archive['event']['result']['confidence'] == archive['analysis']['prediction']['confidence'] * 100
        print(json.dumps({'passed': ['real prediction', '27 SHAP factors', 'actual nearby OSM site',
            'deterministic repeat', 'new exact coordinates', 'invalid history rejected',
            'missing timestamp rejected', 'exact archive replay', 'model confidence scale'],
            'examplePrediction': first['prediction'], 'exampleFacility': first['context']['facilities'][0]}, indent=2))
    finally:
        server.terminate()
        server.wait(timeout=10)
