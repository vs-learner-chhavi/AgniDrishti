# Dashboard component boundaries

- `LiveMonitor.tsx` owns monitor controls, archive filtering, selection, day-count persistence and evidence. Keep it mounted in `app/page.tsx` when editing other dashboard sections.
- `LiveMap.tsx` owns Leaflet rendering. Its `realMap` element needs the explicit height supplied by `.restoredMonitor .mapStage` in `app/globals.css`. Preserve the resize/zero-size guards. View/layer changes must not reset the viewport.
- `SimulationLab.tsx` owns hypothetical model runs; `HistoricalIntelligence.tsx` owns the historical workspace. These remain independent of the monitor.

Monitor time windows end at the final UTC day of `public/data/firms-recent.json`, not today. Both density and archive dots use the same filtered observations; at most 400 archive dots are selectable. Fixed demos are optional and never contribute to density. Snapshot recurrence and the model's prior-window persistence are labelled separately; the latter comes from `active_days_30d` after analysis.

`/api/context` retrieves local OSM snapshot records without classifying a point. `/api/analyze` replays an exact archived observation through the trained model. Archive/demo review alerts stay in the local queue and do not create live incidents. Model training, improved location-aware classification and operational risk assessment remain separate teammate work.

Install the existing lockfile with `npm ci`. Validate changes with `npm run typecheck`, `npm run build`, and `python scripts/verify_inference_api.py` using the inference Python environment. Then visually check both map modes, all three time windows, selection, layers, technical evidence, and the other dashboard sections locally before merging to main.
