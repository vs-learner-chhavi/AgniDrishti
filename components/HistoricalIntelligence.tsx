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

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
    .replace(',', '');
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

  const daySnapshot = useMemo(() => {
    if (state.status !== 'ready' || !selectedDate) return null;
    return state.data.timeline.find((d) => d.date === selectedDate) || null;
  }, [state, selectedDate]);

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
  const chartData = data.timeline.map((d) => ({ ...d, __selected: d.date === selectedDate }));

  return (
    <div className="hiRoot">
      <div className="hiProvenance">
        <Satellite size={13} />
        <span>
          NASA FIRMS · {data.provenance.satellites.join(' + ') || 'Unknown satellite'} ·{' '}
          {data.provenance.observationPeriodStart} → {data.provenance.observationPeriodEnd} · Precomputed aggregate
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
          <span className="label">DAILY OBSERVATION TIMELINE</span>
          <em>{data.totalObservations} total observations</em>
        </div>
        {chartData.length > 0 ? (
          <div className="hiChart">
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={chartData} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => v.slice(5)}
                  tick={{ fill: '#536e85', fontSize: 8 }}
                  axisLine={{ stroke: '#1b3248' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(79,201,241,0.06)' }} />
                <Bar dataKey="observationCount" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.date}
                      fill={thermalColor(d.peakBrightnessK, d.date === selectedDate)}
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
        ) : (
          <div className="hiEmptyInline">No daily observations to display.</div>
        )}
      </div>

      {daySnapshot && (
        <div className="hiDaySnapshot">
          <div className="hiCardHead">
            <CalendarDays size={13} />
            <span className="label">DAY SNAPSHOT</span>
            <em>{formatDateLabel(daySnapshot.date)}</em>
          </div>
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
        </div>
      )}

      <div className="hiSummaryGrid">
        {data.persistence ? (
          <div className="hiCard">
            <div className="hiCardHead">
              <Activity size={13} />
              <span className="label">PERSISTENCE</span>
            </div>
            <div className="hiPersistenceHeadline">
              {data.persistence.activeDays} / {data.persistence.windowDays}
              <small>active days</small>
            </div>
            <div className="hiKeyValRows">
              <div>
                <span title="Consecutive active days ending at this cluster's latest observed date">
                  Current streak
                </span>
                <strong>{data.persistence.currentStreakDays} day{data.persistence.currentStreakDays === 1 ? '' : 's'}</strong>
              </div>
              <div>
                <span>Longest streak</span>
                <strong>{data.persistence.longestStreakDays} day{data.persistence.longestStreakDays === 1 ? '' : 's'}</strong>
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
                <span>Recent trend</span>
                <strong>{data.persistence.recentTrend}</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="hiCard hiCardMuted">
            <span className="label">PERSISTENCE</span>
            <p>INSUFFICIENT HISTORY FOR PERSISTENCE SUMMARY</p>
          </div>
        )}

        <div className="hiCard">
          <div className="hiCardHead">
            <TrendingUp size={13} />
            <span className="label">HISTORICAL THERMAL BASELINE</span>
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
                  ? 'Current value is the selected event\u2019s own reading.'
                  : 'Current value is the cluster\u2019s most recent historical observation.'}
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
            <span className="label">MULTI-SATELLITE CORROBORATION</span>
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
              <span className="hiStatusPill hi-low">CORROBORATED OBSERVATION</span>
              <p className="hiMuted hiFootnote">Represents observational agreement, not a probability of fire.</p>
            </>
          ) : (
            <p className="hiMuted">NO MULTI-SATELLITE CORROBORATION AVAILABLE</p>
          )}
        </div>

        {data.fingerprint.available && (
          <div className="hiCard">
            <div className="hiCardHead">
              <Layers size={13} />
              <span className="label">THERMAL ACTIVITY FINGERPRINT</span>
            </div>
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
                <span>Recent trend</span>
                <strong>{data.fingerprint.recentTrend}</strong>
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
          </div>
        )}

        <div className="hiCard">
          <div className="hiCardHead">
            <AlertTriangle size={13} />
            <span className="label">ESCALATION / CHANGE DETECTION</span>
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
                  <span>Change detected</span>
                  <strong>{data.escalation.changeDetectedDate ? formatDateLabel(data.escalation.changeDetectedDate) : '—'}</strong>
                </div>
              </div>
            </>
          ) : (
            <span className="hiStatusPill hi-low">STABLE</span>
          )}
        </div>

        <div className="hiCard">
          <div className="hiCardHead">
            <span className="label">ESTIMATED SPATIAL FOOTPRINT</span>
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
