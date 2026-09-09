'use client';

import { useEffect, useRef } from 'react';

type MapEvent = {
  id: string;
  latitude: number;
  longitude: number;
  risk: string;
  confidence: number;
  classification: string;
};

export default function LiveMap({ events, selectedId, onSelect }: { events: MapEvent[]; selectedId?: string; onSelect: (id: string) => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;
    import('leaflet').then((L) => {
      if (!mounted || !mapRef.current) return;
      if (!instanceRef.current) {
        const map = L.map(mapRef.current, { zoomControl: false, attributionControl: true }).setView([22.5, 79], 5);
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
        instanceRef.current = { map, markers: new Map() };
      }
      const { map, markers } = instanceRef.current;
      const riskClass = (risk: string) => risk.toLowerCase().replace(/\s+/g, '-');
      events.forEach((event) => {
        const existing = markers.get(event.id);
        if (existing) existing.remove();
        const marker = L.circleMarker([event.latitude, event.longitude], {
          radius: event.id === selectedId ? 11 : 8,
          weight: 2,
          color: event.risk === 'CRITICAL' ? '#fb7185' : event.risk === 'HIGH' ? '#fbbf24' : '#38bdf8',
          fillOpacity: 0.85,
        }).addTo(map);
        marker.bindTooltip(`${event.id} · ${event.classification} · ${event.confidence}%`, { direction: 'top', offset: [0, -6] });
        marker.on('click', () => onSelect(event.id));
        markers.set(event.id, marker);
      });
      markers.forEach((marker: any, id: string) => {
        if (!events.some((event) => event.id === id)) { marker.remove(); markers.delete(id); }
      });
      void riskClass;
    });
    return () => { mounted = false; };
  }, [events, selectedId, onSelect]);

  return <div ref={mapRef} className="realMap" aria-label="Interactive India thermal activity map" />;
}
