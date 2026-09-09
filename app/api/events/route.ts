import { NextResponse } from 'next/server';

const demoEvents = [
  { id:'TG-1042', classification:'Industrial Fire', confidence:91, risk:'CRITICAL', source:'DEMO', detectedAt:new Date().toISOString() },
  { id:'TG-1037', classification:'Gas Flare', confidence:96, risk:'HIGH', source:'DEMO', detectedAt:new Date().toISOString() },
  { id:'TG-1028', classification:'Crop Burning', confidence:86, risk:'MODERATE', source:'DEMO', detectedAt:new Date().toISOString() }
];

export async function GET(){
  return NextResponse.json({ok:true, source:'DEMO_DATA', events:demoEvents, generatedAt:new Date().toISOString()});
}

export async function POST(req:Request){
  const body=await req.json().catch(()=>({}));
  const event={id:`TG-${Date.now().toString().slice(-5)}`,classification:body.classification||'Industrial Fire',confidence:94,risk:'HIGH',source:'SIMULATION',detectedAt:new Date().toISOString(),location:body.location||'Demo location'};
  return NextResponse.json({ok:true,event},{status:201});
}
