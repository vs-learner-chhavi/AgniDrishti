export type ClusterableEvent = { id: string; lat: number | string; lon: number | string; detectedAt?: string | number | Date | null; time?: string | null };

export const EARTH_RADIUS_KM = 6371;

export function toCoordinate(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseEventTime(event: ClusterableEvent): number | null {
  const value = event.detectedAt ?? event.time;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function haversineKm(a: ClusterableEvent, b: ClusterableEvent): number {
  const lat1 = toCoordinate(a.lat);
  const lon1 = toCoordinate(a.lon);
  const lat2 = toCoordinate(b.lat);
  const lon2 = toCoordinate(b.lon);
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function areEventsRelated(a: ClusterableEvent, b: ClusterableEvent, radiusKm: number, windowHours: number): boolean {
  const distance = haversineKm(a, b);
  if (!Number.isFinite(distance) || distance > radiusKm) return false;
  const ta = parseEventTime(a);
  const tb = parseEventTime(b);
  if (ta === null || tb === null) return true;
  return Math.abs(ta - tb) <= windowHours * 60 * 60 * 1000;
}

export type EventCluster<T extends ClusterableEvent> = { id: string; events: T[]; center: { latitude: number; longitude: number }; geographicRadiusKm: number; timeSpanHours: number };

export function buildEventClusters<T extends ClusterableEvent>(events: T[], radiusKm = 25, windowHours = 168): EventCluster<T>[] {
  const usable = events.filter((event, index, list) => {
    const lat = toCoordinate(event.lat); const lon = toCoordinate(event.lon);
    return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && list.findIndex(item => item.id === event.id) === index;
  });
  const visited = new Set<string>(); const clusters: EventCluster<T>[] = [];
  for (const seed of usable) {
    if (visited.has(seed.id)) continue;
    const queue: T[] = [seed]; const members: T[] = []; visited.add(seed.id);
    while (queue.length) {
      const current = queue.shift()!; members.push(current);
      for (const candidate of usable) if (!visited.has(candidate.id) && areEventsRelated(current, candidate, radiusKm, windowHours)) { visited.add(candidate.id); queue.push(candidate); }
    }
    const coords = members.map(event => ({ latitude: toCoordinate(event.lat)!, longitude: toCoordinate(event.lon)! }));
    const center = { latitude: coords.reduce((sum, p) => sum + p.latitude, 0) / coords.length, longitude: coords.reduce((sum, p) => sum + p.longitude, 0) / coords.length };
    const times = members.map(parseEventTime).filter((time): time is number => time !== null).sort((a, b) => a - b);
    clusters.push({ id: `cluster-${clusters.length + 1}`, events: members, center, geographicRadiusKm: Math.max(0, ...members.map(event => haversineKm({ ...event, lat: center.latitude, lon: center.longitude }, event))), timeSpanHours: times.length > 1 ? (times[times.length - 1] - times[0]) / 3600000 : 0 });
  }
  return clusters.sort((a, b) => b.events.length - a.events.length);
}
