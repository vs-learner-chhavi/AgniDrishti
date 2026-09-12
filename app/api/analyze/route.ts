import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { fetchFirmsHotspots, type FirmsHotspot } from '@/lib/firms';
import { findNearbyFacilities } from '@/lib/overpass';
import { estimatePersistence } from '@/lib/persistence';
import { lookupWorldCover } from '@/lib/worldcover';
import { classifyThermalEvent } from '@/lib/classifier';
import { fireTypeLabels, runModel } from '@/lib/model-inference';

export const runtime = 'nodejs';

function demoHotspot(latitude: number, longitude: number, body: any): FirmsHotspot {
  const brightness = Math.min(380, Math.max(280, Number(body.brightnessKelvin) || 348));
  const confidence = Math.min(100, Math.max(50, Number(body.firmsConfidence) || 94));
  const d = body.detectedAt ? new Date(body.detectedAt) : new Date();

  return {
    latitude,
    longitude,
    brightness,
    confidence,
    acqDate: d.toISOString().slice(0, 10),
    acqTime: d.toISOString().slice(11, 16).replace(':', ''),
    satellite: body.satellite || 'SIMULATION',
    frp: Number(body.frp) || 0,
  };
}

function predict(features: Record<string, number>): Promise<any> {
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON_BIN || 'python';
    const child = spawn(python, ['inference_bridge.py'], { cwd: 'ml' });

    let out = '';
    let err = '';

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(err || `Python exited with ${code}`));
      }

      try {
        const lines = out.trim().split(/\r?\n/).filter(Boolean);
        const value = JSON.parse(lines.at(-1) || '{}');

        if (value.error) {
          return reject(new Error(value.error));
        }

        resolve(value);
      } catch (e) {
        reject(e);
      }
    });

    child.stdin.end(JSON.stringify(features) + '\n');
  });
}

function normalizeLandCover(
  value: any,
): 'industrial' | 'forest' | 'cropland' | 'mining' | 'unknown' {
  const label = String(value?.label || value || '').toLowerCase();

  if (label.includes('industrial')) return 'industrial';
  if (label.includes('forest') || label.includes('tree')) return 'forest';
  if (label.includes('crop') || label.includes('farm') || label.includes('agri')) {
    return 'cropland';
  }
  if (label.includes('mine')) return 'mining';

  return 'unknown';
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'Expected an observation object.' },
        { status: 400 },
    );
}

    if (body.observationSource === 'NASA_ARCHIVE') {
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
      model: 'Trained XGBoost fire-type classifier', xai: { source: 'XGBoost native TreeSHAP', all_contributions: explanations } };
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

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json(
        { ok: false, error: 'latitude and longitude are required' },
        { status: 400 },
      );
    }

    const radius = Number(body.radiusMeters) || 10000;

    let history: FirmsHotspot[] = [];
    let current: FirmsHotspot | null = null;

    let source: 'NASA_FIRMS' | 'NASA_ARCHIVE' | 'DEMO_SIMULATION' =
      body.observationSource === 'NASA_ARCHIVE'
        ? 'NASA_ARCHIVE'
        : 'NASA_FIRMS';

    if (process.env.FIRMS_MAP_KEY) {
      try {
        history = await fetchFirmsHotspots('IND', Number(body.days) || 7);

        current =
          history
            .filter(
              (h) =>
                Math.abs(h.latitude - latitude) < 0.2 &&
                Math.abs(h.longitude - longitude) < 0.2,
            )
            .sort((a, b) => b.brightness - a.brightness)[0] || null;
      } catch {}
    }

    if (!current) {
      source = 'DEMO_SIMULATION';
      current = demoHotspot(latitude, longitude, body);

      history = Array.from({ length: 14 }, (_, i) => ({
        ...current!,
        latitude: latitude + Math.sin(i * 1.7) * 0.006,
        longitude: longitude + Math.cos(i * 1.3) * 0.006,
        brightness: Math.max(
          285,
          current!.brightness - i * 1.7 + (i % 3) * 5,
        ),
        confidence: Math.max(65, current!.confidence - (i % 4)),
      }));
    }

    let facilities: any[] = [];

    try {
      facilities = await findNearbyFacilities(
        current.latitude,
        current.longitude,
        radius,
      );
    } catch {}

    const suppliedDistance = Number(body.industrialDistanceKm);
    const nearest =
      facilities[0]?.distanceKm ??
      (Number.isFinite(suppliedDistance) ? suppliedDistance : 0.8);

    const persistence = estimatePersistence(
      current,
      history,
      Number(body.windowDays) || 30,
    );

    let cover: any = {
      code: -1,
      label: String(body.landCover || 'unknown'),
    };

    try {
      if (!body.landCover) {
        cover = await lookupWorldCover(
          current.latitude,
          current.longitude,
        );
      }
    } catch {}

    const heuristic = classifyThermalEvent({
      brightnessKelvin: current.brightness,
      firmsConfidence: current.confidence,
      persistence: persistence.score,
      industrialDistanceKm: nearest,
      landCover: normalizeLandCover(cover),
    });

    const hour = Number(current.acqTime.slice(0, 2)) || 12;

    const day =
      Math.floor(
        (Date.parse(current.acqDate) -
          Date.parse(`${current.acqDate.slice(0, 4)}-01-01`)) /
          86400000,
      ) + 1;

    // Normalize optional FIRMS FRP once so all ML features receive a definite number.
    const currentFrp = current.frp ?? 0;

    const features = {
      brightness: current.brightness,
      bright_t31: current.brightness - 30,
      frp: currentFrp,
      confidence_score: current.confidence / 100,
      log_frp: Math.log1p(currentFrp),
      thermal_excess: 30,
      hour,
      month: Number(current.acqDate.slice(5, 7)),
      day_of_year: day,
      is_night: hour < 6 || hour >= 18 ? 1 : 0,

      hotspot_count_7d: history.length,
      active_days_7d: history.length,
      hotspot_count_30d: history.length,
      active_days_30d: history.length,

      persistence_ratio_7d: 1,
      persistence_ratio_30d: 1,

      persistent_source_flag: persistence.score > 50 ? 1 : 0,
      high_persistence_flag: persistence.score > 70 ? 1 : 0,

      daily_total_frp: currentFrp,
      daily_max_brightness: current.brightness,
      daily_mean_confidence: current.confidence / 100,

      frp_per_detection_30d:
        currentFrp / Math.max(1, history.length),

      persistence_score: persistence.score / 100,

      night_fire_flag: hour < 6 || hour >= 18 ? 1 : 0,
      persistent_activity: persistence.score > 50 ? 1 : 0,
      high_frp_flag: currentFrp > 50 ? 1 : 0,
      low_persistence_flag: persistence.score < 20 ? 1 : 0,
    };

    let model;

    try {
      model = await predict(features);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: `Trained ML inference unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        { status: 503 },
      );
    }

    const classification =
      model.fire_type || heuristic.classification;

    const confidence =
      Number(model.confidence) || heuristic.confidence;

    const explanations =
      model.explanations ||
      model.xai?.all_contributions ||
      heuristic.explanations;

    const positiveFactors =
      model.positiveFactors ||
      model.xai?.top_positive_factors ||
      explanations.filter(
        (item: any) =>
          Number(item.shap_value ?? item.contribution) > 0,
      );

    const negativeFactors =
      model.negativeFactors ||
      model.xai?.top_negative_factors ||
      explanations.filter(
        (item: any) =>
          Number(item.shap_value ?? item.contribution) < 0,
      );

    const xai =
      model.xai || {
        source: 'transparent_rule_based',
        factors: explanations,
      };

    const result = {
      fireType: classification,
      classification,
      confidence,
      probabilities: model.probabilities || {},
      risk: heuristic.risk,
      explanations,
      positiveFactors,
      negativeFactors,
      xai,
      model: 'trained fire-type classifier + SHAP attribution',
    };

    return NextResponse.json({
      ok: true,
      event: {
        hotspot: current,
        persistence,
        nearestFacility: facilities[0] || null,
        industrialDistanceKm: nearest,
        facilities,
        landCoverContext: cover,
        result,
        classification,
        risk: result.risk,
        explanations,
        xai,
        source,
        analysisMode:
          source === 'NASA_FIRMS'
            ? 'LIVE MULTISOURCE'
            : 'DEMO MULTISOURCE',
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Analysis failed',
      },
      { status: 500 },
    );
  }
}
