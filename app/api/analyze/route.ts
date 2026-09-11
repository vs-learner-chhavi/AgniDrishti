import {NextResponse} from 'next/server';
import {fetchFirmsHotspots, type FirmsHotspot} from '@/lib/firms';
import {findNearbyFacilities} from '@/lib/overpass';
import {estimatePersistence} from '@/lib/persistence';
import {classifyThermalEvent} from '@/lib/classifier';
import {lookupWorldCover} from '@/lib/worldcover';

function demoHotspot(latitude:number, longitude:number, body:any):FirmsHotspot {
 const brightness=Math.min(380,Math.max(280,Number(body.brightnessKelvin)||348));
 const confidence=Math.min(100,Math.max(50,Number(body.firmsConfidence)||94));
 const now=new Date();
 const detected=body.detectedAt?new Date(body.detectedAt):now;
 return {latitude,longitude,brightness,confidence,acqDate:detected.toISOString().slice(0,10),acqTime:detected.toISOString().slice(11,16).replace(':',''),satellite:body.satellite||'SIMULATION',frp:Number(body.frp)||0};
}

export async function POST(req:Request){
 try{
  const body=await req.json().catch(()=>({}));
  const latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return NextResponse.json({ok:false,error:'latitude and longitude are required'},{status:400});
  const radius=Number(body.radiusMeters)||10000,isArchive=body.observationSource==='NASA_ARCHIVE';
  let history:FirmsHotspot[]=[];
  let current:FirmsHotspot|null=null;
  let source:'NASA_FIRMS'|'NASA_ARCHIVE'|'DEMO_SIMULATION'=isArchive?'NASA_ARCHIVE':'NASA_FIRMS';

  if(process.env.FIRMS_MAP_KEY){
   try{
    history=await fetchFirmsHotspots('IND',Number(body.days)||7);
    current=history.filter(h=>Math.abs(h.latitude-latitude)<0.2&&Math.abs(h.longitude-longitude)<0.2).sort((a,b)=>b.brightness-a.brightness)[0]||null;
   }catch{}
  }

  if(!current&&isArchive){current=demoHotspot(latitude,longitude,body);history=[];source='NASA_ARCHIVE';}
  if(!current){
   source='DEMO_SIMULATION';
   current=demoHotspot(latitude,longitude,body);
   history=Array.from({length:14},(_,i)=>({...current!,latitude:latitude+(Math.sin(i*1.7)*0.006),longitude:longitude+(Math.cos(i*1.3)*0.006),brightness:Math.max(285,current!.brightness-i*1.7+(i%3)*5),confidence:Math.max(65,current!.confidence-i%4)}));
  }

  let facilities:any[]=[],facilityLookupStatus:'complete'|'unavailable'='complete';
  try{facilities=await findNearbyFacilities(current.latitude,current.longitude,radius);if(!facilities.length&&radius<25000)facilities=await findNearbyFacilities(current.latitude,current.longitude,25000);}catch{facilityLookupStatus='unavailable'}
  const fallbackDistance=Number(body.industrialDistanceKm);
  const nearest=facilities[0]?.distanceKm??(Number.isFinite(fallbackDistance)?fallbackDistance:source==='DEMO_SIMULATION'?0.8:99);
  const persistence=isArchive
   ? {score:Math.min(100,Math.max(0,Number(body.persistence)||0)),observations:Math.max(0,Number(body.persistenceObservations)||0),persistenceDays:Math.max(0,Number(body.persistenceDays)||0),windowDays:30}
   : source==='DEMO_SIMULATION'
   ? {score:Math.min(99,Math.max(8,Number(body.persistence)||82)),hotspotCount:history.length}
   : estimatePersistence(current,history,Number(body.windowDays)||30);
  const landCoverContext=body.landCover?{code:-1,label:String(body.landCover)}:await lookupWorldCover(current.latitude,current.longitude);
  const landCover=landCoverContext.code===10?'forest':landCoverContext.code===40?'cropland':'unknown';
  const result=classifyThermalEvent({brightnessKelvin:current.brightness,firmsConfidence:current.confidence,persistence:persistence.score,industrialDistanceKm:nearest,landCover});
  return NextResponse.json({ok:true,event:{hotspot:current,persistence,nearestFacility:facilities[0]||null,facilities,facilityLookupStatus,landCoverContext,result,source,analysisMode:isArchive?'ARCHIVE CONTEXT ONLY':source==='NASA_FIRMS'?'LIVE MULTISOURCE':'DEMO MULTISOURCE'},generatedAt:new Date().toISOString()});
 }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Analysis failed'},{status:500});}
}
