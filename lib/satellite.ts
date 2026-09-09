export type SatelliteEvidence = { available:boolean; provider:string; url?:string; note:string };

/** Returns a deterministic Sentinel-2 search link for the selected hotspot.
 * It is intentionally a discovery link: imagery availability/cloud cover must be
 * checked by the operator rather than fabricated by the application.
 */
export function sentinel2Evidence(latitude:number, longitude:number, days=30):SatelliteEvidence {
  const end = new Date();
  const start = new Date(end.getTime() - days*86400000);
  const fmt = (d:Date) => d.toISOString().slice(0,10);
  const url = `https://browser.dataspace.copernicus.eu/?zoom=8&lat=${latitude}&lng=${longitude}&dataset=ESA%20Sentinel-2&from=${fmt(start)}&to=${fmt(end)}`;
  return { available:true, provider:'Copernicus Sentinel-2', url, note:'Open satellite evidence for visual verification; cloud cover and scene availability vary.' };
}
