"""Preprocess data/ into per-flight files for the GitHub Pages dashboard.

Reads:
  data/all_flights.csv   (~283k rows of raw telemetry)
  data/scores.csv
  data/teams.csv

Writes into docs/data/:
  flights/<teamId>_<round>.csv    one full-resolution, rounded, local-XY file per flight
  flights_index.json              which (team, round) flights exist + point counts
  scores.json                     teams joined with scores (leaderboard source)

Design decisions (per user):
  * Per-flight CSV output (human-readable) - the page fetches only what it needs.
  * LOSSLESS: every raw sample is kept (no downsampling). The only lossy step is
    rounding away floating-point noise below sensible sensor resolution:
      AltitudeGPS / AltitudeBaro -> mm      (3 dp)
      Voltage / Current          -> mV / mA (3 dp)
  * Convert lat/lon -> local x,y METRES relative to each flight's own start point
    via an equirectangular projection at the field latitude (accurate over a
    <=1 km flying field). x = East(+), y = North(+).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data"
OUT = ROOT / "docs" / "data"
FLIGHTS_OUT = OUT / "flights"

EARTH_R = 6_371_000.0  # metres


def to_local_xy(lat: pd.Series, lon: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Equirectangular projection to metres, relative to the first fix of the flight."""
    lat0 = lat.iloc[0]
    lon0 = lon.iloc[0]
    lat0_rad = math.radians(lat0)
    x = (lon - lon0).map(math.radians) * math.cos(lat0_rad) * EARTH_R  # East
    y = (lat - lat0).map(math.radians) * EARTH_R                        # North
    return x, y


def build_flights() -> list[dict]:
    print("Reading all_flights.csv ...")
    df = pd.read_csv(SRC / "all_flights.csv")

    FLIGHTS_OUT.mkdir(parents=True, exist_ok=True)
    index: list[dict] = []

    grouped = df.groupby(["TeamID", "Round"], sort=True)
    for (team_id, rnd), g in grouped:
        g = g.sort_values("Time").reset_index(drop=True)
        if len(g) < 2:
            continue

        x, y = to_local_xy(g["Latitude"], g["Longitude"])

        # Time relative to flight start, in seconds.
        t = (g["Time"] - g["Time"].iloc[0]) / 1000.0

        # Altitude relative to the flight's own baro ground reference reads more
        # naturally than absolute; keep absolute GPS too. Round the FP noise away.
        out = pd.DataFrame({
            "t":       t.round(2),
            "x":       x.round(2),
            "y":       y.round(2),
            "altGps":  g["AltitudeGPS"].round(3),
            "altBaro": g["AltitudeBaro"].round(3),
            "voltage": g["Voltage"].round(3),
            "current": g["Current"].round(3),
            "sats":    g["SatConnected"].astype(int),
            "lat":     g["Latitude"].round(7),
            "lon":     g["Longitude"].round(7),
        })

        fname = f"{int(team_id)}_{int(rnd)}.csv"
        out.to_csv(FLIGHTS_OUT / fname, index=False)

        index.append({
            "teamId": int(team_id),
            "round": int(rnd),
            "points": int(len(out)),
            "durationS": round(float(t.iloc[-1]), 1),
            "maxAltBaro": round(float(g["AltitudeBaro"].max()), 1),
            "file": f"data/flights/{fname}",
        })

    print(f"  wrote {len(index)} flight files")
    return index


def build_scores() -> None:
    print("Reading scores.csv + teams.csv ...")
    teams = pd.read_csv(SRC / "teams.csv")
    scores = pd.read_csv(SRC / "scores.csv")
    merged = teams.merge(scores, on="ID", how="left")

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
    index = build_flights()
    (OUT / "flights_index.json").write_text(
        json.dumps(index, ensure_ascii=False), encoding="utf-8"
    )
    print("  wrote flights_index.json")
    build_scores()
    print("Done.")


if __name__ == "__main__":
    main()
