import { prisma } from '@/lib/prisma';
import { fetchFirmsHotspots } from '@/lib/firms';
import { classifyThermalEvent } from '@/lib/classifier';

export async function ingestFirmsToDatabase() {
  if (!process.env.FIRMS_MAP_KEY) throw new Error('FIRMS_MAP_KEY is not configured');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

  const days = Math.min(Math.max(Number(process.env.FIRMS_DAYS || 1), 1), 10);
  const hotspots = await fetchFirmsHotspots('IND', days);
  const savedIds: string[] = [];

  for (const h of hotspots.slice(0, 500)) {
    const analysis = classifyThermalEvent({
      brightnessKelvin: h.brightness,
      firmsConfidence: h.confidence,
      persistence: 0,
      industrialDistanceKm: 10,
    });

    const time = String(h.acqTime).padStart(4, '0');
    const id = `F-${h.acqDate.replace(/-/g, '')}-${time}-${Math.round(h.latitude * 100)}-${Math.round(h.longitude * 100)}`;
    const detectedAt = new Date(`${h.acqDate}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);

    await prisma.thermalEvent.upsert({
      where: { id },
      update: {
        brightnessKelvin: h.brightness,
        confidence: analysis.confidence,
        risk: analysis.risk,
        classification: analysis.classification,
        source: `NASA_FIRMS_${h.satellite}`,
        features: { firmsConfidence: h.confidence, satellite: h.satellite, frp: h.frp || 0 },
      },
      create: {
        id,
        latitude: h.latitude,
        longitude: h.longitude,
        detectedAt,
        classification: analysis.classification,
        confidence: analysis.confidence,
        risk: analysis.risk,
        brightnessKelvin: h.brightness,
        persistenceScore: 0,
        industrialDistance: 10,
        source: `NASA_FIRMS_${h.satellite}`,
        features: { firmsConfidence: h.confidence, satellite: h.satellite, frp: h.frp || 0 },
        explanations: analysis.explanations,
      },
    });
    savedIds.push(id);
  }

  return { fetched: hotspots.length, persisted: savedIds.length, ids: savedIds };
}
