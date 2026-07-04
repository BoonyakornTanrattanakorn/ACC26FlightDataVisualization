"""Preprocess data/ into per-flight files for the GitHub Pages dashboard.

Reads:
  raw_data/all_flights.csv   (~283k rows of raw telemetry)
  raw_data/scores.csv
  raw_data/teams.csv

Writes into docs/data/:
  flights/<teamId>_<round>.csv    one full-resolution, rounded, local-XY file per flight
  flights_index.json              per-flight metrics + phase boundaries + official score
  scores.json                     teams joined with scores (leaderboard source)

Design decisions (per user):
  * Per-flight CSV output (human-readable) - the page fetches only what it needs.
  * LOSSLESS: every raw sample is kept (no downsampling). The only lossy step is
    rounding away floating-point noise below sensible sensor resolution:
      AltitudeGPS / AltitudeBaro -> mm      (3 dp)
      Voltage / Current          -> mV / mA (3 dp)
      speed (GPS ground speed)   -> 0.01 km/h
  * Convert lat/lon -> local x,y METRES relative to each flight's own start point
    via an equirectangular projection at the field latitude (accurate over a
    <=1 km flying field). x = East(+), y = North(+).

Flight phases (rulebook Rules-ACC-2026-3.pdf, sections 4.6.4-4.6.7):
  * Flight-time start t0 = first moment where EITHER the current exceeds 5 A for
    more than 3 s, OR the GPS ground speed reaches 5 km/h - whichever is first.
  * Climb    : [t0,      t0 + 60 s)   - altitude gained here is not scored.
  * Distance : [t0 + 60, t0 + 180 s)  - the 120 s scored segment; ground-projected
                                        distance covered here drives the score.
  * Landing  : [t0 + 180 s, end]

Derived metrics (all ground-projected, matching the rulebook's distance definition):
  * totalDistM       cumulative haversine distance over the whole flight
  * distSegM         distance covered within the 120 s distance segment
  * maxSpeedKmh      peak GPS ground speed over the whole flight
  * avgSpeedKmh      mean GPS ground speed over the whole flight
  * avgSpeedDistKmh  mean GPS ground speed within the distance segment

NOTE: the official normalized round score cannot be recomputed from telemetry
(it needs the announced take-off length, loading/unloading times and payload
prediction, none of which are logged). We therefore attach the OFFICIAL round
score from scores.csv to each flight and document the scoring method on the page.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "raw_data"
OUT = ROOT / "docs" / "data"
FLIGHTS_OUT = OUT / "flights"

EARTH_R = 6_371_000.0  # metres

# Rulebook phase constants.
CLIMB_S = 60.0
DIST_S = 120.0
START_CURRENT_A = 5.0
START_CURRENT_HOLD_S = 3.0
START_SPEED_KMH = 5.0


def to_local_xy(lat: pd.Series, lon: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Equirectangular projection to metres, relative to the first fix of the flight."""
    lat0 = lat.iloc[0]
    lon0 = lon.iloc[0]
    lat0_rad = math.radians(lat0)
    x = (lon - lon0).map(math.radians) * math.cos(lat0_rad) * EARTH_R  # East
    y = (lat - lat0).map(math.radians) * EARTH_R                        # North
    return x, y


def ground_step_distances(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Ground-projected distance (metres) between consecutive fixes, equirectangular."""
    lat_r = np.radians(lat)
    lon_r = np.radians(lon)
    mid = (lat_r[:-1] + lat_r[1:]) / 2.0
    dx = np.diff(lon_r) * np.cos(mid) * EARTH_R
    dy = np.diff(lat_r) * EARTH_R
    return np.hypot(dx, dy)


def detect_start(t: np.ndarray, current: np.ndarray, speed_kmh: np.ndarray) -> float:
    """Flight-time start t0 per rulebook 4.6.4: first of (I>5A for >3s) OR (v>=5km/h)."""
    # Current condition: earliest time whose >5 A run has already lasted >3 s.
    t_current = math.inf
    run_start = None
    for i in range(len(t)):
        if current[i] > START_CURRENT_A:
            if run_start is None:
                run_start = t[i]
            elif t[i] - run_start > START_CURRENT_HOLD_S:
                t_current = t[i]
                break
        else:
            run_start = None

    # Speed condition: first sample at or above 5 km/h.
    speed_hits = np.where(speed_kmh >= START_SPEED_KMH)[0]
    t_speed = float(t[speed_hits[0]]) if len(speed_hits) else math.inf

    t0 = min(t_current, t_speed)
    return 0.0 if not math.isfinite(t0) else float(t0)


def segment_metrics(t: np.ndarray, step_d: np.ndarray, speed_kmh: np.ndarray,
                    lo: float, hi: float) -> tuple[float, float]:
    """Distance (m) and mean speed (km/h) for samples with lo <= t < hi.

    step_d[i] is the distance from sample i to i+1; we credit it when the *end*
    sample (i+1) falls inside the window.
    """
    end_in = (t[1:] >= lo) & (t[1:] < hi)
    dist = float(step_d[end_in].sum())
    in_win = (t >= lo) & (t < hi)
    avg_speed = float(speed_kmh[in_win].mean()) if in_win.any() else 0.0
    return dist, avg_speed


def build_flights(round_scores: dict[tuple[int, int], float],
                  teams: dict[int, dict]) -> list[dict]:
    print("Reading all_flights.csv ...")
    df = pd.read_csv(SRC / "all_flights.csv")

    FLIGHTS_OUT.mkdir(parents=True, exist_ok=True)
    index: list[dict] = []

    grouped = df.groupby(["TeamID", "Round"], sort=True)
    for (team_id, rnd), g in grouped:
        g = g.sort_values("Time").reset_index(drop=True)
        if len(g) < 2:
            continue

        team_id = int(team_id)
        rnd = int(rnd)

        x, y = to_local_xy(g["Latitude"], g["Longitude"])
        t = ((g["Time"] - g["Time"].iloc[0]) / 1000.0).to_numpy()

        lat = g["Latitude"].to_numpy()
        lon = g["Longitude"].to_numpy()
        current = g["Current"].to_numpy()

        # Per-step ground distance and per-sample GPS ground speed.
        step_d = ground_step_distances(lat, lon)         # len n-1
        dt = np.diff(t)
        with np.errstate(divide="ignore", invalid="ignore"):
            step_speed = np.where(dt > 0, step_d / dt, 0.0) * 3.6  # km/h, len n-1
        # Assign each sample a speed: sample i uses the step leaving it; last
        # sample reuses the previous step so the array lines up with the rows.
        speed_kmh = np.empty(len(t))
        speed_kmh[:-1] = step_speed
        speed_kmh[-1] = step_speed[-1] if len(step_speed) else 0.0

        # Phase boundaries.
        t0 = detect_start(t, current, speed_kmh)
        climb_end = t0 + CLIMB_S
        dist_end = t0 + CLIMB_S + DIST_S

        # Derived physical metrics (ground-projected).
        total_dist = float(step_d.sum())
        dur = float(t[-1])
        max_speed = float(speed_kmh.max())
        avg_speed = float(speed_kmh.mean())
        dist_seg_m, avg_speed_dist = segment_metrics(
            t, step_d, speed_kmh, climb_end, dist_end)

        out = pd.DataFrame({
            "t":       np.round(t, 2),
            "x":       x.round(2),
            "y":       y.round(2),
            "altGps":  g["AltitudeGPS"].round(3),
            "altBaro": g["AltitudeBaro"].round(3),
            "voltage": g["Voltage"].round(3),
            "current": g["Current"].round(3),
            "speed":   np.round(speed_kmh, 2),
            "sats":    g["SatConnected"].astype(int),
            "lat":     g["Latitude"].round(7),
            "lon":     g["Longitude"].round(7),
        })

        fname = f"{team_id}_{rnd}.csv"
        out.to_csv(FLIGHTS_OUT / fname, index=False)

        team = teams.get(team_id, {})
        index.append({
            "teamId": team_id,
            "round": rnd,
            "team": team.get("name", f"Team {team_id}"),
            "flag": team.get("flag", ""),
            "university": team.get("university", ""),
            "predictedPayload": team.get("predictedPayload"),
            "points": int(len(out)),
            "durationS": round(dur, 1),
            "t0": round(t0, 2),
            "climbEndS": round(climb_end, 2),
            "distEndS": round(dist_end, 2),
            "maxAltBaro": round(float(g["AltitudeBaro"].max()), 1),
            "totalDistM": round(total_dist, 1),
            "distSegM": round(dist_seg_m, 1),
            "maxSpeedKmh": round(max_speed, 1),
            "avgSpeedKmh": round(avg_speed, 1),
            "avgSpeedDistKmh": round(avg_speed_dist, 1),
            "score": round(round_scores.get((team_id, rnd), 0.0), 1),
            "file": f"data/flights/{fname}",
        })

    print(f"  wrote {len(index)} flight files")
    return index


def read_teams() -> tuple[dict[int, dict], pd.DataFrame]:
    teams_df = pd.read_csv(SRC / "teams.csv")
    teams: dict[int, dict] = {}
    for _, r in teams_df.iterrows():
        teams[int(r["ID"])] = {
            "name": r["Name"],
            "university": r["University"],
            "country": r["Country"],
            "flag": r["Flag"],
            "predictedPayload": None if pd.isna(r["Predicted Payload"]) else float(r["Predicted Payload"]),
        }
    return teams, teams_df


def read_round_scores(scores_df: pd.DataFrame) -> dict[tuple[int, int], float]:
    """Map (teamId, round) -> official round score from scores.csv."""
    out: dict[tuple[int, int], float] = {}
    for _, r in scores_df.iterrows():
        tid = int(r["ID"])
        for i in range(1, 6):
            col = f"Round {i}"
            if col in scores_df.columns:
                out[(tid, i)] = float(r.get(col, 0) or 0)
    return out


def build_scores(teams_df: pd.DataFrame, scores_df: pd.DataFrame) -> None:
    print("Building scores.json ...")
    merged = teams_df.merge(scores_df, on="ID", how="left")

    records = []
    for _, r in merged.iterrows():
        records.append({
            "id": int(r["ID"]),
            "name": r["Name"],
            "university": r["University"],
            "country": r["Country"],
            "flag": r["Flag"],
            "predictedPayload": None if pd.isna(r["Predicted Payload"]) else float(r["Predicted Payload"]),
            "dsq": bool(str(r["DSQ"]).strip().lower() == "true"),
            "rounds": [
                round(float(r.get(f"Round {i}", 0) or 0), 1) for i in range(1, 6)
            ],
            "roundTotal": int(r["Round Total"]),
            "presentation": int(r["Presentation"]),
            "drawings": int(r["Drawings"]),
            "report": int(r["Report"]),
            "penalties": int(r["Penalties"]),
            "total": int(r["Total"]),
        })
    records.sort(key=lambda x: x["total"], reverse=True)
    for rank, rec in enumerate(records, 1):
        rec["rank"] = rank

    (OUT / "scores.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=None), encoding="utf-8"
    )
    print(f"  wrote scores.json ({len(records)} teams)")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Reading scores.csv + teams.csv ...")
    teams, teams_df = read_teams()
    scores_df = pd.read_csv(SRC / "scores.csv")
    round_scores = read_round_scores(scores_df)

    index = build_flights(round_scores, teams)
    (OUT / "flights_index.json").write_text(
        json.dumps(index, ensure_ascii=False), encoding="utf-8"
    )
    print("  wrote flights_index.json")
    build_scores(teams_df, scores_df)
    print("Done.")


if __name__ == "__main__":
    main()
