import sys,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ml'))
from observation_features import archive_features
from predict_fire_type import predict_fire_type
from explain_fire_type import explain_fire_type
snapshot=json.loads((ROOT/'public/data/firms-recent.json').read_text())
cache=json.loads((ROOT/'public/data/firms-predictions.json').read_text())
assert cache['archiveSha']==hashlib.sha256((ROOT/'public/data/firms-recent.json').read_bytes()).hexdigest()
assert set(cache['results'])=={p['id'] for p in snapshot['observations']}
seen=set()
for p in snapshot['observations']:
 r=cache['results'][p['id']]
 assert abs(sum(r['probabilities'].values())-1)<1e-5
 if r['fire_type'] in seen:continue
 f=archive_features({'latitude':p['latitude'],'longitude':p['longitude'],'detectedAt':f"{p['date']}T{p['time'][:2]}:{p['time'][2:]}:00Z"})
 actual=predict_fire_type(f)
 assert actual['fire_type']==r['fire_type']
 assert abs(actual['confidence']-r['confidence'])<1e-6
 expected=explain_fire_type(f)['all_contributions'][:3]
 for a,b in zip(expected,r['factors']):
  assert a['feature']==b['feature'] and abs(a['shap_value']-b['shap_value'])<1e-5
 assert r['activeDays30d']==f['active_days_30d']
 seen.add(r['fire_type'])
print('PASS: complete cache, normalized probabilities, single-observation prediction/SHAP/history parity for',len(seen),'classes')
