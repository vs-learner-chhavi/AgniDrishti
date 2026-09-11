'use client';
import {useEffect,useRef} from 'react';

export type MapMode='hotspots'|'density';
export type MapLayers={thermal:boolean;markers:boolean;halos:boolean;labels:boolean};
export type ThermalSignal={latitude:number;longitude:number;brightness:number;frp:number;date:string};
type MapEvent={id:string;latitude:number;longitude:number;risk:string;confidence:number;classification:string;brightness:number;persistence:number};
type LayerSet={halo:any;core:any;ring:any;marker:any};

const classPalette:Record<string,{stroke:string;fill:string}>={
 'Industrial Fire':{stroke:'#ff8b78',fill:'#f2543f'},
 'Gas Flare':{stroke:'#c99cff',fill:'#9258d8'},
 'Crop Burning':{stroke:'#ffd06f',fill:'#e9a432'},
 'Wildfire':{stroke:'#7ce0a3',fill:'#39ad69'},
 'Mining':{stroke:'#75cfff',fill:'#318fca'}
};
const riskScale:Record<string,number>={LOW:.6,MODERATE:.78,HIGH:1,CRITICAL:1.25};

export default function LiveMap({events,densityEvents=[],selectedId,onSelect,mode='hotspots',layers:layerOptions={thermal:true,markers:true,halos:true,labels:true}}:{events:MapEvent[];densityEvents?:ThermalSignal[];selectedId?:string;onSelect:(id:string)=>void;mode?:MapMode;layers?:MapLayers}){
 const mapRef=useRef<HTMLDivElement>(null),instanceRef=useRef<any>(null);
 useEffect(()=>{
  let mounted=true;
  Promise.all([import('leaflet'),import('leaflet.heat')]).then(([leaflet])=>{
   const L:any=leaflet.default;
   if(!mounted||!mapRef.current)return;
   if(!instanceRef.current){
    const map=L.map(mapRef.current,{zoomControl:false,attributionControl:true,minZoom:4}).setView([22.5,79],5);
    L.control.zoom({position:'bottomright'}).addTo(map);
    const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);
    instanceRef.current={map,tiles,layers:new Map<string,LayerSet>(),heat:null};
   }
   const state=instanceRef.current,{map,layers}=state;
   map.getContainer().classList.toggle('hideMapLabels',!layerOptions.labels);
   if(state.heat){state.heat.remove();state.heat=null;}
   layers.forEach((set:LayerSet)=>{set.halo.remove();set.core.remove();set.ring.remove();set.marker.remove();});
   layers.clear();

   if(mode==='density'&&layerOptions.thermal&&densityEvents.length){
    const points=densityEvents.map(event=>{
     const thermal=Math.max(.08,Math.min(1,(event.brightness-295)/65));
     const radiative=Math.max(.05,Math.min(1,event.frp/80));
     return [event.latitude,event.longitude,Math.min(1,thermal*.65+radiative*.35)];
    });
    state.heat=L.heatLayer(points,{radius:34,blur:26,maxZoom:8,minOpacity:.28,gradient:{.2:'#28b8a0',.45:'#f0c849',.68:'#f28b38',1:'#ef3f35'}}).addTo(map);
   }

   events.forEach(event=>{
    const c=classPalette[event.classification]||{stroke:'#a6c6d9',fill:'#5f8298'};
    const risk=riskScale[event.risk]||.7,selected=event.id===selectedId;
    const base=Math.max(6,Math.min(18,5+(event.confidence/100)*8))*risk;
    const halo=L.circle([event.latitude,event.longitude],{radius:base*1150,stroke:false,fillColor:c.fill,fillOpacity:mode==='hotspots'&&layerOptions.halos?.11:0,interactive:mode==='hotspots'}).addTo(map);
    const core=L.circle([event.latitude,event.longitude],{radius:Math.max(450,base*125),weight:selected?3:1.5,color:c.stroke,fillColor:c.fill,fillOpacity:mode==='hotspots'&&layerOptions.markers?.78:0,opacity:mode==='hotspots'&&layerOptions.markers?1:0,interactive:mode==='hotspots'}).addTo(map);
    const ring=L.circle([event.latitude,event.longitude],{radius:Math.max(750,base*210),weight:selected?2:1,color:c.stroke,fillOpacity:0,opacity:mode==='hotspots'&&layerOptions.halos?(selected?.95:.38):0,interactive:false}).addTo(map);
    const marker=L.circleMarker([event.latitude,event.longitude],{radius:mode==='density'?(selected?6:3):(selected?7:4),weight:selected?3:1,color:c.stroke,fillColor:c.fill,fillOpacity:layerOptions.markers?(mode==='density'?.72:.96):0,opacity:layerOptions.markers?1:0}).addTo(map);
    const label=`${event.id} · ${event.classification} · ${event.confidence}% confidence · ${event.risk}`;
    marker.bindTooltip(label,{direction:'top',offset:[0,-7]});marker.on('click',()=>onSelect(event.id));
    if(mode==='hotspots'){[halo,core].forEach((x:any)=>{x.bindTooltip(label,{direction:'top',offset:[0,-7]});x.on('click',()=>onSelect(event.id));});}
    layers.set(event.id,{halo,core,ring,marker});
   });
   map.invalidateSize();
  }).catch(()=>{});
  return()=>{mounted=false};
 },[events,densityEvents,selectedId,onSelect,mode,layerOptions]);
 return <div ref={mapRef} className="realMap" aria-label={`Interactive India ${mode==='density'?'thermal-risk density':'thermal hotspot'} map`}/>;
}
