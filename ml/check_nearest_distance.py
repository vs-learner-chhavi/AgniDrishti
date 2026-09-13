import pandas as pd
import numpy as np
import math

# TG-1037 coordinates: Gas infrastructure, Rajasthan
lat, lon = 27.17, 73.21

for category in ['industrial', 'gas', 'mining']:
    path = f'../data/raw/osm/{category}.parquet'
    df = pd.read_parquet(path)
    a, b = np.radians(df.latitude.to_numpy()), np.radians(df.longitude.to_numpy())
    x, y = math.radians(lat), math.radians(lon)
    hav = np.sin((a - x) / 2) ** 2 + np.cos(a) * math.cos(x) * np.sin((b - y) / 2) ** 2
    km = 6371 * 2 * np.arcsin(np.sqrt(np.clip(hav, 0, 1)))
    nearest_idx = np.argmin(km)
    nearest_row = df.iloc[nearest_idx]
    print(f"{category}: {len(df)} total points, nearest is {km[nearest_idx]:.1f} km away "
          f"(name={nearest_row.get('name', 'N/A')}, "
          f"lat={nearest_row.latitude:.4f}, lon={nearest_row.longitude:.4f})")
