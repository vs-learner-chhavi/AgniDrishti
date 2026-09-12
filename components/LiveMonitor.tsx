'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, Flame, Layers3, MapPin, RefreshCw, Satellite, Search, ShieldCheck, Sparkles, Target } from 'lucide-react';
import LiveMap, { type MapLayers, type MapMode, type ThermalSignal, type FacilityPoint } from './LiveMap';

type Factor = { feature: string; value?: number; shap_value?: number; contribution?: number };
export type MonitorEvent = {
  id: string; name: string; lat: number; lon: number; cls: string; confidence: number;
  risk: string; brightness: number; persistence: number; distance: number; time: string;
  detectedAt?: string; source?: string; landCover?: string; frp?: number; firmsConfidence?: number;
  persistenceDays?: number; persistenceObservations?: number; persistenceWindow?: number;
  facilities?: { name: string; type: string; distanceKm: number; lat: number; lon: number }[];
  explanations?: { feature: string; contribution: number }[];
};
type Context = { facilities: FacilityPoint[]; unavailable: string[] };
type Analysis = { features: Record<string, number>; explanation: { all_contributions: Factor[] } };
const layersInitial: MapLayers = { facilities: true, imagery: false, labels: true, halos: false };
const demoDays: Record<string, number> = { 'TG-1042': 18, 'TG-1037': 24, 'TG-1028': 7, 'TG-1019': 4 };
const emptyContext: Context = { facilities: [], unavailable: [] };

function fromSignal(s: ThermalSignal): MonitorEvent {
  return { id: s.id, name: 'NASA FIRMS archived detection', lat: s.latitude, lon: s.longitude,
    cls: 'Unclassified thermal anomaly', confidence: 0, risk: 'UNASSESSED', brightness: s.brightness,
    persistence: s.persistenceScore, persistenceDays: s.persistenceDays, persistenceWindow: 30,
    persistenceObservations: s.persistenceObservations, distance: 99, time: `${s.time.slice(0, 2)}:${s.time.slice(2)} UTC`,
    detectedAt: `${s.date}T${s.time.slice(0, 2)}:${s.time.slice(2)}:00Z`, source: 'NASA_ARCHIVE',
    frp: s.frp, firmsConfidence: s.confidence, landCover: 'unknown' };
}
function factorText(f: Factor): string {
  if (f.feature === 'persistent_activity') return f.value === 1 ? 'Frequent-activity threshold reached' : 'Below the frequent-activity threshold';
  if (f.feature === 'active_days_30d') return `Activity on ${f.value} of the previous 30 days`;
  if (f.feature === 'active_days_7d') return `Activity on ${f.value} of the previous 7 days`;
  return `${f.feature.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())}${f.value === undefined ? '' : `: ${Number(f.value.toFixed(3))}`}`;
}

export default function LiveMonitor({ demoEvents, onReview, onAlert, queuedIds }: { demoEvents: MonitorEvent[]; onReview: (event: MonitorEvent) => void; onAlert: (event: MonitorEvent) => void; queuedIds: string[] }) {
  const [signals, setSignals] = useState<ThermalSignal[]>([]);
  const [archiveTo, setArchiveTo] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<MapMode>('detections');
  const [windowDays, setWindowDays] = useState(7);
  const [showDemo, setShowDemo] = useState(false);
  const [priority, setPriority] = useState(false);
  const [query, setQuery] = useState('');
  const [layers, setLayers] = useState(layersInitial);
  const [layersOpen, setLayersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [updates, setUpdates] = useState<Record<string, MonitorEvent>>({});
  const [contexts, setContexts] = useState<Record<string, Context>>({});
  const [contextLoading, setContextLoading] = useState('');
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [technical, setTechnical] = useState(false);
  const analysisController = useRef<AbortController | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const demos = useMemo(() => demoEvents.map(e => ({ ...e, source: 'DEMO', persistenceDays: demoDays[e.id] ?? e.persistenceDays, persistenceWindow: 30 })), [demoEvents]);
  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    setLoading(true); setError('');
    try {
      const r = await fetch('/data/firms-recent.json', { cache: 'no-store', signal: controller.signal });
      if (!r.ok) throw new Error('FIRMS archive could not be loaded.');
      const data = await r.json();
      const valid = (data.observations || []).filter((s: ThermalSignal) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && Number.isFinite(s.brightness) && /^\d{4}-\d{2}-\d{2}$/.test(s.date));
      setSignals(valid); setArchiveTo(data.to || ''); setTotal(data.totalRecentObservations || valid.length);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Archive unavailable.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { refreshController.current?.abort(); analysisController.current?.abort(); }; }, [refresh]);
  const filteredSignals = useMemo(() => {
    if (!signals.length) return [];
    const latest = archiveTo || signals.reduce((date, s) => s.date > date ? s.date : date, '');
    const cutoff = new Date(`${latest}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - windowDays + 1);
    return signals.filter(s => s.date >= cutoff.toISOString().slice(0, 10) && s.date <= latest);
  }, [signals, archiveTo, windowDays]);
  const realEvents = useMemo(() => filteredSignals.map(s => updates[s.id] || fromSignal(s)), [filteredSignals, updates]);
  const matches = useCallback((e: MonitorEvent) => (!priority || e.brightness >= 340 || (e.frp ?? 0) >= 35 || ['HIGH', 'CRITICAL'].includes(e.risk)) &&
    (!query || `${e.id} ${e.name} ${e.cls} ${e.lat} ${e.lon}`.toLowerCase().includes(query.toLowerCase())), [priority, query]);
  const realVisible = useMemo(() => realEvents.filter(matches).sort((a, b) => (b.frp || 0) - (a.frp || 0)), [realEvents, matches]);
  const mapEvents = useMemo(() => [...realVisible.slice(0, 400), ...(showDemo ? demos.filter(matches) : [])], [realVisible, showDemo, demos, matches]);
  const density = useMemo(() => {
    const ids = new Set(realVisible.map(e => e.id)); return filteredSignals.filter(s => ids.has(s.id));
  }, [filteredSignals, realVisible]);
  // Filters cannot leave stale off-map evidence in the sidebar.
  const selected = mapEvents.find(e => e.id === selectedId) || mapEvents[0];
  const id = selected?.id || '';
  const selectedLat = selected?.lat, selectedLon = selected?.lon;
  useEffect(() => {
    if (!id || selectedLat === undefined || selectedLon === undefined || contexts[id]) return;
    const controller = new AbortController(); setContextLoading(id);
    fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: selectedLat, longitude: selectedLon }), signal: controller.signal })
      .then(async r => { const d = await r.json(); if (!r.ok || !d.ok) throw new Error(d.error); return d.context as Context; })
      .then(context => setContexts(previous => ({ ...previous, [id]: context })))
      .catch(() => { if (!controller.signal.aborted) setContexts(previous => ({ ...previous, [id]: { facilities: [], unavailable: ['industrial', 'gas', 'mining'] } })); })
      .finally(() => { if (!controller.signal.aborted) setContextLoading(''); });
    return () => controller.abort();
  }, [id, selectedLat, selectedLon, contexts]);
  const context = contexts[id] || emptyContext;
  const analysis = analyses[id];
  const days = analysis?.features.active_days_30d ?? selected?.persistenceDays;
  const isDemo = selected?.source === 'DEMO';
  const select = useCallback((value: string) => { setSelectedId(value); setTechnical(false); setError(''); }, []);
  async function analyze() {
    if (!selected || isDemo) return;
    const event = selected;
    analysisController.current?.abort(); const controller = new AbortController(); analysisController.current = controller;
    setAnalyzing(true); setError('');
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: event.lat, longitude: event.lon, detectedAt: event.detectedAt }), signal: controller.signal });
      const data = await r.json(); if (!r.ok || !data.ok) throw new Error(data.error || 'Analysis unavailable.');
      const result = data.event.result;
      const updated: MonitorEvent = { ...event, cls: result.classification, confidence: result.confidence, risk: result.risk,
        firmsConfidence: data.event.hotspot.confidence, persistence: data.event.persistence.score, persistenceDays: data.event.persistence.activeDays,
        distance: data.event.industrialDistanceKm ?? 99,
        explanations: result.explanations.map((f: Factor) => ({ feature: f.feature, contribution: f.shap_value ?? f.contribution ?? 0 })),
        facilities: data.event.facilities.map((f: FacilityPoint) => ({ name: f.name, type: f.type, distanceKm: f.distanceKm, lat: f.latitude, lon: f.longitude })) };
      setUpdates(previous => ({ ...previous, [event.id]: updated }));
      setAnalyses(previous => ({ ...previous, [event.id]: data.analysis }));
      setContexts(previous => ({ ...previous, [event.id]: data.analysis.context }));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Analysis unavailable.'); }
    finally { if (!controller.signal.aborted) setAnalyzing(false); }
  }
  return <section id="monitor" className="section sectionBlock restoredMonitor">
    <div className="sectionHeading"><div><span className="eyebrow">01 · LIVE MONITOR</span><h2>See the heat. Follow the signal.</h2><p>Explore archived FIRMS observations, then inspect the evidence behind one detection.</p></div>
      <button className="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} />{loading ? 'Loading archive…' : 'Refresh data'}</button></div>
    <div className="monitorArchiveNote">NASA FIRMS archive · Through {archiveTo || '…'} · Historical observations, not a current-fire feed. Demo examples are separate.</div>
    <div className="monitorGrid"><div className="mapShell">
      <div className="mapHeader"><div><span className="label">INDIA · THERMAL ACTIVITY</span><b>{realVisible.length.toLocaleString()} archive observations in this view</b></div>
        <div className="monitorControls"><div className="monitorModes" aria-label="Map view">{(['detections', 'density'] as const).map(value => <button key={value} aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{value === 'detections' ? 'Hotspots' : 'Thermal density'}</button>)}</div>
          <button className="ghost" aria-expanded={layersOpen} onClick={() => setLayersOpen(v => !v)}><Layers3 size={14} />Layers</button></div></div>
      <div className="monitorTimeRail"><span>ARCHIVE WINDOW</span>{[1, 7, 30].map(n => <button key={n} aria-pressed={windowDays === n} className={windowDays === n ? 'active' : ''} onClick={() => setWindowDays(n)}>{n === 1 ? 'Final 24h' : `Final ${n} days`}</button>)}<small>Ends {archiveTo || 'at latest archive day'} UTC</small></div>
      <div className="monitorFilterRail"><label><Search size={14} /><input aria-label="Search map detections" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search detections or coordinates" /></label>
        <button aria-pressed={showDemo} onClick={() => setShowDemo(v => !v)}><Sparkles size={13} />{showDemo ? 'Hide demos' : 'Show demos'}</button>
        <button aria-pressed={priority} onClick={() => setPriority(v => !v)}><Target size={13} />{priority ? 'Show all' : 'Priority signals'}</button></div>
      <div className="mapStage"><LiveMap events={mapEvents.map(e => ({ id: e.id, latitude: e.lat, longitude: e.lon, classification: e.cls, confidence: e.confidence, risk: e.risk, brightness: e.brightness, persistence: e.persistence }))}
        densityEvents={density} facilities={context.facilities} selectedId={id} onSelect={select} mode={mode} layers={layers} />
        {layersOpen && <div className="monitorLayers"><b>MAP LAYERS</b><label><input type="checkbox" checked={layers.facilities} onChange={e => setLayers(v => ({ ...v, facilities: e.target.checked }))} />Nearby mapped facilities</label><small>{contextLoading === id ? 'Looking up the selected location…' : `${context.facilities.length} mapped features available for this location`}</small><label><input type="checkbox" checked={layers.imagery} onChange={e => setLayers(v => ({ ...v, imagery: e.target.checked }))} />Satellite basemap</label><small>Geographic context, not dated imagery or evidence of an active fire.</small></div>}
        <div className="monitorLegend">{mode === 'density' ? <><span>Relative thermal density</span><i /><small>Lower → Higher</small></> : <span>Grey: unclassified archive detections · Colour: model results / labelled demos</span>}</div>
      </div>
      <p className="monitorFootnote">{Math.min(400, realVisible.length)} selectable archive points{realVisible.length > 400 ? ' (highest FRP)' : ''}; density uses all {density.length} filtered observations. The display archive is a sample of {total.toLocaleString()} observations. Demos do not contribute to density.{priority && ' Priority filter: ≥340 K, ≥35 MW or a high/critical demo flag; this is not a model risk assessment.'}</p>
      <details className="monitorDetectionList"><summary>Browse visible detections ({mapEvents.length})</summary><div>{mapEvents.map(e => <button key={e.id} onClick={() => select(e.id)} aria-pressed={id === e.id}><span>{e.source === 'DEMO' ? 'Demo' : 'Archive'} · {e.id}</span><small>{e.lat.toFixed(3)}, {e.lon.toFixed(3)} · {e.brightness.toFixed(1)} K</small></button>)}</div></details>
    </div>
    <aside className="selectedPanel">{!selected ? <div className="monitorEmpty"><h3>{loading ? 'Loading observations…' : 'No matching detections'}</h3><p>Choose another archive window, clear the filters, or enable the fixed demo examples.</p></div> : <>
      <div className="selectedTop"><div><span className="label">{isDemo ? 'FIXED DEMO EXAMPLE' : 'SELECTED ARCHIVE DETECTION'}</span><h3>{selected.id}</h3></div></div>
      <div className="selectedPlace"><MapPin size={15} /><span>{selected.name}<small>{selected.lat.toFixed(5)}, {selected.lon.toFixed(5)} · {selected.detectedAt?.slice(0, 10) || 'Illustrative scenario'}</small></span></div>
      <div className="classification"><div><span>{isDemo ? 'ILLUSTRATIVE CLASSIFICATION' : analysis ? 'THERMAL/HISTORY PREDICTION' : 'CLASSIFICATION STATUS'}</span><b>{selected.confidence ? selected.cls : 'Awaiting model analysis'}</b><small>{isDemo ? 'Fixed example, not an observed current fire' : analysis ? 'Location context does not verify the predicted source' : 'Real FIRMS detection; source not yet classified'}</small></div>{selected.confidence > 0 && <strong>{selected.confidence.toFixed(1)}%<small>{isDemo ? 'demo score' : 'model probability'}</small></strong>}</div>
      <div className="monitorSignals">
        <div><Flame size={16} /><small>Thermal intensity</small><b>{selected.brightness.toFixed(1)} K</b></div>
        <div><Activity size={16} /><small>Persistence</small><b>{days === undefined ? 'Unavailable' : `${days} of 30 days`}</b></div>
        <div><ShieldCheck size={16} /><small>FIRMS confidence</small><b>{selected.firmsConfidence === undefined ? 'Unavailable' : `${selected.firmsConfidence}%`}</b></div>
        <div><Flame size={16} /><small>Radiative power</small><b>{selected.frp === undefined ? 'Unavailable' : `${selected.frp.toFixed(1)} MW`}</b></div>
      </div>
      <p className="monitorFootnote">{isDemo ? 'Persistence is part of the fixed demo scenario.' : analysis ? 'Model persistence counts prior calendar days, excluding the observation day.' : `Snapshot recurrence across the archive window ending ${archiveTo}. Model analysis recalculates the prior-window evidence from the saved feature table.`}</p>
      <div className="monitorEvidence"><h4>{analysis || isDemo ? 'Why this classification?' : 'Evidence to inspect'}</h4>
        {analysis ? <ul>{analysis.explanation.all_contributions.slice(0, 3).map(f => <li key={f.feature}><b>{factorText(f)}</b><small>{(f.shap_value || 0) > 0 ? 'Increases' : 'Decreases'} the model’s score for this class; a learned association.</small></li>)}</ul> : <ul>
          <li>{isDemo ? `${selected.landCover ? selected.landCover.charAt(0).toUpperCase() + selected.landCover.slice(1) : 'Illustrative'} land context in this demo` : 'Source classification requires model analysis and context review'}</li>
          <li>Thermal signal measured at {selected.brightness.toFixed(1)} K</li>
          <li>{days === undefined ? 'Recurrence history unavailable' : `Detections on ${days} of 30 days in ${isDemo ? 'the demo scenario' : 'the archive snapshot'}`}</li>
        </ul>}
        <button className="monitorTechnical" aria-expanded={technical} onClick={() => setTechnical(v => !v)}>View technical evidence <ChevronDown size={14} /></button>
        {technical && <div className="monitorTechnicalBody">{analysis ? <><p>SHAP values are score contributions, not percentages.</p><table><thead><tr><th>Feature</th><th>Value</th><th>SHAP</th></tr></thead><tbody>{analysis.explanation.all_contributions.map(f => <tr key={f.feature}><td>{f.feature}</td><td>{f.value?.toFixed(3)}</td><td>{f.shap_value?.toFixed(3)}</td></tr>)}</tbody></table></> : <p>{isDemo ? 'This example has no model-generated SHAP explanation.' : 'Run model analysis to view actual inputs and SHAP contributions.'}<br />Observation: {selected.detectedAt || 'Demo'}<br />Snapshot observations near this point: {selected.persistenceObservations ?? 'Unavailable'}</p>}</div>}
      </div>
      <div className="monitorContext"><h4>Nearby mapped infrastructure</h4><p>{contextLoading === id ? 'Searching the OSM snapshots…' : context.facilities[0] ? `${context.facilities[0].name} · ${context.facilities[0].distanceKm.toFixed(2)} km` : context.unavailable.length ? 'Infrastructure lookup unavailable for one or more categories.' : 'No mapped features found within 10 km.'}</p><small>Snapshot coverage is incomplete; absence of a record is not proof of absence.</small></div>
      <div className="monitorActions"><button className="ghost" onClick={() => setLayers(v => ({ ...v, imagery: !v.imagery }))}><Satellite size={14} />{layers.imagery ? 'Street map' : 'Inspect imagery'}</button>
        {!isDemo && <button className="primary" onClick={analyze} disabled={analyzing}>{analyzing ? 'Analyzing…' : analysis ? 'Refresh analysis' : 'Run model analysis'}</button>}
        <button className="ghost" onClick={() => onReview({ ...selected, facilities: context.facilities.map(f => ({ name: f.name, type: f.type, distanceKm: f.distanceKm, lat: f.latitude, lon: f.longitude })) })}>Review in Intelligence →</button></div>
      <button className="primary full" disabled={queuedIds.includes(id)} onClick={() => onAlert(selected)}>{queuedIds.includes(id) ? 'Review alert queued' : 'Create review alert'}</button>
      <p className="monitorFootnote">Archive/demo alerts enter the local review queue, not the live incident database.</p>
    </>}</aside></div>
    {error && <p className="monitorError" role="alert">{error}</p>}
  </section>;
}
