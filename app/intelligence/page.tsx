'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import CrossEventIntelligence from '@/components/CrossEventIntelligence';

type EventLike = { id:string; name:string; lat:number; lon:number; cls:string; confidence:number; risk:string; brightness:number; persistence:number; detectedAt?:string; time?:string; frp?:number; nearbyFacilities?:number };
type Facility = { latitude:number; longitude:number };

function mapEvent(e:any):EventLike {
  const detectedAt = e.detectedAt || e.timestamp || e.datetime || e.date || undefined;
  return {
    id:String(e.id),
    name:e.location||e.name||`${e.classification||'Thermal event'} · ${Number(e.latitude).toFixed(2)}, ${Number(e.longitude).toFixed(2)}`,
    lat:Number(e.latitude), lon:Number(e.longitude), cls:e.classification||e.cls||'Unknown',
    confidence:Number(e.confidence)||0, risk:e.risk||'MODERATE', brightness:Number(e.brightnessKelvin)||0,
    persistence:Number(e.persistenceScore)||0, frp:Number(e.frp)||Number(e.frpMw)||0, nearbyFacilities:0,
    detectedAt: detectedAt ? new Date(detectedAt).toISOString() : undefined,
    time: detectedAt ? new Date(detectedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST' : e.time
  };
}
function distanceKm(a:EventLike,b:Facility){const r=6371,p=Math.PI/180,dLat=(b.latitude-a.lat)*p,dLon=(b.longitude-a.lon)*p,x=Math.sin(dLat/2)**2+Math.cos(a.lat*p)*Math.cos(b.latitude*p)*Math.sin(dLon/2)**2;return 2*r*Math.asin(Math.min(1,Math.sqrt(x)));}
async function enrichFacilities(events:EventLike[]){return Promise.all(events.map(async event=>{try{const r=await fetch(`/api/facilities?latitude=${event.lat}&longitude=${event.lon}&radiusKm=10`,{cache:'no-store'});const d=await r.json();return{...event,nearbyFacilities:Array.isArray(d.facilities)?d.facilities.filter((f:Facility)=>distanceKm(event,f)<=10).length:0};}catch{return event;}}));}

export default function IntelligencePage(){
 const [events,setEvents]=useState<EventLike[]>([]),[selected,setSelected]=useState<EventLike|null>(null),[source,setSource]=useState(''),[updatedAt,setUpdatedAt]=useState(''),[error,setError]=useState('');
 const load=useCallback(async()=>{try{const r=await fetch('/api/events',{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Unable to load live events');const mapped=(d.events||[]).map(mapEvent).filter((e:EventLike)=>Number.isFinite(e.lat)&&Number.isFinite(e.lon)&&Math.abs(e.lat)<=90&&Math.abs(e.lon)<=180);const enriched=await enrichFacilities(mapped);setEvents(enriched);setSource(d.source||'UNKNOWN');setUpdatedAt(d.generatedAt||new Date().toISOString());setSelected(current=>current&&enriched.some(e=>e.id===current.id)?enriched.find(e=>e.id===current.id)||current:enriched[0]||null);setError('');}catch(e){setError(e instanceof Error?e.message:'Unable to load live events');}},[]);
 useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer)},[load]);
 const selectedEvent=selected||events[0];
 const selectedRegion=useMemo(()=>selectedEvent?`${selectedEvent.lat.toFixed(3)}° N, ${selectedEvent.lon.toFixed(3)}° E`:'No region selected',[selectedEvent]);
 return <main className="app"><section className="section sectionBlock"><div className="workspace"><div className="liveRegionBanner"><span>LIVE DATA REGION</span><b>{selectedRegion}</b><small>{source||'CONNECTING'} · Last refresh {updatedAt?new Date(updatedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Kolkata'}):'—'} IST · Auto-refresh 30s</small></div>{error?<div className="emptyCluster">{error}</div>:!selectedEvent?<div className="emptyCluster">No live thermal events available.</div>:<CrossEventIntelligence events={events} selected={selectedEvent} onSelect={setSelected}/>}</div></section></main>;
}
