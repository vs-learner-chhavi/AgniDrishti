import { NextResponse } from 'next/server';
import { ingestFirmsToDatabase } from '@/lib/firms-ingest';
import { fetchFirmsHotspots } from '@/lib/firms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!process.env.FIRMS_MAP_KEY) {
    return NextResponse.json({ ok: false, error: 'FIRMS_MAP_KEY is not configured' }, { status: 503 });
  }

  try {
    if (process.env.DATABASE_URL) {
      const result = await ingestFirmsToDatabase();
      return NextResponse.json({ ok: true, source: 'NASA_FIRMS', ...result });
    }

    const hotspots = await fetchFirmsHotspots('IND', Number(process.env.FIRMS_DAYS || 1));
    return NextResponse.json({ ok: true, source: 'NASA_FIRMS', persisted: false, count: hotspots.length, hotspots });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'FIRMS ingestion failed' },
      { status: 502 },
    );
  }
}
