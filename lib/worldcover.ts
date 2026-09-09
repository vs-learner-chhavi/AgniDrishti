export type LandCoverContext = { code: number; label: string; distanceToForestKm?: number };

const labels: Record<number,string> = {
  10:'Tree cover',20:'Shrubland',30:'Grassland',40:'Cropland',50:'Built-up',60:'Bare / sparse vegetation',70:'Snow and ice',80:'Permanent water bodies',90:'Herbaceous wetland',95:'Mangroves',100:'Moss and lichen'
};

/**
 * Lightweight ESA WorldCover context lookup. Set WORLDCOVER_API_URL to a service
 * exposing a point query that returns a numeric class. The dashboard remains
 * usable without the optional service and reports Unknown rather than inventing data.
 */
export async function lookupWorldCover(latitude:number, longitude:number): Promise<LandCoverContext> {
  const base = process.env.WORLDCOVER_API_URL;
  if (!base) return { code: -1, label: 'Unknown' };
  try {
    const url = new URL(base);
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return { code: -1, label: 'Unknown' };
    const data = await response.json();
    const code = Number(data.code ?? data.class ?? data.value);
    return { code: Number.isFinite(code) ? code : -1, label: labels[code] ?? 'Unknown' };
  } catch {
    return { code: -1, label: 'Unknown' };
  }
}
