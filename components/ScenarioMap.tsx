'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import {terrainTiles,terrainOptions,loadIndiaBoundaries,addIndiaBoundaries} from '@/lib/india-map';

type Point = { latitude: number; longitude: number };
export default function ScenarioMap({ point, runs, onPick }: {
  point: Point | null; runs: (Point & { id: string; label: string })[];
  onPick: (point: Point) => void;
}) {
  const [mapError,setMapError]=useState('');
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const overlays = useRef<Leaflet.LayerGroup | null>(null);
  const pick = useRef(onPick);
  const current = useRef({ point, runs });
  const redraw = useRef<() => void>(() => {});
  pick.current = onPick;
  current.current = { point, runs };
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void Promise.all([import('leaflet'),loadIndiaBoundaries()]).then(([{ default: L },boundaries]) => {
      if (disposed || !host.current) return;
      const instance = L.map(host.current).setView([22.7, 79.2], 4);
      map.current = instance;
      L.tileLayer(terrainTiles,terrainOptions).addTo(instance);
      addIndiaBoundaries(L,instance,boundaries);
      overlays.current = L.layerGroup().addTo(instance);
      instance.on('click', e => {
        const position = e.latlng.wrap();
        pick.current({ latitude: Number(position.lat.toFixed(5)), longitude: Number(position.lng.toFixed(5)) });
      });
      redraw.current = () => {
        const group = overlays.current;
        if (!group) return;
        group.clearLayers();
        for (const run of current.current.runs) {
          const tooltip = document.createElement('span');
          tooltip.textContent = `${run.id} · ${run.label} · simulated`;
          L.circleMarker([run.latitude, run.longitude], { radius: 6, color: '#ef985c', fillOpacity: .6 }).bindTooltip(tooltip).addTo(group);
        }
        const selected = current.current.point;
        if (selected) L.circleMarker([selected.latitude, selected.longitude], {
          radius: 9, color: '#fff', weight: 2, fillColor: '#ef985c', fillOpacity: .9,
        }).bindTooltip('Selected scenario location').addTo(group);
      };
      redraw.current();
      observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
      observer.observe(host.current);
    }).catch(error=>{if(!disposed)setMapError(error instanceof Error?error.message:'Map unavailable')});
    return () => { disposed = true; observer?.disconnect(); map.current?.remove(); map.current = null; overlays.current = null; };
  }, []);
  useEffect(() => redraw.current(), [point, runs]);
  return <div ref={host} className="scenarioMap" aria-label="Choose scenario coordinates by clicking the map">{mapError&&<p role="alert">{mapError}</p>}</div>;
}
