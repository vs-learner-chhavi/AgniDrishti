"""Validated model inputs using the same definitions as the training scripts."""
from datetime import datetime, timezone
from pathlib import Path
import json
import math
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / 'ml/models/inference_contract.json').read_text())


def number(data, key, minimum, maximum, integer=False):
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{key} must be a finite number.')
    if not minimum <= value <= maximum or (integer and value != int(value)):
        raise ValueError(f'{key} must be {"an integer " if integer else ""}between {minimum} and {maximum}.')
    return float(value)


def coordinates(data):
    return number(data, 'latitude', -90, 90), number(data, 'longitude', -180, 180)


def timestamp(data):
    try:
        value = datetime.fromisoformat(str(data['detectedAt']).replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError()
        return value.astimezone(timezone.utc)
    except (KeyError, ValueError):
        raise ValueError('detectedAt must include a date, time and timezone.')


def derived_flags(features):
    features.update({
        'night_fire_flag': features['is_night'],
        'persistent_activity': int(features['active_days_7d'] >= 3 or features['active_days_30d'] >= 10),
        'high_frp_flag': int(features['frp'] >= CONTRACT['high_frp_threshold']),
        'low_persistence_flag': int(features['active_days_30d'] <= 2),
    })
    return features


def simulation_features(data):
    """Explicit hypothetical history; never invent detections in an archive."""
    coordinates(data)
    at = timestamp(data)
    brightness = number(data, 'brightness', 200, 500)
    background = number(data, 'bright_t31', 150, 400)
    frp = number(data, 'frp', 0, 100000)
    confidence = number(data, 'confidence_score', 0, 100)
    if data.get('daynight') not in ('D', 'N'):
        raise ValueError('daynight must be D or N (the satellite observation flag).')
    a7 = number(data, 'active_days_7d', 0, 7, True)
    a30 = number(data, 'active_days_30d', 0, 30, True)
    n7 = number(data, 'hotspot_count_7d', 0, 100000, True)
    n30 = number(data, 'hotspot_count_30d', 0, 100000, True)
    if not a7 <= a30 <= a7 + 23:
        raise ValueError('30-day active days must include the 7-day active days, plus at most 23 older days.')
    if n7 < a7 or n30 < a30 or n30 < n7 or n30 - n7 < a30 - a7:
        raise ValueError('Detection counts must cover all active days in each window.')
    if (a7 == 0) != (n7 == 0) or (a30 == a7) != (n30 == n7):
        raise ValueError('Zero active days in a period must mean zero detections in that period.')
    total = number(data, 'daily_total_frp', frp, 10000000)
    max_brightness = number(data, 'daily_max_brightness', brightness, 500)
    daily_confidence = number(data, 'daily_mean_confidence', 0, 100)
    ratio7, ratio30 = a7 / 7, a30 / 30
    features = dict(brightness=brightness, bright_t31=background, frp=frp,
        confidence_score=confidence, log_frp=math.log1p(frp), thermal_excess=brightness-300,
        hour=at.hour, month=at.month, day_of_year=at.timetuple().tm_yday,
        is_night=int(data['daynight'] == 'N'), hotspot_count_7d=n7, active_days_7d=a7,
        hotspot_count_30d=n30, active_days_30d=a30, persistence_ratio_7d=ratio7,
        persistence_ratio_30d=ratio30, persistent_source_flag=int(a30 >= 5 or n30 >= 10),
        high_persistence_flag=int(a30 >= 10 or n30 >= 25), daily_total_frp=total,
        daily_max_brightness=max_brightness, daily_mean_confidence=daily_confidence,
        frp_per_detection_30d=total/n30 if n30 else 0,
        persistence_score=.5*ratio30 + .3*min(n30/25, 1) + .2*ratio7)
    return derived_flags(features)


def archive_features(data):
    """Replay an exact archived detection using its training-time aggregates."""
    lat, lon = coordinates(data)
    at = timestamp(data)
    path = ROOT / 'data/processed/firms_features.parquet'
    if not path.exists() or path.stat().st_size < 1000:
        raise FileNotFoundError('Archive features unavailable. Run git lfs pull for data/processed/firms_features.parquet.')
    # Float32 coordinates in this dataset need a small numeric tolerance (~1m).
    frame = pd.read_parquet(path, filters=[('latitude', '>=', lat-.00001),
        ('latitude', '<=', lat+.00001), ('longitude', '>=', lon-.00001), ('longitude', '<=', lon+.00001)])
    matches = frame[pd.to_datetime(frame.timestamp, utc=True) == pd.Timestamp(at)]
    if matches.empty:
        raise ValueError('No exact archived observation at these coordinates and time. Live observations need a complete feature/history feed; use Simulation Lab for hypothetical inputs.')
    if len(matches) != 1:
        raise ValueError('More than one archived observation matches. A satellite/event identifier is needed to disambiguate it.')
    row = matches.iloc[0]
    base = {key: float(row[key]) for key in CONTRACT['features'] if key in row.index}
    features = derived_flags(base)
    if set(CONTRACT['features']) - set(features) or not all(math.isfinite(v) for v in features.values()):
        raise ValueError('This archived observation has missing model inputs; prediction was not attempted.')
    return features


def location_context(lat, lon):
    """OSM snapshots are supporting evidence, not primary classifier inputs."""
    import numpy as np
    facilities, unavailable = [], []
    distances = {}
    for category in ('industrial', 'gas', 'mining'):
        path = ROOT / f'data/raw/osm/{category}.parquet'
        if not path.exists() or path.stat().st_size < 1000:
            unavailable.append(category)
            continue
        points = pd.read_parquet(path, columns=['latitude', 'longitude', 'name'])
        points = points.dropna(subset=['latitude', 'longitude'])
        if points.empty:
            distances[category] = None
            continue
        a, b = np.radians(points.latitude.to_numpy()), np.radians(points.longitude.to_numpy())
        x, y = math.radians(lat), math.radians(lon)
        hav = np.sin((a-x)/2)**2 + np.cos(a)*math.cos(x)*np.sin((b-y)/2)**2
        km = 6371 * 2 * np.arcsin(np.sqrt(np.clip(hav, 0, 1)))
        distances[category] = float(km.min())
        for i in np.argsort(km)[:5]:
            if km[i] > 10:
                continue
            point = points.iloc[i]
            facilities.append({'name': str(point['name']) if pd.notna(point['name']) else f'Unnamed {category} site',
                'type': category, 'latitude': float(point.latitude), 'longitude': float(point.longitude),
                'distanceKm': float(km[i]), 'source': 'OSM snapshot'})
    facilities.sort(key=lambda x: x['distanceKm'])
    return {'facilities': facilities, 'distancesKm': distances, 'unavailable': unavailable,
        'radiusKm': 10, 'source': 'Repository OSM snapshots',
        'note': 'Mapped infrastructure supports review; proximity does not establish the cause of a thermal anomaly.'}
