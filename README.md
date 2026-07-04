# ACC 2026 Flight Telemetry Dashboard

A static, dependency-free dashboard for visualizing the Air Cargo Challenge 2026
data in [`raw_data/`](raw_data). Runs entirely in the browser and is served from
GitHub Pages.

## Pages

The dashboard is split into four pages that share one stylesheet and a common
JS module under [`docs/assets/`](docs/assets):

- **Home** ([`index.html`](docs/index.html)) — what the competition is, the flight
  mission, and data credits, with links into the explorer.
- **Leaderboard** ([`leaderboard.html`](docs/leaderboard.html)) — all teams joined
  with their scores (sortable). Clicking a team that has flight data opens it in
  the visualizer, deep-linked as `visualizer.html?team=<id>&round=<n>`.
- **Flight Explorer** ([`explorer.html`](docs/explorer.html)) — a sortable table of
  **every** recorded flight (duration, total distance, distance-segment distance,
  average/max speed, max altitude, predicted payload, official score). Click any
  header to sort; click a row to visualize it.
- **Flight Visualizer** ([`visualizer.html`](docs/visualizer.html)) — a single
  flight: a custom **3D flight path (Three.js)** with a replay transport (play /
  pause / speed / scrub) whose clock reads **flight time** (`T+0` = take-off) and
  a plane that flies the track, plus altitude / speed / voltage / current charts
  (drag-to-zoom) with phase-boundary markers. Deep-linkable via `?team=&round=`.

## Flight phases &amp; scoring

Metrics and phase boundaries come from the rulebook
([`raw_data/Rules-ACC-2026-3.pdf`](raw_data/Rules-ACC-2026-3.pdf), §4.6–4.7):

- **Flight-time start** `t0` = first moment the motor current exceeds 5 A for
  more than 3 s, **or** GPS ground speed reaches 5 km/h — whichever is first.
- **Climb** `[t0, t0+60s)`, **Distance** `[t0+60s, t0+180s)` (the 120 s scored
  window), **Landing** `[t0+180s, end]`.
- The **round score** is normalized against the best team in each round and folds
  in take-off, loading and payload-prediction bonuses minus penalties — it **cannot**
  be recomputed from telemetry (it needs the announced take-off length, loading/
  unloading times and payload prediction, none of which are logged). The dashboard
  therefore shows the **official** round scores from `scores.csv` and derives only
  the physical metrics (distance, speeds, phases) from the flight logs. The full
  scoring method is documented on the Flight Explorer page.

## What it shows

- **3D flight path** — the GPS track rendered in a custom Three.js scene with a
  **grass ground** and **sky**, a phase-coloured path and its ground shadow, and a
  **to-scale plane icon** (2 m wingspan) that flies the path pointing along its
  heading. A flight-time replay transport (play / pause / speed / scrub) reads
  `T+0` at take-off. Three camera views: **Orbit** (free orbit / pan / zoom),
  **Start POV** (from the take-off point) and **Plane POV** (chase cam). Because a
  2 m aircraft is a speck on a ~1 km track, a screen-constant locator ring keeps it
  findable when zoomed out. Heading only updates past a small displacement
  threshold, so GPS noise on the ground doesn't make the icon spin.
- **Altitude / Speed / Voltage / Current vs time** — per-flight telemetry with
  climb/distance/landing markers and drag-to-zoom (Chart.js + chartjs-plugin-zoom).

## Front-end libraries (all via CDN, no build step)

- **Three.js** (+ OrbitControls) — the 3D flight scene, loaded as an ES module
  through an import map and re-exported onto `window` for the classic page script.
- **Chart.js** (+ **chartjs-plugin-zoom**) — the time-series charts.

## Data pipeline

The raw `all_flights.csv` (~19 MB, 283k rows) is too large to load in one request,
so [`scripts/build_dashboard_data.py`](scripts/build_dashboard_data.py) splits it
into per-flight files under [`docs/data/`](docs/data) that the page fetches on demand:

- **Per-flight CSV** `data/flights/<teamId>_<round>.csv` — one file per flight
  (~160 KB each), fetched only when that flight is opened. Includes a GPS
  ground-`speed` column alongside the raw channels.
- **Lossless:** every raw sample is kept — no downsampling. The only lossy step is
  **rounding** away floating-point noise below sensor resolution (altitude to mm,
  voltage/current to mV/mA, speed to 0.01 km/h).
- Latitude/longitude **converted to local x/y metres** relative to each flight's
  own start point (equirectangular projection at the field latitude). Raw lat/lon
  are kept too, for the 3D path.
- `data/flights_index.json` — one entry per flight with the derived metrics and
  **phase boundaries** (`t0`, `climbEndS`, `distEndS`), the official round `score`,
  and team info (so the explorer table loads in a single fetch).
- `data/scores.json` — teams joined with scores (leaderboard source).

### Rebuild the data

```bash
pip install pandas numpy
python scripts/build_dashboard_data.py
```

Re-run this whenever `raw_data/` changes, then commit the regenerated `docs/data/`.

## Local preview

The page fetches data files over HTTP, so open it via a server (not `file://`):

```bash
cd docs
python -m http.server 8000
# open http://localhost:8000/
```

## Deploy (GitHub Pages)

In the repository: **Settings → Pages → Build and deployment → Deploy from a branch**,
then choose **branch `main`, folder `/docs`**. The site publishes at
`https://<user>.github.io/ACC26FlightDataVisualization/`.

`.nojekyll` is present so Pages serves the `data/` files verbatim.
