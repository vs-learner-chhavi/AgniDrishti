'use client';

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock3, MapPin, Network, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';

type EventLike = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  cls: string;
  confidence: number;
  risk: string;
  brightness: number;
  persistence: number;
  detectedAt?: string;
  time?: string;
  frp?: number;
  nearbyFacilities?: number;
};

type Cluster = {
  id: string;
  events: EventLike[];
  center: { latitude: number; longitude: number };
  geographicRadiusKm: number;
  timeSpanHours: number;
  startTime?: string;
  endTime?: string;
  classificationDistribution: Record<string, number>;
  averageConfidence: number;
  averageFrp: number;
  nearbyFacilitiesCount: number;
  patternStatus: 'NORMAL DISTRIBUTION' | 'INCREASING ACTIVITY' | 'UNUSUAL CLUSTERING' | 'POTENTIAL ESCALATION';
};

type Props = { events: EventLike[]; selected: EventLike; onSelect?: (event: EventLike) => void };

const EARTH_RADIUS_KM = 6371;
const DEFAULT_RADIUS_KM = 25;
const DEFAULT_WINDOW_HOURS = 24;

function validEvent(event: EventLike) {
  const timestamp = event.detectedAt ? Date.parse(event.detectedAt) : NaN;
  return Number.isFinite(event.lat) && Number.isFinite(event.lon) && Math.abs(event.lat) <= 90 && Math.abs(event.lon) <= 180 && Number.isFinite(timestamp);
}

function distanceKm(a: EventLike, b: EventLike) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildClusters(events: EventLike[], radiusKm: number, windowHours: number): Cluster[] {
  const usable = events.filter(validEvent).filter((event, index, array) => array.findIndex(item => item.id === event.id) === index);
  const visited = new Set<string>();
  const clusters: Cluster[] = [];
  const windowMs = windowHours * 3600000;

  for (const seed of usable) {
    if (visited.has(seed.id)) continue;
    const queue = [seed];
    const members: EventLike[] = [];
    visited.add(seed.id);

    while (queue.length) {
      const current = queue.shift()!;
      members.push(current);
      const currentTime = Date.parse(current.detectedAt!);
      for (const candidate of usable) {
        if (visited.has(candidate.id)) continue;
        const candidateTime = Date.parse(candidate.detectedAt!);
        if (distanceKm(current, candidate) <= radiusKm && Math.abs(currentTime - candidateTime) <= windowMs) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    const lat = members.reduce((sum, event) => sum + event.lat, 0) / members.length;
    const lon = members.reduce((sum, event) => sum + event.lon, 0) / members.length;
    const timestamps = members.map(event => Date.parse(event.detectedAt!)).sort((a, b) => a - b);
    const distribution: Record<string, number> = {};
    members.forEach(event => { distribution[event.cls || 'Unknown'] = (distribution[event.cls || 'Unknown'] || 0) + 1; });
    const confidenceValues = members.map(event => event.confidence).filter(Number.isFinite);
    const frpValues = members.map(event => event.frp).filter((value): value is number => Number.isFinite(value));
    const facilityIds = new Set(members.flatMap(event => Array.from({ length: Math.max(0, Math.round(event.nearbyFacilities || 0)) }, (_, i) => `${event.id}-facility-${i}`)));
    const geographicRadiusKm = Math.max(...members.map(event => distanceKm({ ...event, lat, lon }, event)));
    const timeSpanHours = (timestamps[timestamps.length - 1] - timestamps[0]) / 3600000;
    const recentCutoff = timestamps[0] + (timestamps[timestamps.length - 1] - timestamps[0]) * 0.6;
    const recentCount = timestamps.filter(time => time >= recentCutoff).length;
    const earlierCount = timestamps.length - recentCount;
    const highRisk = members.filter(event => ['HIGH', 'CRITICAL'].includes(event.risk.toUpperCase())).length;
    const highFrp = frpValues.length > 0 && frpValues.reduce((sum, value) => sum + value, 0) / frpValues.length >= 50;
    const patternStatus = highRisk >= Math.max(2, Math.ceil(members.length * 0.4)) && (recentCount > earlierCount || highFrp)
      ? 'POTENTIAL ESCALATION'
      : recentCount > earlierCount * 1.5 && recentCount >= 3
        ? 'INCREASING ACTIVITY'
        : members.length >= 4 && geographicRadiusKm <= radiusKm * 0.5 && timeSpanHours <= windowHours * 0.5
          ? 'UNUSUAL CLUSTERING'
          : 'NORMAL DISTRIBUTION';

    clusters.push({
      id: `cluster-${clusters.length + 1}`,
      events: members,
      center: { latitude: lat, longitude: lon },
      geographicRadiusKm,
      timeSpanHours,
      startTime: new Date(timestamps[0]).toISOString(),
      endTime: new Date(timestamps[timestamps.length - 1]).toISOString(),
      classificationDistribution: distribution,
      averageConfidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0,
      averageFrp: frpValues.length ? frpValues.reduce((sum, value) => sum + value, 0) / frpValues.length : 0,
      nearbyFacilitiesCount: facilityIds.size,
      patternStatus,
    });
  }
  return clusters.sort((a, b) => b.events.length - a.events.length);
}

function formatDuration(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)} hours`;
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
}

export default function CrossEventIntelligence({ events, selected, onSelect }: Props) {
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [windowHours, setWindowHours] = useState(DEFAULT_WINDOW_HOURS);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);

  const clusters = useMemo(() => buildClusters(events, radiusKm, windowHours), [events, radiusKm, windowHours]);
  const activeCluster = clusters.find(cluster => cluster.id === selectedClusterId) || clusters.find(cluster => cluster.events.some(event => event.id === selected.id)) || clusters[0];
  const clusterEvents = activeCluster?.events || [selected];
  const related = clusterEvents.filter(event => event.id !== selected.id).map(event => ({ event, distance: distanceKm(selected, event) })).sort((a, b) => a.distance - b.distance);
  const classes = Object.entries(activeCluster?.classificationDistribution || {});
  const maxClassCount = Math.max(1, ...classes.map(([, count]) => count));

  function chooseCluster(cluster: Cluster) {
    setSelectedClusterId(cluster.id);
    onSelect?.(cluster.events[0]);
  }

  return <section className="crossEventWorkspace">
    <div className="crossEventToolbar">
      <div><span className="label">SPATIAL-TEMPORAL INTELLIGENCE</span><h2>Connect the signals.</h2><p>Clusters are calculated from the live event dataset using geographic distance and detection time.</p></div>
      <div className="crossEventControls"><label>Radius <input type="number" min={1} max={100} value={radiusKm} onChange={event => setRadiusKm(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /> km</label><label>Window <select value={windowHours} onChange={event => setWindowHours(Number(event.target.value))}><option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option></select></label><button className="ghost" onClick={() => { setRadiusKm(DEFAULT_RADIUS_KM); setWindowHours(DEFAULT_WINDOW_HOURS); }}><RefreshCw size={14}/> Reset</button></div>
    </div>
    <div className="crossEventStats"><span>{events.length} live events</span><span>{clusters.length} clusters</span><span>{activeCluster ? `Largest: ${activeCluster.events.length} events` : 'No clusters'}</span></div>
    <div className="crossEventGrid">
      <div className="crossEventMap cardSurface"><div className="cardTitle"><div><span className="label">CLUSTER MAP</span><h3>{activeCluster ? `${activeCluster.events.length} connected events` : 'No valid event clusters'}</h3></div><Network size={18}/></div><div className="clusterCanvas"><div className="clusterHalo"/><div className="clusterCentre"><Activity size={18}/><b>{activeCluster?.id || '—'}</b><small>SELECTED CLUSTER</small></div>{related.map(({ event, distance }, index) => { const angle = index / Math.max(1, related.length) * Math.PI * 2 - Math.PI / 2; const spread = Math.min(42, 18 + distance * 1.2); return <button key={event.id} className="clusterNode" style={{ left: `${50 + Math.cos(angle) * spread}%`, top: `${50 + Math.sin(angle) * spread}%` }} onClick={() => onSelect?.(event)}><span className={`dot ${event.risk.toLowerCase()}`}/><b>{event.id}</b></button>; })}{related.map(({ event, distance }, index) => <span key={`line-${event.id}`} className="clusterLine" style={{ transform: `rotate(${index / Math.max(1, related.length) * 360 - 90}deg)`, height: `${Math.min(42, 18 + distance * 1.2)}%` }}/>) }<span className="clusterLegend"><MapPin size={12}/> {radiusKm} km radius · {formatDuration(windowHours)}</span></div></div>
      <div className="clusterInsights cardSurface"><div className="cardTitle"><div><span className="label">CLUSTER SUMMARY</span><h3>{activeCluster?.patternStatus || 'NO DATA'}</h3></div>{activeCluster && <span className="pill high">{activeCluster.patternStatus}</span>}</div>{activeCluster ? <><div className="clusterStats"><div><small>EVENT COUNT</small><b>{activeCluster.events.length}</b></div><div><small>GEOGRAPHIC RADIUS</small><b>{activeCluster.geographicRadiusKm.toFixed(1)} km</b></div><div><small>TIME SPAN</small><b>{formatDuration(activeCluster.timeSpanHours)}</b></div><div><small>AVG CONFIDENCE</small><b>{activeCluster.averageConfidence.toFixed(1)}%</b></div><div><small>AVG FRP</small><b>{activeCluster.averageFrp.toFixed(1)} MW</b></div><div><small>NEARBY FACILITIES</small><b>{activeCluster.nearbyFacilitiesCount}</b></div></div><div className="classificationDistribution"><small>CLASSIFICATION DISTRIBUTION</small>{classes.map(([name, count]) => <div key={name} className="classificationRow"><span>{name}</span><i><b style={{ width: `${count / maxClassCount * 100}%` }}/></i><strong>{count}</strong></div>)}</div><div className="clusterReason"><ShieldCheck size={15}/><div><b>Pattern explanation</b><span>{activeCluster.patternStatus === 'POTENTIAL ESCALATION' ? 'Recent activity is increasing alongside elevated risk indicators.' : activeCluster.patternStatus === 'INCREASING ACTIVITY' ? 'More events are occurring in the recent part of the cluster time span.' : activeCluster.patternStatus === 'UNUSUAL CLUSTERING' ? 'Several events are concentrated in a small area and time window.' : 'No abnormal increase or concentration rule was triggered.'}</span></div></div></> : <div className="emptyCluster"><AlertTriangle size={18}/><b>No valid live events found</b><span>Clusters will appear when events contain valid coordinates and timestamps.</span></div>}</div>
    </div>
    <div className="crossEventBottom"><div className="eventList cardSurface"><div className="cardTitle"><div><span className="label">DETECTED CLUSTERS</span><h3>Investigation groups</h3></div><TrendingUp size={17}/></div>{clusters.length ? clusters.map(cluster => <button key={cluster.id} className="relatedEvent" onClick={() => chooseCluster(cluster)}><span className={`dot ${cluster.patternStatus === 'POTENTIAL ESCALATION' ? 'critical' : cluster.patternStatus === 'INCREASING ACTIVITY' ? 'high' : 'moderate'}`}/><span><b>{cluster.id}</b><small>{cluster.events.length} events · {formatDuration(cluster.timeSpanHours)}</small></span><strong>{cluster.geographicRadiusKm.toFixed(1)} km</strong></button>) : <div className="emptyCluster"><AlertTriangle size={18}/><b>No clusters found</b><span>Adjust the radius or time window, or wait for more live events.</span></div>}</div><div className="patternCard cardSurface"><div className="cardTitle"><div><span className="label">EMERGING PATTERN</span><h3>Regional change signal</h3></div><Clock3 size={17}/></div><div className="patternRow"><span className="patternIcon"><Activity size={16}/></span><div><b>{activeCluster?.patternStatus || 'NORMAL DISTRIBUTION'}</b><span>{activeCluster ? `${activeCluster.events.length} events connected within ${radiusKm} km and ${windowHours} hours.` : 'No valid cluster is currently available.'}</span></div></div></div></div>
  </section>;
}
