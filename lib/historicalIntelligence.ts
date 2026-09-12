// lib/historicalIntelligence.ts
//
// Server-only. Loads the compact, precomputed dataset produced by
// scripts/build_historical_intelligence.py and resolves a selected
// thermal event (lat/lon) to its Historical Intelligence record.
//
// This file intentionally does NOT parse any CSV/parquet. All the heavy
// lifting already happened offline; this is a small in-memory lookup.

import fs from 'node:fs';
import path from 'node:path';
import type {
  ClusterRecord,
  HistoricalIntelligenceDataset,
  HistoricalIntelligencePayload,
} from '@/types/historical';

// Same grid definition as scripts/build_persistence.py and
// scripts/build_historical_intelligence.py. Must stay in sync with the
// Python GRID_SIZE constant -- see CHANGES.md.
const GRID_SIZE = 0.05;

// If the exact grid cell for the selected event has fewer than this many
// observations, we also consider the surrounding 3x3 neighborhood so a
// slightly-off detection coordinate for the same physical source is not
// treated as "no history". See module docstring in the Python script for
// the matching rule this mirrors.
const MIN_OBSERVATIONS_FOR_DIRECT_MATCH = 2;

// A neighbor cell is only accepted if its centroid is within this distance
// of the requested point. This keeps the match inside roughly 1.5 grid
// cells (~8 km) so unrelated hotspots that merely share a neighborhood are
// not merged together.
const MAX_NEIGHBOR_MATCH_KM = 8;

const DATASET_PATH = path.join(process.cwd(), 'data', 'derived', 'historical_intelligence.json');

let cachedDataset: HistoricalIntelligenceDataset | null = null;
let cacheMtimeMs = 0;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function gridIdFor(lat: number, lon: number): string {
  const gridLat = Math.floor(lat / GRID_SIZE);
  const gridLon = Math.floor(lon / GRID_SIZE);
  return String(gridLat * 10000 + gridLon);
}

function neighborGridIds(lat: number, lon: number): string[] {
  const gridLat = Math.floor(lat / GRID_SIZE);
  const gridLon = Math.floor(lon / GRID_SIZE);
  const ids: string[] = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      if (dLat === 0 && dLon === 0) continue;
      ids.push(String((gridLat + dLat) * 10000 + (gridLon + dLon)));
    }
  }
  return ids;
}

/**
 * Loads data/derived/historical_intelligence.json into memory.
 * Returns null (rather than throwing) when the file has not been
 * generated yet, so the rest of the app keeps working in that state --
 * the API route surfaces this as "insufficient historical observations"
 * instead of a 500 error.
 */
function loadDataset(): HistoricalIntelligenceDataset | null {
  try {
    const stat = fs.statSync(DATASET_PATH);
    if (cachedDataset && stat.mtimeMs === cacheMtimeMs) {
      return cachedDataset;
    }
    const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as HistoricalIntelligenceDataset;
    cachedDataset = parsed;
    cacheMtimeMs = stat.mtimeMs;
    return parsed;
  } catch {
    // File missing, unreadable, or invalid JSON. Treated as "no dataset yet".
    return null;
  }
}

export interface ResolvedMatch {
  cluster: ClusterRecord;
  matchMethod: 'exact_cell' | 'neighbor_cell';
  matchDistanceKm: number;
}

/**
 * Resolves a selected event's coordinates to the best-matching spatial
 * cluster in the precomputed dataset.
 *
 * Matching rule (documented in CHANGES.md):
 * 1. Compute the exact 0.05deg grid cell for (lat, lon).
 * 2. If that cell exists and has >= MIN_OBSERVATIONS_FOR_DIRECT_MATCH
 *    observations, use it directly ("exact_cell").
 * 3. Otherwise, examine the 8 surrounding cells. Among those that exist
 *    in the dataset, pick the one whose centroid is closest to the
 *    requested point, but only if that distance is <= MAX_NEIGHBOR_MATCH_KM
 *    ("neighbor_cell"). This tolerates the same physical source being
 *    reported at slightly different coordinates across passes, without
 *    merging genuinely distinct, unrelated hotspots.
 * 4. If nothing qualifies, return null (no history available).
 */
export function resolveCluster(dataset: HistoricalIntelligenceDataset, lat: number, lon: number): ResolvedMatch | null {
  const exactId = gridIdFor(lat, lon);
  const exact = dataset.clusters[exactId];
  if (exact && exact.totalObservations >= MIN_OBSERVATIONS_FOR_DIRECT_MATCH) {
    const distance = haversineKm(lat, lon, exact.centroid.latitude, exact.centroid.longitude);
    return { cluster: exact, matchMethod: 'exact_cell', matchDistanceKm: Math.round(distance * 1000) / 1000 };
  }

  let best: ResolvedMatch | null = null;
  for (const id of neighborGridIds(lat, lon)) {
    const candidate = dataset.clusters[id];
    if (!candidate) continue;
    const distance = haversineKm(lat, lon, candidate.centroid.latitude, candidate.centroid.longitude);
    if (distance > MAX_NEIGHBOR_MATCH_KM) continue;
    if (!best || distance < best.matchDistanceKm) {
      best = { cluster: candidate, matchMethod: 'neighbor_cell', matchDistanceKm: Math.round(distance * 1000) / 1000 };
    }
  }

  // Fall back to the exact cell even if it is thin (1 observation), if no
  // better neighbor was found -- one real observation is still real
  // history, just reported through the edge-case states in the UI.
  if (!best && exact) {
    const distance = haversineKm(lat, lon, exact.centroid.latitude, exact.centroid.longitude);
    return { cluster: exact, matchMethod: 'exact_cell', matchDistanceKm: Math.round(distance * 1000) / 1000 };
  }

  return best;
}

// Kept identical to BASELINE_ELEVATED_PCT / BASELINE_UNUSUAL_PCT in
// scripts/build_historical_intelligence.py so the offline batch and this
// request-time override classify deviations the same way.
const BASELINE_ELEVATED_PCT = 10.0;
const BASELINE_UNUSUAL_PCT = 25.0;

function classifyBaseline(
  currentK: number,
  historicalMedianK: number,
): { status: 'CONSISTENT_WITH_BASELINE' | 'ELEVATED_ACTIVITY' | 'UNUSUAL_ACTIVITY'; deviationRatio: number } {
  const deviationRatio = historicalMedianK ? (currentK - historicalMedianK) / historicalMedianK : 0;
  const pct = Math.abs(deviationRatio) * 100;
  const status: 'CONSISTENT_WITH_BASELINE' | 'ELEVATED_ACTIVITY' | 'UNUSUAL_ACTIVITY' =
    pct < BASELINE_ELEVATED_PCT
      ? 'CONSISTENT_WITH_BASELINE'
      : pct < BASELINE_UNUSUAL_PCT
        ? 'ELEVATED_ACTIVITY'
        : 'UNUSUAL_ACTIVITY';
  return { status, deviationRatio: Math.round(deviationRatio * 10000) / 10000 };
}

/**
 * Overrides a cluster's precomputed baseline.currentK with the SELECTED
 * event's own reported brightness, when the frontend supplied one. This is
 * what makes "Current: X K" in the UI reflect the actual thermal event the
 * analyst is looking at, rather than whatever the offline batch's most
 * recent historical day happened to be (which could be days/weeks old
 * relative to a freshly-ingested live detection).
 *
 * If historicalMedianK is unavailable (INSUFFICIENT_HISTORY), the override
 * is a no-op -- there is nothing to compare the selected brightness against.
 */
function applySelectedBrightnessOverride(
  baseline: HistoricalIntelligencePayload['baseline'],
  selectedBrightnessK: number | null,
): HistoricalIntelligencePayload['baseline'] {
  if (selectedBrightnessK === null || !Number.isFinite(selectedBrightnessK)) return baseline;
  if (baseline.status === 'INSUFFICIENT_HISTORY' || baseline.historicalMedianK === null) return baseline;

  const { status, deviationRatio } = classifyBaseline(selectedBrightnessK, baseline.historicalMedianK);
  return {
    ...baseline,
    status,
    currentK: Math.round(selectedBrightnessK * 10) / 10,
    currentValueSource: 'SELECTED_EVENT',
    deviationRatio,
  };
}

function toPayload(
  dataset: HistoricalIntelligenceDataset,
  match: ResolvedMatch,
  selectedBrightnessK: number | null,
): HistoricalIntelligencePayload {
  const { cluster } = match;
  return {
    clusterId: cluster.gridId,
    matchMethod: match.matchMethod,
    matchDistanceKm: match.matchDistanceKm,
    provenance: {
      source: 'NASA_FIRMS_DERIVED',
      satellites: cluster.satellites,
      observationPeriodStart: cluster.observationPeriodStart,
      observationPeriodEnd: cluster.observationPeriodEnd,
      processingMode: 'PRECOMPUTED_AGGREGATE',
      datasetGeneratedAt: dataset.generatedAt,
    },
    hasHistory: true,
    totalObservations: cluster.totalObservations,
    timeline: cluster.timeline,
    persistence: cluster.persistence,
    baseline: applySelectedBrightnessOverride(cluster.baseline, selectedBrightnessK),
    behavior: cluster.behavior,
    corroboration: cluster.corroboration,
    fingerprint: cluster.fingerprint,
    escalation: cluster.escalation,
    spatialFootprint: cluster.spatialFootprint,
  };
}

export type HistoryLookupResult =
  | { ok: true; payload: HistoricalIntelligencePayload }
  | { ok: false; reason: 'DATASET_NOT_GENERATED' | 'NO_HISTORY_FOR_LOCATION' };

/**
 * Main entry point used by app/api/history/route.ts.
 *
 * @param selectedBrightnessK - the currently SELECTED event's own reported
 *   brightness (K), if the frontend has it (e.g. ThermalEvent.brightnessKelvin
 *   for a live/DB-backed event). When supplied, the thermal baseline's
 *   "current" value and deviation are computed against THIS observation
 *   instead of the offline batch's latest historical day -- see
 *   applySelectedBrightnessOverride above.
 */
export function getHistoricalIntelligence(
  lat: number,
  lon: number,
  selectedBrightnessK: number | null = null,
): HistoryLookupResult {
  const dataset = loadDataset();
  if (!dataset) {
    return { ok: false, reason: 'DATASET_NOT_GENERATED' };
  }
  const match = resolveCluster(dataset, lat, lon);
  if (!match) {
    return { ok: false, reason: 'NO_HISTORY_FOR_LOCATION' };
  }
  return { ok: true, payload: toPayload(dataset, match, selectedBrightnessK) };
}

/** Exposed for tests / debugging. */
export const __internal = { gridIdFor, neighborGridIds, haversineKm, GRID_SIZE, MAX_NEIGHBOR_MATCH_KM };
