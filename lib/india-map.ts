import type * as Leaflet from 'leaflet';
import type { FeatureCollection } from 'geojson';

// Political boundaries come exclusively from SOI, not from raster basemap borders.
export const terrainTiles = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}';
export const terrainOptions = { attribution: 'Terrain © Esri', maxNativeZoom: 13, maxZoom: 19 };
export async function loadIndiaBoundaries(): Promise<FeatureCollection> {
  const response = await fetch('/data/india-soi-boundaries.geojson');
  if (!response.ok) throw new Error('Official India boundaries could not be loaded. Please refresh.');
  return response.json();
}
export function addIndiaBoundaries(L: typeof Leaflet, map: Leaflet.Map, data: FeatureCollection) {
  map.createPane('indiaBoundaries').style.zIndex = '350';
  map.getPane('indiaBoundaries')!.style.pointerEvents = 'none';
  map.createPane('indiaLabels').style.zIndex = '375';
  map.getPane('indiaLabels')!.style.pointerEvents = 'none';
  L.geoJSON(data, { pane: 'indiaBoundaries', interactive: false,
    style: { color: '#245a79', weight: 1.5, opacity: .9, fillColor: '#84cae0', fillOpacity: .06 },
    attribution: 'Boundaries: <a href="https://surveyofindia.gov.in/pages/administrative-boundary-data-base-abdb-">Survey of India</a> (simplified)',
  }).addTo(map);
  const labels = L.layerGroup();
  for (const feature of data.features) {
    const p = feature.properties;
    if (!p?.label || p.name.startsWith('Disputed')) continue;
    const node = document.createElement('span'); node.textContent = p.name;
    L.marker(p.label, { pane: 'indiaLabels', interactive: false,
      icon: L.divIcon({ className: 'indiaStateLabel', html: node, iconSize: [110, 20], iconAnchor: [55, 10] }),
    }).addTo(labels);
  }
  labels.addTo(map);
  return labels;
}
