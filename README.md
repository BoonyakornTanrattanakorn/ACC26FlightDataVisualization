# ACC 2026 Flight Telemetry Dashboard

A static, dependency-free web dashboard for exploring the **Air Cargo Challenge
2026** flight telemetry and results. It runs entirely in the browser (no build
step, no backend) and is served from GitHub Pages.

> **Independent project.** This is an unofficial visualisation. All flight data
> and scores belong to the competition organisers — see [Credits](#credits).

## Features

- **Leaderboard** — the full competition standings (flight, presentation,
  drawings, report, penalties, total), sortable by any column. Click a team to
  jump straight to one of its flights.
- **Flight Explorer** — a sortable table of *every* recorded flight with derived
  metrics: duration, total distance, distance-segment distance, average/max
  ground speed, max altitude, predicted payload, and official score.
- **Flight Visualizer** — replay a single flight in a custom **3D scene**:
  - grass ground + sky, with the GPS track drawn as a **phase-coloured path**
    (climb / distance / landing) and its ground shadow;
  - a **to-scale aircraft** (2 m wingspan) that flies the path, pointed along its
    heading, with a locator ring so it stays findable when zoomed out;
  - a **replay transport** (play / pause / speed / scrub) whose clock reads
    **flight time**, `T+0` at take-off;
  - three camera views — **Orbit**, **Start POV** (from the take-off point) and
    **Plane POV** (chase cam);
  - **altitude / speed / voltage / current** charts with climb/distance/landing
    markers and drag-to-zoom.
- **Deep links & theming** — flights are shareable via `?team=<id>&round=<n>`;
  light/dark theme throughout.

## Flight phases & scoring

Metrics and phase boundaries follow the official ACC 2026 rulebook (§4.6–4.7):

- **Flight-time start** `t0` = first moment the motor current exceeds 5 A for
  more than 3 s, **or** GPS ground speed reaches 5 km/h — whichever is first.
- **Climb** `[t0, t0+60s)` · **Distance** `[t0+60s, t0+180s)` (the 120 s scored
  window) · **Landing** `[t0+180s, end]`.
- The official **round score** is normalised against the best team in the round
  and folds in take-off / loading / payload-prediction bonuses minus penalties.
  It **cannot** be recomputed from telemetry alone (it needs the announced
  take-off length, loading/unloading times and payload prediction, none of which
  are logged), so the dashboard shows the **official** scores and derives only the
  physical metrics (distance, speeds, phases) from the flight logs. The full
  scoring method is documented on the Flight Explorer page.

## How it's built

Four pages under [`docs/`](docs) — Home, Leaderboard, Flight Explorer, Flight
Visualizer — sharing one stylesheet and a common JS module in
[`docs/assets/`](docs/assets). Front-end libraries load from a CDN, no bundler:

- **Three.js** (+ OrbitControls) — the 3D flight scene.
- **Chart.js** (+ **chartjs-plugin-zoom**) — the time-series charts.

### Data pipeline

The raw telemetry (~19 MB, 283k rows) is too large to load at once, so
[`scripts/build_dashboard_data.py`](scripts/build_dashboard_data.py) splits it
into small per-flight files the page fetches on demand, under `docs/data/`:

- **Per-flight files** — **lossless** (no downsampling; only floating-point noise
  is rounded to sensor resolution). Add a GPS ground-`speed` column and local x/y
  metres alongside raw lat/lon.
- **A flight index** — one entry per flight with derived metrics, phase boundaries
  (`t0`, `climbEndS`, `distEndS`), the official round `score`, and team info (so the
  explorer table loads in a single fetch).
- **A scores file** — teams joined with scores (leaderboard source).

Rebuild whenever the source data changes, then commit the regenerated `docs/data/`:

```bash
pip install pandas numpy
python scripts/build_dashboard_data.py
```

### Local preview

Serve over HTTP (the page fetches data files, so `file://` won't work):

```bash
cd docs
python -m http.server 8000   # then open http://localhost:8000/
```

### Deploy (GitHub Pages)

**Settings → Pages → Deploy from a branch**, then **branch `main`, folder
`/docs`**. `.nojekyll` is present so the `data/` files are served verbatim. The
site publishes at `https://<user>.github.io/ACC26FlightDataVisualization/`.

## Credits

- **Air Cargo Challenge 2026** — the competition, its rules, and all flight
  telemetry and scores shown here are the work of the ACC organisers,
  **Akamodell Stuttgart e.V.** (student aeromodelling club of the University of
  Stuttgart), with coordination by EUROAVIA. Data was recorded via the
  competition's automated on-board measurement system.
  Official site: <https://aircargochallenge.de/>.
- **Libraries** — [Three.js](https://threejs.org/),
  [Chart.js](https://www.chartjs.org/) and
  [chartjs-plugin-zoom](https://github.com/chartjs/chartjs-plugin-zoom).

*This dashboard is an independent, non-official project and is not affiliated with
or endorsed by the Air Cargo Challenge organisers. Full credit for the competition
and the underlying data belongs to them; please refer to the official site for
authoritative results, rules and news.*
