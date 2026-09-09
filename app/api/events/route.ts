import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const demoEvents = [
  { id:'TG-1042', classification:'Industrial Fire', confidence:91, risk:'CRITICAL', source:'DEMO', detectedAt:new Date().toISOString(), latitude:22.31, longitude:72.61, brightnessKelvin:342, persistenceScore:88, industrialDistance:0.7 },
  { id:'TG-1037', classification:'Gas Flare', confidence:96, risk:'HIGH', source:'DEMO', detectedAt:new Date().toISOString(), latitude:27.17, longitude:73.21, brightnessKelvin:329, persistenceScore:97, industrialDistance:1.1 },
  { id:'TG-1028', classification:'Crop Burning', confidence:86, risk:'MODERATE', source:'DEMO', detectedAt:new Date().toISOString(), latitude:29.06, longitude:76.08, brightnessKelvin:318, persistenceScore:43, industrialDistance:18.4 },
  { id:'TG-1019', classification:'Wildfire', confidence:84, risk:'HIGH', source:'DEMO', detectedAt:new Date().toISOString(), latitude:20.26, longitude:84.27, brightnessKelvin:337, persistenceScore:29, industrialDistance:31.2 }
];

function shape(e:any){
  return {id:e.id,classification:e.classification,confidence:e.confidence,risk:e.risk,source:e.source,detectedAt:e.detectedAt,latitude:e.latitude,longitude:e.longitude,brightnessKelvin:e.brightnessKelvin,persistenceScore:e.persistenceScore,industrialDistance:e.industrialDistance,landCover:e.landCover};
}

export async function GET(){
  try{
    if(process.env.DATABASE_URL){
      const events=await prisma.thermalEvent.findMany({orderBy:{detectedAt:'desc'},take:500});
      if(events.length) return NextResponse.json({ok:true,source:'POSTGRES',events:events.map(shape),generatedAt:new Date().toISOString()});
    }
  }catch{}
  return NextResponse.json({ok:true,source:'DEMO_DATA',events:demoEvents,generatedAt:new Date().toISOString()});
}

export async function POST(req:Request){
  const body=await req.json().catch(()=>({}));
  const now=new Date();
  const event={
    id:`SIM-${Date.now().toString().slice(-8)}`,
    latitude:Number(body.latitude)||23.0225,
    longitude:Number(body.longitude)||72.5714,
    detectedAt:now,
    classification:body.classification||'Industrial Fire',
    confidence:Number(body.confidence)||94,
    risk:body.risk||'CRITICAL',
    source:'SIMULATION',
    brightnessKelvin:Number(body.brightnessKelvin)||350,
    persistenceScore:Number(body.persistenceScore)||82,
    industrialDistance:Number(body.industrialDistance)||0.5,
    landCover:body.landCover||'Built-up / industrial context'
  };
  try{
    if(process.env.DATABASE_URL){
      const saved=await prisma.thermalEvent.create({data:event});
      return NextResponse.json({ok:true,event:shape(saved),persisted:true},{status:201});
    }
  }catch{}
  return NextResponse.json({ok:true,event:shape(event),persisted:false},{status:201});
}
