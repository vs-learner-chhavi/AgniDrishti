# Simulation Lab — local preview and teammate handoff

The lab sends hypothetical observations to the saved XGBoost classifier and SHAP explainer. It does not write incidents, create alerts, or retrain the model. The normal analysis endpoint uses the same prediction boundary to replay an exact archived observation. Unavailable observations and incomplete evidence return an error rather than a fabricated observation or heuristic prediction.

## Run locally

From the AgniDrishti folder after applying this change:

```bash
git lfs pull
npm ci
python3.13 -m venv .venv
.venv/bin/python -m pip install -r ml/requirements-inference.txt
PYTHON_BIN="$PWD/.venv/bin/python" npm run dev
```

Open http://localhost:3000 and click **Simulate**, or **Launch simulation** in the last section. Keep that terminal running. This preview runs on your Mac; a server started in ChatGPT's workspace does not start one on your Mac.

Python 3.12 was tested. The Mac commands use Python 3.13, which was present in your earlier setup output; Python 3.12 is also suitable. Avoid using Python 3.14 with these pinned packages, since it can trigger source builds. If `python3.13` is missing, stop and check which Python is installed. On macOS, XGBoost may require an OpenMP runtime; only install `libomp` if its import reports a missing `libomp.dylib`.

Test a point such as latitude `22.35`, longitude `69.85`, then run a prediction. The committed OSM snapshot finds Reliance Refinery roughly 2.25 km away. This is a test location, not a claim of a current fire there. Pick a different map location and alter the thermal/history evidence for a second run. Previous runs remain visible in this lab until it is closed or cleared. A repeat of identical inputs must return identical probabilities. Changed inputs need not change the winning class, but can change its probability.

## Meaning of the controls

- Exact latitude/longitude: picked from the map or typed. Viewport stays put when inputs/results change.
- Hotspot temperature, secondary thermal-band temperature and FRP: distinct measurements, not an invented generic intensity slider.
- FIRMS confidence: satellite detection quality, encoded low=0, nominal=50, high=100. This is different from the model's output probability.
- Day/night: the observation flag, not inferred from UTC hour (India's daylight is not UTC daylight).
- History: active days in the previous 7/30 UTC calendar days, excluding the observation day, in a 0.05-degree grid cell.
- Default hypothetical counts: one detection per active day, and the selected observation alone today. Advanced controls explicitly override detection counts and daily aggregates.
- Result: predicted class, all class probabilities, three strongest SHAP contributions, raw technical evidence and OSM context. SHAP contributions are not probability percentages.

Simulation events remain inside the lab map; they are never posted to `/api/events` or `/api/alerts`. Coordinates affect context only in the current model. Do not claim the classifier uses industrial distance or land cover: it was trained without those proximity inputs.

## Who needs to keep what aligned

| Teammate / section | Keep in mind |
| --- | --- |
| ML model owner | Keep the saved model, ordered feature list, label encoder and preprocessing contract together. Re-export the contract with `python scripts/export_inference_contract.py` when deliberately updating the model or training inputs, then run parity and prediction checks. A model hash mismatch blocks inference. |
| Data/history owner | Live inference needs the same 27 inputs and complete history definitions, including secondary-band temperature and day/night. The sparse map JSON (up to 200 points/day) is for display; it cannot provide complete counts. The current normal analysis route supports exact archive replay only. |
| Live monitor owner | Send numeric coordinates plus the original `detectedAt` timestamp; do not replace it with the current time. Exact archive replay fails clearly when a point is absent or ambiguous. New live observations still need an ingestion/feature feed. Map selection only selects; it does not reclassify demo points. |
| GIS/context owner | Local industrial/gas/mining parquet files supply nearby infrastructure within 10 km. An empty search differs from a missing snapshot, and neither proves absence of industry. This context is separate from SHAP. |
| Risk/alerts owner | Class probability is not incident severity. Analysis currently returns `UNASSESSED` risk until a reviewed risk policy is connected. Simulations never enter production alerts. |
| Deployment owner | Both inference routes require Node.js child processes, Python and local model/data files. A static frontend alone cannot run this. The CLI has a 60-second timeout; a persistent inference service can replace it behind the same API contract when needed. |
| Evaluation/presentation owner | The simulation demonstrates working inference, not independently verified real-world accuracy. Saved metrics use dataset labels; evaluation on independently confirmed events is still a separate task. |

## Verification

```bash
npm run typecheck
npm run build
.venv/bin/python -m unittest discover -s ml/tests -v
.venv/bin/python scripts/verify_inference_api.py
```

The Python suite checks 100 sampled rows against the existing training feature table, impossible histories, zero confidence/FRP, midnight, required features, saved-model determinism, sensitivity to changed history, and real SHAP output. Full dataset parity needs LFS files. No model training is performed.

A failed Python setup, absent model files or invalid inputs must show an error in the lab. No test point should be added on failure. Model outputs are probabilities, not calibrated guarantees that a fire type is correct.

Verified in this change: production build and typecheck passed; all four Python tests passed, including parity with 100 dataset rows; nine HTTP checks passed against the actual saved model. Interactive browser verification is pending because the available cloud browser blocked the workspace localhost address.

## Diagnosing slow inference

The dashboard now loads the model once per request, limits XGBoost to two threads,
and uses its native TreeSHAP implementation. It no longer imports SHAP/Numba on
the request path. Native contributions matched the prior SHAP implementation on
25 sampled rows (all 27 features). Model weights and input definitions are unchanged.

If a prediction is still slow, stop the dev server and run:

```bash
.venv/bin/python ml/check_inference.py
```

This prints Python/platform details and the current stage, then either a result or
a diagnostic timeout after 90 seconds. The dashboard keeps its 60-second limit but
now identifies the stage where it timed out. Share the diagnostic output if it
fails; do not reinstall dependencies or retrain the model speculatively.

## UI interpretation and model-team follow-up

The lab now labels its output as a thermal/history prediction, separately reports whether
matching infrastructure categories are mapped within 10 km, and never treats proximity
as verification. Missing snapshots and no matching mapped features have distinct messages.
Binary SHAP inputs are described in words; frequent activity means at least 3/7 or 10/30
active days. Small nonzero probabilities display as <0.1%. Quarry areas retain their OSM
record links and identify missing names; they are not presented as detected mining fires.

The model teammate owns reviewing weak label rules, excluded unknown examples, independent
evaluation, probability calibration and an uncertainty/rejection strategy. In the saved
training table, all 1,021 rows with persistent_activity=0 and active_days_30d>=3 were labelled
gas_flare. That is a dataset observation, not proof of real gas flares. Do not alter UI outputs
to force a different class, or treat location context as an input before retraining and validation.
