export type Facility={name:string;type:string;latitude:number;longitude:number;distanceKm:number;source:'OSM'};

const facilityQuery=`[out:json][timeout:25];(nwr(around:RADIUS,LAT,LON)[industrial];nwr(around:RADIUS,LAT,LON)[landuse=industrial];nwr(around:RADIUS,LAT,LON)[power=plant];nwr(around:RADIUS,LAT,LON)[man_made=works];nwr(around:RADIUS,LAT,LON)[man_made=petroleum_well];);out center tags;`;

export async function findNearbyFacilities(lat:number,lon:number,radiusMeters=10000):Promise<Facility[]> {
 const query=facilityQuery.replaceAll('RADIUS',String(radiusMeters)).replaceAll('LAT',String(lat)).replaceAll('LON',String(lon));
 const response=await fetch(process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:query}),cache:'no-store'});
 if(!response.ok) throw new Error(`Overpass request failed: ${response.status}`);
 const json=await response.json() as {elements?:any[]};
 return (json.elements||[]).map((e:any)=>{const p=e.lat!=null?e:{...e,...e.center};const type=e.tags?.industrial||e.tags?.power||e.tags?.landuse||e.tags?.man_made||'industrial';return {name:e.tags?.name||'Unnamed facility',type,latitude:Number(p.lat),longitude:Number(p.lon),distanceKm:haversineKm(lat,lon,Number(p.lat),Number(p.lon)),source:'OSM' as const};}).filter((x:Facility)=>Number.isFinite(x.latitude)&&Number.isFinite(x.longitude)).sort((a:Facility,b:Facility)=>a.distanceKm-b.distanceKm).slice(0,20);
}
function haversineKm(a:number,b:number,c:number,d:number){const R=6371,toRad=(x:number)=>x*Math.PI/180;const p1=toRad(a),p2=toRad(c),dp=toRad(c-a),dl=toRad(d-b);const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
