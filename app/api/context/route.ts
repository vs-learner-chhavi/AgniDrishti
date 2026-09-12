import { NextResponse } from 'next/server';
import { runModel } from '@/lib/model-inference';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body.latitude !== 'number' || typeof body.longitude !== 'number' ||
      !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) || Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180) {
      return NextResponse.json({ ok: false, error: 'Valid latitude and longitude are required.' }, { status: 400 });
    }
    const data = await runModel({ mode: 'context', latitude: body.latitude, longitude: body.longitude });
    return NextResponse.json(data, { status: data.ok ? 200 : data.status || 503 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Context unavailable.' }, { status: 503 });
  }
}
