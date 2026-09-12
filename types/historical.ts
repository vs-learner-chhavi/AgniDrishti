// types/historical.ts
//
// Shared contract between the offline preprocessing pipeline
// (scripts/build_historical_intelligence.py), the server-side loader
// (lib/historicalIntelligence.ts), the API route (app/api/history/route.ts)
// and the UI (components/HistoricalIntelligence.tsx).
//
// IMPORTANT: every field here is either a directly-observed NASA FIRMS
// value or a deterministic calculation over those observations. Nothing
// in this file is a placeholder / synthetic shape — if a metric cannot be
// supported by real data, the corresponding "status" field says so
// instead of a fabricated number.

export type DataQuality = 'ARCHIVE' | 'NRT';
export type ConfidenceLabel = 'l' | 'n' | 'h' | 'low' | 'nominal' | 'high';

/** One calendar day (UTC) of aggregated thermal observations for a resolved cluster. */
export interface DailyRecord {
  /** ISO date, UTC, e.g. "2026-09-05" */
  date: string;
  /** Number of individual FIRMS detections on this day. */
  observationCount: number;
  peakBrightnessK: number;
  meanBrightnessK: number;
  /** MW. Null if FRP was not reported for any observation that day. */
  peakFrpMw: number | null;
  meanFrpMw: number | null;
  /** Distinct satellites that observed this cluster this day, e.g. ["N20","N21"] */
  satellites: string[];
  /** Count of observations per raw FIRMS confidence label this day. */
  confidenceCounts: Partial<Record<'l' | 'n' | 'h', number>>;
  /** Dominant confidence label this day (mode of confidenceCounts). */
  dominantConfidence: 'l' | 'n' | 'h' | null;
  /**
   * Max pairwise distance (km) between observations recorded this day
   * inside the resolved cluster. Requires >=2 observations. Null otherwise.
   */
  estimatedSpreadKm: number | null;
  /** Whether any observation this day came from ARCHIVE vs NRT source rows. */
  dataQuality: DataQuality[];
}

export interface PersistenceSummary {
  windowDays: number;
  activeDays: number;
  totalObservations: number;
  currentStreakDays: number;
  longestStreakDays: number;
  /** Mean gap (days) between consecutive active days within the window. Null if <2 active days. */
  typicalRecurrenceDays: number | null;
  /** Ratio of last-7d observation count to the preceding-7d observation count. Null if not computable. */
  recentTrendRatio: number | null;
  recentTrend: 'RISING' | 'STABLE' | 'FALLING' | 'UNKNOWN';
}

export type BaselineStatus =
  | 'CONSISTENT_WITH_BASELINE'
  | 'ELEVATED_ACTIVITY'
  | 'UNUSUAL_ACTIVITY'
  | 'INSUFFICIENT_HISTORY';

export type CurrentValueSource = 'SELECTED_EVENT' | 'LATEST_HISTORICAL_OBSERVATION' | 'UNAVAILABLE';

export interface ThermalBaseline {
  status: BaselineStatus;
  /** Median brightness (K) across the full available history. Null if insufficient. */
  historicalMedianK: number | null;
  /**
   * Brightness (K) the deviation is measured against. Prefer the currently
   * SELECTED event's own reported brightness (passed to /api/history as
   * `brightness`); fall back to the peak brightness of the cluster's most
   * recent historical day only when the caller did not supply one.
   */
  currentK: number | null;
  /** Where currentK came from -- see CurrentValueSource. */
  currentValueSource: CurrentValueSource;
  /** (current - median) / median, as a fraction. Null if insufficient. */
  deviationRatio: number | null;
  observationsUsed: number;
  minimumRequired: number;
}

export type BehaviorLabel =
  | 'PERSISTENT_SOURCE'
  | 'INTERMITTENT_RECURRING_SOURCE'
  | 'RECENT_ESCALATION'
  | 'ISOLATED_TRANSIENT_DETECTION'
  | 'INSUFFICIENT_HISTORY';

export interface BehaviorInterpretation {
  label: BehaviorLabel;
  /** Short, plain-language, rule-based explanation. Never a ground-truth claim. */
  explanation: string;
}

export interface CorroborationResult {
  corroborated: boolean;
  satellites: string[];
  satelliteCount: number;
  /** km, max distance between matched observations from different satellites. Null if not corroborated. */
  spatialAgreementKm: number | null;
  /** hours, max time separation between matched observations. Null if not corroborated. */
  temporalSeparationHours: number | null;
  reason: string;
}

export type QualLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';

export interface ActivityFingerprint {
  available: boolean;
  persistence: QualLevel;
  recurrence: 'REGULAR' | 'IRREGULAR' | 'UNKNOWN';
  spatialStability: QualLevel;
  recentTrend: 'RISING' | 'STABLE' | 'FALLING' | 'UNKNOWN';
  observationFrequency: QualLevel;
  dayNightBehavior: 'MOSTLY_DAY' | 'MOSTLY_NIGHT' | 'MIXED' | 'UNKNOWN';
  reason?: string;
}

export type EscalationStatus = 'STABLE' | 'RECENT_ESCALATION' | 'INSUFFICIENT_HISTORY';

export interface EscalationResult {
  status: EscalationStatus;
  /** Recent (last 7 active-window) level divided by prior historical median level. Null if insufficient. */
  ratio: number | null;
  changeDetectedDate: string | null;
  reason: string;
}

export type FootprintStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface SpatialFootprint {
  status: FootprintStatus;
  /** km, distance from centroid to the farthest observation used. */
  maxRadiusKm: number | null;
  centroid: { latitude: number; longitude: number } | null;
  observationsUsed: number;
}

export interface HistoricalIntelligencePayload {
  /** Deterministic spatial cell id the selected event was resolved to. */
  clusterId: string;
  /** How the event was matched to this cluster: 'exact_cell' | 'neighbor_cell' */
  matchMethod: 'exact_cell' | 'neighbor_cell' | 'none';
  /** Distance (km) between the requested lat/lon and the cluster's observation centroid. */
  matchDistanceKm: number | null;
  provenance: {
    source: 'NASA_FIRMS_DERIVED';
    satellites: string[];
    observationPeriodStart: string | null;
    observationPeriodEnd: string | null;
    processingMode: 'PRECOMPUTED_AGGREGATE';
    datasetGeneratedAt: string;
  };
  hasHistory: boolean;
  totalObservations: number;
  timeline: DailyRecord[];
  persistence: PersistenceSummary | null;
  baseline: ThermalBaseline;
  behavior: BehaviorInterpretation;
  corroboration: CorroborationResult;
  fingerprint: ActivityFingerprint;
  escalation: EscalationResult;
  spatialFootprint: SpatialFootprint;
}

export interface InsufficientHistoryPayload {
  hasHistory: false;
  clusterId: null;
  matchMethod: 'none';
  message: string;
}

// ------------------------------------------------------------------
// ON-DISK SHAPE
//
// This is exactly what scripts/build_historical_intelligence.py writes
// to data/derived/historical_intelligence.json. It is intentionally a
// separate type from HistoricalIntelligencePayload above: the on-disk
// record has no notion of "the currently selected event" (matchMethod /
// matchDistanceKm) -- that is resolved at request time by
// lib/historicalIntelligence.ts, which turns a ClusterRecord into a
// HistoricalIntelligencePayload.
// ------------------------------------------------------------------

export interface ClusterRecord {
  gridId: string;
  centroid: { latitude: number; longitude: number };
  totalObservations: number;
  satellites: string[];
  observationPeriodStart: string;
  observationPeriodEnd: string;
  timeline: DailyRecord[];
  persistence: PersistenceSummary | null;
  baseline: ThermalBaseline;
  behavior: BehaviorInterpretation;
  corroboration: CorroborationResult;
  fingerprint: ActivityFingerprint;
  escalation: EscalationResult;
  spatialFootprint: SpatialFootprint;
}

export interface HistoricalIntelligenceDataset {
  generatedAt: string;
  gridSizeDegrees: number;
  datasetPeriod: { start: string; end: string };
  /** Keyed by grid id (string form of the integer grid id). */
  clusters: Record<string, ClusterRecord>;
}
