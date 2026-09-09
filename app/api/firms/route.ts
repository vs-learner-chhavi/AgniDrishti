import {NextResponse} from 'next/server';
import {fetchFirmsHotspots} from '@/lib/firms';

export async function GET(req:Request){
 const {searchParams}=new URL(req.url);
 const country=searchParams.get('country')||'IND';
 const days=Math.min(10,Math.max(1,Number(searchParams.get('days')||1)));
 try{const hotspots=await fetchFirmsHotspots(country,days);return NextResponse.json({ok:true,source:'NASA FIRMS',country,days,count:hotspots.length,hotspots,generatedAt:new Date().toISOString()});}
 catch(error){return NextResponse.json({ok:false,source:'NASA FIRMS',error:error instanceof Error?error.message:'FIRMS unavailable'},{status:503});}
}
