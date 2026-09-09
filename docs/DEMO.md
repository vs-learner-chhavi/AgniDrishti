# AgniDrishti demo checklist

1. Install dependencies with `npm install`.
2. Run `npm run typecheck` and `npm run build`.
3. Start with `npm run dev`.
4. Without environment keys the app uses the safe demo dataset.
5. With `FIRMS_MAP_KEY`, the ingestion endpoint can pull NASA FIRMS data.
6. The GIS view uses Leaflet/OpenStreetMap; markers are selectable and feed the intelligence panel.
7. Classification is probabilistic intelligence, not ground-truth confirmation.

Deployment is intentionally left for the next step.
