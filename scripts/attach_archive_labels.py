"""Join saved rule labels to the display archive; never infer missing labels."""
from pathlib import Path
import json
from collections import Counter
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/processed/fire_type_dataset.parquet'
TARGET = ROOT / 'public/data/firms-recent.json'

def attach(snapshot, frame):
    counts = Counter()
    groups = {key: group for key, group in frame.groupby(['date', 'time', 'satellite'])}
    for point in snapshot['observations']:
        point.pop('datasetLabel', None)
        group = groups.get((point['date'], point['time'], point['satellite']))
        if group is None:
            counts['unmatched'] += 1
            continue
        # JSON coordinates are rounded; parquet stores float32. Never match by location alone.
        rows = group[(abs(group.latitude - point['latitude']) < 0.00001) &
                     (abs(group.longitude - point['longitude']) < 0.00001)]
        if len(rows) != 1:
            counts['ambiguous' if len(rows) else 'unmatched'] += 1
            continue
        row = rows.iloc[0]
        point['datasetLabel'] = {'fireType': str(row.fire_type),
            'quality': str(row.label_confidence), 'eventId': str(row.event_id),
            'activeDays30d': int(row.active_days_30d),
            'observations30d': int(row.hotspot_count_30d)}
        counts[str(row.fire_type)] += 1
    snapshot['labelProvenance'] = {'source': 'data/processed/fire_type_dataset.parquet',
        'method': 'Saved rule-assigned labels, not model predictions or verified incidents',
        'matching': 'Date, acquisition time, satellite and coordinates within 0.00001 degrees; unique match required',
        'counts': dict(counts)}
    return snapshot

if __name__ == '__main__':
    snapshot = json.loads(TARGET.read_text())
    columns = ['latitude','longitude','date','time','satellite','fire_type','label_confidence',
               'event_id','active_days_30d','hotspot_count_30d']
    frame = pd.read_parquet(SOURCE, columns=columns)
    frame = frame[(frame.date >= snapshot['from']) & (frame.date <= snapshot['to'])]
    attach(snapshot, frame)
    TARGET.write_text(json.dumps(snapshot, separators=(',', ':')))
    print(json.dumps(snapshot['labelProvenance'], indent=2))
