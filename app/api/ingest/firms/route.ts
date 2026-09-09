import { NextResponse } from 'next/server';
import { fetchFirmsHotspots } from '@/lib/firms';
import { classifyThermalEvent } from '@/lib/classifier';
import { prisma } from '@/lib/prisma';

export async function POST(){
 if(!process.env.FIRMS_MAP_KEY)return NextResponse.json({ok:false,error:'FIRMS_MAP_KEY is not configured'},{status:503});
 try{
  const hotspots=await fetchFirmsHotspots('IND',Number(process.env.FIRMS_DAYS||1));
  if(!process.env.DATABASE_URL)return NextResponse.json({ok:true,persisted:false,count:hotspots.length,hotspots});
  const results=[];
  for(const h of hotspots.slice(0,500)){
   const analysis=classifyThermalEvent({brightnessKelvin:h.brightness,firmsConfidence:h.confidence,persistence:0,industrialDistanceKm:10});
   const id=`F-${h.acqDate.replace(/-/g,'')}-${Math.round(h.latitude*100)}-${Math.round(h.longitude*100)}`;
   const event=await prisma.thermalEvent.upsert({where:{id},update:{brightnessKelvin:h.brightness,confidence:analysis.confidence,risk:analysis.risk},create:{id,latitude:h.latitude,longitude:h.longitude,detectedAt:new Date(`${h.acqDate}T${String(h.acqTime).padStart(4,'0').slice(0,2)}:${String(h.acqTime).padStart(4,'0').slice(2)}:00Z`),classification:analysis.classification,confidence:analysis.confidence,risk:analysis.risk,brightnessKelvin:h.brightness,persistenceScore:0,industrialDistance:10,source:`NASA_FIRMS_${h.satellite}`,explanations:analysis.explanations}});
   results.push(event.id);
  }
  return NextResponse.json({ok:true,persisted:true,count:results.length,ids:results});
 }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'FIRMS ingestion failed'},{status:502});}
}
