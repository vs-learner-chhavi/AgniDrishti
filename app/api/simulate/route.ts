import { NextResponse } from 'next/server';
import { runModel } from '@/lib/model-inference';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Expected an observation object.' }, { status: 400 });
  }
  try {
    const result = await runModel({ ...body, mode: 'simulation' });
    return NextResponse.json(result, { status: result.ok ? 200 : result.status || 503 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Model unavailable.' }, { status: 503 });
  }
}
