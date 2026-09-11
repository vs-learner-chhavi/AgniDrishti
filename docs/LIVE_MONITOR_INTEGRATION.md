# Live Monitor: teammate integration checklist

The monitor now uses real NASA FIRMS observations for the map, time windows, density view, brightness, FRP, confidence and persistence. Real detections intentionally remain **Unclassified thermal anomaly** until the trained model is connected.

| Owner / dependency | What works now | What the teammate needs to provide | What changes after connection |
|---|---|---|---|
| Classification model | Collects model-ready thermal, persistence, land and facility evidence. Demo points show the intended classified UI. | An API returning `classification`, `confidence`, class probabilities, top feature contributions and `modelVersion`. | Real gray detections receive defensible classes and the panel changes from “Model-ready evidence” to “Why this classification?”. |
| Industrial database | Automatically queries OpenStreetMap near the selected point. | A curated Indian facility list/API with name, type, coordinates, source and stable ID. | “Nearby industry” becomes more complete; OSM gaps no longer look like proof that no facility exists. |
| Land-cover pipeline | Supports an optional WorldCover point service and otherwise says Unknown. | Configure `WORLDCOVER_API_URL`, returning a class code for latitude/longitude. | Forest, cropland and built-up context appear reliably in the evidence panel. |
| Recent imagery | “Inspect satellite view” switches to an Esri visual basemap while preserving the current map position. | A dated Sentinel/Landsat imagery service returning acquisition date, cloud cover and image/tile URL. | Analysts can inspect a time-relevant image rather than a geographic basemap only. |
| Live ingestion / GIS storage | Uses a compact 30-day FIRMS archive extract in the browser. | Scheduled FIRMS ingestion into PostGIS (or an API) with stable detection IDs and timestamps. | The monitor updates continuously and can query longer history without shipping a large CSV to the browser. |
| Alerts / response workflow | Creates an alert in the current browser session. | Database persistence, user ownership, notification channels and status workflow. | Alerts survive reloads and can be assigned, acknowledged and escalated. |

## Shared event contract

Every component should preserve the same core fields: `id`, `latitude`, `longitude`, `detectedAt`, `satellite`, `brightnessKelvin`, `frp`, `firmsConfidence`, `persistenceDays`, `persistenceObservations` and `persistenceWindowDays`.

The important team rule is simple: context is evidence, not classification. Being near a factory, appearing persistent or looking very hot can support the model, but none of those facts alone should label a real detection as an industrial fire.
