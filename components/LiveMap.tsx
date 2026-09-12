'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';

export type MapMode = 'detections' | 'density';
export type MapLayers = {
  facilities: boolean;
  halos: boolean;
  labels: boolean;
  imagery: boolean;
};
export type ThermalSignal = {
  id: string;
  latitude: number;
  longitude: number;
  brightness: number;
  frp: number;
  date: string;
  time: string;
  confidence: number;
  satellite: string;
  persistenceDays: number;
  persistenceObservations: number;
  persistenceScore: number;
};
export type FacilityPoint = {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
};
type MapEvent = {
  id: string;
  latitude: number;
  longitude: number;
  risk: string;
  confidence: number;
  classification: string;
  brightness: number;
  persistence: number;
};

const colours: Record<string, string> = {
  'Industrial Fire': '#f2543f',
  'Gas Flare': '#9258d8',
  'Crop Burning': '#e9a432',
  Wildfire: '#39ad69',
  Mining: '#318fca',
  'Unclassified thermal anomaly': '#9bb4c6',
};

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export default function LiveMap({
  events,
  densityEvents,
  facilities,
  selectedId,
  onSelect,
  mode,
  layers,
}: {
  events: MapEvent[];
  densityEvents: ThermalSignal[];
  facilities: FacilityPoint[];
  selectedId: string;
  onSelect: (id: string) => void;
  mode: MapMode;
  layers: MapLayers;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const drawn = useRef<Leaflet.Layer[]>([]);
  const tiles = useRef<{ street: Leaflet.TileLayer; satellite: Leaflet.TileLayer } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [heatReady, setHeatReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;

    (async () => {
      try {
        const L = (await import('leaflet')).default;
        if (cancelled || !host.current || mapRef.current) return;

        const map = L.map(host.current, {
          zoomControl: true,
          attributionControl: true,
          preferCanvas: true,
        }).setView([22.7, 79.2], 5);

        const street = L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            crossOrigin: true,
          },
        );
        const satellite = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles © Esri',
            maxZoom: 19,
            crossOrigin: true,
          },
        );

        street.addTo(map);
        leaflet.current = L;
        tiles.current = { street, satellite };
        mapRef.current = map;
        observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
        observer.observe(host.current);
        setMapReady(true);

        try {
          await import('leaflet.heat');
          if (!cancelled) setHeatReady(true);
        } catch {
          // Density mode gracefully falls back to individual markers.
        }
      } catch {
        // Keep the map shell visible instead of failing the whole dashboard.
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (mapRef.current) {
        mapRef.current.off();
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = leaflet.current;
    const tileLayers = tiles.current;
    if (!map || !L || !tileLayers || !host.current) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const draw = (attempt = 0) => {
      if (cancelled || !host.current) return;
      const box = host.current.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) {
        if (attempt < 20) timer = setTimeout(() => draw(attempt + 1), 75);
        return;
      }

      map.invalidateSize({ pan: false });
      drawn.current.forEach((layer) => map.removeLayer(layer));
      drawn.current = [];

      const { street, satellite } = tileLayers;
      if (layers.imagery) {
        if (map.hasLayer(street)) map.removeLayer(street);
        if (!map.hasLayer(satellite)) satellite.addTo(map);
      } else {
        if (map.hasLayer(satellite)) map.removeLayer(satellite);
        if (!map.hasLayer(street)) street.addTo(map);
      }

      const addMarker = (e: MapEvent) => {
        const latitude = safeNumber(e.latitude);
        const longitude = safeNumber(e.longitude);
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;

        const selected = e.id === selectedId;
        const colour = colours[e.classification] || '#9bb4c6';
        const marker = L.circleMarker([latitude, longitude], {
          radius: selected ? 9 : 5,
          color: selected ? '#ffffff' : colour,
          weight: selected ? 3 : 1.5,
          fillColor: colour,
          fillOpacity: selected ? 1 : 0.88,
        }).addTo(map);

        marker.bindTooltip(
          `<b>${e.classification}</b><br/>${latitude.toFixed(3)}, ${longitude.toFixed(3)}<br/>${safeNumber(e.brightness).toFixed(1)} K · ${safeNumber(e.confidence)}% confidence`,
          { direction: 'top', opacity: 0.95 },
        );
        marker.on('click', () => onSelect(e.id));
        drawn.current.push(marker);
      };

      if (mode === 'density' && densityEvents.length && heatReady && (L as any).heatLayer) {
        try {
          const heat = (L as any)
            .heatLayer(
              densityEvents
                .filter((event) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude))
                .map((event) => [
                  event.latitude,
                  event.longitude,
                  Math.min(1, Math.max(0.1, 0.18 + (event.brightness - 280) / 100 + event.frp / 500)),
                ]),
              {
                radius: 24,
                blur: 26,
                maxZoom: 8,
                minOpacity: 0.35,
                gradient: { 0.15: '#28b8a0', 0.45: '#f0c849', 0.7: '#f28b38', 1: '#ef3f35' },
              },
            )
            .addTo(map);
          drawn.current.push(heat);
        } catch {
          events.forEach(addMarker);
        }
      } else if (mode === 'density') {
        densityEvents.forEach((event) =>
          addMarker({
            id: event.id,
            latitude: event.latitude,
            longitude: event.longitude,
            risk: 'MODERATE',
            confidence: event.confidence,
            classification: 'Thermal detection',
            brightness: event.brightness,
            persistence: event.persistenceScore,
          }),
        );
      } else {
        events.forEach((event) => {
          const colour = colours[event.classification] || '#9bb4c6';
          if (layers.halos && event.risk !== 'MODERATE') {
            const halo = L.circle([event.latitude, event.longitude], {
              radius: event.risk === 'CRITICAL' ? 26000 : 16000,
              color: colour,
              weight: 1,
              fillColor: colour,
              fillOpacity: 0.07,
              opacity: 0.38,
            }).addTo(map);
            drawn.current.push(halo);
          }
          addMarker(event);
        });
      }

      if (layers.facilities) {
        facilities.forEach((facility) => {
          const latitude = safeNumber(facility.latitude);
          const longitude = safeNumber(facility.longitude);
          if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
          const marker = L.circleMarker([latitude, longitude], {
            radius: 5,
            color: '#65d5ff',
            weight: 2,
            fillColor: '#071522',
            fillOpacity: 1,
          }).addTo(map);
          marker.bindTooltip(
            `<b>${facility.name}</b><br/>${facility.type} · ${safeNumber(facility.distanceKm).toFixed(1)} km`,
            { direction: 'top' },
          );
          drawn.current.push(marker);
        });
      }

      host.current.classList.toggle('hideMapLabels', !layers.labels && !layers.imagery);
    };

    timer = setTimeout(() => draw(), 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [events, densityEvents, facilities, selectedId, onSelect, mode, layers, mapReady, heatReady]);

  return <div ref={host} className="realMap" aria-label="Interactive thermal activity map" />;
}
