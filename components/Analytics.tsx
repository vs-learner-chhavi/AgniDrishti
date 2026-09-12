'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type AnalyticsDay = {
  date: string;
  detections: number;
  totalFrp: number;
  maxFrp: number;
  meanFrp: number;
  maxBrightness: number;
  meanBrightness: number;
  types: Record<string, number>;
};

type AnalyticsPayload = {
  ok: boolean;
  source?: string;
  window?: { from: string; to: string };
  days?: AnalyticsDay[];
  fireTypes?: string[];
  totalDetections?: number;
  error?: string;
};

const TYPE_COLORS = [
  '#55cdf5',
  '#ff9b67',
  '#66e0b8',
  '#b994ff',
  '#f3c969',
  '#7da7ff',
  '#ff6f91',
  '#82d9e8',
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function colorForType(type: string, types: string[]) {
  const index = types.indexOf(type);
  return TYPE_COLORS[index >= 0 ? index % TYPE_COLORS.length : 0];
}

function AnalyticsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: AnalyticsDay; dataKey?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const day = payload[0].payload;
  const visibleSegments = payload.filter(
    (entry) => Number(entry.value) > 0 && entry.dataKey && entry.dataKey !== 'detections',
  );

  return (
    <div className="analyticsTooltip">
      <span className="analyticsTooltipDate">
        {label ? formatLongDate(label) : 'Observation day'}
      </span>
      <strong>{day.detections.toLocaleString('en-IN')} detections</strong>

      {visibleSegments.length > 0 && (
        <div className="analyticsTooltipTypes">
          {visibleSegments.map((entry) => (
            <div key={String(entry.dataKey)}>
              <span>{String(entry.dataKey)}</span>
              <b>{Number(entry.value).toLocaleString('en-IN')}</b>
            </div>
          ))}
        </div>
      )}

      <div className="analyticsTooltipMeta">
        <span>Total FRP <b>{day.totalFrp.toFixed(2)}</b></span>
        <span>Max brightness <b>{day.maxBrightness.toFixed(2)} K</b></span>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch('/api/analytics', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = (await response.json()) as AnalyticsPayload;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || 'Analytics data could not be loaded.');
        }

        setData(payload);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Analytics data could not be loaded.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const fireTypes = useMemo(() => data?.fireTypes ?? [], [data]);

  const typeTotals = useMemo(() => {
    const totals = new Map<string, number>();

    for (const type of fireTypes) totals.set(type, 0);

    for (const day of data?.days ?? []) {
      for (const [type, count] of Object.entries(day.types)) {
        totals.set(type, (totals.get(type) ?? 0) + Number(count));
      }
    }

    return [...totals.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [data, fireTypes]);

  const chartData = useMemo(
    () =>
      (data?.days ?? []).map((day) => ({
        ...day,
        label: day.date,
      })),
    [data],
  );

  return (
    <section id="analytics" className="section sectionBlock">
      <div className="sectionHeading">
        <div>
          <span className="label">03 · ANALYTICS</span>
          <h2>Understand patterns, not isolated pixels.</h2>
          <p>Thirty days of real FIRMS observations, grouped by observation day and fire type across the monitored region.</p>
        </div>
      </div>

      <div className="analyticsGrid">
        <div className="chartCard analyticsRealCard">
          <div className="cardTitle analyticsCardTitle">
            <div>
              <span className="label">30-DAY SIGNAL HISTORY</span>
              <h2>Thermal activity trend</h2>
            </div>
            <span className="trend">
              <span className="analyticsStatusDot" />
              {loading ? 'Loading archive' : 'Live data pipeline'}
            </span>
          </div>

          {error ? (
            <div className="analyticsState">
              <strong>Analytics unavailable</strong>
              <span>{error}</span>
            </div>
          ) : (
            <>
              <div className="analyticsLegend">
                {fireTypes.map((type) => (
                  <button
                    type="button"
                    key={type}
                    className={`analyticsLegendItem ${hoveredType && hoveredType !== type ? 'dimmed' : ''}`}
                    onMouseEnter={() => setHoveredType(type)}
                    onMouseLeave={() => setHoveredType(null)}
                    onFocus={() => setHoveredType(type)}
                    onBlur={() => setHoveredType(null)}
                  >
                    <i style={{ background: colorForType(type, fireTypes) }} />
                    <span>{type}</span>
                  </button>
                ))}
              </div>

              <div className="analyticsChartWrap">
                {loading ? (
                  <div className="analyticsState compact">
                    <span className="analyticsLoader" />
                    <span>Reading the processed thermal archive…</span>
                  </div>
                ) : chartData.length === 0 ? (
                  <div className="analyticsState compact">
                    <span>No observations in the 30-day archive window.</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 8, right: 8, left: -18, bottom: 8 }}
                      barCategoryGap="18%"
                    >
                      <CartesianGrid
                        strokeDasharray="3 5"
                        vertical={false}
                        stroke="rgba(87, 124, 148, 0.18)"
                      />
                      <XAxis
                        dataKey="label"
                        tickFormatter={formatDate}
                        tick={{ fill: '#70879e', fontSize: 9 }}
                        axisLine={{ stroke: '#193047' }}
                        tickLine={false}
                        interval={2}
                        minTickGap={14}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: '#60788f', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                        width={42}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(77, 180, 221, 0.06)' }}
                        content={<AnalyticsTooltip />}
                      />

                      {fireTypes.map((type) => (
                        <Bar
                          key={type}
                          dataKey={`types.${type}`}
                          name={type}
                          stackId="detections"
                          fill={colorForType(type, fireTypes)}
                          radius={type === fireTypes[fireTypes.length - 1] ? [3, 3, 0, 0] : 0}
                          animationDuration={650}
                          isAnimationActive
                          onMouseEnter={() => setHoveredType(type)}
                          onMouseLeave={() => setHoveredType(null)}
                          opacity={hoveredType && hoveredType !== type ? 0.28 : 1}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="axis">
                <span>{data?.window?.from ? formatDate(data.window.from) : '—'}</span>
                <span>{data?.window?.to ? formatDate(data.window.to) : '—'}</span>
              </div>
            </>
          )}
        </div>

        <div className="mixCard analyticsMixCard">
          <span className="label">CLASSIFICATION MIX</span>
          <h2>What are we seeing?</h2>
          <p className="analyticsMixIntro">
            Same 30-day detection counts used by the stacked chart, grouped by the dataset&apos;s actual fire-type field.
          </p>

          <div className="mixRows">
            {typeTotals.map(({ type, count }) => {
              const max = typeTotals[0]?.count || 1;
              return (
                <div
                  key={type}
                  className={hoveredType && hoveredType !== type ? 'analyticsMixRow dimmed' : 'analyticsMixRow'}
                  onMouseEnter={() => setHoveredType(type)}
                  onMouseLeave={() => setHoveredType(null)}
                >
                  <span className="analyticsMixName">
                    <i style={{ background: colorForType(type, fireTypes) }} />
                    {type}
                  </span>
                  <i className="analyticsMixBar">
                    <b
                      style={{
                        width: `${Math.max(4, (count / max) * 100)}%`,
                        background: colorForType(type, fireTypes),
                      }}
                    />
                  </i>
                  <strong>{count.toLocaleString('en-IN')}</strong>
                </div>
              );
            })}
          </div>

          {!loading && !error && (
            <div className="analyticsTotal">
              <span>30-DAY DETECTIONS</span>
              <strong>{(data?.totalDetections ?? 0).toLocaleString('en-IN')}</strong>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .analyticsRealCard {
          min-width: 0;
          overflow: hidden;
        }

        .analyticsCardTitle {
          margin-bottom: 12px;
        }

        .analyticsStatusDot {
          width: 6px;
          height: 6px;
          display: inline-block;
          border-radius: 50%;
          background: #45d5a7;
          box-shadow: 0 0 10px #45d5a7;
          margin-right: 6px;
        }

        .analyticsLegend {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 13px;
          padding: 0 0 12px;
          border-bottom: 1px solid #172f43;
        }

        .analyticsLegendItem {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 0;
          background: transparent;
          padding: 2px 0;
          color: #7f96aa;
          font-size: 8px;
          transition: opacity 0.18s ease, color 0.18s ease;
        }

        .analyticsLegendItem:hover {
          color: #dceef8;
        }

        .analyticsLegendItem i,
        .analyticsMixName i {
          width: 7px;
          height: 7px;
          border-radius: 2px;
          display: inline-block;
          box-shadow: 0 0 9px rgba(255, 255, 255, 0.08);
        }

        .dimmed {
          opacity: 0.32;
        }

        .analyticsChartWrap {
          height: 360px;
          padding-top: 14px;
        }

        .analyticsState {
          min-height: 360px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #688198;
          font-size: 9px;
          text-align: center;
          padding: 25px;
        }

        .analyticsState strong {
          color: #c8ddea;
          font-size: 12px;
        }

        .analyticsState.compact {
          min-height: 100%;
        }

        .analyticsLoader {
          width: 18px;
          height: 18px;
          border: 2px solid #24465d;
          border-top-color: #55cdf5;
          border-radius: 50%;
          animation: analyticsSpin 0.8s linear infinite;
        }

        .analyticsTooltip {
          min-width: 210px;
          padding: 11px 12px;
          border: 1px solid #31546c;
          border-radius: 9px;
          background: rgba(4, 15, 26, 0.96);
          box-shadow: 0 18px 45px rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(12px);
        }

        .analyticsTooltipDate {
          display: block;
          color: #7190a6;
          font-size: 8px;
          letter-spacing: 0.7px;
          text-transform: uppercase;
          margin-bottom: 5px;
        }

        .analyticsTooltip > strong {
          display: block;
          color: #e4f4fc;
          font-size: 13px;
          margin-bottom: 8px;
        }

        .analyticsTooltipTypes {
          display: grid;
          gap: 4px;
          padding: 7px 0;
          border-top: 1px solid #193047;
          border-bottom: 1px solid #193047;
        }

        .analyticsTooltipTypes div,
        .analyticsTooltipMeta span {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          color: #7e96aa;
          font-size: 8px;
        }

        .analyticsTooltipTypes b,
        .analyticsTooltipMeta b {
          color: #cfe8f4;
        }

        .analyticsTooltipMeta {
          display: grid;
          gap: 4px;
          padding-top: 7px;
        }

        .analyticsMixCard {
          min-width: 0;
        }

        .analyticsMixIntro {
          color: #617990;
          font-size: 8px;
          line-height: 1.55;
          margin: 7px 0 16px;
        }

        .analyticsMixRow {
          transition: opacity 0.18s ease, transform 0.18s ease;
          cursor: default;
        }

        .analyticsMixRow:hover {
          transform: translateX(2px);
        }

        .analyticsMixName {
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .analyticsMixBar {
          display: block;
          height: 5px;
          margin: 7px 0 3px;
          background: #102536;
          border-radius: 5px;
          overflow: hidden;
        }

        .analyticsMixBar b {
          display: block;
          height: 100%;
          border-radius: inherit;
          transition: width 0.45s ease;
        }

        .analyticsTotal {
          display: flex;
          justify-content: space-between;
          align-items: end;
          margin-top: 17px;
          padding-top: 14px;
          border-top: 1px solid #193047;
        }

        .analyticsTotal span {
          color: #5d778e;
          font-size: 7px;
          letter-spacing: 1px;
        }

        .analyticsTotal strong {
          color: #61d4f7;
          font-size: 22px;
          letter-spacing: -1px;
        }

        @keyframes analyticsSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 800px) {
          .analyticsChartWrap {
            height: 300px;
          }
        }
      `}</style>
    </section>
  );
}
