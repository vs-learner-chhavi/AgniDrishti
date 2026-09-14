import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { classifyThermalEvent } from '@/lib/classifier';

function explain(e: any) {
  return classifyThermalEvent({
    brightnessKelvin: Number(e.brightnessKelvin) || 0,
    firmsConfidence: Number(e.firmsConfidence || e.confidence) || 0,
    persistence: Number(e.persistenceScore) || 0,
    industrialDistanceKm: Number(e.industrialDistance) || 99,
    landCover: e.landCover || 'unknown',
  }).explanations;
}

function shape(e: any) {
  const features = e.features || {};

  return {
    id: e.id,
    classification: e.classification,
    confidence: e.confidence,
    risk: e.risk,
    source: e.source,
    detectedAt: e.detectedAt,
    latitude: e.latitude,
    longitude: e.longitude,
    brightnessKelvin: e.brightnessKelvin,
    persistenceScore: e.persistenceScore,
    persistenceDays:
      e.persistenceDays ?? features.persistenceDays,
    persistenceObservations:
      e.persistenceObservations ?? features.persistenceObservations,
    persistenceWindow:
      e.persistenceWindow ?? features.persistenceWindow ?? 30,
    industrialDistance: e.industrialDistance,
    landCover: e.landCover,
    satellite:
      features.satellite ||
      String(e.source || '').replace('NASA_FIRMS_', ''),
    frp: features.frp,
    firmsConfidence: features.firmsConfidence,
    explanations: e.explanations || explain(e),
  };
}

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        {
          ok: false,
          source: 'NO_DATABASE',
          events: [],
          error: 'DATABASE_URL is not configured',
        },
        { status: 503 }
      );
    }

    const events = await prisma.thermalEvent.findMany({
      orderBy: { detectedAt: 'desc' },
      take: 500,
    });

    return NextResponse.json({
      ok: true,
      source: 'POSTGRES',
      events: events.map(shape),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to load real thermal events:', error);

    return NextResponse.json(
      {
        ok: false,
        source: 'POSTGRES_ERROR',
        events: [],
        error: 'Unable to load real thermal events',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const now = new Date();

  const latitude = Number(body.latitude) || 23.0225;
  const longitude = Number(body.longitude) || 72.5714;

  const brightness = Math.min(
    380,
    Math.max(280, Number(body.brightnessKelvin) || 350)
  );

  const persistence = Math.min(
    100,
    Math.max(0, Number(body.persistenceScore) || 82)
  );

  const distance = Math.max(
    0,
    Number(body.industrialDistance) || 0.7
  );

  const firmsConfidence = Math.min(
    100,
    Math.max(50, Number(body.firmsConfidence) || 94)
  );

  const analysis = classifyThermalEvent({
    brightnessKelvin: brightness,
    firmsConfidence,
    persistence,
    industrialDistanceKm: distance,
    landCover: body.landCover || 'industrial',
  });

  const event = {
    id: `SIM-${Date.now().toString().slice(-8)}`,
    latitude,
    longitude,
    detectedAt: now,
    classification: analysis.classification,
    confidence: analysis.confidence,
    risk: analysis.risk,
    source: 'SIMULATION',
    brightnessKelvin: brightness,
    persistenceScore: persistence,
    industrialDistance: distance,
    landCover: body.landCover || 'industrial',
    explanations: analysis.explanations,
  };

  try {
    if (process.env.DATABASE_URL) {
      const saved = await prisma.thermalEvent.create({
        data: {
          ...event,
          features: { firmsConfidence },
          explanations: analysis.explanations,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          event: shape(saved),
          persisted: true,
        },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error('Failed to persist simulated event:', error);
  }

  return NextResponse.json(
    {
      ok: true,
      event: shape(event),
      persisted: false,
    },
    { status: 201 }
  );
}