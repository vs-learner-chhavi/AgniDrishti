# 🔥 AgniDrishti

### Thermal Intelligence Command Center

**AgniDrishti** is an AI-powered geospatial intelligence platform for detecting, classifying, explaining and prioritizing satellite-derived thermal anomalies — with a focus on **industrial fires and persistent thermal sources**.

> **From Hotspots to Intelligence.**
>
> Conventional hotspot maps answer **“Where is the heat?”** AgniDrishti aims to answer **“What is it, why is it happening, how risky is it, and should we act?”**

---

## 🚀 SIH 2026

| | Details |
|---|---|
| **Problem Statement** | **SIH26162** |
| **Title** | AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources Using NASA FIRMS, OSM & Satellite Data |
| **Organization** | National Technical Research Organisation (NTRO) |
| **Theme** | Disaster Management |
| **Category** | Software |
| **Team** | WINFINITY |
| **Product** | AgniDrishti |

---

## 🎯 Problem

Satellite thermal products are excellent at identifying **where thermal anomalies are detected**, but a hotspot is not automatically an uncontrolled fire. The same observation may correspond to an industrial fire, gas flare, agricultural burning, wildfire, mining activity or another persistent heat source.

The operational gap is therefore not only detection. It is **contextual classification and prioritization**.

AgniDrishti addresses this gap by fusing thermal, spatial, environmental and temporal evidence into one GIS-first workflow.

---

## 💡 Solution

For every thermal event, AgniDrishti can combine:

- 🛰️ **NASA FIRMS** — satellite-derived thermal anomaly observations
- 🏭 **OpenStreetMap** — nearby industrial and infrastructure context
- 🌍 **Land cover** — environmental context around the hotspot
- 📡 **Satellite imagery** — visual/contextual evidence where available
- 🕒 **Historical activity** — persistence and recurrence behaviour
- 🤖 **Machine Learning** — source classification
- 🔍 **Explainable AI** — reasons behind model predictions
- ⚠️ **Risk engine** — event prioritization
- 🗺️ **GIS dashboard** — analyst-facing command center

### Intelligence pipeline

```text
NASA FIRMS
    ↓
Thermal Anomaly
    ↓
QC + Spatial Alignment
    ↓
OSM + Land Cover + Satellite Context
    ↓
Historical Persistence
    ↓
Feature Engineering
    ↓
AI Classification
    ↓
Risk Scoring
    ↓
Explainable AI
    ↓
PostgreSQL / PostGIS
    ↓
GIS Command Center
    ↓
Alerts + Decision Support
```

---

## 🧠 Classification Targets

The planned classifier distinguishes between five useful source categories:

| Class | Typical contextual signals |
|---|---|
| 🔥 **Industrial Fire** | Industrial proximity, elevated thermal intensity, abnormal/repeated activity |
| 🔥 **Gas Flare** | Strong persistence, oil/gas infrastructure, stable recurring location |
| 🌾 **Agricultural Burning** | Cropland, seasonal recurrence, regional clustering |
| 🌲 **Wildfire** | Forest/vegetation context, clustered/spreading hotspots |
| ⛏️ **Mining Activity** | Mining areas, bare/mining land cover, recurring thermal activity |

The output is probabilistic and should be interpreted as **likely source classification**, not ground-truth confirmation.

---

## ✨ Current Command Center

The web prototype is designed as a dark, high-contrast intelligence dashboard with:

- Interactive India thermal map
- Clickable event markers
- Event intelligence panel
- AI classification + confidence
- Risk prioritization
- Persistence/history visualization
- Search across events/regions
- Risk filters
- Interactive map layer/filter controls
- Refresh/sync action
- Priority alert generation
- Simulation Lab for safe demo events
- Animated KPI cards and intelligence feed
- Toast notifications and interaction feedback
- Responsive layout
- Clear **DEMO / FALLBACK** vs **LIVE / DATABASE** status

### Demo flow

**Select hotspot → Analyze → View classification → Inspect evidence → Review persistence → Read XAI → Generate priority alert**

The Simulation Lab can create a clearly labelled demo event so the complete workflow can be demonstrated without pretending that simulated data is real satellite data.

---

## 🖥️ Tech Stack

### Frontend

- Next.js 15
- React 19
- TypeScript
- CSS
- Leaflet
- Recharts
- Lucide React

### Backend

- Next.js API Routes
- Node.js
- TypeScript

### Database

- PostgreSQL
- PostGIS
- Prisma ORM

### AI / ML

- Python
- Pandas
- NumPy
- Scikit-learn
- XGBoost
- SHAP

### Data / Geospatial

- NASA FIRMS
- OpenStreetMap / Overpass
- ESA WorldCover
- Sentinel-2 imagery
- GeoJSON
- PostGIS

---

## 📁 Project Structure

```text
AgniDrishti/
├── app/
│   ├── api/
│   │   ├── alerts/
│   │   ├── analyze/
│   │   ├── events/
│   │   ├── health/
│   │   └── ingest/firms/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── LiveMap.tsx
├── lib/
│   ├── classifier.ts
│   ├── firms.ts
│   ├── overpass.ts
│   ├── prisma.ts
│   ├── satellite.ts
│   └── worldcover.ts
├── prisma/
│   └── schema.prisma
├── docs/
│   └── DEMO.md
├── .env.example
├── package.json
└── README.md
```

---

## ⚙️ Local Setup

### 1. Clone

```bash
git clone https://github.com/vs-learner-chhavi/AgniDrishti.git
cd AgniDrishti
```

### 2. Install dependencies

```bash
npm install
```

### 3. Generate Prisma Client

```bash
npx prisma generate
```

### 4. Start development server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Available scripts

```bash
npm run dev
npm run build
npm run start
npm run typecheck
```

---

## 🔐 Environment Variables

Copy `.env.example` to `.env.local` and configure the services you want to enable.

Typical variables include:

```env
DATABASE_URL="postgresql://..."
FIRMS_MAP_KEY="..."
FIRMS_DAYS="1"
```

The dashboard is intentionally able to run in **DEMO / FALLBACK** mode when a production database or live FIRMS key is not configured.

Never commit API keys or database credentials.

---

## 🗄️ Data Model

### ThermalEvent

Stores the intelligence record for a thermal observation:

- coordinates
- detection time
- classification
- confidence
- risk
- brightness
- persistence
- industrial distance
- land cover
- source
- model features
- explanations

### Facility

Stores mapped infrastructure context such as:

- facility name
- type
- coordinates
- OSM source
- tags

### Alert

Stores:

- event ID
- severity
- status
- message
- creation time

PostGIS is intended to support efficient geographic proximity and spatial analysis as the production pipeline matures.

---

## 🔌 API Surface

| Endpoint | Purpose |
|---|---|
| `GET /api/events` | Retrieve current events |
| `POST /api/events` | Create a demo/simulated event |
| `POST /api/analyze` | Analyze a thermal coordinate using the intelligence pipeline |
| `GET /api/alerts` | Retrieve priority alerts |
| `GET /api/health` | Service health check |
| `POST /api/ingest/firms` | Ingest FIRMS observations when configured |

---

## 🔬 AI & Explainability

The current service layer contains a transparent feature-based classification/risk engine suitable for the prototype. The production ML path is designed around a trained **Random Forest/XGBoost classifier** with genuine **SHAP** explanations.

A final production prediction should expose both:

1. **Classification confidence** — how strongly the model favours a class.
2. **Feature contribution** — which evidence pushed the prediction toward or away from that class.

Example:

```text
Industrial Fire — 91%

Industrial proximity       +0.42
Thermal intensity          +0.31
Historical persistence     +0.24
FIRMS confidence           +0.08
Forest proximity           -0.06
```

> Prototype feature contributions should not be described as genuine SHAP values until the SHAP-backed model is connected.

---

## 📊 Risk Intelligence

Risk is treated separately from classification.

A thermal anomaly can be classified with high confidence while still requiring different operational priority. AgniDrishti therefore combines signals such as:

- thermal intensity
- satellite confidence
- industrial proximity
- persistence
- classification
- historical behaviour
- available exposure/context information

Suggested priority levels:

- **CRITICAL** — immediate verification recommended
- **HIGH** — priority investigation
- **MODERATE** — monitor / analyst review
- **LOW** — lower priority

---

## 🛰️ Data Integrity Principles

AgniDrishti is designed around an important rule:

> **A satellite thermal anomaly is an observation, not automatic proof of an industrial fire.**

Important limitations include:

- satellite spatial resolution
- cloud cover and observation gaps
- sensor limitations
- incomplete mapping data
- ambiguous thermal signatures
- historical data gaps
- need for authoritative or field verification for high-stakes cases

Likewise, if OSM contains no facility near a hotspot, the system should report **“no mapped facility found”** rather than claiming that no facility exists.

All seeded/simulated records are explicitly marked as demo/simulation data.

---

## 🧪 Evaluation Strategy

A production model should be evaluated using:

- Accuracy
- Precision
- Recall
- F1-score
- Confusion matrix
- Class-specific performance
- ROC-AUC where appropriate

Special attention should be given to **industrial-fire recall**, because missing a potentially serious event can be operationally more costly than a harmless false positive.

Validation should also consider:

### Spatial validation

Hold out geographic regions to reduce facility/location leakage.

### Temporal validation

Train on earlier periods and evaluate on later periods to better approximate deployment.

### Class imbalance

Use class weights, balanced sampling or threshold tuning where required.

---

## 📈 Scalability Roadmap

### Stage 1 — Prototype

Single dashboard + demo events + core APIs.

### Stage 2 — Live Data

NASA FIRMS ingestion + OSM enrichment + land cover.

### Stage 3 — ML Intelligence

Trained classifier + persistence engine + genuine SHAP.

### Stage 4 — National Monitoring

PostGIS + scheduled ingestion + scalable workers + alerting.

### Stage 5 — Advanced Intelligence

Multimodal satellite models, anomaly detection, weather-aware risk and predictive escalation.

A future production architecture can separate ingestion, enrichment, inference and alerting into independently scalable services.

---

## 🔮 Future Vision

AgniDrishti can evolve from reactive hotspot classification into continuous facility and regional anomaly monitoring.

A future system could learn a facility's normal thermal baseline and flag deviations such as:

```text
Historical baseline
        ↓
Normal thermal behaviour
        ↓
Current observation
        ↓
Significant deviation
        ↓
Anomaly score
        ↓
Risk + explanation
        ↓
Priority investigation
```

Longer-term extensions include:

- weather-aware fire spread risk
- population/infrastructure exposure
- multimodal satellite AI
- automated change detection
- facility-level thermal baselines
- mobile/secure notifications
- incident lifecycle management
- predictive and prescriptive intelligence

---

## 🏆 Why AgniDrishti?

### Conventional approach

**Hotspot → Map**

### AgniDrishti

**Hotspot → Context → Classification → Explanation → Risk → Action**

The project is intentionally designed as a **decision-support system**, not just another visualization layer.

---

## 🎤 SIH Demo Story

A strong demonstration should take the judge through one event:

1. Open the India command center.
2. Select a high-risk thermal hotspot.
3. Show the AI classification.
4. Show confidence and risk.
5. Show industrial proximity and land cover.
6. Open the historical persistence view.
7. Show the model explanation.
8. Generate a priority alert.
9. Explain that the system turns a raw satellite observation into actionable intelligence.

### Closing line

> **“We don't just show where the heat is. We explain what it likely is, why it matters, and where attention is needed.”**

---

## 👥 Team

**WINFINITY**

Built for **Smart India Hackathon 2026**.

---

## 📌 Project Status

🚧 **Active SIH 2026 build**

The current repository contains a functional command-center prototype, service-layer foundations and a path toward live multisource geospatial intelligence.

---

## 📜 Responsible Use

AgniDrishti is intended as an intelligence and decision-support system. Model outputs are probabilistic and should be combined with appropriate authoritative information before high-stakes operational decisions.

---

## 🔥 AgniDrishti

### **From Hotspots to Intelligence.**
