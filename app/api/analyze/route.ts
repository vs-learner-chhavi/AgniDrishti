import {NextResponse} from 'next/server';
import {fetchFirmsHotspots} from '@/lib/firms';
import {findNearbyFacilities} from '@/lib/overpass';
import {estimatePersistence} from '@/lib/persistence';
import {classifyThermalEvent} from '@/lib/classifier';

export async function POST(req:Request){
 try{
  const body=await req.json().catch(()=>({}));
  const latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return NextResponse.json({ok:false,error:'latitude and longitude are required'},{status:400});
  const radius=Number(body.radiusMeters)||10000;
  const history=await fetchFirmsHotspots('IND',Number(body.days)||7);
  const current=history.filter(h=>Math.abs(h.latitude-latitude)<0.2&&Math.abs(h.longitude-longitude)<0.2).sort((a,b)=>b.brightness-a.brightness)[0]||history[0];
  if(!current)return NextResponse.json({ok:false,error:'No FIRMS hotspot found for analysis window'},{status:404});
  const facilities=await findNearbyFacilities(current.latitude,current.longitude,radius);
  const persistence=estimatePersistence(current,history,Number(body.windowDays)||30);
  const nearest=facilities[0]?.distanceKm??99;
  const landCover=body.landCover||'unknown';
  const result=classifyThermalEvent({brightnessKelvin:current.brightness,firmsConfidence:current.confidence,persistence:persistence.score,industrialDistanceKm:nearest,landCover});
  return NextResponse.json({ok:true,event:{hotspot:current,persistence,nearestFacility:facilities[0]||null,facilities,result},generatedAt:new Date().toISOString()});
 }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Analysis failed'},{status:500});}
}
