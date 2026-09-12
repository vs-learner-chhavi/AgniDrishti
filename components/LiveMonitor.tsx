'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, Building2, Clock3, Gauge, Activity, ChevronDown, Flame, Layers3, MapPin, RefreshCw, Satellite, Search, ShieldCheck, Sparkles, Target } from 'lucide-react';
import LiveMap, { type MapLayers, type MapMode, type ThermalSignal, type FacilityPoint } from './LiveMap';

type Factor = { feature: string; value?: number; shap_value?: number; contribution?: number };
export type MonitorEvent = {
  id: string; name: string; lat: number; lon: number; cls: string; confidence: number;
  risk: string; brightness: number; persistence: number; distance: number; time: string;
  modelPrediction?: ThermalSignal['modelPrediction']; datasetLabel?: ThermalSignal['datasetLabel']; detectedAt?: string; source?: string; landCover?: string; frp?: number; firmsConfidence?: number;
  persistenceDays?: number; persistenceObservations?: number; persistenceWindow?: number;
  facilities?: { name: string; type: string; distanceKm: number; lat: number; lon: number }[];
  explanations?: { feature: string; contribution: number }[];
};
type Context = { facilities: FacilityPoint[]; unavailable: string[] };
type Analysis = { features: Record<string, number>; explanation: { all_contributions: Factor[] } };
const layersInitial: MapLayers = { facilities: true, imagery: false, labels: true, halos: true };
const originalDemos: MonitorEvent[]=[
{id:'TG-1042',name:'Industrial cluster · Gujarat',lat:22.31,lon:72.61,cls:'Industrial Fire',confidence:91,risk:'CRITICAL',brightness:342,persistence:88,persistenceDays:18,persistenceObservations:42,persistenceWindow:30,distance:.7,time:'14:32 IST',source:'DEMO',landCover:'industrial'},
{id:'TG-1037',name:'Gas infrastructure · Rajasthan',lat:27.17,lon:73.21,cls:'Gas Flare',confidence:96,risk:'HIGH',brightness:329,persistence:97,persistenceDays:24,persistenceObservations:61,persistenceWindow:30,distance:1.1,time:'13:58 IST',source:'DEMO',landCover:'industrial'},
{id:'TG-1028',name:'Agricultural belt · Haryana',lat:29.06,lon:76.08,cls:'Crop Burning',confidence:86,risk:'MODERATE',brightness:318,persistence:43,persistenceDays:7,persistenceObservations:11,persistenceWindow:30,distance:18.4,time:'13:41 IST',source:'DEMO',landCover:'cropland'},
{id:'TG-1019',name:'Forest edge · Odisha',lat:20.26,lon:84.27,cls:'Wildfire',confidence:84,risk:'HIGH',brightness:337,persistence:29,persistenceDays:4,persistenceObservations:6,persistenceWindow:30,distance:31.2,time:'12:47 IST',source:'DEMO',landCover:'forest'}];

const demoDays: Record<string, number> = { 'TG-1042': 18, 'TG-1037': 24, 'TG-1028': 7, 'TG-1019': 4 };
const emptyContext: Context = { facilities: [], unavailable: [] };

const datasetClasses: Record<string,string> = {industrial_fire:'Industrial Fire',gas_flare:'Gas Flare',wildfire:'Wildfire',mining_thermal_source:'Mining thermal source',agricultural_burning:'Crop Burning'};
function fromSignal(s: ThermalSignal): MonitorEvent {
  return { id: s.id, name: 'NASA FIRMS archived detection', lat: s.latitude, lon: s.longitude,
    cls: datasetClasses[s.modelPrediction?.fire_type || ''] || 'Unclassified thermal anomaly', modelPrediction:s.modelPrediction, datasetLabel: s.datasetLabel, confidence: (s.modelPrediction?.confidence ?? 0)*100, risk: s.frp >= 80 || s.brightness >= 355 ? 'CRITICAL' : s.frp >= 35 || s.brightness >= 340 ? 'HIGH' : 'MODERATE', brightness: s.brightness,
    persistence: s.persistenceScore, persistenceDays: s.modelPrediction?.activeDays30d ?? s.datasetLabel?.activeDays30d ?? s.persistenceDays, persistenceWindow: 30,
    persistenceObservations: s.modelPrediction?.observations30d ?? s.datasetLabel?.observations30d ?? s.persistenceObservations, distance: 99, time: `${s.time.slice(0, 2)}:${s.time.slice(2)} UTC`,
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
  const [modelSha,setModelSha]=useState('');
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
  const demos = useMemo(() => originalDemos.map(e => ({ ...e, source: 'DEMO', persistenceDays: demoDays[e.id] ?? e.persistenceDays, persistenceWindow: 30 })), [demoEvents]);
  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    setLoading(true); setError('');
    try {
      const r = await fetch('/data/firms-recent.json', { cache: 'no-store', signal: controller.signal });
      if (!r.ok) throw new Error('FIRMS archive could not be loaded.');
      const raw = await r.text();
      const data = JSON.parse(raw);
      let predictions: Record<string, ThermalSignal['modelPrediction']> = {};
      try {
        const response=await fetch('/data/firms-predictions.json',{cache:'no-store',signal:controller.signal});
        if(!response.ok) throw new Error('Saved predictions unavailable; observations remain unclassified.');
        const cache=await response.json();
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
        const sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        if(cache.archiveSha!==sha) throw new Error('Saved predictions do not match this archive. Regenerate predictions.');
        predictions=cache.results;setModelSha(cache.modelSha);
      } catch(e) { if(controller.signal.aborted) throw e; setModelSha('');setError(e instanceof Error?e.message:'Predictions unavailable'); }

      const valid = (data.observations || []).filter((s: ThermalSignal) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && Number.isFinite(s.brightness) && /^\d{4}-\d{2}-\d{2}$/.test(s.date));
      setSignals(valid.map((s:ThermalSignal)=>({...s,modelPrediction:predictions[s.id]}))); setArchiveTo(data.to || ''); setTotal(data.totalRecentObservations || valid.length);
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
  const selectedEvent = mapEvents.find(e => e.id === selectedId) || mapEvents[0];
  const selected = selectedEvent || demos[0];
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
  const analysis = analyses[id] || (selected.modelPrediction?.factors ? {features:{active_days_30d:selected.modelPrediction.activeDays30d??0},explanation:{all_contributions:selected.modelPrediction.factors}} : undefined);
  const days = analysis?.features.active_days_30d ?? selected?.persistenceDays;
  const isDemo = selected?.source === 'DEMO';
  const hasDatasetClass = !!datasetClasses[selected.datasetLabel?.fireType || ''];
  const hasClassification = selected.confidence > 0;
  const select = useCallback((value: string) => { setSelectedId(value); setTechnical(false); setError(''); }, []);
  async function analyze() {
    if (!selected || isDemo) return;
    const event = selected;
    analysisController.current?.abort(); const controller = new AbortController(); analysisController.current = controller;
    setAnalyzing(true); setError('');
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: event.lat, longitude: event.lon, detectedAt: event.detectedAt }), signal: controller.signal });
      const raw = await r.text();
      const data = JSON.parse(raw);
      let predictions: Record<string, ThermalSignal['modelPrediction']> = {};
      try {
        const response=await fetch('/data/firms-predictions.json',{cache:'no-store',signal:controller.signal});
        if(!response.ok) throw new Error('Saved predictions unavailable; observations remain unclassified.');
        const cache=await response.json();
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
        const sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        if(cache.archiveSha!==sha) throw new Error('Saved predictions do not match this archive. Regenerate predictions.');
        predictions=cache.results;setModelSha(cache.modelSha);
      } catch(e) { if(controller.signal.aborted) throw e; setModelSha('');setError(e instanceof Error?e.message:'Predictions unavailable'); }
 if (!r.ok || !data.ok) throw new Error(data.error || 'Analysis unavailable.');
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
   <SectionHeading kicker="01 · LIVE MONITOR" title="See the heat. Follow the signal." text="Move from national thermal activity to one explainable, actionable event." action={<button className="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14}/> {loading?'Syncing':'Refresh data'}</button>}/>
   <div className="monitorGrid">
    <div className="mapShell">
     <div className="mapHeader">
      <div><span className="label">INDIA · THERMAL ACTIVITY</span><b><span className="greenDot"/> NASA FIRMS ARCHIVE · {density.length.toLocaleString('en-IN')} OBSERVATIONS{archiveTo?` · THROUGH ${archiveTo}`:''}</b></div>
      <div className="mapControls">
       <div className="modeSwitch" aria-label="Map view"><button className={mode==='detections'?'active':''} onClick={()=>setMode('detections')}>Detections</button><button className={mode==='density'?'active':''} onClick={()=>setMode('density')}>Density</button></div>
       <div className="mapTools"><button className={layersOpen?'active':''} onClick={()=>setLayersOpen(v=>!v)}><Layers3 size={14}/> Layers</button><button className={showDemo?'active':''} onClick={()=>setShowDemo(v=>!v)}><Sparkles size={14}/> {showDemo?'Hide demos':'Show demos'}</button><button className={priority?'active':''} onClick={()=>setPriority(v=>!v)}><Target size={14}/> {!priority?'Priority only':'Show all'}</button></div>
      </div>
     </div>
     <div className="timeRail"><span>DATASET WINDOW</span>{[1,7,30].map(n=><button key={n} className={windowDays===n?'active':''} onClick={()=>setWindowDays(n)}>{n===1?'FINAL 24H':`FINAL ${n} DAYS`}</button>)}<em>Ends {archiveTo||'at latest archive record'} · applies to real detections and density</em></div>
     <div className="mapStage">
      <LiveMap events={mapEvents.map(e=>({id:e.id,latitude:e.lat,longitude:e.lon,risk:e.risk,confidence:e.confidence,classification:e.cls,brightness:e.brightness,persistence:e.persistence}))} densityEvents={density} facilities={context.facilities} selectedId={selected.id} onSelect={id=>{const e=mapEvents.find(x=>x.id===id);if(e){select(e.id);onReview(e)}}} mode={mode} layers={layers}/>
      {mode==='detections'?<div className="classLegend"><span><i className="unclassified"/>Prediction unavailable</span>{[['industrial','Industrial'],['flare','Gas flare'],['crop','Crop burning'],['wildfire','Wildfire'],['mining','Mining']].map(([colour,label])=><span key={colour}><i className={colour}/>{label}</span>)}{showDemo&&<><span><i className="industrial"/>Demo industrial</span><span><i className="flare"/>Demo flare</span><span><i className="crop"/>Demo crop</span><span><i className="wildfire"/>Demo wildfire</span></>}</div>:<div className="heatLegend"><span>REAL FIRMS OBSERVATION DENSITY</span><i/><div><small>LOW</small><small>HIGH</small></div></div>}
      {layersOpen&&<div className="layerBox"><b>MAP LAYERS</b><label><input type="checkbox" checked={layers.facilities} onChange={e=>setLayers(v=>({...v,facilities:e.target.checked}))}/> Nearby industrial facilities</label>{mode==='detections'&&<label><input type="checkbox" checked={layers.halos} onChange={e=>setLayers(v=>({...v,halos:e.target.checked}))}/> Operational risk rings</label>}<label><input type="checkbox" checked={layers.labels} onChange={e=>setLayers(v=>({...v,labels:e.target.checked}))}/> State / UT labels</label><label><input type="checkbox" checked={layers.imagery} onChange={e=>setLayers(v=>({...v,imagery:e.target.checked}))}/> Satellite visual context</label><small>Satellite is a geographic basemap, not dated evidence. Switching layers preserves your current map position.</small></div>}
     </div>
    </div>
    <aside className="selectedPanel">
     <div className="selectedTop"><div><span className="label">SELECTED DETECTION</span><h3>{selected.id}</h3></div><div className="statusStack"><span className={`pill ${selected.risk.toLowerCase()}`}>{selected.risk}</span><small>NEEDS VERIFICATION</small></div></div>
     <div className="selectedPlace"><MapPin size={15}/><span>{selected.name}<small>{selected.lat.toFixed(4)}° N · {selected.lon.toFixed(4)}° E</small></span></div>
     <div className="classification"><div><span>{isDemo?'DEMO CLASSIFICATION':hasClassification?'MODEL PREDICTION':'CLASSIFICATION STATUS'}</span><b>{hasClassification?selected.cls:'Unclassified thermal anomaly'}</b><small>{isDemo?'Fixed demo classification':hasClassification?'Trained-model archive replay · requires verification':selected.modelPrediction?.error||'Prediction unavailable'}</small></div>{selected.confidence>0&&<strong>{selected.confidence.toFixed(1)}%<small>{isDemo?'demo score':'model probability'}</small></strong>}</div>
     <div className="contextCard"><Building2 size={16}/><div><span>NEAREST MAPPED FACILITY</span><b>{contextLoading===id?'Searching OpenStreetMap…':context.facilities[0]?.name||(context.unavailable.length>0?'Facility lookup unavailable':'No mapped facility within 10 km')}</b><small>{context.facilities[0]?.type?`${context.facilities[0]?.type} · `:''}{(context.facilities[0]?.distanceKm ?? 99)<99?`${(context.facilities[0]?.distanceKm ?? 99).toFixed(1)} km from detection`:'Coverage depends on OpenStreetMap completeness'}</small></div></div>
     <div className="signalGrid">
      <Signal icon={<Flame/>} label="Thermal intensity" value={`${selected.brightness} K`} note={selected.brightness>=335?'Very high':'Elevated'}/>
      <Signal icon={<Activity/>} label="Persistence" value={`${(days ?? 0)} of ${selected.persistenceWindow||30} days`} note={`${selected.persistenceObservations||0} nearby observations`}/>
      <Signal icon={<ShieldCheck/>} label="FIRMS confidence" value={selected.firmsConfidence===undefined?'Unavailable':`${selected.firmsConfidence}%`} note="Detection quality"/>
      <Signal icon={<Gauge/>} label="Radiative power" value={selected.frp?`${selected.frp.toFixed(1)} MW`:'Unavailable'} note="NASA FIRMS FRP"/>
     </div>
     <div className="evidenceSummary"><div className="xaiHead"><span><Sparkles size={14}/> {hasClassification?'WHY THIS CLASSIFICATION?':'MODEL-READY EVIDENCE'}</span><b>{analyzing?'ENRICHING':'EVIDENCE'}</b></div>{analysis ? analysis.explanation.all_contributions.slice(0,3).map(f=><div className="reasonRow" key={f.feature}><i>{(f.shap_value||0)>0?'+':'−'}</i><span>{factorText(f)} — {(f.shap_value||0)>0?'increases':'decreases'} the model score</span></div>) : <><div className="reasonRow"><i>1</i><span>{context.facilities[0]?.name?`Located ${(context.facilities[0]?.distanceKm ?? 99).toFixed(1)} km from ${context.facilities[0]?.name}`:selected.landCover&&selected.landCover!=='unknown'?`${(selected.landCover ? selected.landCover.charAt(0).toUpperCase()+selected.landCover.slice(1) : 'Unknown')} land context surrounds this detection`:'No mapped industrial facility has been confirmed nearby'}</span></div><div className="reasonRow"><i>2</i><span>Thermal signal reached {selected.brightness} K — {selected.brightness>=335?'very high':'elevated'} intensity</span></div><div className="reasonRow"><i>3</i><span>Detected on {(days ?? 0)} of the past {selected.persistenceWindow||30} days — {(days ?? 0)>=10?'a persistent pattern':'an intermittent pattern'}</span></div></>}<button className="technicalToggle" onClick={()=>setTechnical(v=>!v)}>View technical evidence <ChevronDown size={13} className={technical?'open':''}/></button>{technical&&<div className="technicalEvidence">{!isDemo&&<p style={{fontSize:9,lineHeight:1.6}}>Reference dataset label: {datasetClasses[selected.datasetLabel?.fireType||'']||'Unknown'}. {hasDatasetClass&&hasClassification?(datasetClasses[selected.datasetLabel!.fireType]===selected.cls?'Agrees with model.':'Disagrees with model.') : ''}<br/>Model: {modelSha.slice(0,16)||'Unavailable'}<br/>Top three SHAP score contributions, not percentages. Archive replay; training membership unverified.</p>}{analysis ? analysis.explanation.all_contributions.map((f,i)=><div className="xaiRow" key={i}><span>{factorText(f)}</span><i><b style={{width:`${Math.min(100,Math.abs(f.shap_value||0)*20)}%`}}/></i><strong>{f.shap_value?.toFixed(2)}</strong></div>) : <><div className="reasonRow"><span>FRP</span><strong>{selected.frp?.toFixed(1)||'—'} MW</strong></div><div className="reasonRow"><span>FIRMS detection confidence</span><strong>{selected.firmsConfidence??'—'}%</strong></div><div className="reasonRow"><span>Persistence</span><strong>{days ?? '—'} of 30 days</strong></div><small>{isDemo?'Fixed demo evidence; no model-generated SHAP values.':selected.datasetLabel?`Saved label: ${selected.datasetLabel.fireType}. Rule-label quality: ${selected.datasetLabel.quality} (not model probability). Source: fire_type_dataset.parquet. Record: ${selected.datasetLabel.eventId}.`:'No unique dataset match; no label assigned.'}</small></>}</div>}{!hasClassification&&<small>Inputs are prepared for the classification model; no class is inferred here.</small>}</div>
     <div className="provenance"><Clock3 size={14}/><div><b>{selected.time} · {isDemo?'DEMO':'VIIRS'}</b><span>{isDemo?'Illustrative demo scenario':selected.datasetLabel?'NASA FIRMS · Model archive replay · History excludes observation day':'NASA FIRMS archive · Snapshot recurrence'}</span></div></div>
     <div className="recommendation"><span>VERIFICATION REQUIRED</span><p>Satellite basemap is visual context, not proof of a current incident. Check dated imagery or ground reports before escalation.</p></div>
     <div className="panelActions"><button className="ghost" onClick={()=>{setMode('detections');setLayers(v=>({...v,imagery:!v.imagery}))}}><Satellite size={14}/>{layers.imagery?'Return to terrain map':'Inspect satellite view'}</button><button className={queuedIds.includes(id)?'alertCreated primary':'primary'} onClick={()=>onAlert(selected)} disabled={queuedIds.includes(id)}><Bell size={15}/> {queuedIds.includes(id)?'Alert queued':'Create alert'}</button></div>
    </aside>
   </div>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
function SectionHeading({kicker,title,text,action}:{kicker:string;title:string;text:string;action?:ReactNode}){return <div className="sectionHeading"><div><span className="eyebrow">{kicker}</span><h2>{title}</h2><p>{text}</p></div>{action}</div>}
function Signal({icon,label,value,note}:{icon:ReactNode;label:string;value:string;note:string}){return <div className="signal"><span className="signalIcon">{icon}</span><div><small>{label}</small><b>{value}</b><em>{note}</em></div></div>}
