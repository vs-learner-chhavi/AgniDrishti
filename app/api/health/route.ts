import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(){
  let database='unconfigured';
  if(process.env.DATABASE_URL){
    try{await prisma.$queryRaw`SELECT 1`;database='connected';}catch{database='error';}
  }
  return NextResponse.json({ok:database!=='error',service:'AgniDrishti',database,firmsConfigured:Boolean(process.env.FIRMS_MAP_KEY),demoMode:process.env.DEMO_MODE!=='false',timestamp:new Date().toISOString()});
}
