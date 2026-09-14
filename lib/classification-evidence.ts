export type Factor = { feature: string; value?: number; shap_value?: number; contribution?: number };
export const classLabels: Record<string, string> = {
  industrial_fire: 'Industrial Fire', gas_flare: 'Gas Flare', agricultural_burning: 'Crop Burning',
  wildfire: 'Wildfire', mining_thermal_source: 'Mining thermal source',
};
export const contribution = (factor: Factor) => factor.shap_value ?? factor.contribution ?? 0;
export function probability(value: number) {
  return value > 0 && value < .001 ? '<0.1%' : `${(value * 100).toFixed(1)}%`;
}
export function factorText(f: Factor): string {
  const value = f.value;
  if (value === undefined || !Number.isFinite(value)) return `${f.feature.replaceAll('_', ' ')}: value unavailable`;
  const n = Number(value.toFixed(2));
  const flags: Record<string, [string, string]> = {
    persistent_activity: ['Activity recorded on fewer than 3 of 7 days and fewer than 10 of 30 days', 'Activity recorded on at least 3 of 7 days or 10 of 30 days'],
    persistent_source_flag: ['Fewer than 5 active days and 10 detections in 30 days', 'At least 5 active days or 10 detections in 30 days'],
    high_persistence_flag: ['Fewer than 10 active days and 25 detections in 30 days', 'At least 10 active days or 25 detections in 30 days'],
    low_persistence_flag: ['Activity recorded on more than 2 of 30 days', 'Activity recorded on no more than 2 of 30 days'],
    high_frp_flag: ['Radiative power is below the model’s high-power cutoff', 'Radiative power reaches the model’s high-power cutoff'],
    is_night: ['Satellite passed during daytime', 'Satellite passed at night'],
    night_fire_flag: ['Satellite passed during daytime', 'Satellite passed at night'],
  };
  if (flags[f.feature] && (value === 0 || value === 1)) return flags[f.feature][value];
  if (/^active_days_(7|30)d$/.test(f.feature)) return `Detected on ${n} of the previous ${f.feature.includes('30') ? 30 : 7} days`;
  if (/^hotspot_count_(7|30)d$/.test(f.feature)) return `${n} detections in the previous ${f.feature.includes('30') ? 30 : 7} days`;
  const labels: Record<string, string> = {
    brightness: `Satellite brightness temperature: ${n} K`,
    bright_t31: `Secondary-band brightness temperature: ${n} K`,
    frp: `Radiative power: ${n} MW`,
    daily_total_frp: `Daily total radiative power: ${n} MW`,
    daily_max_brightness: `Daily peak brightness temperature: ${n} K`,
    daily_mean_confidence: `Daily mean detection confidence: ${n}%`,
    confidence_score: `Satellite detection confidence: ${n}%`,
    thermal_excess: `Brightness temperature is ${Math.abs(n)} K ${value < 0 ? 'below' : 'above'} the 300 K reference`,
    frp_per_detection_30d: `Radiative power per historical detection: ${n} MW`,
    persistence_ratio_7d: `Activity recorded on ${Number((value * 100).toFixed(1))}% of the previous 7 days`,
    persistence_ratio_30d: `Activity recorded on ${Number((value * 100).toFixed(1))}% of the previous 30 days`,
    persistence_score: `Combined recurrence indicator: ${n}`,
    log_frp: `Radiative power on the model’s logarithmic scale: ${n}`,
    hour: `Observation hour: ${n}:00 UTC`,
    month: `Observation month: ${n}`,
    day_of_year: `Observation falls on day ${n} of the year`,
  };
  return labels[f.feature] ?? `${f.feature.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())}: ${n}`;
}

function family(feature: string) {
  if (/^(active_days_|hotspot_count_|persistence_|persistent_|high_persistence|low_persistence)/.test(feature)) return 'recurrence';
  if (['frp', 'log_frp', 'high_frp_flag'].includes(feature)) return 'power';
  if (['is_night', 'night_fire_flag', 'hour'].includes(feature)) return 'time';
  if (['month', 'day_of_year'].includes(feature)) return 'season';
  return feature;
}
export function evidenceGroups(factors: Factor[], direction: 1 | -1) {
  const groups = new Map<string, Factor[]>();
  for (const factor of factors) {
    const score = contribution(factor);
    if (!Number.isFinite(score) || score * direction <= 0) continue;
    const key = family(factor.feature);
    groups.set(key, [...(groups.get(key) || []), factor]);
  }
  return [...groups.entries()].map(([key, items]) => {
    items.sort((a, b) => Math.abs(contribution(b)) - Math.abs(contribution(a)));
    // Prefer direct counts to overlapping threshold flags. Keep the sign-specific
    // groups separate: recurrence can support and oppose in the same observation.
    const direct = items.filter(f => /^active_days_/.test(f.feature));
    const facts = (key === 'recurrence' && direct.length ? direct : items).slice(0, key === 'recurrence' ? 2 : 1);
    return { key, text: facts.map(factorText).join('; '),
      magnitude: items.reduce((sum, f) => sum + Math.abs(contribution(f)), 0),
      count: items.length };
  }).sort((a, b) => b.magnitude - a.magnitude).slice(0, 2);
}
export function explanationSummary(classification: string, confidence: number, factors: Factor[], probabilities: Record<string, number> = {}, complete = false) {
  const supporting = evidenceGroups(factors, 1), opposing = evidenceGroups(factors, -1);
  const alternatives = Object.entries(probabilities).filter(([key, value]) =>
    key !== classification && classLabels[key] !== classification && Number.isFinite(value) && value >= 0 && value <= 1
  ).sort((a, b) => b[1] - a[1]);
  const runnerUp = alternatives[0];
  const gap = runnerUp ? (confidence - runnerUp[1]) * 100 : undefined;
  const close = gap !== undefined && gap >= 0 && gap < 10;
  const tentative = confidence < .5 || close;
  const label = classLabels[classification] || classification;
  return { supporting, opposing, runnerUp, gap,
    opening: `${label} ranks first at ${probability(confidence)} model probability. ${tentative
      ? `Treat this as tentative${opposing.length ? ': the evidence is mixed.' : '.'}`
      : opposing.length ? (supporting.length ? 'Some evidence supports it; other evidence lowers its score.' : 'The available inputs lower its score relative to its baseline.') : supporting.length ? 'The available contributions support this result.' : 'No directional contributions are available.'}`,
    noSupport: !factors.length ? 'No model contributions are available for this result.' : complete
      ? 'No inputs raise this class’s score above its baseline. It can still rank first because the model compares the complete scores of all classes, including their baselines.'
      : 'No supporting factors appear in this saved excerpt. The full explanation is needed to see whether other inputs support this result.',
    alternative: runnerUp ? `${classLabels[runnerUp[0]] || runnerUp[0]} · ${probability(runnerUp[1])}${gap !== undefined && gap >= 0 ? ` · ${gap.toFixed(1)} percentage points behind${close ? ' — a close call' : ''}` : ''}.`
      : 'Class probabilities are unavailable; the closest alternative cannot be identified.',
  };
}
