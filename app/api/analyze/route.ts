import { NextResponse } from 'next/server';
import { fireTypeLabels, runModel } from '@/lib/model-inference';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Expected an observation object.' }, { status: 400 });
  }
  if (!body.detectedAt) {
    return NextResponse.json({ ok: false, error: 'This point has no exact observation timestamp. Demo points stay fixed; use Simulation Lab to test the model.' }, { status: 422 });
  }
  try {
    const analysis = await runModel({ latitude: body.latitude, longitude: body.longitude, detectedAt: body.detectedAt, mode: 'archive' });
    if (!analysis.ok) return NextResponse.json(analysis, { status: analysis.status || 503 });
    const f = analysis.features, p = analysis.prediction;
    const classification = fireTypeLabels[p.fire_type] || p.fire_type;
    const explanations = analysis.explanation.all_contributions;
    const facilities = analysis.context.facilities;
    // Risk assessment is a separate teammate-owned feature, not a class prediction.
    const result = { classification, fireType: classification, confidence: p.confidence * 100,
      probabilities: p.probabilities, explanations, risk: 'UNASSESSED',
      positiveFactors: analysis.explanation.top_positive_factors, negativeFactors: analysis.explanation.top_negative_factors,
      model: 'Trained XGBoost fire-type classifier', xai: { source: 'SHAP TreeExplainer', all_contributions: explanations } };
    return NextResponse.json({ ok: true, analysis, event: {
      hotspot: { latitude: body.latitude, longitude: body.longitude, brightness: f.brightness, frp: f.frp, confidence: f.confidence_score },
      persistence: { score: f.persistence_score * 100, activeDays: f.active_days_30d, windowDays: 30 },
      nearestFacility: facilities[0] || null, industrialDistanceKm: analysis.context.distancesKm.industrial ?? null,
      facilities, result, classification, risk: result.risk, explanations, xai: result.xai,
      source: 'NASA_ARCHIVE', analysisMode: 'ARCHIVE MODEL REPLAY',
    } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Model unavailable.' }, { status: 503 });
  }
}
