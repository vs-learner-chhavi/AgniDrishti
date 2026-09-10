import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {classifyThermalEvent} from '@/lib/classifier';

const demoEvents=[
 {id:'TG-1042',classification:'Industrial Fire',confidence:91,risk:'CRITICAL',source:'DEMO',detectedAt:new Date().toISOString(),latitude:22.31,longitude:72.61,brightnessKelvin:342,persistenceScore:88,industrialDistance:0.7,landCover:'industrial'},
 {id:'TG-1037',classification:'Gas Flare',confidence:96,risk:'HIGH',source:'DEMO',detectedAt:new Date().toISOString(),latitude:27.17,longitude:73.21,brightnessKelvin:329,persistenceScore:97,industrialDistance:1.1,landCover:'industrial'},
 {id:'TG-1028',classification:'Crop Burning',confidence:86,risk:'MODERATE',source:'DEMO',detectedAt:new Date().toISOString(),latitude:29.06,longitude:76.08,brightnessKelvin:318,persistenceScore:43,industrialDistance:18.4,landCover:'cropland'},
 {id:'TG-1019',classification:'Wildfire',confidence:84,risk:'HIGH',source:'DEMO',detectedAt:new Date().toISOString(),latitude:20.26,longitude:84.27,brightnessKelvin:337,persistenceScore:29,industrialDistance:31.2,landCover:'forest'}
];

function explain(e:any){return classifyThermalEvent({brightnessKelvin:Number(e.brightnessKelvin)||0,firmsConfidence:Number(e.firmsConfidence||e.confidence)||0,persistence:Number(e.persistenceScore)||0,industrialDistanceKm:Number(e.industrialDistance)||99,landCover:e.landCover||'unknown'}).explanations;}
function shape(e:any){return {id:e.id,classification:e.classification,confidence:e.confidence,risk:e.risk,source:e.source,detectedAt:e.detectedAt,latitude:e.latitude,longitude:e.longitude,brightnessKelvin:e.brightnessKelvin,persistenceScore:e.persistenceScore,industrialDistance:e.industrialDistance,landCover:e.landCover,explanations:e.explanations||explain(e)};}

export async function GET(){
 try{
  if(process.env.DATABASE_URL){const events=await prisma.thermalEvent.findMany({orderBy:{detectedAt:'desc'},take:500});if(events.length)return NextResponse.json({ok:true,source:'POSTGRES',events:events.map(shape),generatedAt:new Date().toISOString()});}
 }catch{}
 return NextResponse.json({ok:true,source:'DEMO_DATA',events:demoEvents.map(shape),generatedAt:new Date().toISOString()});
}

export async function POST(req:Request){
 const body=await req.json().catch(()=>({}));
 const now=new Date();
 const latitude=Number(body.latitude)||23.0225;
 const longitude=Number(body.longitude)||72.5714;
 const brightness=Math.min(380,Math.max(280,Number(body.brightnessKelvin)||350));
 const persistence=Math.min(100,Math.max(0,Number(body.persistenceScore)||82));
 const distance=Math.max(0,Number(body.industrialDistance)||0.7);
 const firmsConfidence=Math.min(100,Math.max(50,Number(body.firmsConfidence)||94));
 const analysis=classifyThermalEvent({brightnessKelvin:brightness,firmsConfidence,persistence,industrialDistanceKm:distance,landCover:body.landCover||'industrial'});
 const event={id:`SIM-${Date.now().toString().slice(-8)}`,latitude,longitude,detectedAt:now,classification:analysis.classification,confidence:analysis.confidence,risk:analysis.risk,source:'SIMULATION',brightnessKelvin:brightness,persistenceScore:persistence,industrialDistance:distance,landCover:body.landCover||'industrial',explanations:analysis.explanations};
 try{
  if(process.env.DATABASE_URL){const saved=await prisma.thermalEvent.create({data:{...event,features:{firmsConfidence},explanations:analysis.explanations}});return NextResponse.json({ok:true,event:shape(saved),persisted:true},{status:201});}
 }catch{}
 return NextResponse.json({ok:true,event:shape(event),persisted:false},{status:201});
}
