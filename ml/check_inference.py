"""Run one timed local diagnostic, without starting Next.js or modifying data."""
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

payload = dict(mode='simulation', latitude=22.35, longitude=69.85,
    detectedAt='2026-09-10T00:00:00Z', brightness=330, bright_t31=300,
    frp=15, confidence_score=50, daynight='N', active_days_7d=2,
    active_days_30d=5, hotspot_count_7d=2, hotspot_count_30d=5,
    daily_total_frp=15, daily_max_brightness=330, daily_mean_confidence=50)
print(f'Python {platform.python_version()} | {platform.system()} {platform.release()} | {platform.machine()}', flush=True)
print('Running one hypothetical prediction. Each stage is printed below; maximum wait is 90 seconds.', flush=True)
started = time.perf_counter()
try:
    result = subprocess.run([sys.executable, '-u', 'scenario_bridge.py'],
        cwd=Path(__file__).resolve().parent, input=json.dumps(payload), text=True,
        stdout=subprocess.PIPE, timeout=90,
        env={**os.environ, 'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2'})
    if result.returncode:
        print(f'Python worker exited with code {result.returncode}. See the error above.')
        sys.exit(1)
    data = json.loads(result.stdout)
    if not data.get('ok'):
        print(data.get('error', 'Inference failed.'))
        sys.exit(1)
    print(f"PASS in {time.perf_counter()-started:.2f}s | {data['prediction']['fire_type']} | {data['prediction']['confidence']*100:.1f}%")
    print(f"Explanation: {data['provenance']['explanationSource']} | factors: {len(data['explanation']['all_contributions'])}")
except subprocess.TimeoutExpired:
    print('STOPPED after 90 seconds. Share this output, including the last stage printed above.')
    sys.exit(1)
