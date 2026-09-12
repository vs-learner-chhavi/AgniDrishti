"""
scripts/build_historical_intelligence.py

Builds the compact, precomputed Historical Intelligence dataset consumed by
app/api/history/route.ts and rendered by components/HistoricalIntelligence.tsx.

WHY THIS SCRIPT EXISTS
-----------------------
Historical Intelligence needs a real, per-cluster daily timeline, persistence
summary, thermal baseline, behaviour interpretation, multi-satellite
corroboration, activity fingerprint and escalation/change-detection result
for the *currently selected* thermal event. Computing all of that from the
raw ~280MB of NASA FIRMS CSV on every page load (or every hover) would be
slow and would require shipping raw observations to the browser.

Instead, this script performs the expensive spatial/temporal aggregation
ONCE, offline, and writes a small derived JSON file
(data/derived/historical_intelligence.json) keyed by spatial grid cell.
The Next.js API route just looks up the relevant cell(s) at request time.

INPUT
-----
data/processed/firms_clean.parquet
    Produced by the EXISTING scripts/preprocess_firms.py. This script does
    NOT re-implement archive/NRT ingestion, duplicate handling across the
    three raw CSVs, or FIRMS field parsing -- that already exists in the
    current repository and is reused as-is (see "REUSED FROM EXISTING
    PIPELINE" below). This script only adds a Historical-Intelligence-
    specific aggregation layer on top of that already-cleaned data.

REUSED FROM EXISTING PIPELINE
------------------------------
* Column names / dtypes produced by preprocess_firms.py:
  latitude, longitude, brightness, scan, track, date, time, satellite,
  instrument, confidence, version, bright_t31, frp, daynight, firms_type,
  timestamp, confidence_score, log_frp, thermal_excess, hour, month,
  day_of_year, year, season, is_night, data_quality, event_id.
* The 0.05 degree (~5.5 km) spatial grid used by scripts/build_persistence.py
  (GRID_SIZE). Historical Intelligence intentionally reuses the SAME grid
  definition so that "persistence" (existing feature) and "Historical
  Intelligence" (this feature) describe the same spatial unit instead of
  inventing a second, incompatible clustering system.
* data_quality ("ARCHIVE" | "NRT") already assigned by preprocess_firms.py.

ADDITIONAL DEDUPLICATION LOGIC (documented, as requested)
-----------------------------------------------------------
preprocess_firms.py already removes exact duplicate rows across the three
raw files (same latitude, longitude, timestamp, satellite, brightness, frp).
That catches byte-identical overlap between the archive and NRT extracts.

It does not catch *near*-duplicate observations: the same physical detection
reported once in an NRT file and again -- usually with minor value revisions
-- once it lands in the standard archive. This script adds one more pass for
that case, applied within each (grid cell, calendar date, satellite) group:

  1. Sort the group's observations by timestamp.
  2. Walk the sorted observations. Any pair whose timestamps are within
     RESOLUTION_WINDOW_MINUTES of each other is treated as the same
     physical detection reported twice.
  3. When such a pair spans an ARCHIVE row and an NRT row, keep the ARCHIVE
     row and drop the NRT row (the archive product is the higher-quality,
     reprocessed standard product). When both rows share the same
     data_quality, keep the first (earliest-timestamp) row.

This is intentionally conservative: it only merges rows that are already in
the same 5.5 km grid cell, on the same UTC calendar date, from the same
satellite, and within a few minutes of each other. It will not merge
genuinely distinct passes or genuinely newer detections.

OUTPUT
------
data/derived/historical_intelligence.json
  {
    "generatedAt": "...",
    "gridSizeDegrees": 0.05,
    "datasetPeriod": {"start": "...", "end": "..."},
    "clusters": {
      "<gridId>": { ...ClusterRecord... },
      ...
    }
  }

Run:
    python scripts/build_historical_intelligence.py

Requires: pandas, numpy, pyarrow (already required by the existing
scripts/preprocess_firms.py and scripts/build_persistence.py).
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from statistics import median

import numpy as np
import pandas as pd

# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[1]
INPUT_PATH = BASE_DIR / "data" / "processed" / "firms_clean.parquet"
OUTPUT_PATH = BASE_DIR / "data" / "derived" / "historical_intelligence.json"
REPORT_PATH = BASE_DIR / "data" / "reports" / "historical_intelligence_report.json"

# Same spatial grid as scripts/build_persistence.py. Kept identical on
# purpose -- see module docstring.
GRID_SIZE = 0.05

# Near-duplicate resolution window used for the additional archive/NRT pass
# described above.
RESOLUTION_WINDOW_MINUTES = 10
# Two close-in-time rows in the same cell/date/satellite are only merged as
# the "same" detection if their brightness values are also this close --
# otherwise they are treated as distinct legitimate detections.
BRIGHTNESS_MATCH_TOLERANCE_K = 15.0

# Persistence window (days) used for the PERSISTENCE SUMMARY feature.
PERSISTENCE_WINDOW_DAYS = 30

# Multi-satellite corroboration thresholds. Chosen because VIIRS N20/N21
# overpasses of a given point in India typically occur within a few hours
# of each other; 6 hours comfortably covers same-day repeat passes without
# matching detections from unrelated days. 2 km keeps the match inside a
# single ~5.5 km grid cell (avoids corroborating across genuinely separate
# hotspots that merely share a cell).
CORROBORATION_MAX_HOURS = 6.0
CORROBORATION_MAX_KM = 2.0

# Thermal baseline thresholds (documented in CHANGES.md).
BASELINE_MIN_OBSERVATIONS = 5
BASELINE_ELEVATED_PCT = 10.0
BASELINE_UNUSUAL_PCT = 25.0

# Behaviour interpretation thresholds (documented in CHANGES.md).
BEHAVIOR_ISOLATED_MAX_OBS = 2
BEHAVIOR_PERSISTENT_RATIO = 0.5
BEHAVIOR_INTERMITTENT_RATIO = 0.15
BEHAVIOR_ESCALATION_RATIO = 2.0
BEHAVIOR_ESCALATION_MIN_OBS = 5

# Escalation / change-detection thresholds.
ESCALATION_MIN_TOTAL_OBS = 15
ESCALATION_MIN_HISTORY_DAYS = 21
ESCALATION_RATIO = 2.0

# Fingerprint thresholds.
FINGERPRINT_MIN_OBS = 8


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def max_pairwise_distance_km(lats, lons) -> float | None:
    n = len(lats)
    if n < 2:
        return None
    best = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            d = haversine_km(lats[i], lons[i], lats[j], lons[j])
            if d > best:
                best = d
    return round(best, 3)


def confidence_label(v) -> str | None:
    s = str(v).strip().lower()
    if s in ("l", "low"):
        return "l"
    if s in ("n", "nominal"):
        return "n"
    if s in ("h", "high"):
        return "h"
    return None


# ============================================================
# STEP 1 -- LOAD + BUILD GRID
# ============================================================

def load_and_grid() -> pd.DataFrame:
    if not INPUT_PATH.exists():
        raise FileNotFoundError(
            f"Input file not found:\n{INPUT_PATH}\n"
            "Run scripts/preprocess_firms.py first (existing pipeline)."
        )
    log(f"Loading cleaned FIRMS data from {INPUT_PATH}")
    df = pd.read_parquet(INPUT_PATH)
    log(f"Loaded {len(df):,} rows.")

    required = ["latitude", "longitude", "timestamp", "satellite", "brightness", "data_quality"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(
            f"firms_clean.parquet is missing expected columns: {missing}. "
            "This script expects the output shape of the existing "
            "scripts/preprocess_firms.py."
        )

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df[df["timestamp"].notna()].copy()

    df["grid_lat"] = np.floor(df["latitude"] / GRID_SIZE).astype(np.int64)
    df["grid_lon"] = np.floor(df["longitude"] / GRID_SIZE).astype(np.int64)
    df["grid_id"] = df["grid_lat"] * 10000 + df["grid_lon"]
    df["date_only"] = df["timestamp"].dt.strftime("%Y-%m-%d")

    if "confidence" not in df.columns:
        df["confidence"] = None
    df["confidence_label"] = df["confidence"].map(confidence_label)

    if "frp" not in df.columns:
        df["frp"] = np.nan

    log(f"Assigned {df['grid_id'].nunique():,} spatial cells (grid size {GRID_SIZE} deg).")
    return df


# ============================================================
# STEP 2 -- ARCHIVE/NRT NEAR-DUPLICATE RESOLUTION (see docstring)
# ============================================================

def resolve_near_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    """
    Walks each (grid cell, calendar date, satellite) group in timestamp
    order and compares EACH row only to the most recently KEPT row --
    never to an earlier "anchor" -- so a chain of detections spaced just
    under RESOLUTION_WINDOW_MINUTES apart cannot be collapsed into a single
    observation spanning much longer than that window (that would have
    silently discarded genuinely distinct, legitimate detections).

    A pair is only ever treated as a near-duplicate of the SAME physical
    detection if BOTH:
      (a) timestamps are within RESOLUTION_WINDOW_MINUTES of each other, AND
      (b) brightness values are within BRIGHTNESS_MATCH_TOLERANCE_K of each
          other (guards against two genuinely distinct hotspots that happen
          to fall in the same 5.5 km cell within a few minutes of each
          other -- rare, but a real possibility for large or busy cells).
    When both conditions hold and one row is ARCHIVE and the other NRT, the
    ARCHIVE row is kept. When both share the same data_quality, the earlier
    (lower index) row is kept and the later one is dropped.
    """
    log("Resolving archive/NRT near-duplicate observations...")
    window = pd.Timedelta(minutes=RESOLUTION_WINDOW_MINUTES)

    # Reset to a dense 0..n-1 RangeIndex first. keep_mask is a plain NumPy
    # array positionally aligned to df's rows; group.index.to_numpy() below
    # is used to scatter results back into keep_mask by row position, which
    # is only correct if df's index IS that row position. If df ever arrived
    # with a non-default index (a stray filter upstream, a concat that
    # didn't reset, etc.) this would silently write to the wrong rows.
    df = df.sort_values(["grid_id", "date_only", "satellite", "timestamp"]).reset_index(drop=True)
    keep_mask = np.ones(len(df), dtype=bool)
    dropped = 0

    group_cols = ["grid_id", "date_only", "satellite"]

    for _, group in df.groupby(group_cols, sort=False):
        if len(group) < 2:
            continue
        idx = group.index.to_numpy()
        ts = group["timestamp"].to_numpy()
        quality = group["data_quality"].to_numpy()
        brightness = group["brightness"].to_numpy()

        anchor = 0  # position (within this group) of the last KEPT row
        n = len(idx)
        for k in range(1, n):
            close_in_time = (ts[k] - ts[anchor]) <= np.timedelta64(window)
            close_in_brightness = abs(float(brightness[k]) - float(brightness[anchor])) <= BRIGHTNESS_MATCH_TOLERANCE_K
            if close_in_time and close_in_brightness:
                if quality[k] == "ARCHIVE" and quality[anchor] != "ARCHIVE":
                    # Newer row is the higher-quality product -- it wins,
                    # and becomes the anchor for subsequent comparisons.
                    keep_mask[idx[anchor]] = False
                    dropped += 1
                    anchor = k
                else:
                    # Keep the existing anchor (already ARCHIVE, or a tie);
                    # drop this row as the duplicate.
                    keep_mask[idx[k]] = False
                    dropped += 1
            else:
                anchor = k

    log(f"Dropped {dropped:,} near-duplicate observations (archive preferred over NRT).")
    return df[keep_mask].copy()


# ============================================================
# STEP 3 -- DAILY AGGREGATION PER CLUSTER
# ============================================================

def build_daily_records(cluster_df: pd.DataFrame) -> list[dict]:
    records = []
    for date_str, day_df in cluster_df.groupby("date_only", sort=True):
        lats = day_df["latitude"].tolist()
        lons = day_df["longitude"].tolist()
        conf_counts: dict[str, int] = {}
        for label in day_df["confidence_label"].dropna():
            conf_counts[label] = conf_counts.get(label, 0) + 1
        dominant = max(conf_counts, key=conf_counts.get) if conf_counts else None

        frp_vals = day_df["frp"].dropna()
        frp_vals = frp_vals[frp_vals > 0] if len(frp_vals) else frp_vals

        records.append({
            "date": date_str,
            "observationCount": int(len(day_df)),
            "peakBrightnessK": round(float(day_df["brightness"].max()), 1),
            "meanBrightnessK": round(float(day_df["brightness"].mean()), 1),
            "peakFrpMw": round(float(frp_vals.max()), 1) if len(frp_vals) else None,
            "meanFrpMw": round(float(frp_vals.mean()), 1) if len(frp_vals) else None,
            "satellites": sorted(day_df["satellite"].dropna().unique().tolist()),
            "confidenceCounts": conf_counts,
            "dominantConfidence": dominant,
            "estimatedSpreadKm": max_pairwise_distance_km(lats, lons),
            "dataQuality": sorted(day_df["data_quality"].dropna().unique().tolist()),
        })
    return records


# ============================================================
# STEP 4 -- PERSISTENCE SUMMARY
# ============================================================

def build_persistence_summary(daily: list[dict], as_of: pd.Timestamp) -> dict | None:
    """
    `as_of` is THIS CLUSTER's own max observation timestamp (passed in from
    main() as `cluster_as_of = cluster_df["timestamp"].max()`), NOT the
    dataset-wide max and NOT wall-clock "now". Two different clusters will
    generally have different `as_of` values. So:
      - "currentStreakDays" = consecutive active days ending at this
        cluster's MOST RECENTLY OBSERVED date, counting backward across its
        full history. If a cluster's last observation is much older than
        other clusters' (or than the dataset's own max timestamp), this
        streak is still measured relative to THIS cluster's own last
        observation, not some shared reference point.
      - "windowDays"/"activeDays" cover an INCLUSIVE window of exactly
        PERSISTENCE_WINDOW_DAYS calendar dates ending at `as_of` (e.g. 30
        means [as_of - 29 days, as_of], 30 dates -- not 31).
      - "longestStreakDays" is the longest run of consecutive active days
        found WITHIN that same window (not the cluster's full history) --
        see the field's doc comment in types/historical.ts.
    The UI should treat these as "as of this cluster's latest observation",
    which the provenance line above the timeline makes visible via
    observationPeriodEnd.
    """
    if not daily:
        return None
    # `as_of` is this cluster's raw max observation TIMESTAMP (real
    # hour/minute, e.g. 02:14 UTC). Everything it's compared against below
    # (`dates`, from date-only strings) is midnight-normalized. Comparing a
    # non-midnight as_of against midnight dates directly would make the
    # window boundary depend on what time of day the latest observation
    # happened to occur -- an hour-of-day-dependent off-by-one on top of
    # (and independent from) the day-count issue this function already
    # fixes. Normalize to the calendar date once, up front, since every
    # comparison in this function is calendar-day-level by design.
    as_of = as_of.normalize()
    dates = pd.to_datetime([d["date"] for d in daily], utc=True)
    counts = {d["date"]: d["observationCount"] for d in daily}

    # Inclusive N-day window ending at as_of: for PERSISTENCE_WINDOW_DAYS=30
    # that's [as_of - 29 days, as_of], i.e. exactly 30 calendar dates. Using
    # `- PERSISTENCE_WINDOW_DAYS` (no -1) would start the window one day too
    # early and span 31 dates.
    window_start = as_of - pd.Timedelta(days=PERSISTENCE_WINDOW_DAYS - 1)
    window_dates = sorted([d for d in dates if window_start <= d <= as_of])
    active_days = len(window_dates)
    total_obs_window = sum(counts[d.strftime("%Y-%m-%d")] for d in window_dates)

    all_dates_sorted = sorted(dates)

    # Longest streak of consecutive calendar days with activity, scoped to
    # the SAME window_dates as activeDays above (not the cluster's full
    # history) -- see the PersistenceSummary.longestStreakDays doc comment
    # in types/historical.ts for why: the client-side Historical Recurrence
    # index combines activeDays/windowDays with longestStreakDays/windowDays,
    # and both terms need to describe the same window or the index doesn't
    # mean what its own formula says it means.
    longest_streak = 1 if window_dates else 0
    current_run = 1
    for i in range(1, len(window_dates)):
        gap = (window_dates[i] - window_dates[i - 1]).days
        if gap == 1:
            current_run += 1
            longest_streak = max(longest_streak, current_run)
        else:
            current_run = 1

    # Current streak: consecutive active days ending at the cluster's most
    # recent observed date, counted across its FULL history (intentionally
    # NOT bounded by window_dates -- see the type doc comment). `as_of` here
    # is already this cluster's own latest observation (see main()), so
    # all_dates_sorted[-1] == as_of's date whenever daily is non-empty.
    current_streak = 0
    if all_dates_sorted:
        current_streak = 1
        for i in range(len(all_dates_sorted) - 1, 0, -1):
            gap = (all_dates_sorted[i] - all_dates_sorted[i - 1]).days
            if gap == 1:
                current_streak += 1
            else:
                break

    # Typical recurrence interval: mean gap between consecutive active days in window.
    typical_recurrence = None
    if len(window_dates) >= 2:
        gaps = [(window_dates[i] - window_dates[i - 1]).days for i in range(1, len(window_dates))]
        typical_recurrence = round(float(np.mean(gaps)), 2)

    # Recent trend: last 7 days vs preceding 7 days, by observation count.
    last7_start = as_of - pd.Timedelta(days=7)
    prev7_start = as_of - pd.Timedelta(days=14)
    last7 = sum(c for dt, c in zip(dates, [counts[d["date"]] for d in daily]) if last7_start < dt <= as_of)
    prev7 = sum(c for dt, c in zip(dates, [counts[d["date"]] for d in daily]) if prev7_start < dt <= last7_start)

    trend_ratio = None
    trend = "UNKNOWN"
    if prev7 > 0:
        trend_ratio = round(last7 / prev7, 2)
        if trend_ratio >= 1.3:
            trend = "RISING"
        elif trend_ratio <= 0.7:
            trend = "FALLING"
        else:
            trend = "STABLE"
    elif last7 > 0:
        trend = "RISING"
        trend_ratio = None  # undefined denominator; report qualitatively only

    return {
        "windowDays": PERSISTENCE_WINDOW_DAYS,
        "activeDays": active_days,
        "totalObservations": int(total_obs_window),
        "currentStreakDays": int(current_streak),
        "longestStreakDays": int(longest_streak),
        "typicalRecurrenceDays": typical_recurrence,
        "recentTrendRatio": trend_ratio,
        "recentTrend": trend,
    }


# ============================================================
# STEP 5 -- THERMAL BASELINE
# ============================================================

def build_baseline(cluster_df: pd.DataFrame, daily: list[dict]) -> dict:
    """
    Offline baseline. `currentK` here is always the peak brightness of the
    cluster's most recent historical day (currentValueSource =
    LATEST_HISTORICAL_OBSERVATION), because this batch script has no
    concept of "the event the analyst currently has selected".

    At request time, lib/historicalIntelligence.ts overrides currentK with
    the SELECTED event's own reported brightness when the frontend supplies
    one (via /api/history?...&brightness=), recomputing deviationRatio and
    status against the same historicalMedianK computed here. See
    HistoricalIntelligence-request-time override in that file.
    """
    n = len(cluster_df)
    if n < BASELINE_MIN_OBSERVATIONS or not daily:
        return {
            "status": "INSUFFICIENT_HISTORY",
            "historicalMedianK": None,
            "currentK": None,
            "currentValueSource": "UNAVAILABLE",
            "deviationRatio": None,
            "observationsUsed": int(n),
            "minimumRequired": BASELINE_MIN_OBSERVATIONS,
        }

    hist_median = float(cluster_df["brightness"].median())
    latest_day = max(daily, key=lambda d: d["date"])
    current = float(latest_day["peakBrightnessK"])
    status, deviation = classify_baseline(current, hist_median)

    return {
        "status": status,
        "historicalMedianK": round(hist_median, 1),
        "currentK": round(current, 1),
        "currentValueSource": "LATEST_HISTORICAL_OBSERVATION",
        "deviationRatio": round(deviation, 4),
        "observationsUsed": int(n),
        "minimumRequired": BASELINE_MIN_OBSERVATIONS,
    }


def classify_baseline(current_k: float, historical_median_k: float) -> tuple[str, float]:
    """Shared thresholding logic so the offline batch and the request-time
    override in lib/historicalIntelligence.ts classify deviations identically.
    Mirrored (not imported, since one side is Python and one is TypeScript) --
    keep BASELINE_ELEVATED_PCT / BASELINE_UNUSUAL_PCT in sync with the
    constants of the same name in lib/historicalIntelligence.ts."""
    if not historical_median_k:
        return "INSUFFICIENT_HISTORY", 0.0
    deviation = (current_k - historical_median_k) / historical_median_k
    pct = abs(deviation) * 100
    if pct < BASELINE_ELEVATED_PCT:
        status = "CONSISTENT_WITH_BASELINE"
    elif pct < BASELINE_UNUSUAL_PCT:
        status = "ELEVATED_ACTIVITY"
    else:
        status = "UNUSUAL_ACTIVITY"
    return status, deviation


# ============================================================
# STEP 6 -- BEHAVIOUR INTERPRETATION
# ============================================================

def build_behavior(total_obs: int, persistence: dict | None) -> dict:
    if persistence is None:
        return {
            "label": "INSUFFICIENT_HISTORY",
            "explanation": "Not enough historical observations to characterise behaviour.",
        }
    if total_obs <= BEHAVIOR_ISOLATED_MAX_OBS:
        return {
            "label": "ISOLATED_TRANSIENT_DETECTION",
            "explanation": f"Only {total_obs} observation(s) on record; no recurring pattern detected.",
        }

    ratio = persistence["activeDays"] / persistence["windowDays"]
    trend_ratio = persistence.get("recentTrendRatio")

    if (trend_ratio is not None and trend_ratio >= BEHAVIOR_ESCALATION_RATIO
            and total_obs >= BEHAVIOR_ESCALATION_MIN_OBS):
        return {
            "label": "RECENT_ESCALATION",
            "explanation": (
                f"Recent 7-day activity is {trend_ratio}x the preceding 7-day activity."
            ),
        }
    if ratio >= BEHAVIOR_PERSISTENT_RATIO:
        return {
            "label": "PERSISTENT_SOURCE",
            "explanation": (
                f"Active on {persistence['activeDays']} of the last {persistence['windowDays']} days."
            ),
        }
    if ratio >= BEHAVIOR_INTERMITTENT_RATIO:
        return {
            "label": "INTERMITTENT_RECURRING_SOURCE",
            "explanation": (
                f"Active on {persistence['activeDays']} of the last {persistence['windowDays']} days, "
                "with gaps between detections."
            ),
        }
    return {
        "label": "ISOLATED_TRANSIENT_DETECTION",
        "explanation": "Sparse activity with no established recurrence in the analysis window.",
    }


# ============================================================
# STEP 7 -- MULTI-SATELLITE CORROBORATION
# ============================================================

def build_corroboration(cluster_df: pd.DataFrame) -> dict:
    sats = sorted(cluster_df["satellite"].dropna().unique().tolist())
    if len(sats) < 2:
        return {
            "corroborated": False,
            "satellites": sats,
            "satelliteCount": len(sats),
            "spatialAgreementKm": None,
            "temporalSeparationHours": None,
            "reason": "Fewer than two distinct satellites observed this cluster.",
        }

    df = cluster_df.sort_values("timestamp")
    rows = df[["timestamp", "satellite", "latitude", "longitude"]].to_dict("records")
    max_gap = pd.Timedelta(hours=CORROBORATION_MAX_HOURS)

    # Sorted-by-time sliding window: since a match requires timestamps within
    # CORROBORATION_MAX_HOURS, row i can only ever match rows in a bounded
    # window ahead of it. This keeps the scan close to O(n) instead of O(n^2)
    # for cells with many thousands of observations (e.g. a long-running
    # industrial source with years of detections).
    best = None  # most recent corroborated match
    n = len(rows)
    for i in range(n):
        j = i + 1
        while j < n and (rows[j]["timestamp"] - rows[i]["timestamp"]) <= max_gap:
            if rows[j]["satellite"] != rows[i]["satellite"]:
                dist_km = haversine_km(rows[i]["latitude"], rows[i]["longitude"],
                                        rows[j]["latitude"], rows[j]["longitude"])
                if dist_km <= CORROBORATION_MAX_KM:
                    dt_hours = (rows[j]["timestamp"] - rows[i]["timestamp"]).total_seconds() / 3600.0
                    candidate = (rows[i]["timestamp"], rows[i]["satellite"], rows[j]["satellite"], dist_km, dt_hours)
                    if best is None or candidate[0] > best[0]:
                        best = candidate
            j += 1

    if best is None:
        return {
            "corroborated": False,
            "satellites": sats,
            "satelliteCount": len(sats),
            "spatialAgreementKm": None,
            "temporalSeparationHours": None,
            "reason": (
                f"No cross-satellite observations within {CORROBORATION_MAX_KM} km / "
                f"{CORROBORATION_MAX_HOURS}h of each other."
            ),
        }

    _, sat_a, sat_b, dist_km, dt_hours = best
    return {
        "corroborated": True,
        "satellites": sorted({sat_a, sat_b}),
        "satelliteCount": len(sats),
        "spatialAgreementKm": round(dist_km, 3),
        "temporalSeparationHours": round(dt_hours, 2),
        "reason": "Independent satellites observed the same cluster within the matching thresholds.",
    }


# ============================================================
# STEP 8 -- ACTIVITY FINGERPRINT
# ============================================================

def build_fingerprint(cluster_df: pd.DataFrame, daily: list[dict], persistence: dict | None) -> dict:
    total_obs = len(cluster_df)
    if total_obs < FINGERPRINT_MIN_OBS or persistence is None:
        return {
            "available": False,
            "persistence": "UNKNOWN",
            "recurrence": "UNKNOWN",
            "spatialStability": "UNKNOWN",
            "recentTrend": "UNKNOWN",
            "observationFrequency": "UNKNOWN",
            "dayNightBehavior": "UNKNOWN",
            "reason": f"Fewer than {FINGERPRINT_MIN_OBS} observations on record.",
        }

    ratio = persistence["activeDays"] / persistence["windowDays"]
    persistence_label = "HIGH" if ratio >= 0.5 else "MODERATE" if ratio >= 0.2 else "LOW"

    dates_sorted = sorted(pd.to_datetime([d["date"] for d in daily], utc=True))
    gaps = [(dates_sorted[i] - dates_sorted[i - 1]).days for i in range(1, len(dates_sorted))]
    if len(gaps) >= 3:
        mean_gap = float(np.mean(gaps))
        cv = float(np.std(gaps) / mean_gap) if mean_gap else None
        recurrence = "REGULAR" if (cv is not None and cv < 0.6) else "IRREGULAR"
    else:
        recurrence = "UNKNOWN"

    spreads = [d["estimatedSpreadKm"] for d in daily if d["estimatedSpreadKm"] is not None]
    if spreads:
        avg_spread = float(np.mean(spreads))
        spatial_stability = "HIGH" if avg_spread <= 2 else "MODERATE" if avg_spread <= 5 else "LOW"
    else:
        spatial_stability = "UNKNOWN"

    span_days = max(1, (dates_sorted[-1] - dates_sorted[0]).days + 1)
    freq = total_obs / span_days
    observation_frequency = "HIGH" if freq >= 1.0 else "MODERATE" if freq >= 0.2 else "LOW"

    if "is_night" in cluster_df.columns:
        night_ratio = float(cluster_df["is_night"].mean())
    elif "daynight" in cluster_df.columns:
        night_ratio = float((cluster_df["daynight"].astype(str).str.upper() == "N").mean())
    else:
        night_ratio = None

    if night_ratio is None:
        day_night = "UNKNOWN"
    elif night_ratio >= 0.7:
        day_night = "MOSTLY_NIGHT"
    elif night_ratio <= 0.3:
        day_night = "MOSTLY_DAY"
    else:
        day_night = "MIXED"

    return {
        "available": True,
        "persistence": persistence_label,
        "recurrence": recurrence,
        "spatialStability": spatial_stability,
        "recentTrend": persistence["recentTrend"],
        "observationFrequency": observation_frequency,
        "dayNightBehavior": day_night,
    }


# ============================================================
# STEP 9 -- ESCALATION / CHANGE DETECTION
# ============================================================

def build_escalation(daily: list[dict], as_of: pd.Timestamp) -> dict:
    """
    `as_of` is THIS CLUSTER's own max observation timestamp (see main()),
    matching build_persistence_summary's as_of -- not the dataset-wide max.

    Change detection compares two OBSERVATION RATES (detections per day),
    not brightness or FRP levels:
      recent_rate = (observations in the last 7 days) / 7
      prior_rate  = (observations in all days before that window) / (span of those prior days)
    ratio = recent_rate / prior_rate
    ratio >= ESCALATION_RATIO (2.0x) => RECENT_ESCALATION.
    This flags a sustained increase in detection frequency, e.g. a source
    that fires nightly instead of every few days -- it says nothing about
    whether any single detection is hotter or larger than before (that is
    what the THERMAL BASELINE feature is for).

    The returned `comparisonWindowStart` is the start date of the recent
    7-day window used above -- it is NOT the date some threshold was
    crossed. Do not present it in the UI as an exact detection date.
    """
    total_obs = sum(d["observationCount"] for d in daily)
    dates_sorted = sorted(pd.to_datetime([d["date"] for d in daily], utc=True))
    history_days = (dates_sorted[-1] - dates_sorted[0]).days + 1 if dates_sorted else 0

    # See the matching normalize() call and comment in build_persistence_summary:
    # as_of carries a real time-of-day, but every date compared against it
    # here is midnight-normalized. Normalize first so the 7-day windows
    # below are pure calendar-day boundaries, not hour-of-day-dependent.
    as_of = as_of.normalize()

    if total_obs < ESCALATION_MIN_TOTAL_OBS or history_days < ESCALATION_MIN_HISTORY_DAYS:
        return {
            "status": "INSUFFICIENT_HISTORY",
            "ratio": None,
            "comparisonWindowStart": None,
            "reason": (
                f"Requires >= {ESCALATION_MIN_TOTAL_OBS} observations across >= "
                f"{ESCALATION_MIN_HISTORY_DAYS} days of history."
            ),
        }

    recent_start = as_of - pd.Timedelta(days=7)
    recent_obs = sum(d["observationCount"] for d in daily
                      if recent_start < pd.Timestamp(d["date"], tz="UTC") <= as_of)
    recent_rate = recent_obs / 7.0

    prior_days = [d for d in daily if pd.Timestamp(d["date"], tz="UTC") <= recent_start]
    if not prior_days:
        return {
            "status": "INSUFFICIENT_HISTORY",
            "ratio": None,
            "comparisonWindowStart": None,
            "reason": "No prior history before the most recent 7-day window.",
        }
    prior_span_days = max(
        1,
        (pd.Timestamp(prior_days[-1]["date"], tz="UTC") - pd.Timestamp(prior_days[0]["date"], tz="UTC")).days + 1,
    )
    prior_total = sum(d["observationCount"] for d in prior_days)
    prior_rate = prior_total / prior_span_days

    if prior_rate <= 0:
        return {
            "status": "INSUFFICIENT_HISTORY",
            "ratio": None,
            "comparisonWindowStart": None,
            "reason": "No prior baseline activity to compare against.",
        }

    ratio = round(recent_rate / prior_rate, 2)
    recent_txt = f"{round(recent_rate, 2)} obs/day"
    prior_txt = f"{round(prior_rate, 2)} obs/day"
    if ratio >= ESCALATION_RATIO:
        return {
            "status": "RECENT_ESCALATION",
            "ratio": ratio,
            "comparisonWindowStart": recent_start.strftime("%Y-%m-%d"),
            "reason": (
                f"Recent 7-day observation rate ({recent_txt}) is {ratio}x the prior "
                f"historical observation rate ({prior_txt})."
            ),
        }
    return {
        "status": "STABLE",
        "ratio": ratio,
        "comparisonWindowStart": None,
        "reason": (
            f"Recent 7-day observation rate ({recent_txt}) is {ratio}x the prior "
            f"historical observation rate ({prior_txt}); below the {ESCALATION_RATIO}x threshold."
        ),
    }


# ============================================================
# STEP 10 -- SPATIAL FOOTPRINT
# ============================================================

def build_footprint(cluster_df: pd.DataFrame) -> dict:
    n = len(cluster_df)
    if n < 3:
        return {"status": "UNAVAILABLE", "maxRadiusKm": None, "centroid": None, "observationsUsed": int(n)}
    lat_c = float(cluster_df["latitude"].mean())
    lon_c = float(cluster_df["longitude"].mean())
    max_r = max(haversine_km(lat_c, lon_c, r.latitude, r.longitude) for r in cluster_df.itertuples())
    return {
        "status": "AVAILABLE",
        "maxRadiusKm": round(max_r, 3),
        "centroid": {"latitude": round(lat_c, 5), "longitude": round(lon_c, 5)},
        "observationsUsed": int(n),
    }


# ============================================================
# MAIN
# ============================================================

def main():
    start = time.time()
    df = load_and_grid()
    df = resolve_near_duplicates(df)

    clusters: dict[str, dict] = {}
    dataset_as_of = df["timestamp"].max()
    log(f"Dataset-wide max timestamp (metadata only, NOT used per-cluster): {dataset_as_of.isoformat()}")

    grouped = df.groupby("grid_id", sort=False)
    n_cells = grouped.ngroups
    log(f"Building Historical Intelligence records for {n_cells:,} spatial cells.")

    # NOTE: this iterates the groupby object directly (single O(rows) pass)
    # rather than looping over grid ids and re-filtering the full dataframe
    # per cell (which was previously O(cells x rows) -- far too slow for a
    # multi-million-row dataset with many thousands of distinct cells).
    for n_done, (grid_id, cluster_df) in enumerate(grouped, start=1):
        # Each cluster's temporal metrics (persistence window, streaks,
        # escalation) are anchored to THIS CLUSTER's own latest observation,
        # not the dataset-wide latest. Two clusters can have very different
        # as_of values -- e.g. one still actively detected in NRT data, one
        # whose last detection was months ago in the archive -- and each
        # must be judged relative to its own timeline, not another
        # cluster's (or the whole dataset's) most recent activity.
        cluster_as_of = cluster_df["timestamp"].max()

        daily = build_daily_records(cluster_df)
        persistence = build_persistence_summary(daily, cluster_as_of)
        baseline = build_baseline(cluster_df, daily)
        behavior = build_behavior(len(cluster_df), persistence)
        corroboration = build_corroboration(cluster_df)
        fingerprint = build_fingerprint(cluster_df, daily, persistence)
        escalation = build_escalation(daily, cluster_as_of)
        footprint = build_footprint(cluster_df)

        centroid_lat = float(cluster_df["latitude"].mean())
        centroid_lon = float(cluster_df["longitude"].mean())

        clusters[str(int(grid_id))] = {
            "gridId": str(int(grid_id)),
            "centroid": {"latitude": round(centroid_lat, 5), "longitude": round(centroid_lon, 5)},
            "totalObservations": int(len(cluster_df)),
            "satellites": sorted(cluster_df["satellite"].dropna().unique().tolist()),
            "observationPeriodStart": cluster_df["timestamp"].min().strftime("%Y-%m-%d"),
            "observationPeriodEnd": cluster_df["timestamp"].max().strftime("%Y-%m-%d"),
            "timeline": daily,
            "persistence": persistence,
            "baseline": baseline,
            "behavior": behavior,
            "corroboration": corroboration,
            "fingerprint": fingerprint,
            "escalation": escalation,
            "spatialFootprint": footprint,
        }

        if n_done % 25000 == 0:
            log(f"  processed {n_done:,}/{n_cells:,} cells")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "gridSizeDegrees": GRID_SIZE,
        "datasetPeriod": {
            "start": df["timestamp"].min().strftime("%Y-%m-%d"),
            "end": df["timestamp"].max().strftime("%Y-%m-%d"),
        },
        "clusters": clusters,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), default=str)

    elapsed = round(time.time() - start, 2)
    report = {
        "input_file": str(INPUT_PATH),
        "output_file": str(OUTPUT_PATH),
        "grid_size_degrees": GRID_SIZE,
        "cluster_count": len(clusters),
        "elapsed_seconds": elapsed,
    }
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    log(f"Wrote {len(clusters):,} cluster records to {OUTPUT_PATH}")
    log(f"Elapsed: {elapsed}s")


if __name__ == "__main__":
    main()
