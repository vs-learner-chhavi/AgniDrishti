'use client';
import {useEffect,useRef} from 'react';

type MapEvent={id:string;latitude:number;longitude:number;risk:string;confidence:number;classification:string};
type LayerSet={halo:any;core:any;ring:any;marker:any};

const palette=(risk:string)=>risk==='CRITICAL'?{stroke:'#ff6b57',fill:'#ff4f32'}:risk==='HIGH'?{stroke:'#ffc15a',fill:'#ff9d2e'}:{stroke:'#48d6b0',fill:'#28b8a0'};

export default function LiveMap({events,selectedId,onSelect,pulse=false}:{events:MapEvent[];selectedId?:string;onSelect:(id:string)=>void;pulse?:boolean}){
 const mapRef=useRef<HTMLDivElement>(null),instanceRef=useRef<any>(null);
 useEffect(()=>{
  let mounted=true;
  import('leaflet').then(L=>{
   if(!mounted||!mapRef.current)return;
   if(!instanceRef.current){
    const map=L.map(mapRef.current,{zoomControl:false,attributionControl:true}).setView([22.5,79],5);
    L.control.zoom({position:'bottomright'}).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);
    instanceRef.current={map,layers:new Map<string,LayerSet>()};
   }
   const {map,layers}=instanceRef.current;
   events.forEach(event=>{
    layers.get(event.id)?.halo.remove();layers.get(event.id)?.core.remove();layers.get(event.id)?.ring.remove();layers.get(event.id)?.marker.remove();
    const c=palette(event.risk),intensity=Math.max(8,Math.min(28,(event.confidence/100)*22));
    const halo=L.circle([event.latitude,event.longitude],{radius:intensity*900,stroke:false,fillColor:c.fill,fillOpacity:.09}).addTo(map);
    const core=L.circle([event.latitude,event.longitude],{radius:Math.max(500,intensity*110),weight:event.id===selectedId?3:2,color:c.stroke,fillColor:c.fill,fillOpacity:.72}).addTo(map);
    const ring=L.circle([event.latitude,event.longitude],{radius:Math.max(850,intensity*185),weight:1,color:c.stroke,fillOpacity:0,opacity:event.id===selectedId?.9:.42}).addTo(map);
    const marker=L.circleMarker([event.latitude,event.longitude],{radius:event.id===selectedId?6:4,weight:1,color:'#fff',fillColor:c.fill,fillOpacity:.95}).addTo(map);
    const label=`${event.id} · ${event.classification} · ${event.confidence}% confidence · ${event.risk}`;
    [halo,core,ring,marker].forEach((layer:any)=>{layer.bindTooltip(label,{direction:'top',offset:[0,-7]});layer.on('click',()=>onSelect(event.id));});
    layers.set(event.id,{halo,core,ring,marker});
   });
   layers.forEach((set:LayerSet,id:string)=>{if(!events.some(e=>e.id===id)){set.halo.remove();set.core.remove();set.ring.remove();set.marker.remove();layers.delete(id);}});
   map.invalidateSize();
  });
  return()=>{mounted=false};
 },[events,selectedId,onSelect,pulse]);
 useEffect(()=>{
  if(!pulse||!instanceRef.current)return;
  const timer=setInterval(()=>{instanceRef.current?.layers.forEach((set:LayerSet)=>{const r=set.ring.getRadius();set.ring.setRadius(r>9000?900:r+450);set.ring.setStyle({opacity:r>9000?.35:.7});});},900);
  return()=>clearInterval(timer);
 },[pulse]);
 return <div ref={mapRef} className="realMap" aria-label="Interactive India thermal activity map"/>;
}
