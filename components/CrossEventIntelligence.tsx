'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Network,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';

import {
  buildEventClusters,
  haversineKm,
  parseEventTime,
} from '@/lib/event-clusters';

type EventLike = {
  id: string;
  name?: string;
  lat: number | string;
  lon: number | string;
  cls?: string;
  classification?: string;
  confidence?: number;
  risk?: string;
  brightness?: number;
  brightnessKelvin?: number;
  persistence?: number;
  persistenceScore?: number;
  detectedAt?: string | number | Date | null;
  time?: string | null;
  frp?: number;
  nearbyFacilities?: number;
};

type Props = {
  events: EventLike[];
  selected?: EventLike | null;
  onSelect?: (event: EventLike) => void;
};

const DEFAULT_RADIUS_KM = 25;
const DEFAULT_WINDOW_HOURS = 168;

function riskColor(risk = '') {
  return (
    {
      CRITICAL: '#fb7185',
      HIGH: '#fb923c',
      MODERATE: '#facc15',
      LOW: '#34d399',
    }[risk.toUpperCase()] || '#38bdf8'
  );
}

function eventClass(event: EventLike) {
  return event.cls || event.classification || 'Unknown';
}

function eventRisk(event: EventLike) {
  return event.risk || 'MODERATE';
}

function formatDuration(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return '0 min';

  if (hours < 1) {
    return `${Math.round(hours * 60)} min`;
  }

  if (hours < 24) {
    return `${hours.toFixed(1)} hours`;
  }

  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
}

export default function CrossEventIntelligence({
  events,
  selected,
  onSelect,
}: Props) {
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [windowHours, setWindowHours] = useState(DEFAULT_WINDOW_HOURS);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null
  );

  const validEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          Number.isFinite(Number(event.lat)) &&
          Number.isFinite(Number(event.lon))
      ),
    [events]
  );

  const activeEvent = selected || validEvents[0] || null;

  const clusters = useMemo(
    () => buildEventClusters(validEvents, radiusKm, windowHours),
    [validEvents, radiusKm, windowHours]
  );

  const activeCluster =
    clusters.find((cluster) => cluster.id === selectedClusterId) ||
    clusters.find((cluster) =>
      activeEvent
        ? cluster.events.some((event) => event.id === activeEvent.id)
        : false
    ) ||
    null;

  const activeMembers = activeCluster?.events || [];

  const connectedEvents = activeEvent
    ? validEvents
        .filter((event) => event.id !== activeEvent.id)
        .map((event) => ({
          event,
          distance: haversineKm(activeEvent, event),
        }))
        .sort((a, b) => a.distance - b.distance)
    : [];

  const times = activeMembers
    .map(parseEventTime)
    .filter((time): time is number => time !== null);

  const classes = Object.entries(
    activeMembers.reduce<Record<string, number>>((result, event) => {
      const key = eventClass(event);
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {})
  );

  const maxClass = Math.max(1, ...classes.map(([, count]) => count));

  const avgConfidence =
    activeMembers.length > 0
      ? activeMembers.reduce(
          (sum, event) => sum + Number(event.confidence || 0),
          0
        ) / activeMembers.length
      : 0;

  const bounds = useMemo(() => {
    if (!validEvents.length) {
      return {
        minLat: 0,
        maxLat: 1,
        minLon: 0,
        maxLon: 1,
        latSpan: 1,
        lonSpan: 1,
      };
    }

    const lats = validEvents.map((event) => Number(event.lat));
    const lons = validEvents.map((event) => Number(event.lon));

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    return {
      minLat,
      maxLat,
      minLon,
      maxLon,
      latSpan: Math.max(maxLat - minLat, 0.01),
      lonSpan: Math.max(maxLon - minLon, 0.01),
    };
  }, [validEvents]);

  /*
   * Convert geographic coordinates into percentages.
   *
   * These coordinates are also used directly by the SVG.
   * SVG uses a 0–100 viewBox, so percentage coordinates map correctly.
   */
  const point = (event: EventLike) => ({
    x:
      8 +
      ((Number(event.lon) - bounds.minLon) / bounds.lonSpan) * 84,
    y:
      8 +
      (1 - (Number(event.lat) - bounds.minLat) / bounds.latSpan) * 84,
  });

  const selectCluster = (cluster: (typeof clusters)[number]) => {
    setSelectedClusterId(cluster.id);
    onSelect?.(cluster.events[0]);
  };

  const selectEvent = (event: EventLike) => {
    const containingCluster = clusters.find((cluster) =>
      cluster.events.some((member) => member.id === event.id)
    );

    setSelectedClusterId(containingCluster?.id || null);
    onSelect?.(event);
  };

  const isConnectedEvent = (event: EventLike) =>
    activeCluster?.events.some((member) => member.id === event.id) ?? false;

  const timeWindowLabel =
    windowHours >= 168
      ? '7-day'
      : windowHours === 24
        ? '24-hour'
        : `${windowHours}-hour`;

  return (
    <section className="crossEventWorkspace">
      {/* HEADER */}
      <div className="crossEventToolbar">
        <div className="crossEventHeading">
          <span className="label">SPATIAL-TEMPORAL INTELLIGENCE</span>

          <h2>Understand event relationships.</h2>

          <p>
            Select any real thermal event to see nearby related events, their
            geographic distance, time difference, and risk relationship.
          </p>
        </div>

        <div className="crossEventControls">
          <label>
            Radius
            <div className="controlInput">
              <input
                type="number"
                min={1}
                max={100}
                value={radiusKm}
                onChange={(e) =>
                  setRadiusKm(
                    Math.max(1, Math.min(100, Number(e.target.value) || 1))
                  )
                }
              />
              <span>km</span>
            </div>
          </label>

          <label>
            Time window
            <select
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
            >
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
              <option value={72}>72 hours</option>
              <option value={168}>7 days</option>
            </select>
          </label>

          <button
            type="button"
            className="ghost"
            onClick={() => {
              setRadiusKm(DEFAULT_RADIUS_KM);
              setWindowHours(DEFAULT_WINDOW_HOURS);
              setSelectedClusterId(null);
            }}
          >
            <RefreshCw size={14} />
            Reset
          </button>
        </div>
      </div>

      {/* QUICK STATUS */}
      <div className="crossEventStats">
        <span>
          <Activity size={13} />
          {validEvents.length} live events
        </span>

        <span>
          <Network size={13} />
          {clusters.length} detected groups
        </span>

        <span>
          <Target size={13} />
          {activeEvent ? `Selected: ${activeEvent.id}` : 'No event selected'}
        </span>
      </div>

      {/* MAIN GRID */}
      <div className="crossEventGrid">
        {/* LIVE MAP */}
        <div className="crossEventMap cardSurface">
          <div className="cardTitle">
            <div>
              <span className="label">LIVE EVENT MAP</span>
              <h3>{validEvents.length} real events across region</h3>
            </div>

            <MapPin size={18} />
          </div>

          <div className="clusterCanvas liveGeoMap">
            <div className="geoGrid" />

            <div className="geoLegend">
              <span>
                <i className="legendDot live" />
                Live event
              </span>

              <span>
                <i className="legendDot selected" />
                Selected event
              </span>

              <span>
                <i className="legendDot connected" />
                Related event
              </span>
            </div>

            {/* CONNECTION LINES */}
            {activeEvent &&
              activeCluster &&
              activeCluster.events.length > 1 && (
                <svg
                  className="clusterLinks"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {activeCluster.events
                    .filter((event) => event.id !== activeEvent.id)
                    .map((event) => {
                      const start = point(activeEvent);
                      const end = point(event);

                      return (
                        <g key={`connection-${activeEvent.id}-${event.id}`}>
                          {/* Wide glow */}
                          <line
                            className="clusterLinkGlow"
                            x1={start.x}
                            y1={start.y}
                            x2={end.x}
                            y2={end.y}
                          />

                          {/* Main visible line */}
                          <line
                            className="clusterLinkLine"
                            x1={start.x}
                            y1={start.y}
                            x2={end.x}
                            y2={end.y}
                          />

                          {/* Endpoint marker */}
                          <circle
                            className="clusterLinkNode"
                            cx={end.x}
                            cy={end.y}
                            r="0.8"
                          />
                        </g>
                      );
                    })}
                </svg>
              )}

            {/* EVENTS */}
            {/* EVENTS */}
{validEvents.map((event) => {
  const position = point(event);
  const isSelected = activeEvent?.id === event.id;
  const connected = isConnectedEvent(event);

  return (
    <button
      key={event.id}
      className={`geoEvent ${
        isSelected ? 'isSelected' : ''
      } ${connected ? 'isConnected' : ''}`}
      style={
        {
          left: `${position.x}%`,
          top: `${position.y}%`,
          '--event-color': riskColor(eventRisk(event)),
        } as React.CSSProperties
      }
      onClick={() => selectEvent(event)}
      title={`${event.id} • ${eventClass(event)}`}
      aria-label={`${event.id} • ${eventClass(event)}`}
    >
      <span className="geoPulse" />
      <span className="geoDot" />

      {/* SHOW LABEL ONLY FOR SELECTED EVENT */}
      {isSelected && (
        <span className="geoLabel">
          {event.id}
        </span>
      )}
    </button>
  );
})}

            <span className="clusterLegend">
              <MapPin size={12} />
              Actual coordinates · {radiusKm} km grouping radius
            </span>
          </div>
        </div>

        {/* EVENT ANALYSIS */}
        <div className="clusterInsights cardSurface">
          <div className="cardTitle">
            <div>
              <span className="label">SELECTED EVENT ANALYSIS</span>

              <h3>
                {activeEvent
                  ? activeCluster && activeMembers.length > 1
                    ? 'Connected activity'
                    : 'Isolated event'
                  : 'No event selected'}
              </h3>
            </div>

            {activeEvent ? (
              <ShieldCheck size={18} />
            ) : (
              <AlertTriangle size={18} />
            )}
          </div>

          {activeEvent ? (
            <>
              {/* SELECTED EVENT IDENTITY */}
              <div className="selectedEventIdentity">
                <div className="selectedEventText">
                  <span className="eventId">{activeEvent.id}</span>
                  <strong>
                    {activeEvent.name || eventClass(activeEvent)}
                  </strong>
                </div>

                <span
                  className="riskBadge"
                  style={{
                    color: riskColor(eventRisk(activeEvent)),
                    borderColor: riskColor(eventRisk(activeEvent)),
                  }}
                >
                  {eventRisk(activeEvent)}
                </span>
              </div>

              {/* LOCATION */}
              <div className="coordinateReadout">
                <Target size={15} />

                <div>
                  <small>SELECTED LOCATION</small>

                  <strong>
                    {Number(activeEvent.lat).toFixed(4)}°,{' '}
                    {Number(activeEvent.lon).toFixed(4)}°
                  </strong>
                </div>
              </div>

              {/* STATS */}
              <div className="clusterStats">
                <div>
                  <small>RELATED EVENTS</small>
                  <b>{activeMembers.length}</b>
                </div>

                <div>
                  <small>GROUP RADIUS</small>

                  <b>
                    {activeCluster
                      ? `${activeCluster.geographicRadiusKm.toFixed(1)} km`
                      : '—'}
                  </b>
                </div>

                <div>
                  <small>TIME SPAN</small>

                  <b>
                    {activeCluster
                      ? formatDuration(activeCluster.timeSpanHours)
                      : '—'}
                  </b>
                </div>

                <div>
                  <small>AVG CONFIDENCE</small>

                  <b>
                    {activeCluster ? `${avgConfidence.toFixed(1)}%` : '—'}
                  </b>
                </div>
              </div>

              {/* CONNECTION EXPLANATION */}
              <div
                className={`clusterReason ${
                  activeCluster && activeMembers.length > 1
                    ? 'isConnectedReason'
                    : 'isIsolatedReason'
                }`}
              >
                {activeCluster && activeMembers.length > 1 ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )}

                <div>
                  <b>
                    {activeCluster && activeMembers.length > 1
                      ? 'Why these events are connected'
                      : 'Why this event is isolated'}
                  </b>

                  <span>
                    {activeCluster && activeMembers.length > 1
                      ? `${activeMembers.length} events fall within ${radiusKm} km and the selected time window.`
                      : `No other event falls within ${radiusKm} km and the selected time window.`}
                  </span>
                </div>
              </div>

              {/* CLASSIFICATION */}
              {activeCluster && activeMembers.length > 1 && (
                <div className="classificationDistribution">
                  <small>EVENT TYPES IN THIS GROUP</small>

                  {classes.map(([name, count]) => (
                    <div key={name} className="classificationRow">
                      <span>{name}</span>

                      <i>
                        <b
                          style={{
                            width: `${(count / maxClass) * 100}%`,
                          }}
                        />
                      </i>

                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>
              )}

              {/* NEAREST EVENTS */}
              <div className="nearbyReadout">
                <div className="nearbyHeader">
                  <span className="label">NEAREST REAL EVENTS</span>
                  <span>{connectedEvents.length} total</span>
                </div>

                {connectedEvents.slice(0, 8).map(({ event, distance }) => (
                  <button
                    type="button"
                    key={event.id}
                    className={`nearbyEvent ${
                      isConnectedEvent(event) ? 'nearbyConnected' : ''
                    }`}
                    onClick={() => selectEvent(event)}
                  >
                    <span
                      className="nearbyDot"
                      style={{
                        background: riskColor(eventRisk(event)),
                      }}
                    />

                    <span className="nearbyEventInfo">
                      <b>{event.id}</b>

                      <small>
                        {eventClass(event)}
                        {isConnectedEvent(event) ? ' · Connected' : ''}
                      </small>
                    </span>

                    <strong>{distance.toFixed(1)} km</strong>
                  </button>
                ))}

                {connectedEvents.length === 0 && (
                  <div className="emptyNearby">
                    No other real events available.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="emptyCluster">
              <AlertTriangle size={18} />
              <b>No valid live events found</b>
              <span>
                Select an event from the map to begin analysis.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM SELECTED CLUSTER */}
      <div className="selectedClusterPanel cardSurface">
        <div className="cardTitle">
          <div>
            <span className="label">SELECTED INVESTIGATION GROUP</span>

            <h3>
              {activeCluster
                ? activeCluster.events.length > 1
                  ? `${activeCluster.events.length} connected events`
                  : 'No connected cluster'
                : 'Select an event'}
            </h3>
          </div>

          <Network size={18} />
        </div>

        {activeCluster && activeCluster.events.length > 1 ? (
          <>
            <div className="selectedClusterEvents">
              {activeCluster.events.map((event: EventLike) => (
                <button
                  type="button"
                  key={event.id}
                  onClick={() => selectEvent(event)}
                  className={`clusterEventChip ${
                    activeEvent?.id === event.id ? 'selectedChip' : ''
                  }`}
                >
                  <span
                    className="chipDot"
                    style={{
                      background: riskColor(eventRisk(event)),
                    }}
                  />

                  <span className="chipEventId">{event.id}</span>

                  <span className="chipEventClass">
                    {eventClass(event)}
                  </span>
                </button>
              ))}
            </div>

            <div className="clusterExplanation">
              <Network size={16} />

              <span>
                These events are connected because they fall within the
                selected <strong>{radiusKm} km radius</strong> and{' '}
                <strong>{timeWindowLabel} time window</strong>.
              </span>
            </div>
          </>
        ) : (
          <div className="noClusterMessage">
            <MapPin size={16} />

            <span>
              This event currently has no nearby events within the selected
              grouping radius and time window.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}