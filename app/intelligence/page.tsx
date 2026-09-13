'use client';

import { useEffect, useState } from 'react';
import CrossEventIntelligence from '@/components/CrossEventIntelligence';
import styles from '@/components/CrossEventIntelligence.module.css';

type EventLike={id:string;name:string;lat:number;lon:number;cls:string;confidence:number;risk:string;brightness:number;persistence:number;detectedAt?:string;time?:string};
const fallback:EventLike[]=[
 {id:'TG-1042',name:'Historical recurring source · Jharkhand',lat:23.77591,lon:86.38096,cls:'Industrial Fire',confidence:91,risk:'CRITICAL',brightness:342,persistence:88,time:'14:32 IST'},
 {id:'TG-1037',name:'Gas infrastructure · Rajasthan',lat:27.17,lon:73.21,cls:'Gas Flare',confidence:96,risk:'HIGH',brightness:329,persistence:97,time:'13:58 IST'},
 {id:'TG-1028',name:'Agricultural belt · Haryana',lat:29.06,lon:76.08,cls:'Crop Burning',confidence:86,risk:'MODERATE',brightness:318,persistence:43,time:'13:41 IST'},
];
function mapEvent(e:any):EventLike{return{id:e.id,name:e.location||e.name||`${e.classification} · ${Number(e.latitude).toFixed(2)}, ${Number(e.longitude).toFixed(2)}`,lat:Number(e.latitude),lon:Number(e.longitude),cls:e.classification||e.cls,confidence:Number(e.confidence)||0,risk:e.risk||'MODERATE',brightness:Number(e.brightnessKelvin)||0,persistence:Number(e.persistenceScore)||0,detectedAt:e.detectedAt,time:e.detectedAt?new Date(e.detectedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST':e.time};}
export default function IntelligencePage(){const[events,setEvents]=useState<EventLike[]>(fallback);const[selected,setSelected]=useState<EventLike>(fallback[0]);useEffect(()=>{fetch('/api/events',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.ok&&d.events?.length){const mapped=d.events.map(mapEvent);setEvents(mapped);const requested=new URLSearchParams(window.location.search).get('event');setSelected(mapped.find((e:EventLike)=>e.id===requested)||mapped[0]);}}).catch(()=>{});},[]);return <main className="app"><section className="section sectionBlock"><div className={styles.workspace}><CrossEventIntelligence events={events} selected={selected} onSelect={setSelected}/></div></section></main>;}
