'use client';

// components/HistoricalIntelligence.tsx
//
// Replaces the old synthetic "history" section content in app/page.tsx.
// Fetches /api/history for the currently selected event's coordinates and
// renders a real, NASA-FIRMS-derived analysis. Every number shown here
// either came directly from lib/historicalIntelligence.ts (i.e. from
// scripts/build_historical_intelligence.py's aggregation of the actual
// FIRMS CSVs) or is an explicit "insufficient / unavailable" state --
// nothing is invented client-side.

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Info,
  Layers,
  Radar,
  Satellite,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyRecord, HistoricalIntelligencePayload } from '@/types/historical';

export interface HistoricalIntelligenceProps {
  eventId: string;
  latitude: number;
  longitude: number;
  /**
   * The currently SELECTED event's own reported brightness (K), if known
   * (e.g. ThermalEvent.brightnessKelvin). Passed through to /api/history so
   * the THERMAL BASELINE's "current" value reflects the actual selected
   * observation instead of the precomputed dataset's latest historical day
   * for this cluster. Optional -- if omitted, the baseline falls back to
   * that latest historical day (currentValueSource will say so).
   */
  brightnessK?: number | null;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty'; message: string }
  | { status: 'ready'; data: HistoricalIntelligencePayload };

// Fixed, documented brightness-temperature bands used purely for the
// timeline's visual language (see CHANGES.md). These are NOT the thermal
// baseline calculation -- that uses the cluster's own historical median.
const THERMAL_BANDS = {
  low: 320, // < 320K -> LOW (teal)
  moderate: 335, // 320-335K -> MODERATE (amber)
  high: 350, // 335-350K -> HIGH (orange)
  // >= 350K -> EXTREME (red)
};

function thermalColor(peakK: number, selected: boolean): string {
  if (selected) return '#eafcff';
  if (peakK < THERMAL_BANDS.low) return '#28b8a0'; // teal / LOW
  if (peakK < THERMAL_BANDS.moderate) return '#f0c849'; // amber / MODERATE
  if (peakK < THERMAL_BANDS.high) return '#f28b38'; // orange / HIGH
  return '#ef3f35'; // red / EXTREME
}

// Legend entries share the exact colors/thresholds thermalColor uses above,
// so the legend can never drift out of sync with what the bars actually show.
const THERMAL_LEGEND = [
  { label: 'LOW', color: '#28b8a0' },
  { label: 'MODERATE', color: '#f0c849' },
  { label: 'HIGH', color: '#f28b38' },
  { label: 'EXTREME', color: '#ef3f35' },
];

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
    .replace(',', '');
}

function emptyDailyRecord(date: string): DailyRecord {
  return {
    date,
    observationCount: 0,
    peakBrightnessK: 0,
    meanBrightnessK: 0,
    peakFrpMw: null,
    meanFrpMw: null,
    satellites: [],
    confidenceCounts: {},
    dominantConfidence: null,
    estimatedSpreadKm: null,
    dataQuality: [],
  };
}

/**
 * Returns exactly 10 DailyRecords, one per calendar day, ending at the
 * cluster's own most recent observed date (its real "latest day" -- NOT
 * wall-clock today, since a precomputed dataset may be older than that; see
 * CHANGES.md's note on persistence's `as_of`). Days the backend has no
 * observation for are filled with a real, explicit zero-observation record
 * -- never a fabricated value, just an honest "nothing detected that day."
 */
function buildLast10Days(timeline: DailyRecord[], periodEnd: string | null): DailyRecord[] {
  const byDate = new Map(timeline.map((d) => [d.date, d]));
  const anchorIso = timeline.length > 0 ? timeline[timeline.length - 1].date : periodEnd ?? new Date().toISOString().slice(0, 10);
  const anchor = new Date(`${anchorIso}T00:00:00Z`);
  const days: DailyRecord[] = [];
  for (let i = 9; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push(byDate.get(iso) ?? emptyDailyRecord(iso));
  }
  return days;
}

// ------------------------------------------------------------------
// HISTORICAL RECURRENCE INDEX
//
// A single, transparent 0-100 summary of how consistently this cluster
// recurs, computed ENTIRELY from fields lib/historicalIntelligence.ts
// already returns (data.persistence) -- no new backend data, no fabricated
// inputs. It intentionally does NOT assign a categorical label (persistent
// / intermittent / etc.) -- that interpretation already exists, computed
// server-side with its own documented thresholds, in `data.behavior`. This
// index only adds a single at-a-glance number so the two cards don't say
// the same thing twice.
//
// Formula (deliberately simple -- 2 inputs, both already shown elsewhere
// on this card as their own row so nothing here is hidden):
//   70% x (activeDays / windowDays)            -- how much of the window had activity
//   30% x (longestStreakDays / windowDays)     -- how long its best unbroken run was
// Both ratios are capped at 1 before weighting. Result rounded to an integer.
// ------------------------------------------------------------------
function computeRecurrenceIndex(p: { activeDays: number; windowDays: number; longestStreakDays: number }): number {
  const activeRatio = p.windowDays > 0 ? Math.min(1, p.activeDays / p.windowDays) : 0;
  const streakRatio = p.windowDays > 0 ? Math.min(1, p.longestStreakDays / p.windowDays) : 0;
  return Math.round(100 * (0.7 * activeRatio + 0.3 * streakRatio));
}

function confidenceContextLabel(day: DailyRecord): string {
  if (!day.dominantConfidence) return 'Unavailable';
  const map: Record<string, string> = { l: 'Low', n: 'Nominal', h: 'High' };
  const total = Object.values(day.confidenceCounts).reduce((a, b) => a + (b || 0), 0);
  const dominantCount = day.confidenceCounts[day.dominantConfidence] || 0;
  if (total > 0 && dominantCount < total) {
    return `Mostly ${map[day.dominantConfidence]}`;
  }
  return map[day.dominantConfidence];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const day: DailyRecord = payload[0].payload;

  if (day.observationCount === 0) {
    return (
      <div className="hiTooltip">
        <b>{formatDateLabel(day.date)}</b>
        <span>No observations this day</span>
      </div>
    );
  }

  return (
    <div className="hiTooltip">
      <b>{formatDateLabel(day.date)}</b>
      <span>
        {day.observationCount} observation{day.observationCount === 1 ? '' : 's'}
      </span>
      <div>
        <em>Peak brightness</em>
        <strong>{day.peakBrightnessK.toFixed(1)} K</strong>
      </div>
      {day.peakFrpMw !== null && (
        <div>
          <em>Peak FRP</em>
          <strong>{day.peakFrpMw.toFixed(1)} MW</strong>
        </div>
      )}
      <div>
        <em>Satellite{day.satellites.length > 1 ? 's' : ''}</em>
        <strong>{day.satellites.join(' + ') || '—'}</strong>
      </div>
      <div>
        <em>Confidence</em>
        <strong>{confidenceContextLabel(day)}</strong>
      </div>
      <div>
        <em>Est. cluster spread</em>
        <strong>{day.estimatedSpreadKm !== null ? `${day.estimatedSpreadKm.toFixed(1)} km` : 'Unavailable'}</strong>
      </div>
    </div>
  );
}

function statusTone(status: string): 'low' | 'moderate' | 'high' | 'extreme' {
  if (status === 'CONSISTENT_WITH_BASELINE' || status === 'STABLE') return 'low';
  if (status === 'ELEVATED_ACTIVITY') return 'moderate';
  if (status === 'UNUSUAL_ACTIVITY' || status === 'RECENT_ESCALATION') return 'extreme';
  return 'moderate';
}

function labelize(s: string): string {
  return s.replace(/_/g, ' ');
}

export default function HistoricalIntelligence({ eventId, latitude, longitude, brightnessK }: HistoricalIntelligenceProps) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setSelectedDate(null);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setState({ status: 'error', message: 'Selected event has no valid coordinates.' });
      return;
    }

    const qs = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
    if (Number.isFinite(brightnessK)) qs.set('brightness', String(brightnessK));

    fetch(`/api/history?${qs.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setState({ status: 'empty', message: json.message || 'INSUFFICIENT HISTORICAL OBSERVATIONS' });
          return;
        }
        const data = json as HistoricalIntelligencePayload;
        setState({ status: 'ready', data });
        if (data.timeline.length > 0) {
          setSelectedDate(data.timeline[data.timeline.length - 1].date);
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: 'Could not load historical intelligence.' });
      });

    return () => {
      cancelled = true;
    };
    // eventId is included so two events that happen to share coordinates
    // still force a clean re-fetch / reset of the selected day. brightnessK
    // is included so a live-updating selected event's baseline stays current.
  }, [eventId, latitude, longitude, brightnessK]);

  // Hooks must run unconditionally on every render (React's Rules of Hooks) --
  // this has to sit above the loading/error/empty early returns below, not
  // after them, or the hook count differs between renders and React throws.
  const last10 = useMemo(() => {
    if (state.status !== 'ready') return [];
    return buildLast10Days(state.data.timeline, state.data.provenance.observationPeriodEnd);
  }, [state]);

  if (state.status === 'loading') {
    return (
      <div className="hiRoot hiLoading">
        <span>Loading historical intelligence…</span>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="hiRoot hiEmpty">
        <AlertTriangle size={18} />
        <b>Historical intelligence unavailable</b>
        <span>{state.message}</span>
      </div>
    );
  }

  if (state.status === 'empty') {
    return (
      <div className="hiRoot hiEmpty">
        <Layers size={18} />
        <b>INSUFFICIENT HISTORICAL OBSERVATIONS</b>
        <span>{state.message}</span>
      </div>
    );
  }

  const { data } = state;
  const last10ObservationCount = last10.reduce((sum, d) => sum + d.observationCount, 0);
  const daySnapshot = last10.find((d) => d.date === selectedDate) ?? last10[last10.length - 1] ?? null;

  const recurrenceIndex = data.persistence ? computeRecurrenceIndex(data.persistence) : null;
  const recurrenceExplainer = data.persistence
    ? `70% weight on active days in the last ${data.persistence.windowDays}d (${data.persistence.activeDays}/${data.persistence.windowDays}), ` +
      `30% weight on the longest unbroken run (${data.persistence.longestStreakDays}d). Purely descriptive -- not a risk score.`
    : '';

  return (
    <div className="hiRoot">
      <div className="hiProvenance">
        <Satellite size={13} />
        <span>
          NASA FIRMS · {data.provenance.satellites.join(' + ') || 'Unknown satellite'} ·{' '}
          {data.provenance.observationPeriodStart} → {data.provenance.observationPeriodEnd}
          {data.matchMethod === 'neighbor_cell' && (
            <>
              {' '}
              · linked from {data.matchDistanceKm !== null ? `${data.matchDistanceKm.toFixed(1)} km` : 'a nearby'} cell
            </>
          )}
        </span>
      </div>

      <div className="hiTimelineCard">
        <div className="hiCardHead">
          <span className="label">LAST 10 DAYS</span>
          <em>{last10ObservationCount} observation{last10ObservationCount === 1 ? '' : 's'}</em>
        </div>

        <div className="hiChart">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={last10} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap="22%">
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fill: '#536e85', fontSize: 8 }}
                axisLine={{ stroke: '#1b3248' }}
                tickLine={false}
                interval={0}
              />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(79,201,241,0.06)' }} />
              <Bar dataKey="observationCount" radius={[4, 4, 1, 1]} minPointSize={3} isAnimationActive={false}>
                {last10.map((d) => (
                  <Cell
                    key={d.date}
                    fill={d.observationCount === 0 ? '#182c40' : thermalColor(d.peakBrightnessK, d.date === selectedDate)}
                    stroke={d.date === selectedDate ? '#eafcff' : 'none'}
                    strokeWidth={d.date === selectedDate ? 1 : 0}
                    cursor="pointer"
                    // Closing over `d.date` directly (rather than reading it
                    // back out of Recharts' onClick callback args) avoids
                    // relying on a payload shape that differs across
                    // Recharts versions/configurations -- this is what
                    // makes "click a date -> Day Snapshot" reliable.
                    onClick={() => setSelectedDate(d.date)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="hiLegend">
          {THERMAL_LEGEND.map((l) => (
            <span key={l.label}>
              <i style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
          <span className="hiLegendMuted">
            <i />
            NO DATA
          </span>
        </div>

        {daySnapshot && (
          <div className="hiDaySnapshot">
            <div className="hiCardHead">
              <CalendarDays size={13} />
              <span className="label">DAY SNAPSHOT</span>
              <em>{formatDateLabel(daySnapshot.date)}</em>
            </div>
            {daySnapshot.observationCount === 0 ? (
              <p className="hiMuted">No observations detected this day.</p>
            ) : (
              <div className="hiSnapshotGrid">
                <div>
                  <b>{daySnapshot.observationCount}</b>
                  <small>Detections</small>
                </div>
                <div>
                  <b>{daySnapshot.peakBrightnessK.toFixed(1)} K</b>
                  <small>Peak brightness</small>
                </div>
                <div>
                  <b>{daySnapshot.peakFrpMw !== null ? `${daySnapshot.peakFrpMw.toFixed(1)} MW` : '—'}</b>
                  <small>Peak FRP</small>
                </div>
                <div>
                  <b>{daySnapshot.satellites.join(' + ') || '—'}</b>
                  <small>Satellites</small>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hiSummaryGrid">
        {data.persistence && recurrenceIndex !== null ? (
          <div className="hiCard hiCardHero">
            <div className="hiCardHead">
              <Activity size={13} />
              <span className="label">HISTORICAL RECURRENCE</span>
              <em title={recurrenceExplainer} className="hiInfoTag">
                <Info size={11} /> HOW THIS IS CALCULATED
              </em>
            </div>
            <div className="hiHeroBody">
              <div className="hiPersistenceHeadline">
                {recurrenceIndex}
                <small>/ 100</small>
              </div>
              <div className="hiKeyValRows hiKeyValRowsWide">
                <div>
                  <span>Active days</span>
                  <strong>{data.persistence.activeDays} / {data.persistence.windowDays}</strong>
                </div>
                <div>
                  <span>Typical recurrence</span>
                  <strong>
                    {data.persistence.typicalRecurrenceDays !== null
                      ? `~${data.persistence.typicalRecurrenceDays.toFixed(1)}d`
                      : 'Unavailable'}
                  </strong>
                </div>
                <div>
                  <span>Longest streak</span>
                  <strong>{data.persistence.longestStreakDays} day{data.persistence.longestStreakDays === 1 ? '' : 's'}</strong>
                </div>
                <div>
                  <span>Recent trend</span>
                  <strong>{data.persistence.recentTrend}</strong>
                </div>
              </div>
            </div>
            <p className="hiMuted hiFootnote">{recurrenceExplainer}</p>
          </div>
        ) : (
          <div className="hiCard hiCardHero hiCardMuted">
            <span className="label">HISTORICAL RECURRENCE</span>
            <p className="hiMuted">INSUFFICIENT HISTORY FOR RECURRENCE ANALYSIS</p>
          </div>
        )}

        <div className="hiCard">
          <div className="hiCardHead">
            <TrendingUp size={13} />
            <span className="label">THERMAL BASELINE</span>
          </div>
          {data.baseline.status === 'INSUFFICIENT_HISTORY' ? (
            <p className="hiMuted">INSUFFICIENT HISTORY FOR BASELINE</p>
          ) : (
            <>
              <div className="hiKeyValRows">
                <div>
                  <span>Historical median</span>
                  <strong>{data.baseline.historicalMedianK?.toFixed(1)} K</strong>
                </div>
                <div>
                  <span>Current</span>
                  <strong>{data.baseline.currentK?.toFixed(1)} K</strong>
                </div>
                <div>
                  <span>Deviation</span>
                  <strong>
                    {data.baseline.deviationRatio !== null
                      ? `${data.baseline.deviationRatio >= 0 ? '+' : ''}${(data.baseline.deviationRatio * 100).toFixed(1)}%`
                      : '—'}
                  </strong>
                </div>
              </div>
              <span className={`hiStatusPill hi-${statusTone(data.baseline.status)}`}>{labelize(data.baseline.status)}</span>
              <p className="hiMuted hiFootnote">
                {data.baseline.currentValueSource === 'SELECTED_EVENT'
                  ? 'Current = selected event\u2019s own reading.'
                  : 'Current = cluster\u2019s latest historical observation.'}
              </p>
            </>
          )}
        </div>

        <div className="hiCard">
          <div className="hiCardHead">
            <Radar size={13} />
            <span className="label">HISTORICAL BEHAVIOUR</span>
          </div>
          <span className={`hiStatusPill hi-${statusTone(data.behavior.label)}`}>{labelize(data.behavior.label)}</span>
          <p className="hiMuted">{data.behavior.explanation}</p>
        </div>

        <div className="hiCard">
          <div className="hiCardHead">
            <ShieldCheck size={13} />
            <span className="label">SATELLITE CORROBORATION</span>
          </div>
          {data.corroboration.corroborated ? (
            <>
              <div className="hiSatRow">
                {data.corroboration.satellites.map((s) => (
                  <span key={s} className="hiSatBadge">
                    {s} ✓
                  </span>
                ))}
              </div>
              <div className="hiKeyValRows">
                <div>
                  <span>Spatial agreement</span>
                  <strong>{data.corroboration.spatialAgreementKm?.toFixed(2)} km</strong>
                </div>
                <div>
                  <span>Temporal separation</span>
                  <strong>{data.corroboration.temporalSeparationHours?.toFixed(1)} h</strong>
                </div>
              </div>
              <span className="hiStatusPill hi-low">CORROBORATED</span>
              <p className="hiMuted hiFootnote">Observational agreement only -- not a probability of fire.</p>
            </>
          ) : (
            <p className="hiMuted">NO MULTI-SATELLITE CORROBORATION AVAILABLE</p>
          )}
        </div>

        <div className="hiCard">
          <div className="hiCardHead">
            <Layers size={13} />
            <span className="label">ACTIVITY FINGERPRINT</span>
          </div>
          {data.fingerprint.available ? (
            <div className="hiKeyValRows">
              <div>
                <span>Persistence</span>
                <strong>{data.fingerprint.persistence}</strong>
              </div>
              <div>
                <span>Recurrence</span>
                <strong>{data.fingerprint.recurrence}</strong>
              </div>
              <div>
                <span>Spatial stability</span>
                <strong>{data.fingerprint.spatialStability}</strong>
              </div>
              <div>
                <span>Observation frequency</span>
                <strong>{data.fingerprint.observationFrequency}</strong>
              </div>
              <div>
                <span>Day/night behaviour</span>
                <strong>{labelize(data.fingerprint.dayNightBehavior)}</strong>
              </div>
            </div>
          ) : (
            <p className="hiMuted">INSUFFICIENT HISTORY FOR FINGERPRINT</p>
          )}
        </div>

        <div className="hiCard">
          <div className="hiCardHead">
            <AlertTriangle size={13} />
            <span className="label">ESCALATION</span>
          </div>
          {data.escalation.status === 'INSUFFICIENT_HISTORY' ? (
            <p className="hiMuted">INSUFFICIENT HISTORY FOR CHANGE DETECTION</p>
          ) : data.escalation.status === 'RECENT_ESCALATION' ? (
            <>
              <span className="hiStatusPill hi-extreme">⚠ ACTIVITY SHIFT DETECTED</span>
              <div className="hiKeyValRows">
                <div>
                  <span>Recent vs prior rate</span>
                  <strong>{data.escalation.ratio?.toFixed(1)}×</strong>
                </div>
                <div>
                  <span title="Start of the recent 7-day window used for this comparison -- not an exact threshold-crossing date">
                    Recent window since
                  </span>
                  <strong>{data.escalation.comparisonWindowStart ? formatDateLabel(data.escalation.comparisonWindowStart) : '—'}</strong>
                </div>
              </div>
            </>
          ) : (
            <span className="hiStatusPill hi-low">STABLE</span>
          )}
        </div>

        <div className="hiCard">
          <div className="hiCardHead">
            <span className="label">SPATIAL FOOTPRINT</span>
          </div>
          {data.spatialFootprint.status === 'AVAILABLE' ? (
            <div className="hiKeyValRows">
              <div>
                <span>Max radius from centroid</span>
                <strong>{data.spatialFootprint.maxRadiusKm?.toFixed(2)} km</strong>
              </div>
              <div>
                <span>Observations used</span>
                <strong>{data.spatialFootprint.observationsUsed}</strong>
              </div>
            </div>
          ) : (
            <p className="hiMuted">UNAVAILABLE</p>
          )}
        </div>
      </div>

      <p className="hiDisclaimer">
        A thermal anomaly is an observation, not automatically a confirmed fire. Persistence, corroboration and
        recurrence are contextual evidence only.
      </p>
    </div>
  );
}
