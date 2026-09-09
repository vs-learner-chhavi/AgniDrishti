# AgniDrishti 🔥

**Thermal Intelligence Command Center** — an AI-powered geospatial intelligence prototype for detecting, classifying and prioritizing thermal anomalies and persistent thermal sources.

## SIH 2026
- Problem: **SIH26162** — AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources Using NASA FIRMS, OSM & Satellite Data
- Product: **AgniDrishti / ThermoGuard AI**
- Team: **WINFINITY**

## Product USP
> Unlike conventional hotspot systems that only detect and display thermal anomalies, AgniDrishti converts them into actionable intelligence by combining thermal, spatial and historical evidence to classify, explain and prioritize events.

## Prototype
The current prototype includes an interactive dark command-center dashboard with:
- India thermal activity map and event selection
- AI classification and confidence display
- Risk prioritization
- SHAP-style explanation panel
- Persistence/history visualization
- Event search and risk filters
- Priority alert interaction
- End-to-end demo simulation flow with authoritative client-side IST timestamps
- API endpoint for event retrieval and simulation

## Data integrity
Seeded records are explicitly marked **DEMO DATA**. The prototype does not claim scientific validation or real-world fire confirmation. Live NASA FIRMS, OSM, land-cover and satellite connectors can be attached through the service layer as the data pipeline is implemented.

## Local development
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

## Planned production architecture
NASA FIRMS → QC/alignment → OSM + land cover + satellite context → feature engineering → classifier → risk engine → XAI → PostGIS → GIS dashboard/API/alerts.

## Status
🚧 Active SIH 2026 build.
