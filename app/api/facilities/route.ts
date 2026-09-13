import { NextResponse } from 'next/server';
import { findNearbyFacilities } from '@/lib/overpass';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const latitude = Number(searchParams.get('latitude'));
  const longitude = Number(searchParams.get('longitude'));
  const radiusKm = Math.min(25, Math.max(1, Number(searchParams.get('radiusKm') || 10)));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ ok: false, error: 'Valid latitude and longitude are required.' }, { status: 400 });
  }

  try {
    const facilities = await findNearbyFacilities(latitude, longitude, radiusKm * 1000);
    return NextResponse.json({ ok: true, source: 'OSM / Overpass', count: facilities.length, facilities, generatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Facility lookup failed' }, { status: 503 });
  }
}
