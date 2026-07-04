"use strict";

// Flight Explorer page: a sortable table of ALL flights (one row per team+round).
// Clicking a row opens that flight in the Flight Visualizer.
//
// Columns marked "derived" are computed from telemetry by the build pipeline
// (see scripts/build_dashboard_data.py). "Score" is the OFFICIAL round score
// from scores.csv — the normalized competition score cannot be recomputed from
// telemetry alone (it needs announced take-off length, loading/unloading times
// and payload prediction, none of which are logged).

// column key -> { label, derived?, fmt, align }
const COLS = [
  { k: "team",            label: "Team",        align: "l", derived: false,
    get: f => f, fmt: f => `<span class="team-name">${f.flag} ${esc(f.team)}</span><br><span class="team-uni">${esc(f.university)}</span>`,
    sort: f => f.team.toLowerCase() },
  { k: "round",           label: "Round",       align: "r", derived: false,
    get: f => f.round, fmt: v => `R${v}` },
  { k: "durationS",       label: "Duration",    align: "r", derived: false,
    get: f => f.durationS, fmt: v => `${v.toFixed(0)}<span class="u"> s</span>` },
  { k: "totalDistM",      label: "Total dist",  align: "r", derived: true,
    get: f => f.totalDistM, fmt: v => `${(v/1000).toFixed(2)}<span class="u"> km</span>` },
  { k: "distSegM",        label: "Dist-seg",    align: "r", derived: true,
    get: f => f.distSegM, fmt: v => `${(v/1000).toFixed(2)}<span class="u"> km</span>` },
  { k: "avgSpeedDistKmh", label: "Avg speed",   align: "r", derived: true,
    get: f => f.avgSpeedDistKmh, fmt: v => `${v.toFixed(0)}<span class="u"> km/h</span>` },
  { k: "maxSpeedKmh",     label: "Max speed",   align: "r", derived: true,
    get: f => f.maxSpeedKmh, fmt: v => `${v.toFixed(0)}<span class="u"> km/h</span>` },
  { k: "maxAltBaro",      label: "Max alt",     align: "r", derived: true,
    get: f => f.maxAltBaro, fmt: v => `${v.toFixed(0)}<span class="u"> m</span>` },
  { k: "predictedPayload",label: "Pred. payload", align: "r", derived: false,
    get: f => f.predictedPayload, fmt: v => v == null ? "—" : `${v}<span class="u"> cans</span>` },
  { k: "score",           label: "Score",       align: "r", derived: false,
    get: f => f.score, fmt: v => `<strong>${v.toFixed(0)}</strong>` },
];

let sort = { k: "score", asc: false };

function sortVal(col, f) {
  if (col.sort) return col.sort(f);
  const v = col.get(f);
  return v == null ? -Infinity : v;
}

function renderTable() {
  const { k, asc } = sort;
  const col = COLS.find(c => c.k === k);
  const rows = [...INDEX].sort((a, b) => {
    const av = sortVal(col, a), bv = sortVal(col, b);
    if (typeof av === "string") return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    return asc ? av - bv : bv - av;
  });

  document.getElementById("flBody").innerHTML = rows.map(f => {
    const cells = COLS.map(c => {
      const raw = c.get(f);
      const inner = c.fmt(raw, f);
      return `<td class="${c.align}">${inner}</td>`;
    }).join("");
    return `<tr class="flrow clickable" data-team="${f.teamId}" data-round="${f.round}">${cells}</tr>`;
  }).join("");

  document.querySelectorAll("#flTable th").forEach(th => {
    th.classList.toggle("sorted", th.dataset.k === k);
    th.classList.toggle("asc", th.dataset.k === k && asc);
  });

  document.querySelectorAll("#flBody tr.flrow").forEach(tr => {
    tr.addEventListener("click", () => {
      window.location.href = `visualizer.html?team=${tr.dataset.team}&round=${tr.dataset.round}`;
    });
  });
}

function buildHead() {
  const tr = document.getElementById("flHead");
  tr.innerHTML = COLS.map(c => {
    const mark = c.derived ? '<span class="deriv" title="derived from telemetry">°</span>' : "";
    const cls = c.align === "l" ? "l" : "";
    const sortedCls = c.k === sort.k ? " sorted" + (sort.asc ? " asc" : "") : "";
    return `<th class="${cls}${sortedCls}" data-k="${c.k}">${c.label}${mark}</th>`;
  }).join("");
  tr.querySelectorAll("th").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (sort.k === k) sort.asc = !sort.asc;
      else sort = { k, asc: (k === "team") };  // text asc, numbers desc by default
      renderTable();
    });
  });
}

(async function(){
  renderChrome("explorer");
  initTheme();
  try {
    await loadBase();
  } catch(e) {
    document.getElementById("loadErr").textContent =
      "Could not load data files. If viewing locally, serve over http (e.g. `python -m http.server` in docs/).";
    return;
  }
  buildHead();
  renderTable();
})();
