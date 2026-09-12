"""Cache model outputs for uniquely matched archived observations; never train."""
import sys,json,hashlib,math
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ml'))
import pandas as pd
from xgboost import DMatrix
from observation_features import derived_flags, CONTRACT
from predict_fire_type import predictor

snapshot=json.loads((ROOT/'public/data/firms-recent.json').read_text())
frame=pd.read_parquet(ROOT/'data/processed/firms_features.parquet')
frame=frame[(frame.date>=snapshot['from'])&(frame.date<=snapshot['to'])]
groups={k:g for k,g in frame.groupby(['date','time','satellite'])}
inputs=[];points=[];results={}
for p in snapshot['observations']:
    g=groups.get((p['date'],p['time'],p['satellite']))
    rows=g[(abs(g.latitude-p['latitude'])<.00001)&(abs(g.longitude-p['longitude'])<.00001)] if g is not None else []
    if len(rows)!=1:
        results[p['id']]={'error':'Missing or ambiguous observation match'};continue
    row=rows.iloc[0]
    f=derived_flags({k:float(row[k]) for k in CONTRACT['features'] if k in row.index})
    if any(k not in f or not math.isfinite(f[k]) for k in predictor.feature_names):
        results[p['id']]={'error':'Incomplete model inputs'};continue
    inputs.append(f);points.append(p)
X=predictor.prepare_features(pd.DataFrame(inputs))
predictions=predictor.predict(X)
shap=predictor.model.get_booster().predict(DMatrix(X,nthread=2),pred_contribs=True,strict_shape=True)
classes=list(predictor.label_encoder.classes_)
for i,(point,prediction) in enumerate(zip(points,predictions)):
    values=shap[i,classes.index(prediction['fire_type'])]
    factors=sorted([{'feature':k,'value':float(X.iloc[i][k]),'shap_value':round(float(values[j]),6)} for j,k in enumerate(predictor.feature_names)],key=lambda x:abs(x['shap_value']),reverse=True)
    results[point['id']]={**prediction,'activeDays30d':int(X.iloc[i].active_days_30d),'observations30d':int(X.iloc[i].hotspot_count_30d),'factors':factors[:3]}
model_sha=hashlib.sha256((ROOT/'ml/models/fire_type_classifier_final.pkl').read_bytes()).hexdigest()
assert model_sha==CONTRACT['model_sha256'], 'Model differs from feature contract'
output={'modelSha':model_sha,'archiveSha':hashlib.sha256((ROOT/'public/data/firms-recent.json').read_bytes()).hexdigest(),'evaluation':'Archive replay; training split membership unverified. Not held-out accuracy.','results':results}
(ROOT/'public/data/firms-predictions.json').write_text(json.dumps(output,separators=(',',':'),allow_nan=False))
print(Counter(x.get('fire_type','unavailable') for x in results.values()),flush=True)
