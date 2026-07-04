# ACC 2026 Flight Telemetry Dashboard

A static, dependency-free dashboard for visualizing the Air Cargo Challenge 2026
data in [`official_data/`](../official_data). Runs entirely in the browser and is
served from GitHub Pages.

## What it shows

- **Leaderboard** — all teams joined with their scores (sortable, click a row to load a flight).
- **Flight explorer** — pick a team + round; the map and charts update.
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
