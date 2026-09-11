from pathlib import Path
import json
import time
import requests
import pandas as pd

OUTPUT_DIR = Path("data/raw/osm")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

HEADERS = {
    "User-Agent": "AgniDrishti/1.0 research project",
    "Accept": "application/json",
}

# Smaller regions instead of querying all of India at once.
REGIONS = {
    "north": (24, 68, 37, 82),
    "central": (17, 72, 28, 86),
    "east": (17, 82, 29, 98),
    "south": (6, 72, 18, 86),
    "west": (6, 68, 24, 78),
    "northeast": (21, 88, 30, 98),
}

QUERIES = {
    "industrial": """
        nwr["industrial"="factory"]({bbox});
        nwr["industrial"="plant"]({bbox});
        nwr["industrial"="refinery"]({bbox});
        nwr["industrial"="depot"]({bbox});
    """,
    "mining": """
        nwr["landuse"="quarry"]({bbox});
        nwr["industrial"="mine"]({bbox});
        nwr["resource"="coal"]({bbox});
        nwr["resource"="iron_ore"]({bbox});
    """,
    "gas": """
        nwr["man_made"="pipeline"]({bbox});
        nwr["man_made"="storage_tank"]({bbox});
        nwr["industrial"="oil"]({bbox});
        nwr["industrial"="gas"]({bbox});
    """,
}


def query_overpass(query, category, region_name):
    for endpoint in ENDPOINTS:
        try:
            print(f"Trying {endpoint} | {category} | {region_name}")

            response = requests.post(
                endpoint,
                data={"data": query},
                headers=HEADERS,
                timeout=120,
            )

            response.raise_for_status()
            return response.json()

        except Exception as e:
            print(f"Failed: {e}")
            time.sleep(5)

    return None


def extract_records(data, category, region_name):
    records = []

    if not data:
        return records

    for element in data.get("elements", []):
        tags = element.get("tags", {})

        lat = element.get("lat")
        lon = element.get("lon")

        if lat is None or lon is None:
            center = element.get("center", {})
            lat = center.get("lat")
            lon = center.get("lon")

        if lat is None or lon is None:
            continue

        records.append({
            "osm_id": element.get("id"),
            "osm_type": element.get("type"),
            "latitude": lat,
            "longitude": lon,
            "category": category,
            "region": region_name,
            **tags,
        })

    return records


def main():
    all_records = {
        "industrial": [],
        "mining": [],
        "gas": [],
    }

    for category, query_template in QUERIES.items():
        print(f"\nDownloading {category} infrastructure...")

        for region_name, (south, west, north, east) in REGIONS.items():
            bbox = f"{south},{west},{north},{east}"

            query = f"""
            [out:json][timeout:120];
            (
                {query_template.format(bbox=bbox)}
            );
            out center tags;
            """

            data = query_overpass(query, category, region_name)

            records = extract_records(data, category, region_name)
            all_records[category].extend(records)

            print(
                f"{category} | {region_name}: "
                f"{len(records)} records"
            )

            time.sleep(5)

    for category, records in all_records.items():
        if not records:
            print(f"No records collected for {category}")
            continue

        df = pd.DataFrame(records)

        # Remove duplicate OSM objects collected from overlapping regions.
        df = df.drop_duplicates(
            subset=["osm_type", "osm_id"]
        )

        output_path = OUTPUT_DIR / f"{category}.parquet"
        df.to_parquet(output_path, index=False)

        print(
            f"\nSaved {len(df):,} records → {output_path}"
        )

    print("\nAll OSM downloads completed.")


if __name__ == "__main__":
    main()