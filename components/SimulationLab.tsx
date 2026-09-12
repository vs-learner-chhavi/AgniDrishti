'use client';
import { useEffect, useRef, useState } from 'react';
import { FlaskConical, MapPin, Play, X, RotateCcw } from 'lucide-react';
import ScenarioMap from './ScenarioMap';

const labels: Record<string, string> = { industrial_fire: 'Industrial Fire', gas_flare: 'Gas Flare',
  agricultural_burning: 'Crop Burning', wildfire: 'Wildfire', mining_thermal_source: 'Mining thermal source' };
type Factor = { feature: string; value: number; shap_value: number };
type Result = { id: string; mode: string; observation: { latitude: number; longitude: number; detectedAt: string };
  prediction: { fire_type: string; confidence: number; probabilities: Record<string, number> };
  features: Record<string, number>; explanation: { all_contributions: Factor[] };
  context: { facilities: { name: string; type: string; distanceKm: number }[]; unavailable: string[]; source: string };
  provenance: { modelSha256: string; highFrpThreshold: number; historyWindow: string } };
const names: Record<string, string> = {
  brightness: 'Hotspot temperature', bright_t31: 'Secondary-band temperature', frp: 'Fire radiative power',
  confidence_score: 'Satellite detection confidence', active_days_7d: 'Active days in the previous week',
  active_days_30d: 'Active days in the previous month', hotspot_count_7d: 'Detections in the previous week',
  hotspot_count_30d: 'Detections in the previous month', persistence_score: 'Combined persistence score',
  thermal_excess: 'Temperature above 300 K', log_frp: 'Logarithm of fire radiative power',
  is_night: 'Night observation', night_fire_flag: 'Night observation', high_frp_flag: 'High radiative power',
  persistent_activity: 'Repeated activity', low_persistence_flag: 'Infrequent activity',
};
function describe(f: Factor) {
  if (f.feature === 'active_days_30d') return `Activity on ${f.value} of the previous 30 days`;
  if (f.feature === 'active_days_7d') return `Activity on ${f.value} of the previous 7 days`;
  if (f.feature === 'brightness') return `A hotspot temperature of ${f.value.toFixed(1)} K`;
  if (f.feature === 'frp') return `${f.value.toFixed(1)} MW of fire radiative power`;
  return `${names[f.feature] || f.feature.replaceAll('_', ' ')}: ${Number(f.value.toFixed(3))}`;
}

export default function SimulationLab({ onClose }: { onClose: () => void }) {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [brightness, setBrightness] = useState(330);
  const [background, setBackground] = useState(300);
  const [frp, setFrp] = useState(15);
  const [confidence, setConfidence] = useState(50);
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [daynight, setDaynight] = useState('D');
  const [days7, setDays7] = useState(2);
  const [days30, setDays30] = useState(5);
  const [advanced, setAdvanced] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Result[]>([]);
  const [dirty, setDirty] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const point = lat.trim() && lon.trim() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180
    ? { latitude: Number(lat), longitude: Number(lon) } : null;
  const latest = runs[0];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]');
      if (!elements?.length) return;
      const visible = Array.from(elements).filter(el => el.getClientRects().length && !el.matches(':disabled'));
      const first = visible[0], last = visible.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', key); controller.current?.abort(); previous?.focus(); };
  }, [onClose]);
  const change = () => { setDirty(true); setError(''); };
  const extra = (key: string, fallback: number) => advanced[key] === undefined || advanced[key] === '' ? fallback : Number(advanced[key]);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!point) { setError('Choose a point on the map or enter valid latitude and longitude.'); return; }
    if (!at) { setError('Choose an observation time.'); return; }
    setBusy(true); setError('');
    controller.current = new AbortController();
    const payload = { ...point, detectedAt: new Date(`${at}:00Z`).toISOString(), brightness, bright_t31: background,
      frp, confidence_score: confidence, daynight, active_days_7d: days7, active_days_30d: days30,
      hotspot_count_7d: extra('hotspot_count_7d', days7), hotspot_count_30d: extra('hotspot_count_30d', days30),
      daily_total_frp: extra('daily_total_frp', frp), daily_max_brightness: extra('daily_max_brightness', brightness),
      daily_mean_confidence: extra('daily_mean_confidence', confidence) };
    try {
      const response = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.current.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Prediction unavailable.');
      setRuns(current => [{ ...result, id: `SIM-${crypto.randomUUID().slice(0, 8)}` }, ...current].slice(0, 5));
      setDirty(false);
    } catch (err) { if (!(err instanceof Error && err.name === 'AbortError')) setError(err instanceof Error ? err.message : 'Prediction unavailable.'); }
    finally { setBusy(false); }
  }
  return <div className="simulationBackdrop">
    <div className="simulationDialog" role="dialog" aria-modal="true" aria-labelledby="simulation-title" ref={dialog} tabIndex={-1}>
      <header className="simulationHeader"><div><span className="eyebrow"><FlaskConical size={14} /> SIMULATION LAB</span>
        <h2 id="simulation-title">Test a new thermal anomaly</h2><p>Choose the evidence. Let the trained model make the call.</p></div>
        <button className="scenarioClose" aria-label="Close simulation" onClick={onClose}><X size={20} /></button></header>
      <div className="scenarioNotice">Hypothetical inputs · Actual model prediction · No live incidents or alerts created</div>
      <div className="simulationGrid">
        <form onSubmit={run} onChange={change} className="scenarioForm">
          <fieldset disabled={busy}>
            <h3>01 / Location & observation</h3>
            <div className="scenarioFields"><label>Latitude<input aria-label="Latitude" type="number" step="any" min="-90" max="90" required value={lat} onChange={e => setLat(e.target.value)} placeholder="Click the map" /></label>
              <label>Longitude<input aria-label="Longitude" type="number" step="any" min="-180" max="180" required value={lon} onChange={e => setLon(e.target.value)} placeholder="Or paste coordinates" /></label>
              <label>Observation time (UTC)<input type="datetime-local" required value={at} onChange={e => setAt(e.target.value)} /></label>
              <label>Day / night flag<select value={daynight} onChange={e => setDaynight(e.target.value)}><option value="D">Day observation</option><option value="N">Night observation</option></select></label>
              <label>Hotspot temperature (K)<input type="number" required min="200" max="500" step="0.1" value={brightness} onChange={e => setBrightness(e.target.valueAsNumber)} /></label>
              <label>Secondary-band temperature (K)<input type="number" required min="150" max="400" step="0.1" value={background} onChange={e => setBackground(e.target.valueAsNumber)} /></label>
              <label>Fire radiative power (MW)<input type="number" required min="0" max="100000" step="0.01" value={frp} onChange={e => setFrp(e.target.valueAsNumber)} /></label>
              <label>FIRMS confidence<select value={confidence} onChange={e => setConfidence(Number(e.target.value))}><option value={0}>Low · 0</option><option value={50}>Nominal · 50</option><option value={100}>High · 100</option></select></label></div>
            <h3>02 / Hypothetical history</h3><p className="scenarioHelp">Days with detections in the same 0.05° grid cell, before the observation day.</p>
            <div className="scenarioFields"><label>Active days / previous 7<input type="number" required min="0" max="7" value={days7} onChange={e => { const n=e.target.valueAsNumber; setDays7(n); setDays30(d => Math.min(Math.max(d, n), n + 23)); }} /></label>
              <label>Active days / previous 30<input type="number" required min={days7} max={days7+23} value={days30} onChange={e => setDays30(e.target.valueAsNumber)} /></label></div>
            <details className="scenarioDetails"><summary>Adjust detection counts & daily totals</summary>
              <p>By default: one detection per active day, with this observation as the only detection today. Override these assumptions if needed.</p>
              <div className="scenarioFields">{[
                ['hotspot_count_7d', 'Detections / previous 7 days', days7], ['hotspot_count_30d', 'Detections / previous 30 days', days30],
                ['daily_total_frp', 'Total FRP today (MW)', frp], ['daily_max_brightness', 'Maximum temperature today (K)', brightness],
                ['daily_mean_confidence', 'Mean FIRMS confidence today', confidence],
              ].map(([key, label, fallback]) => <label key={key}>{label}<input type="number" min="0" step={String(key).startsWith('hotspot') ? '1' : 'any'} value={advanced[String(key)] ?? ''} placeholder={String(fallback)} onChange={e => setAdvanced(a => ({ ...a, [key]: e.target.value }))} /></label>)}</div>
              <button type="button" className="scenarioTextButton" onClick={() => { setAdvanced({}); change(); }}>Restore default assumptions</button>
            </details>
          </fieldset>
          {error && <p className="scenarioError" role="alert">{error}</p>}
          <button className="primary full" type="submit" disabled={busy}><Play size={15} />{busy ? 'Running trained model…' : 'Run prediction'}</button>
          <p className="scenarioHelp">Changing location updates infrastructure context. This model uses thermal and temporal inputs for classification. Test runs are cleared when you close the lab.</p>
        </form>
        <div className="scenarioOutput">
          <div className="scenarioMapTitle"><MapPin size={15} /><span>Click anywhere to choose an exact location</span></div>
          <ScenarioMap point={point} runs={runs.map(r => ({ ...r.observation, id: r.id, label: labels[r.prediction.fire_type] }))} onPick={p => { if (busy) return; setLat(String(p.latitude)); setLon(String(p.longitude)); change(); }} />
          <div className="scenarioCoordinates">{point ? `Lat ${point.latitude.toFixed(5)}, Lon ${point.longitude.toFixed(5)}` : 'No location selected'}<span>Test points only</span></div>
          {!latest ? <div className="scenarioEmpty"><FlaskConical size={26} /><h3>Your model result will appear here</h3><p>Every successful run adds a simulated point at your selected coordinates. No expected fire type is supplied to the model.</p></div> : <section className="scenarioResult" aria-live="polite">
            {dirty && <div className="scenarioNotice">Inputs changed. The result below belongs to the previous run.</div>}
            <div className="scenarioResultHeading"><div><span className="eyebrow">{latest.id} · SIMULATED</span><h3>{labels[latest.prediction.fire_type] || latest.prediction.fire_type}</h3></div><strong>{(latest.prediction.confidence*100).toFixed(1)}%<small>model probability</small></strong></div>
            <p className="scenarioHelp">{latest.observation.latitude.toFixed(5)}, {latest.observation.longitude.toFixed(5)} · {latest.observation.detectedAt.replace('T',' ')}<br />Detected on {latest.features.active_days_30d} of the previous 30 days in this hypothetical history.</p>
            <div className="scenarioProbabilities">{Object.entries(latest.prediction.probabilities).sort((a,b)=>b[1]-a[1]).map(([key,value])=><div key={key}><span>{labels[key] || key}</span><meter min={0} max={1} value={value} /><b>{(value*100).toFixed(1)}%</b></div>)}</div>
            <h4>Why this classification?</h4>
            <ul className="scenarioReasons">{latest.explanation.all_contributions.slice(0,3).map(f=><li key={f.feature}><b>{describe(f)}</b><span>{f.shap_value > 0 ? 'Supports' : 'Weighs against'} this prediction, according to the model.</span></li>)}</ul>
            <h4>Nearby infrastructure</h4><p className="scenarioHelp">OSM snapshot · Within 10 km · Supporting context, separate from the model explanation</p>
            {latest.context.unavailable.length > 0 && <p className="scenarioNotice">Missing snapshots: {latest.context.unavailable.join(', ')}. Download them with git lfs pull.</p>}
            {latest.context.facilities.length ? <ul className="scenarioFacilities">{latest.context.facilities.slice(0,5).map((f,i)=><li key={i}><span>{f.name}<small>{f.type}</small></span><b>{f.distanceKm.toFixed(2)} km</b></li>)}</ul> : <p className="scenarioHelp">No sites found in the available snapshots within 10 km. This does not establish that no industry exists here.</p>}
            <details className="scenarioDetails"><summary>View technical evidence</summary><p>SHAP values show contributions to the predicted class score; they are not percentages.</p>
              <table><thead><tr><th>Input</th><th>Value</th><th>SHAP</th></tr></thead><tbody>{latest.explanation.all_contributions.map(f=><tr key={f.feature}><td>{f.feature}</td><td>{Number(f.value.toFixed(4))}</td><td>{f.shap_value.toFixed(4)}</td></tr>)}</tbody></table>
              <p>Model SHA: <code>{latest.provenance.modelSha256.slice(0,16)}</code><br />High FRP cutoff: {latest.provenance.highFrpThreshold.toFixed(2)} MW<br />{latest.provenance.historyWindow}</p>
            </details>
            {runs.length > 1 && <div className="scenarioComparison"><h4>Recent test runs</h4>{runs.map(r=><p key={r.id}><code>{r.id}</code> · {labels[r.prediction.fire_type]} · {(r.prediction.confidence*100).toFixed(1)}%<br /><small>{r.observation.latitude.toFixed(4)}, {r.observation.longitude.toFixed(4)} · {r.features.brightness} K · {r.features.frp} MW · {r.features.active_days_30d}/30 days</small></p>)}</div>}
            <button type="button" className="scenarioTextButton" onClick={()=>{setRuns([]);setDirty(false);}}><RotateCcw size={14} /> Clear test runs</button>
          </section>}
        </div>
      </div>
    </div>
  </div>;
}
