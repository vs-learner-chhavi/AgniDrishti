import {NextResponse} from 'next/server';

const alerts:{id:string;eventId:string;severity:string;message:string;createdAt:string}[]=[];
export async function GET(){return NextResponse.json({ok:true,alerts});}
export async function POST(req:Request){const body=await req.json().catch(()=>({}));const alert={id:`AL-${Date.now().toString().slice(-7)}`,eventId:String(body.eventId||'UNKNOWN'),severity:String(body.severity||'HIGH'),message:String(body.message||'Priority thermal event requires verification.'),createdAt:new Date().toISOString()};alerts.unshift(alert);return NextResponse.json({ok:true,alert},{status:201});}
