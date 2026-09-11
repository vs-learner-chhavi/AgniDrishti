"""
Build OpenStreetMap industrial-context features for FIRMS hotspots.

Input:
    data/processed/firms_features.parquet

Output:
    data/processed/firms_osm_features.parquet

The script:
- Uses one Overpass request per geographic chunk.
- Downloads all required OSM categories together.
- Handles HTTP 429 rate limits with exponential backoff.
- Calculates nearest distances and industrial POI density.
"""

from pathlib import Path
import time
import json
import random
import requests

import numpy as np
import pandas as pd

from tqdm import tqdm
from scipy.spatial import cKDTree


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[1]

INPUT_PATH = BASE_DIR / "data" / "processed" / "firms_features.parquet"
OUTPUT_PATH = BASE_DIR / "data" / "processed" / "firms_osm_features.parquet"
REPORT_PATH = BASE_DIR / "data" / "reports" / "osm_features_report.json"

# Use a more reliable public Overpass endpoint.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Geographic chunk size.
# 3 x 3 degree chunks reduce total requests.
LAT_STEP = 3.0
LON_STEP = 3.0

# Radius for industrial POI density.
COUNT_RADIUS_KM = 5.0

# Maximum retained points per category.
MAX_POINTS_PER_CATEGORY = 2_000_000

REQUEST_TIMEOUT = 240

# Initial delay between requests.
REQUEST_DELAY = 8

# Maximum retry attempts per request.
MAX_RETRIES = 5


# ============================================================
# HELPERS
# ============================================================

def print_step(message):
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def generate_bboxes(lat_min, lat_max, lon_min, lon_max):
    """
    Generate geographic query chunks.
    """

    lat_values = np.arange(lat_min, lat_max, LAT_STEP)
    lon_values = np.arange(lon_min, lon_max, LON_STEP)

    bboxes = []

    for lat in lat_values:
        for lon in lon_values:
            bboxes.append(
                (
                    lat,
                    lon,
                    min(lat + LAT_STEP, lat_max),
                    min(lon + LON_STEP, lon_max),
                )
            )

    return bboxes


def extract_points(response):
    """
    Extract latitude/longitude coordinates from Overpass JSON.
    """

    points = []

    for element in response.get("elements", []):

        if element.get("type") == "node":
            lat = element.get("lat")
            lon = element.get("lon")

        else:
            center = element.get("center", {})
            lat = center.get("lat")
            lon = center.get("lon")

        if lat is not None and lon is not None:
            points.append((float(lat), float(lon)))

    return points


def query_overpass(query, bbox, chunk_number):
    """
    Query Overpass with retries, exponential backoff,
    and automatic endpoint switching.
    """

    last_error = None

    for attempt in range(MAX_RETRIES):

        endpoint = OVERPASS_URLS[
            (chunk_number + attempt) % len(OVERPASS_URLS)
        ]

        try:

            response = requests.post(
                endpoint,
                data=query,
                timeout=REQUEST_TIMEOUT,
                headers={
                    "User-Agent": (
                        "AgniDrishti/1.0 "
                        "(NASA FIRMS industrial fire research)"
                    )
                },
            )

            if response.status_code == 429:

                retry_after = response.headers.get(
                    "Retry-After"
                )

                if retry_after:
                    wait_seconds = float(retry_after)
                else:
                    wait_seconds = min(
                        120,
                        15 * (2 ** attempt)
                        + random.uniform(0, 5),
                    )

                print_step(
                    f"Rate limited on chunk {chunk_number}. "
                    f"Waiting {wait_seconds:.1f} seconds..."
                )

                time.sleep(wait_seconds)
                continue

            if response.status_code in [502, 503, 504]:

                wait_seconds = min(
                    120,
                    15 * (2 ** attempt)
                )

                print_step(
                    f"Overpass unavailable ({response.status_code}). "
                    f"Retrying in {wait_seconds} seconds..."
                )

                time.sleep(wait_seconds)
                continue

            response.raise_for_status()

            return response.json()

        except requests.exceptions.Timeout as exc:

            last_error = exc

            wait_seconds = min(
                120,
                15 * (2 ** attempt)
            )

            print_step(
                f"Timeout on chunk {chunk_number}. "
                f"Retrying in {wait_seconds} seconds..."
            )

            time.sleep(wait_seconds)

        except Exception as exc:

            last_error = exc

            wait_seconds = min(
                120,
                10 * (2 ** attempt)
            )

            print_step(
                f"Request failed on chunk {chunk_number}: {exc}"
            )

            time.sleep(wait_seconds)

    print_step(
        f"Giving up on chunk {chunk_number}. "
        f"Last error: {last_error}"
    )

    return {"elements": []}


def haversine_km(lat1, lon1, lat2, lon2):
    """
    Vectorized haversine distance.
    """

    earth_radius = 6371.0088

    lat1 = np.radians(lat1)
    lon1 = np.radians(lon1)
    lat2 = np.radians(lat2)
    lon2 = np.radians(lon2)

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        np.sin(dlat / 2) ** 2
        + np.cos(lat1)
        * np.cos(lat2)
        * np.sin(dlon / 2) ** 2
    )

    return (
        2
        * earth_radius
        * np.arcsin(np.sqrt(a))
    )


def nearest_distances(
    hotspot_lat,
    hotspot_lon,
    poi_lat,
    poi_lon,
):
    """
    Find nearest OSM feature distance in kilometres.
    """

    if len(poi_lat) == 0:
        return np.full(
            len(hotspot_lat),
            np.nan,
            dtype=np.float32,
        )

    mean_lat = np.radians(np.mean(hotspot_lat))

    x_hotspots = (
        hotspot_lon
        * np.cos(mean_lat)
        * 111.32
    )

    y_hotspots = hotspot_lat * 111.32

    x_poi = (
        poi_lon
        * np.cos(mean_lat)
        * 111.32
    )

    y_poi = poi_lat * 111.32

    tree = cKDTree(
        np.column_stack([x_poi, y_poi])
    )

    distances, _ = tree.query(
        np.column_stack([
            x_hotspots,
            y_hotspots,
        ]),
        k=1,
    )

    return distances.astype(np.float32)


def count_within_radius(
    hotspot_lat,
    hotspot_lon,
    poi_lat,
    poi_lon,
    radius_km,
):
    """
    Count industrial POIs within radius_km.
    """

    if len(poi_lat) == 0:
        return np.zeros(
            len(hotspot_lat),
            dtype=np.int32,
        )

    mean_lat = np.radians(np.mean(hotspot_lat))

    x_hotspots = (
        hotspot_lon
        * np.cos(mean_lat)
        * 111.32
    )

    y_hotspots = hotspot_lat * 111.32

    x_poi = (
        poi_lon
        * np.cos(mean_lat)
        * 111.32
    )

    y_poi = poi_lat * 111.32

    tree = cKDTree(
        np.column_stack([x_poi, y_poi])
    )

    counts = tree.query_ball_point(
        np.column_stack([
            x_hotspots,
            y_hotspots,
        ]),
        r=radius_km,
        return_length=True,
    )

    return counts.astype(np.int32)


def build_overpass_query(bbox):
    """
    Query all required OSM categories in one request.
    """

    south, west, north, east = bbox

    return f"""
    [out:json][timeout:180];

    (
      /* Industrial landuse and industrial features */
      way["landuse"="industrial"]({south},{west},{north},{east});
      relation["landuse"="industrial"]({south},{west},{north},{east});
      node["industrial"]({south},{west},{north},{east});
      way["industrial"]({south},{west},{north},{east});

      /* Power plants */
      node["power"="plant"]({south},{west},{north},{east});
      way["power"="plant"]({south},{west},{north},{east});
      relation["power"="plant"]({south},{west},{north},{east});

      /* Refineries and works */
      node["industrial"="refinery"]({south},{west},{north},{east});
      way["industrial"="refinery"]({south},{west},{north},{east});
      node["man_made"="works"]({south},{west},{north},{east});
      way["man_made"="works"]({south},{west},{north},{east});

      /* Landfills */
      node["landuse"="landfill"]({south},{west},{north},{east});
      way["landuse"="landfill"]({south},{west},{north},{east});
      relation["landuse"="landfill"]({south},{west},{north},{east});

      /* Mines and quarries */
      node["landuse"="quarry"]({south},{west},{north},{east});
      way["landuse"="quarry"]({south},{west},{north},{east});
      relation["landuse"="quarry"]({south},{west},{north},{east});
      node["resource"="coal"]({south},{west},{north},{east});
      way["resource"="coal"]({south},{west},{north},{east});

      /* Industrial POIs */
      node["industrial"]({south},{west},{north},{east});
      node["man_made"="works"]({south},{west},{north},{east});
      node["man_made"="kiln"]({south},{west},{north},{east});
      node["man_made"="silo"]({south},{west},{north},{east});
      node["power"="plant"]({south},{west},{north},{east});
    );

    out center;
    """


# ============================================================
# MAIN
# ============================================================

def main():

    start_time = time.time()

    print_step(
        "Starting improved OSM industrial-context extraction."
    )

    if not INPUT_PATH.exists():
        raise FileNotFoundError(
            f"Input file not found: {INPUT_PATH}"
        )

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    REPORT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    # --------------------------------------------------------
    # 1. LOAD DATA
    # --------------------------------------------------------

    print_step("Loading FIRMS persistence features.")

    df = pd.read_parquet(
        INPUT_PATH,
        columns=[
            "latitude",
            "longitude",
            "grid_id",
        ],
    )

    print_step(
        f"Loaded {len(df):,} FIRMS detections."
    )

    # --------------------------------------------------------
    # 2. UNIQUE SPATIAL LOCATIONS
    # --------------------------------------------------------

    locations = (
        df.groupby("grid_id", as_index=False)
        .agg(
            latitude=("latitude", "mean"),
            longitude=("longitude", "mean"),
        )
    )

    print_step(
        f"Unique spatial cells: {len(locations):,}"
    )

    lat_min = float(locations["latitude"].min()) - 0.1
    lat_max = float(locations["latitude"].max()) + 0.1
    lon_min = float(locations["longitude"].min()) - 0.1
    lon_max = float(locations["longitude"].max()) + 0.1

    bboxes = generate_bboxes(
        lat_min,
        lat_max,
        lon_min,
        lon_max,
    )

    print_step(
        f"Geographic query chunks: {len(bboxes):,}"
    )

    # --------------------------------------------------------
    # 3. DOWNLOAD OSM DATA
    # --------------------------------------------------------

    osm_points = {
        "industrial": [],
        "power_plant": [],
        "refinery": [],
        "landfill": [],
        "mine": [],
        "industrial_poi": [],
    }

    for chunk_number, bbox in enumerate(
        tqdm(bboxes, desc="OSM chunks"),
        start=1,
    ):

        query = build_overpass_query(bbox)

        response = query_overpass(
            query,
            bbox,
            chunk_number,
        )

        elements = response.get("elements", [])

        print_step(
            f"Chunk {chunk_number}/{len(bboxes)}: "
            f"{len(elements):,} OSM elements"
        )

        for element in elements:

            tags = element.get("tags", {})

            if element.get("type") == "node":
                lat = element.get("lat")
                lon = element.get("lon")
            else:
                center = element.get("center", {})
                lat = center.get("lat")
                lon = center.get("lon")

            if lat is None or lon is None:
                continue

            point = (float(lat), float(lon))

            # Industrial landuse/features.
            if (
                tags.get("landuse") == "industrial"
                or "industrial" in tags
            ):
                osm_points["industrial"].append(point)

            # Power plants.
            if tags.get("power") == "plant":
                osm_points["power_plant"].append(point)
                osm_points["industrial_poi"].append(point)

            # Refineries and works.
            if (
                tags.get("industrial") == "refinery"
                or tags.get("man_made") == "works"
            ):
                osm_points["refinery"].append(point)
                osm_points["industrial_poi"].append(point)

            # Landfills.
            if tags.get("landuse") == "landfill":
                osm_points["landfill"].append(point)

            # Mines/quarries.
            if (
                tags.get("landuse") == "quarry"
                or tags.get("resource") == "coal"
            ):
                osm_points["mine"].append(point)

            # General industrial POIs.
            if (
                "industrial" in tags
                or tags.get("man_made") in [
                    "works",
                    "kiln",
                    "silo",
                ]
                or tags.get("power") == "plant"
                or tags.get("landuse") == "industrial"
            ):
                osm_points["industrial_poi"].append(point)

        # Avoid hammering the API.
        time.sleep(
            REQUEST_DELAY + random.uniform(0, 3)
        )

    # --------------------------------------------------------
    # 4. DEDUPLICATE OSM POINTS
    # --------------------------------------------------------

    print_step("Deduplicating OSM points.")

    osm_arrays = {}

    for category, points in osm_points.items():

        if not points:
            osm_arrays[category] = (
                np.array([], dtype=np.float32),
                np.array([], dtype=np.float32),
            )
            continue

        category_df = pd.DataFrame(
            points,
            columns=[
                "latitude",
                "longitude",
            ],
        )

        category_df = category_df.drop_duplicates()

        if len(category_df) > MAX_POINTS_PER_CATEGORY:
            category_df = category_df.sample(
                MAX_POINTS_PER_CATEGORY,
                random_state=42,
            )

        osm_arrays[category] = (
            category_df["latitude"].to_numpy(
                dtype=np.float32
            ),
            category_df["longitude"].to_numpy(
                dtype=np.float32
            ),
        )

        print_step(
            f"{category}: {len(category_df):,} unique points."
        )

    # --------------------------------------------------------
    # 5. CALCULATE DISTANCES
    # --------------------------------------------------------

    print_step("Calculating OSM distance features.")

    hotspot_lat = locations["latitude"].to_numpy(
        dtype=np.float32
    )

    hotspot_lon = locations["longitude"].to_numpy(
        dtype=np.float32
    )

    features = pd.DataFrame({
        "grid_id": locations["grid_id"].to_numpy(),
    })

    distance_categories = {
        "industrial": "distance_to_industry_km",
        "power_plant": "distance_to_power_plant_km",
        "refinery": "distance_to_refinery_km",
        "landfill": "distance_to_landfill_km",
        "mine": "distance_to_mine_km",
    }

    for category, column_name in distance_categories.items():

        print_step(
            f"Calculating {column_name}."
        )

        poi_lat, poi_lon = osm_arrays[category]

        features[column_name] = nearest_distances(
            hotspot_lat,
            hotspot_lon,
            poi_lat,
            poi_lon,
        )

    # --------------------------------------------------------
    # 6. INDUSTRIAL POI DENSITY
    # --------------------------------------------------------

    print_step(
        "Calculating industrial POI count within 5 km."
    )

    poi_lat, poi_lon = osm_arrays["industrial_poi"]

    features["industrial_poi_count_5km"] = (
        count_within_radius(
            hotspot_lat,
            hotspot_lon,
            poi_lat,
            poi_lon,
            COUNT_RADIUS_KM,
        )
    )

    # --------------------------------------------------------
    # 7. CONTEXT FLAGS
    # --------------------------------------------------------

    print_step("Creating industrial-context flags.")

    features["industrial_context_flag"] = (
        (
            features["distance_to_industry_km"] <= 5
        )
        | (
            features["distance_to_power_plant_km"] <= 5
        )
        | (
            features["distance_to_refinery_km"] <= 5
        )
        | (
            features["industrial_poi_count_5km"] >= 3
        )
    ).astype(np.int8)

    features["strong_industrial_context_flag"] = (
        (
            features["distance_to_industry_km"] <= 2
        )
        | (
            features["distance_to_power_plant_km"] <= 2
        )
        | (
            features["distance_to_refinery_km"] <= 2
        )
    ).astype(np.int8)

    # --------------------------------------------------------
    # 8. MERGE BACK TO FIRMS EVENTS
    # --------------------------------------------------------

    print_step("Merging OSM features with FIRMS events.")

    final_df = df.merge(
        features,
        on="grid_id",
        how="left",
        validate="many_to_one",
    )

    # --------------------------------------------------------
    # 9. SAVE OUTPUT
    # --------------------------------------------------------

    print_step(
        f"Saving output to:\n{OUTPUT_PATH}"
    )

    final_df.to_parquet(
        OUTPUT_PATH,
        index=False,
        engine="pyarrow",
        compression="snappy",
    )

    report = {
        "input_file": str(INPUT_PATH),
        "output_file": str(OUTPUT_PATH),
        "rows": int(len(final_df)),
        "unique_spatial_cells": int(len(locations)),
        "query_chunks": int(len(bboxes)),
        "osm_categories": list(osm_arrays.keys()),
        "industrial_context_events": int(
            final_df["industrial_context_flag"].sum()
        ),
        "strong_industrial_context_events": int(
            final_df["strong_industrial_context_flag"].sum()
        ),
        "elapsed_seconds": round(
            time.time() - start_time,
            2,
        ),
    }

    with open(
        REPORT_PATH,
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            report,
            file,
            indent=2,
        )

    print_step("OSM extraction completed successfully.")
    print_step(
        f"Final rows: {len(final_df):,}"
    )
    print_step(
        f"Final columns: {len(final_df.columns):,}"
    )


if __name__ == "__main__":
    main()