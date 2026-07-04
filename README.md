# ACC 2026 Flight Telemetry Dashboard

A static, dependency-free dashboard for visualizing the Air Cargo Challenge 2026
data in [`data/`](data). Runs entirely in the browser and is served from GitHub Pages.

## Pages

The dashboard is split into three pages that share one stylesheet and a common
JS module under [`docs/assets/`](docs/assets):

- **Home** ([`index.html`](docs/index.html)) — overview, summary stats, and links
  to the other two pages.
- **Leaderboard** ([`leaderboard.html`](docs/leaderboard.html)) — all teams joined
  with their scores (sortable). Clicking a team that has flight data opens it in
  the explorer, deep-linked as `explorer.html?team=<id>&round=<n>`.
- **Flight explorer** ([`explorer.html`](docs/explorer.html)) — pick a team + round
  (or arrive via a deep link); the map and charts update and the URL stays in sync.

## What it shows

- **Ground track** — GPS path over the flying field, colored by altitude (Leaflet + OpenStreetMap).
- **Altitude / Voltage / Current vs time** — per-flight telemetry (Chart.js).

## Data pipeline

The raw `all_flights.csv` (~19 MB, 283k rows) is too large to load in one request,
so [`scripts/build_dashboard_data.py`](scripts/build_dashboard_data.py) splits it
into per-flight files under [`docs/data/`](docs/data) that the page fetches on demand:

- **Per-flight CSV** `data/flights/<teamId>_<round>.csv` — one file per flight
  (~160 KB each), fetched only when that flight is selected.
- **Lossless:** every raw sample is kept — no downsampling. The only lossy step is
  **rounding** away floating-point noise below sensor resolution (altitude to mm,
  voltage/current to mV/mA).
- Latitude/longitude **converted to local x/y metres** relative to each flight's
  own start point (equirectangular projection at the field latitude). Raw lat/lon
  are kept too, for the map.
- `data/scores.json` — teams joined with scores (leaderboard source).
- `data/flights_index.json` — which flights exist + point counts.

### Rebuild the data

```bash
pip install pandas
python scripts/build_dashboard_data.py
```

Re-run this whenever `data/` changes, then commit the regenerated `docs/data/`.

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
