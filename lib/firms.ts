export type FirmsHotspot={latitude:number;longitude:number;brightness:number;confidence:number;acqDate:string;acqTime:string;satellite:string;frp?:number};

export async function fetchFirmsHotspots(country='IND',days=1):Promise<FirmsHotspot[]> {
 const key=process.env.FIRMS_MAP_KEY;
 if(!key) throw new Error('FIRMS_MAP_KEY is not configured');
 const source=process.env.FIRMS_SOURCE||'VIIRS_SNPP_NRT';
 const url=`https://firms.modaps.eosdis.nasa.gov/api/country/csv/${key}/${source}/${country}/${days}`;
 const response=await fetch(url,{cache:'no-store'});
 if(!response.ok) throw new Error(`NASA FIRMS request failed: ${response.status}`);
 const csv=await response.text();
 return parseFirmsCsv(csv);
}

function parseFirmsCsv(csv:string):FirmsHotspot[]{
 const lines=csv.trim().split(/\r?\n/); if(lines.length<2)return[];
 const headers=lines[0].split(',');
 const idx=(name:string)=>headers.indexOf(name);
 return lines.slice(1).map(line=>splitCsv(line)).map(row=>({
  latitude:Number(row[idx('latitude')]),longitude:Number(row[idx('longitude')]),
  brightness:Number(row[idx('bright_ti4')]||row[idx('bright_ti5')]||0),
  confidence:Number(row[idx('confidence')]||0),acqDate:row[idx('acq_date')]||'',
  acqTime:row[idx('acq_time')]||'',satellite:row[idx('satellite')]||'',frp:Number(row[idx('frp')]||0)
 })).filter(x=>Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
}
function splitCsv(line:string){const out:string[]=[];let cur='',quoted=false;for(const ch of line){if(ch==='"')quoted=!quoted;else if(ch===','&&!quoted){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out.map(x=>x.replace(/^"|"$/g,''));}
