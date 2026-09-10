import { NextResponse } from 'next/server';
import { ingestFirmsToDatabase } from '@/lib/firms-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');

  if (secret && authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.FIRMS_MAP_KEY || !process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, error: 'FIRMS_MAP_KEY and DATABASE_URL are required for scheduled ingestion' },
      { status: 503 },
    );
  }

  try {
    const result = await ingestFirmsToDatabase();
    return NextResponse.json({ ok: true, job: 'firms-ingestion', completedAt: new Date().toISOString(), ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, job: 'firms-ingestion', error: error instanceof Error ? error.message : 'Scheduled ingestion failed' },
      { status: 502 },
    );
  }
}
