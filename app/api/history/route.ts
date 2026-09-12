// app/api/history/route.ts
//
// GET /api/history?lat=<number>&lon=<number>&brightness=<number optional>
//
// Returns the Historical Intelligence payload for the thermal cluster
// nearest the given coordinates (see lib/historicalIntelligence.ts for the
// matching rule), or a clearly-labelled "insufficient" response.
//
// `brightness`, when supplied, is the SELECTED event's own reported
// brightness (K) -- e.g. the value shown elsewhere on the currently open
// event card. It is used to compute the THERMAL BASELINE's "current"
// value/deviation against the *actual selected observation* instead of the
// precomputed dataset's latest historical day for that cluster.
//
// This route deliberately does no CSV/parquet parsing -- it only reads the
// small precomputed JSON file via lib/historicalIntelligence.ts.

import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalIntelligence } from '@/lib/historicalIntelligence';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latRaw = searchParams.get('lat');
  const lonRaw = searchParams.get('lon');
  const brightnessRaw = searchParams.get('brightness');

  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const brightness = brightnessRaw !== null ? Number(brightnessRaw) : null;
  const selectedBrightnessK = brightness !== null && Number.isFinite(brightness) ? brightness : null;

  if (latRaw === null || lonRaw === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { ok: false, hasHistory: false, message: 'lat and lon query parameters are required.' },
      { status: 400 },
    );
  }

  const result = getHistoricalIntelligence(lat, lon, selectedBrightnessK);

  if (!result.ok) {
    const message =
      result.reason === 'DATASET_NOT_GENERATED'
        ? 'HISTORICAL INTELLIGENCE DATA NOT YET GENERATED. Run: python scripts/build_historical_intelligence.py'
        : 'INSUFFICIENT HISTORICAL OBSERVATIONS';
    return NextResponse.json(
      { ok: false, hasHistory: false, reason: result.reason, message },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, ...result.payload }, { status: 200 });
}
