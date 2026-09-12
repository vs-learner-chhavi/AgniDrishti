'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronRight,
  ClipboardList,
  Factory,
  Flame,
  Fuel,
  Layers3,
  MapPin,
  Mountain,
  Phone,
  RefreshCw,
  Satellite,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sprout,
  Target,
  Wifi,
  Zap,
} from 'lucide-react';
import LiveMap from '@/components/LiveMap';
import SimulationLab from '@/components/SimulationLab';

type Explanation = {
  feature: string;
  contribution: number;
};

type Facility = {
  name: string;
  type: string;
  distanceKm: number;
  lat: number;
  lon: number;
};

function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const toDeg = (x: number) => (x * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);

  const y =
    Math.sin(dLon) * Math.cos(toRad(lat2));

  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compassLabel(deg: number) {
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];

  return dirs[Math.round(deg / 22.5) % 16];
}

function slaThresholds(risk: string) {
  if (risk === 'CRITICAL') {
    return {
      warn: 5 * 60000,
      breach: 10 * 60000,
    };
  }

  if (risk === 'HIGH') {
    return {
      warn: 15 * 60000,
      breach: 30 * 60000,
    };
  }

  return {
    warn: 30 * 60000,
    breach: 60 * 60000,
  };
}

function elapsedLabel(ms: number) {
  const m = Math.floor(ms / 60000);

  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;

  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function nextStatus(
  s: 'new' | 'ack' | 'resolved',
): 'new' | 'ack' | 'resolved' {
  return s === 'new'
    ? 'ack'
    : s === 'ack'
      ? 'resolved'
      : 'new';
}

function statusLabel(s: 'new' | 'ack' | 'resolved') {
  return s === 'new'
    ? 'New'
    : s === 'ack'
      ? 'Acknowledged'
      : 'Resolved';
}

type Event = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  cls: string;
  confidence: number;
  risk: string;
  brightness: number;
  persistence: number;
  distance: number;
  time: string;
  source?: string;
  detectedAt?: string;
  landCover?: string;
  explanations?: Explanation[];
  facilities?: Facility[];
};

const seed: Event[] = [
  {
    id: 'TG-1042',
    name: 'Industrial cluster · Gujarat',
    lat: 22.31,
    lon: 72.61,
    cls: 'Industrial Fire',
    confidence: 91,
    risk: 'CRITICAL',
    brightness: 342,
    persistence: 88,
    distance: 0.7,
    time: '14:32 IST',
    source: 'DEMO',
    landCover: 'industrial',
  },
  {
    id: 'TG-1037',
    name: 'Gas infrastructure · Rajasthan',
    lat: 27.17,
    lon: 73.21,
    cls: 'Gas Flare',
    confidence: 96,
    risk: 'HIGH',
    brightness: 329,
    persistence: 97,
    distance: 1.1,
    time: '13:58 IST',
    source: 'DEMO',
    landCover: 'industrial',
  },
  {
    id: 'TG-1028',
    name: 'Agricultural belt · Haryana',
    lat: 29.06,
    lon: 76.08,
    cls: 'Crop Burning',
    confidence: 86,
    risk: 'MODERATE',
    brightness: 318,
    persistence: 43,
    distance: 18.4,
    time: '13:41 IST',
    source: 'DEMO',
    landCover: 'cropland',
  },
  {
    id: 'TG-1019',
    name: 'Forest edge · Odisha',
    lat: 20.26,
    lon: 84.27,
    cls: 'Wildfire',
    confidence: 84,
    risk: 'HIGH',
    brightness: 337,
    persistence: 29,
    distance: 31.2,
    time: '12:47 IST',
    source: 'DEMO',
    landCover: 'forest',
  },
];

const fallbackXai: Explanation[] = [
  {
    feature: 'Industrial proximity',
    contribution: 0.42,
  },
  {
    feature: 'Thermal intensity',
    contribution: 0.31,
  },
  {
    feature: 'Historical persistence',
    contribution: 0.24,
  },
  {
    feature: 'FIRMS confidence',
    contribution: 0.18,
  },
  {
    feature: 'Forest proximity',
    contribution: -0.06,
  },
];

/**
 * Converts every possible backend SHAP format into the
 * frontend format expected by the UI.
 */
function normalizeExplanation(x: any): Explanation {
  const rawContribution =
    x?.contribution ??
    x?.shap_value ??
    x?.shapValue ??
    x?.value ??
    x?.score ??
    0;

  const contribution = Number(rawContribution);

  return {
    feature: String(
      x?.feature ??
        x?.feature_name ??
        x?.name ??
        x?.label ??
        'Unknown feature',
    ),
    contribution: Number.isFinite(contribution)
      ? contribution
      : 0,
  };
}

function toEvent(e: any): Event {
  const latitude = Number(e.latitude);
  const longitude = Number(e.longitude);

  return {
    id: e.id,
    name:
      e.location ||
      e.name ||
      `${e.classification} · ${latitude.toFixed(
        2,
      )}, ${longitude.toFixed(2)}`,

    lat: latitude,
    lon: longitude,
    cls: e.classification || 'Unknown',
    confidence: Number(e.confidence) || 0,
    risk: e.risk || 'MODERATE',
    brightness: Number(e.brightnessKelvin) || 0,
    persistence: Number(e.persistenceScore) || 0,
    distance: Number(e.industrialDistance) || 99,

    time:
      e.detectedAt
        ? new Date(e.detectedAt).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Kolkata',
          }) + ' IST'
        : 'Unknown',

    source: e.source,
    detectedAt: e.detectedAt,
    landCover: e.landCover,

    explanations: Array.isArray(e.explanations)
      ? e.explanations.map(normalizeExplanation)
      : Array.isArray(e.xai?.all_contributions)
        ? e.xai.all_contributions.map(normalizeExplanation)
        : fallbackXai,

    facilities: Array.isArray(e.facilities)
      ? e.facilities.map((f: any) => ({
          name: f.name || 'Unnamed facility',
          type: f.type || 'industrial',
          distanceKm: Number(f.distanceKm) || 0,
          lat: Number(f.latitude) || 0,
          lon: Number(f.longitude) || 0,
        }))
      : [],
  };
}

function riskClass(r: string) {
  return r.toLowerCase();
}

export default function Home() {
  const [
    events,
    setEvents,
  ] = useState<Event[]>(seed);

  const [
    selected,
    setSelected,
  ] = useState<Event>(seed[0]);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [source, setSource] = useState('DEMO_DATA');
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [sim, setSim] = useState(false);
  const closeSimulation = useCallback(() => setSim(false), []);
  const [toast, setToast] = useState('');
  const [alerts, setAlerts] = useState<string[]>([]);
  const [active, setActive] = useState('home');
  const [layers, setLayers] = useState(false);
  const [pickedFacility, setPickedFacility] =
    useState<Facility | null>(null);

  const [alertMeta, setAlertMeta] = useState<
    Record<
      string,
      {
        createdAt: number;
        status: 'new' | 'ack' | 'resolved';
      }
    >
  >({});

  const [now, setNow] = useState(Date.now());

  const visible = useMemo(
    () =>
      events.filter(
        (e) =>
          (filter === 'ALL' || e.risk === filter) &&
          (!q ||
            `${e.id} ${e.name} ${e.cls}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [events, filter, q],
  );

  const critical = events.filter(
    (e) => e.risk === 'CRITICAL' || e.risk === 'HIGH',
  ).length;

  const persistent = events.filter(
    (e) => e.persistence >= 70,
  ).length;

  const avg = events.length
    ? events.reduce((a, e) => a + e.confidence, 0) /
      events.length
    : 0;

  const scroll = (id: string) => {
    setActive(id);
    document
      .getElementById(id)
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
  };

  const load = async () => {
    setLoading(true);

    try {
      const r = await fetch('/api/events', {
        cache: 'no-store',
      });

      const d = await r.json();

      if (d.ok && d.events?.length) {
        const mapped = d.events.map(toEvent);

        setEvents(mapped);
        setSelected(mapped[0]);
        setSource(d.source || 'DEMO_DATA');
      }
    } catch {
      setToast('Refresh failed. Showing current intelligence.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPickedFacility(null);
  }, [selected.id]);

  useEffect(() => {
    const t = setInterval(
      () => setNow(Date.now()),
      15000,
    );

    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    load();

    const t = setInterval(load, 60000);

    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;

    const t = setTimeout(
      () => setToast(''),
      4000,
    );

    return () => clearTimeout(t);
  }, [toast]);

  const analyze = async (e: Event) => {
    setSelected(e);
    setAnalyzing(true);

    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude: e.lat,
          longitude: e.lon,
          detectedAt: e.detectedAt,
        }),
      });

      const d = await r.json();

      if (!d.ok) {
        throw new Error(d.error);
      }

      const h = d.event.hotspot;
      const res = d.event.result;

      const updated: Event = {
        ...e,
        lat: h.latitude,
        lon: h.longitude,
        brightness: h.brightness,
        confidence: res.confidence,
        persistence:
          d.event.persistence?.score ?? e.persistence,
        distance:
          d.event.nearestFacility?.distanceKm ??
          e.distance,
        cls: res.classification,
        risk: res.risk,

        explanations: Array.isArray(res.explanations)
          ? res.explanations.map(normalizeExplanation)
          : Array.isArray(d.event.xai?.all_contributions)
            ? d.event.xai.all_contributions.map(
                normalizeExplanation,
              )
            : fallbackXai,

        source: d.event.source,

        facilities: (d.event.facilities || []).map(
          (f: any) => ({
            name: f.name || 'Unnamed facility',
            type: f.type || 'industrial',
            distanceKm: Number(f.distanceKm) || 0,
            lat: Number(f.latitude) || 0,
            lon: Number(f.longitude) || 0,
          }),
        ),
      };

      setEvents((xs) =>
        xs.map((x) => (x.id === e.id ? updated : x)),
      );

      setSelected(updated);

      setToast(
        `${updated.id} analyzed · ${updated.cls} · ${updated.confidence}%`,
      );
    } catch (err) {
      setToast(
        err instanceof Error
          ? err.message
          : 'Analysis failed',
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const generateAlert = () => {
    if (alerts.includes(selected.id)) {
      setToast(
        `${selected.id} is already in the alert queue`,
      );
      return;
    }

    setAlerts((a) => [selected.id, ...a]);

    setAlertMeta((m) => ({
      ...m,
      [selected.id]: {
        createdAt: Date.now(),
        status: 'new',
      },
    }));

    fetch('/api/alerts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: selected.id,
        severity: selected.risk,
        message: `${selected.cls} at ${selected.name} · ${selected.confidence}% confidence`,
      }),
    }).catch(() => {});

    setToast(`Priority alert created for ${selected.id}`);
    scroll('alerts');
  };

  return (
    <main className="app">
      <nav className="topnav">
        <button
          className="navbrand"
          onClick={() => scroll('home')}
        >
          <span className="brandmark">
            <Flame size={19} />
          </span>

          <span>
            <b>AgniDrishti</b>
            <small>THERMAL INTELLIGENCE</small>
          </span>
        </button>

        <div className="navlinks">
          {[
            ['home', 'Overview'],
            ['monitor', 'Live Monitor'],
            ['intelligence', 'Intelligence'],
            ['analytics', 'Analytics'],
            ['history', 'History'],
            ['alerts', 'Alerts'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={active === id ? 'active' : ''}
              onClick={() => scroll(id)}
            >
              {label}

              {id === 'alerts' &&
                alerts.filter(
                  (a) =>
                    alertMeta[a]?.status !== 'resolved',
                ).length > 0 && (
                  <em>
                    {
                      alerts.filter(
                        (a) =>
                          alertMeta[a]?.status !== 'resolved',
                      ).length
                    }
                  </em>
                )}
            </button>
          ))}
        </div>

        <div className="navright">
          <span className="online">
            <i /> SYSTEM ONLINE
          </span>

          <button
            className="navsimulate"
            onClick={() => setSim(true)}
          >
            <Zap size={15} /> Simulate
          </button>
        </div>
      </nav>

      <section id="home" className="hero section">
        <div className="heroCopy">
          <span className="eyebrow">
            <span className="livePulse" />
            NASA FIRMS · OSM · SATELLITE · EXPLAINABLE AI
          </span>

          <h1>
            Turn thermal anomalies into
            <br />
            <span>actionable intelligence.</span>
          </h1>

          <p>
            AgniDrishti detects hotspots, enriches them with
            industrial and geographic context, classifies the
            likely source, scores risk, and explains the evidence
            behind every decision.
          </p>

          <div className="heroActions">
            <button
              className="primary"
              onClick={() => scroll('monitor')}
            >
              <Satellite size={17} />
              Explore live monitor
              <ChevronRight size={16} />
            </button>

            <button
              className="secondary"
              onClick={() => setSim(true)}
            >
              <Sparkles size={16} />
              Run AI simulation
            </button>
          </div>

          <div className="heroProof">
            <span>
              <ShieldCheck size={15} />
              Multisource evidence
            </span>

            <span>
              <Target size={15} />
              5 source classes
            </span>

            <span>
              <Activity size={15} />
              Explainable decisions
            </span>
          </div>
        </div>

        <div className="heroVisual">
          <div className="orb">
            <div className="orbCore">
              <Flame size={34} />
              <b>{loading ? '—' : events.length}</b>
              <small>ACTIVE HOTSPOTS</small>
            </div>

            <span className="ring r1" />
            <span className="ring r2" />
            <span className="ring r3" />
            <i className="scanline" />
          </div>

          <div className="heroCard">
            <span className="label">CURRENT SIGNAL</span>
            <b>{selected.cls}</b>
            <span>
              {selected.lat.toFixed(2)}° N ·{' '}
              {selected.lon.toFixed(2)}° E
            </span>
            <strong>
              {selected.confidence}%
              <small>AI confidence</small>
            </strong>
          </div>
        </div>
      </section>

      <section className="metrics section">
        <Stat
          icon={<Flame />}
          label="Active thermal events"
          value={loading ? '…' : events.length}
          sub={
            source === 'POSTGRES'
              ? 'LIVE DATABASE'
              : 'DEMO / FALLBACK'
          }
        />

        <Stat
          icon={<Activity />}
          label="Persistent sources"
          value={loading ? '…' : persistent}
          sub="70%+ historical recurrence"
        />

        <Stat
          icon={<AlertTriangle />}
          label="High + critical"
          value={loading ? '…' : critical}
          sub="Risk-prioritized"
          hot
        />

        <Stat
          icon={<ShieldCheck />}
          label="Average confidence"
          value={loading ? '…' : `${avg.toFixed(1)}%`}
          sub="Current event set"
        />
      </section>

      <section
        id="monitor"
        className="section sectionBlock"
      >
        <SectionHeading
          kicker="01 · LIVE MONITOR"
          title="See the heat. Follow the signal."
          text="A geographic operating picture that updates as intelligence changes."
          action={
            <button
              className="ghost"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw size={14} />
              {loading ? 'Syncing' : 'Refresh data'}
            </button>
          }
        />

        <div className="monitorGrid">
          <div className="mapShell">
            <div className="mapHeader">
              <div>
                <span className="label">
                  INDIA · THERMAL ACTIVITY
                </span>

                <b>
                  <span className="greenDot" />
                  {source === 'POSTGRES'
                    ? 'LIVE DATABASE'
                    : 'DEMO + SIMULATION DATA'}
                </b>
              </div>

              <div className="mapTools">
                <button
                  onClick={() => setLayers((v) => !v)}
                >
                  <Layers3 size={14} /> Layers
                </button>

                <button
                  onClick={() =>
                    setFilter(
                      filter === 'ALL' ? 'CRITICAL' : 'ALL',
                    )
                  }
                >
                  <Target size={14} />
                  {filter === 'ALL'
                    ? 'Focus risk'
                    : 'Show all'}
                </button>
              </div>
            </div>

            <div className="mapStage">
              <LiveMap
                events={visible.map((e) => ({
                  id: e.id,
                  latitude: e.lat,
                  longitude: e.lon,
                  risk: e.risk,
                  confidence: e.confidence,
                  classification: e.cls,
                  brightness: e.brightness,
                  persistence: e.persistence,
                }))}
                densityEvents={[]}
                facilities={[]}
                selectedId={selected.id}
                onSelect={(id) => {
                  const e = events.find(
                    (x) => x.id === id,
                  );

                  if (e) setSelected(e);
                }}
                mode={'detections' as any}
                layers={{
                  facilities: true,
                  halos: true,
                  labels: true,
                  imagery: false,
                }}
              />

              <div className="mapOverlay">
                <span>THERMAL LAYER</span>
                <span>CONTEXT LAYER</span>
                <span>AI LAYER</span>
              </div>

              {layers && (
                <div className="layerBox">
                  <b>INTELLIGENCE LAYERS</b>

                  <label>
                    <input
                      type="checkbox"
                      defaultChecked
                    />
                    Thermal anomaly intensity
                  </label>

                  <label>
                    <input
                      type="checkbox"
                      defaultChecked
                    />
                    Risk halos
                  </label>

                  <label>
                    <input
                      type="checkbox"
                      defaultChecked
                    />
                    Industrial context
                  </label>

                  <label>
                    <input type="checkbox" />
                    Satellite imagery
                  </label>

                  <small>
                    Live satellite imagery requires a configured
                    imagery provider.
                  </small>
                </div>
              )}
            </div>
          </div>

          <aside className="selectedPanel">
            <div className="selectedTop">
              <div>
                <span className="label">SELECTED EVENT</span>
                <h3>{selected.id}</h3>
              </div>

              <span
                className={`pill ${riskClass(selected.risk)}`}
              >
                {selected.risk}
              </span>
            </div>

            <div className="selectedPlace">
              <MapPin size={15} />
              {selected.name}
            </div>

            <div className="classification">
              <div>
                <span>AI CLASSIFICATION</span>
                <b>{selected.cls}</b>
              </div>

              <strong>
                {selected.confidence}%
                <small>confidence</small>
              </strong>
            </div>

            <div className="metricGrid">
              <Metric
                label="Brightness"
                value={`${selected.brightness} K`}
              />

              <Metric
                label="Persistence"
                value={`${selected.persistence}%`}
              />

              <Metric
                label="Industrial distance"
                value={`${selected.distance.toFixed(1)} km`}
              />

              <Metric
                label="Land context"
                value={selected.landCover || 'unknown'}
              />
            </div>

            <div className="xaiBox">
              <div className="xaiHead">
                <span>
                  <Sparkles size={14} />
                  MODEL EXPLANATION
                </span>

                <b>
                  {analyzing
                    ? 'ANALYZING'
                    : 'EXPLAINABLE'}
                </b>
              </div>

              <p>
                Feature contributions for the current classifier
                decision.
              </p>

              {(selected.explanations || fallbackXai)
                .map(normalizeExplanation)
                .map((x, i) => {
                  const safeContribution =
                    Number.isFinite(x.contribution)
                      ? x.contribution
                      : 0;

                  const barWidth = Math.min(
                    100,
                    Math.max(
                      6,
                      (Math.abs(safeContribution) * 100) /
                        0.45,
                    ),
                  );

                  return (
                    <div
                      className="xaiRow"
                      key={`${x.feature}-${i}`}
                    >
                      <span>{x.feature}</span>

                      <i>
                        <b
                          style={{
                            width: `${barWidth}%`,
                          }}
                        />
                      </i>

                      <strong
                        className={
                          safeContribution < 0
                            ? 'negative'
                            : ''
                        }
                      >
                        {safeContribution > 0 ? '+' : ''}
                        {safeContribution.toFixed(2)}
                      </strong>
                    </div>
                  );
                })}
            </div>

            <button
              className="primary full"
              onClick={generateAlert}
            >
              <Bell size={15} />
              Generate priority alert
              <ChevronRight size={15} />
            </button>
          </aside>
        </div>
      </section>

      <section
        id="intelligence"
        className="section sectionBlock"
      >
        <SectionHeading
          kicker="02 · INTELLIGENCE"
          title="From hotspot to explanation."
          text="Every event is more than a dot on a map: it carries evidence, classification, confidence, risk and a traceable explanation."
        />

        <div className="intelGrid">
          <div className="evidenceCard">
            <div className="cardTitle">
              <div>
                <span className="label">EVIDENCE STACK</span>
                <h2>What the engine sees</h2>
              </div>
              <Wifi size={17} />
            </div>

            {[
              [
                '01',
                'Thermal signal',
                'Brightness, confidence and fire radiative context',
              ],
              [
                '02',
                'Spatial context',
                'Distance to industrial facilities and land-cover context',
              ],
              [
                '03',
                'Temporal history',
                'Persistence and recurrence across the analysis window',
              ],
              [
                '04',
                'AI decision',
                'Class + confidence + risk generated from combined evidence',
              ],
            ].map(([n, t, d]) => (
              <div
                className="evidenceRow"
                key={n}
              >
                <b>{n}</b>

                <div>
                  <strong>{t}</strong>
                  <span>{d}</span>
                </div>

                <ChevronRight size={15} />
              </div>
            ))}
          </div>

          <div className="decisionCard">
            <span className="label">
              CURRENT AI DECISION
            </span>

            <div className="decisionClass">
              <Flame size={22} />

              <div>
                <small>LIKELY SOURCE</small>
                <b>{selected.cls}</b>
              </div>

              <strong>{selected.confidence}%</strong>
            </div>

            <div className="riskMeter">
              <span>RISK SCORE</span>

              <i>
                <b
                  style={{
                    width: `${
                      selected.risk === 'CRITICAL'
                        ? 94
                        : selected.risk === 'HIGH'
                          ? 76
                          : selected.risk === 'MODERATE'
                            ? 52
                            : 28
                    }%`,
                  }}
                />
              </i>

              <em>{selected.risk}</em>
            </div>

            <p>
              The classifier combines thermal intensity, FIRMS
              confidence, persistence, industrial proximity and
              land context. The explanation above shows the
              contribution of each feature.
            </p>

            <button
              className="ghost"
              onClick={() => analyze(selected)}
              disabled={analyzing}
            >
              {analyzing
                ? 'Recomputing…'
                : 'Re-run analysis'}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      <section
        id="analytics"
        className="section sectionBlock"
      >
        <SectionHeading
          kicker="03 · ANALYTICS"
          title="Understand patterns, not isolated pixels."
          text="Use the event stream to identify persistence, risk concentration and source mix."
        />

        <div className="analyticsGrid">
          <div className="chartCard">
            <div className="cardTitle">
              <div>
                <span className="label">
                  30-DAY SIGNAL HISTORY
                </span>
                <h2>Thermal activity trend</h2>
              </div>

              <span className="trend">
                <Activity size={14} /> Live model view
              </span>
            </div>

            <div className="bigBars">
              {[
                32, 44, 38, 58, 46, 67, 53, 76, 62, 83,
                71, 91, 68, 78, 88, 74, 95, 81,
              ].map((v, i) => (
                <i
                  key={i}
                  style={{ height: `${v}%` }}
                >
                  <b />
                </i>
              ))}
            </div>

            <div className="axis">
              <span>−30d</span>
              <span>−20d</span>
              <span>−10d</span>
              <span>Now</span>
            </div>
          </div>

          <div className="mixCard">
            <span className="label">CLASSIFICATION MIX</span>
            <h2>What are we seeing?</h2>

            <div className="mixRows">
              {[
                'Industrial Fire',
                'Gas Flare',
                'Crop Burning',
                'Wildfire',
                'Mining',
              ].map((name) => {
                const count = events.filter(
                  (e) => e.cls === name,
                ).length;

                return (
                  <div key={name}>
                    <span>{name}</span>

                    <i>
                      <b
                        style={{
                          width: `${Math.max(
                            8,
                            events.length
                              ? (count / events.length) *
                                  100
                              : 8,
                          )}%`,
                        }}
                      />
                    </i>

                    <strong>{count}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section
        id="history"
        className="section sectionBlock"
      >
        <SectionHeading
          kicker="04 · HISTORICAL INTELLIGENCE"
          title="Persistence turns heat into context."
          text="Repeated detections can distinguish persistent industrial sources from transient events."
        />

        <div className="historyGrid">
          <div className="historyLead">
            <div className="historyNumber">
              {selected.persistence}
              <span>%</span>
            </div>

            <div>
              <span className="label">
                SELECTED EVENT PERSISTENCE
              </span>

              <h2>
                {selected.persistence >= 70
                  ? 'Persistent thermal source'
                  : 'Transient thermal event'}
              </h2>

              <p>
                Persistence is contextual evidence, not proof of
                cause. Analysts can combine it with location,
                land cover and imagery before taking action.
              </p>
            </div>
          </div>

          <div className="historyTimeline">
            {Array.from({ length: 10 }, (_, i) => {
              const v = Math.max(
                10,
                Math.round(
                  (selected.persistence / 100) *
                    (55 + (i % 4) * 11),
                ),
              );

              return (
                <div key={i}>
                  <span>Day {i + 1}</span>
                  <i style={{ height: `${v}%` }} />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="alerts"
        className="section sectionBlock"
      >
        <SectionHeading
          kicker="05 · RISK & RESPONSE"
          title="Move from detection to action."
          text="Priority alerts are created from selected intelligence and remain visible as an analyst queue."
        />

        <div className="alertsGrid">
          <div className="alertQueue">
            <div className="cardTitle">
              <div>
                <span className="label">PRIORITY QUEUE</span>

                <h2>
                  {alerts.filter(
                    (id) =>
                      alertMeta[id]?.status !== 'resolved',
                  ).length
                    ? `${alerts.filter(
                        (id) =>
                          alertMeta[id]?.status !== 'resolved',
                      ).length} active alert${
                        alerts.filter(
                          (id) =>
                            alertMeta[id]?.status !==
                            'resolved',
                        ).length > 1
                          ? 's'
                          : ''
                      }`
                    : 'No active alerts'}
                </h2>
              </div>

              <Bell size={17} />
            </div>

            {alerts.length ? (
              [...alerts]
                .sort((a, b) => {
                  const sa =
                    alertMeta[a]?.status || 'new';
                  const sb =
                    alertMeta[b]?.status || 'new';

                  if (
                    (sa === 'resolved') !==
                    (sb === 'resolved')
                  ) {
                    return sa === 'resolved' ? 1 : -1;
                  }

                  return (
                    (alertMeta[b]?.createdAt || 0) -
                    (alertMeta[a]?.createdAt || 0)
                  );
                })
                .map((id) => {
                  const e =
                    events.find((x) => x.id === id) ||
                    selected;

                  const meta =
                    alertMeta[id] || {
                      createdAt: Date.now(),
                      status: 'new' as const,
                    };

                  const elapsed = now - meta.createdAt;
                  const th = slaThresholds(e.risk);

                  const urgency =
                    meta.status === 'resolved'
                      ? 'ok'
                      : elapsed >= th.breach
                        ? 'breach'
                        : elapsed >= th.warn
                          ? 'warn'
                          : 'ok';

                  return (
                    <div
                      className={`alertRow status-${meta.status} sla-${urgency}`}
                      key={id}
                    >
                      <button
                        className="alertRowMain"
                        onClick={() => analyze(e)}
                      >
                        <span
                          className={`dot ${riskClass(
                            e.risk,
                          )}`}
                        />

                        <div>
                          <b>{id}</b>
                          <small>
                            {e.cls} · {e.name}
                          </small>
                          <small
                            className={`slaTag sla-${urgency}`}
                          >
                            {statusLabel(meta.status)} ·{' '}
                            {elapsedLabel(elapsed)}
                          </small>
                        </div>

                        <span
                          className={`pill ${riskClass(
                            e.risk,
                          )}`}
                        >
                          {e.risk}
                        </span>
                      </button>

                      <button
                        className="statusCycle"
                        onClick={(ev) => {
                          ev.stopPropagation();

                          setAlertMeta((m) => ({
                            ...m,
                            [id]: {
                              ...meta,
                              status: nextStatus(
                                meta.status,
                              ),
                            },
                          }));
                        }}
                        title="Advance status"
                      >
                        {meta.status === 'new' ? (
                          <ChevronRight size={15} />
                        ) : meta.status === 'ack' ? (
                          <ShieldCheck size={15} />
                        ) : (
                          <RefreshCw size={13} />
                        )}
                      </button>
                    </div>
                  );
                })
            ) : (
              <div className="emptyAlert">
                <Bell size={20} />
                <b>Alert queue is clear</b>
                <span>
                  Select an event and generate a priority
                  alert.
                </span>
              </div>
            )}
          </div>

          <div className="responseCard assetsCard">
            <span className="label">
              NEARBY ASSETS · IMPACT RADIUS
            </span>

            <h2>{selected.name}</h2>

            <div className="radarWrap">
              <svg
                viewBox="0 0 200 200"
                className="radarSvg"
              >
                <circle
                  cx="100"
                  cy="100"
                  r="28"
                  className="radarRing"
                />
                <circle
                  cx="100"
                  cy="100"
                  r="58"
                  className="radarRing"
                />
                <circle
                  cx="100"
                  cy="100"
                  r="90"
                  className="radarRing radarRingOuter"
                />

                <line
                  x1="100"
                  y1="10"
                  x2="100"
                  y2="190"
                  className="radarAxis"
                />

                <line
                  x1="10"
                  y1="100"
                  x2="190"
                  y2="100"
                  className="radarAxis"
                />

                <g className="radarSweep">
                  <path d="M100,100 L100,10 A90,90 0 0,1 163.6,36.4 Z" />
                </g>

                {selected.facilities
                  ?.slice(0, 10)
                  .map((f, i) => {
                    const brg =
                      (bearingDeg(
                        selected.lat,
                        selected.lon,
                        f.lat,
                        f.lon,
                      ) *
                        Math.PI) /
                      180;

                    const r = Math.min(
                      90,
                      10 +
                        (Math.min(f.distanceKm, 10) / 10) *
                          80,
                    );

                    const x = 100 + r * Math.sin(brg);
                    const y = 100 - r * Math.cos(brg);

                    const cls =
                      f.distanceKm <= 1
                        ? 'dotNear'
                        : f.distanceKm <= 5
                          ? 'dotMid'
                          : 'dotFar';

                    const active =
                      pickedFacility?.name === f.name &&
                      pickedFacility?.distanceKm ===
                        f.distanceKm;

                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r={
                          active
                            ? 7
                            : f.distanceKm <= 1
                              ? 5
                              : 3.5
                        }
                        className={`radarDot ${cls}${
                          active ? ' radarDotActive' : ''
                        }`}
                        onClick={() =>
                          setPickedFacility(
                            active ? null : f,
                          )
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <title>
                          {f.name} ·{' '}
                          {f.distanceKm.toFixed(1)} km
                        </title>
                      </circle>
                    );
                  })}

                <circle
                  cx="100"
                  cy="100"
                  r="5"
                  className="radarCenter"
                />
              </svg>

              <span className="radarTag r1km">1km</span>
              <span className="radarTag r5km">5km</span>
              <span className="radarTag r10km">10km</span>

              {pickedFacility && (
                <div className="radarPopover">
                  <button
                    className="radarPopoverClose"
                    onClick={() => setPickedFacility(null)}
                  >
                    ×
                  </button>

                  <b>{pickedFacility.name}</b>
                  <span className="radarPopoverType">
                    {pickedFacility.type}
                  </span>

                  <div className="radarPopoverStats">
                    <div>
                      <small>DISTANCE</small>
                      <strong>
                        {pickedFacility.distanceKm.toFixed(
                          2,
                        )}{' '}
                        km
                      </strong>
                    </div>

                    <div>
                      <small>BEARING</small>
                      <strong>
                        {compassLabel(
                          bearingDeg(
                            selected.lat,
                            selected.lon,
                            pickedFacility.lat,
                            pickedFacility.lon,
                          ),
                        )}{' '}
                        ·{' '}
                        {Math.round(
                          bearingDeg(
                            selected.lat,
                            selected.lon,
                            pickedFacility.lat,
                            pickedFacility.lon,
                          ),
                        )}
                        °
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {selected.facilities &&
            selected.facilities.length ? (
              <div className="assetList">
                {selected.facilities.slice(0, 5).map((f, i) => {
                  const cls =
                    f.distanceKm <= 1
                      ? 'dotNear'
                      : f.distanceKm <= 5
                        ? 'dotMid'
                        : 'dotFar';

                  const active =
                    pickedFacility?.name === f.name &&
                    pickedFacility?.distanceKm ===
                      f.distanceKm;

                  return (
                    <div
                      key={i}
                      className={`assetRow${
                        active ? ' assetRowActive' : ''
                      }`}
                      onClick={() =>
                        setPickedFacility(
                          active ? null : f,
                        )
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <span
                        className={`assetDot ${cls}`}
                      />

                      <div>
                        <b>{f.name}</b>
                        <small>{f.type}</small>
                      </div>

                      <strong>
                        {f.distanceKm.toFixed(1)} km
                      </strong>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="emptyAssets">
                <span>No assets mapped for this event yet.</span>

                <button
                  className="ghost"
                  onClick={() => analyze(selected)}
                  disabled={analyzing}
                >
                  {analyzing ? 'Scanning…' : 'Scan area'}
                </button>
              </div>
            )}

            <div
              className={`escalationBox risk-${riskClass(
                selected.risk,
              )}`}
            >
              <span className="label">
                ESCALATION DIRECTORY
              </span>

              <div className="escalationHead">
                <ClassIcon cls={selected.cls} />

                <div>
                  <b>
                    {contactFor(selected.cls).authority}
                  </b>
                  <small>{selected.cls}</small>
                </div>

                <a
                  className="phoneChip"
                  href={`tel:${contactFor(selected.cls).phone}`}
                >
                  <Phone size={12} />
                  {contactFor(selected.cls).phone}
                </a>
              </div>

              <p>{contactFor(selected.cls).note}</p>

              <button
                className="ghost full"
                onClick={() => {
                  const c = contactFor(selected.cls);

                  const summary = `AgniDrishti Incident ${selected.id}
${selected.cls} · ${selected.risk} risk
Location: ${selected.name} (${selected.lat.toFixed(3)}, ${selected.lon.toFixed(3)})
Confidence: ${selected.confidence}% · Brightness: ${selected.brightness}K · Persistence: ${selected.persistence}%
Nearest industrial facility: ${selected.distance.toFixed(1)} km
Recommended contact: ${c.authority} (${c.phone})`;

                  navigator.clipboard
                    ?.writeText(summary)
                    .then(() =>
                      setToast('Incident summary copied'),
                    )
                    .catch(() =>
                      setToast(
                        'Could not copy — clipboard unavailable',
                      ),
                    );
                }}
              >
                <ClipboardList size={14} />
                Copy incident summary
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="section cta">
        <div>
          <span className="eyebrow">
            SIMULATION LAB · SAFE DEMO MODE
          </span>

          <h2>
            How does the model handle a new anomaly?
          </h2>

          <p>
            Pick an exact location, set hypothetical thermal evidence, and
            inspect a prediction from the trained model. Test points stay
            separate from live incidents and alerts.
          </p>
        </div>

        <button
          className="primary"
          onClick={() => setSim(true)}
        >
          <Zap size={17} />
          Launch simulation
        </button>
      </section>

      <footer>
        <div>
          <span className="brandmark small">
            <Flame size={15} />
          </span>
          <b>AgniDrishti</b> · Team WINFINITY
        </div>

        <span>
          <i /> Pipeline operational ·{' '}
          {source === 'POSTGRES'
            ? 'LIVE DATABASE'
            : 'DEMO / SIMULATION'}
        </span>

        <span>© 2026</span>
      </footer>

      {toast && (
        <div className="toast">
          <Sparkles size={15} />
          <span>{toast}</span>
          <button onClick={() => setToast('')}>×</button>
        </div>
      )}

      {sim && <SimulationLab onClose={closeSimulation} />}
    </main>
  );
}

function responseSteps(e: Event): string[] {
  if (e.risk === 'CRITICAL') {
    return [
      `Escalate immediately — ${e.cls} at ${e.name}`,
      `Confirm industrial distance: ${e.distance.toFixed(1)} km (${e.landCover || 'unknown'} land cover)`,
      'Open satellite/context evidence for verification',
      'Notify ground team — do not wait for further confirmation',
    ];
  }

  if (e.risk === 'HIGH') {
    return [
      `Review thermal evidence — ${e.confidence}% confidence, ${e.brightness} K`,
      `Inspect industrial proximity: ${e.distance.toFixed(1)} km · persistence ${e.persistence}%`,
      'Open satellite/context evidence for verification',
      'Escalate after analyst confirmation',
    ];
  }

  return [
    `Review thermal evidence and confidence (${e.confidence}%)`,
    `Inspect industrial proximity (${e.distance.toFixed(1)} km) and historical pattern`,
    'Open satellite/context evidence for verification',
    'Escalate only after analyst or ground verification',
  ];
}

function contactFor(
  cls: string,
): {
  authority: string;
  phone: string;
  note: string;
} {
  const m: Record<
    string,
    {
      authority: string;
      phone: string;
      note: string;
    }
  > = {
    'Industrial Fire': {
      authority: 'State Fire & Emergency Services',
      phone: '101',
      note: 'Notify local fire control room and the facility operator if identifiable.',
    },

    'Gas Flare': {
      authority: 'PESO / State Pollution Control Board',
      phone: '1800-11-0093',
      note: 'Route to oil & gas safety authority; flares near residential zones need priority review.',
    },

    'Crop Burning': {
      authority: 'State Pollution Control Board',
      phone: '1800-11-0093',
      note: 'Typically handled by agricultural extension + pollution control, not emergency response.',
    },

    Wildfire: {
      authority: 'State Forest Department + Fire Services',
      phone: '101',
      note: 'Escalate to forest fire control room; check wind direction before dispatch.',
    },

    Mining: {
      authority: 'Directorate General of Mines Safety',
      phone: '1800-11-0093',
      note: 'Route to DGMS regional office and state mining department.',
    },
  };

  return (
    m[cls] || {
      authority: 'District Disaster Management Authority',
      phone: '112',
      note: 'Default escalation path for unclassified or ambiguous thermal events.',
    }
  );
}

function ClassIcon({ cls }: { cls: string }) {
  const props = { size: 18 };

  switch (cls) {
    case 'Industrial Fire':
      return <Factory {...props} />;

    case 'Gas Flare':
      return <Fuel {...props} />;

    case 'Crop Burning':
      return <Sprout {...props} />;

    case 'Wildfire':
      return <Flame {...props} />;

    case 'Mining':
      return <Mountain {...props} />;

    default:
      return <ShieldAlert {...props} />;
  }
}

function SectionHeading({
  kicker,
  title,
  text,
  action,
}: {
  kicker: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="sectionHeading">
      <div>
        <span className="eyebrow">{kicker}</span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>

      {action}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  hot,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub: string;
  hot?: boolean;
}) {
  return (
    <div className="statCard">
      <div className={`statIcon ${hot ? 'hot' : ''}`}>
        {icon}
      </div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>

      <div className="spark">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
