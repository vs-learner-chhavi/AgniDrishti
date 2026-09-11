'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Leaflet from 'leaflet';

export type MapMode='detections'|'density';
export type MapLayers={facilities:boolean;halos:boolean;labels:boolean;imagery:boolean};
export type ThermalSignal={id:string;latitude:number;longitude:number;brightness:number;frp:number;date:string;time:string;confidence:number;satellite:string;persistenceDays:number;persistenceObservations:number;persistenceScore:number};
export type FacilityPoint={name:string;type:string;latitude:number;longitude:number;distanceKm:number};
type MapEvent={id:string;latitude:number;longitude:number;risk:string;confidence:number;classification:string;brightness:number;persistence:number};

const colours:Record<string,string>={'Industrial Fire':'#f2543f','Gas Flare':'#9258d8','Crop Burning':'#e9a432','Wildfire':'#39ad69','Mining':'#318fca','Unclassified thermal anomaly':'#9bb4c6'};

export default function LiveMap({events,densityEvents,facilities,selectedId,onSelect,mode,layers}:{events:MapEvent[];densityEvents:ThermalSignal[];facilities:FacilityPoint[];selectedId:string;onSelect:(id:string)=>void;mode:MapMode;layers:MapLayers}){
 const host=useRef<HTMLDivElement>(null),mapRef=useRef<any>(null),leaflet=useRef<typeof Leaflet|null>(null),drawn=useRef<any[]>([]),tiles=useRef<{street:any;satellite:any}|null>(null),[mapReady,setMapReady]=useState(false);
 useEffect(()=>{let cancelled=false;(async()=>{const L=(await import('leaflet')).default;await import('leaflet.heat');if(cancelled||!host.current||mapRef.current)return;const map=L.map(host.current,{zoomControl:true,attributionControl:true}).setView([22.7,79.2],5);const street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19});const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri',maxZoom:19});street.addTo(map);leaflet.current=L;tiles.current={street,satellite};mapRef.current=map;setMapReady(true);setTimeout(()=>map.invalidateSize(),100)})();return()=>{cancelled=true;if(mapRef.current){mapRef.current.remove();mapRef.current=null}}},[]);
 useEffect(()=>{const map=mapRef.current;if(!map||!tiles.current)return;drawn.current.forEach(x=>map.removeLayer(x));drawn.current=[];const {street,satellite}=tiles.current;if(layers.imagery){if(map.hasLayer(street))map.removeLayer(street);if(!map.hasLayer(satellite))satellite.addTo(map)}else{if(map.hasLayer(satellite))map.removeLayer(satellite);if(!map.hasLayer(street))street.addTo(map)}
  const L=leaflet.current;if(!L)return;
  if(mode==='density'&&(L as any).heatLayer){const heat=(L as any).heatLayer(densityEvents.map(x=>[x.latitude,x.longitude,Math.min(1,.18+(x.brightness-280)/100+x.frp/500)]),{radius:18,blur:23,maxZoom:8,gradient:{.15:'#28b8a0',.45:'#f0c849',.7:'#f28b38',1:'#ef3f35'}}).addTo(map);drawn.current.push(heat)}
  if(mode==='detections')events.forEach(e=>{const selected=e.id===selectedId,c=colours[e.classification]||'#9bb4c6';if(layers.halos&&e.risk!=='MODERATE'){const halo=L.circle([e.latitude,e.longitude],{radius:e.risk==='CRITICAL'?26000:16000,color:c,weight:1,fillColor:c,fillOpacity:.06,opacity:.32}).addTo(map);drawn.current.push(halo)}const marker=L.circleMarker([e.latitude,e.longitude],{radius:selected?8:4,color:selected?'#fff':c,weight:selected?2:1,fillColor:c,fillOpacity:.9}).addTo(map);marker.bindTooltip(`<b>${e.classification}</b><br>${e.brightness.toFixed(1)} K${e.confidence?` · ${e.confidence}% confidence`:'<br>Awaiting model classification'}`);marker.on('click',()=>onSelect(e.id));drawn.current.push(marker)});
  if(layers.facilities)facilities.forEach(f=>{const m=L.circleMarker([f.latitude,f.longitude],{radius:5,color:'#65d5ff',weight:2,fillColor:'#071522',fillOpacity:1}).addTo(map);m.bindTooltip(`<b>${f.name}</b><br>${f.type} · ${f.distanceKm.toFixed(1)} km`);drawn.current.push(m)});
  const selected=events.find(e=>e.id===selectedId);if(layers.imagery&&selected)map.setView([selected.latitude,selected.longitude],Math.max(map.getZoom(),10));host.current?.classList.toggle('hideMapLabels',!layers.labels&&!layers.imagery);
 },[events,densityEvents,facilities,selectedId,onSelect,mode,layers,mapReady]);
 return <div ref={host} className="liveMap" aria-label="Interactive thermal activity map"/>;
}
