"use strict";

// Flight Explorer page: a sortable table of ALL flights (one row per team+round).
// Clicking a row opens that flight in the Flight Visualizer.
//
// Columns marked "derived" are computed from telemetry by the build pipeline
// (see scripts/build_dashboard_data.py). "Score" is the OFFICIAL round score
// from scores.csv — the normalized competition score cannot be recomputed from
// telemetry alone (it needs announced take-off length, loading/unloading times
// and payload prediction, none of which are logged).
//
// "Est. m·l²" is the ESTIMATED raw round score (rule 4.7.1) using predicted
// payload as the mass proxy (0.35 kg/can) — not the official score. "OC pen." is
// the over-current penalty, min(1, 0.002·∫max(0, I−30 A) dt) per rule 4.7.4,
// computed exactly from the logged current.

// Compact formatting for the large est. raw score (m·l²) values.
function fmtRaw(v) {
  if (v >= 1e6) return (v/1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(1) + "k";
  return v.toFixed(0);
}

// column key -> { label, derived?, fmt, align, range?, field?, unit?, step? }
// `range: true` columns get min/max range filters (see the range panel). `field`
// is the raw numeric property to test; `unit`/`step` tune the range inputs.
const COLS = [
  { k: "team",            label: "Team",        align: "l", derived: false,
    get: f => f, fmt: f => `<span class="team-name">${f.flag} ${esc(f.team)}</span><br><span class="team-uni">${esc(f.university)}</span>`,
    sort: f => f.team.toLowerCase() },
  { k: "round",           label: "Round",       align: "r", derived: false,
    get: f => f.round, fmt: v => `R${v}` },
  { k: "durationS",       label: "Duration",    align: "r", derived: false,
    get: f => f.durationS, fmt: v => `${v.toFixed(0)}<span class="u"> s</span>`,
    range: true, field: "durationS", unit: "s", step: 1 },
  { k: "totalDistM",      label: "Total dist",  align: "r", derived: true,
    get: f => f.totalDistM, fmt: v => `${(v/1000).toFixed(2)}<span class="u"> km</span>`,
    range: true, field: "totalDistM", unit: "m", step: 10 },
  { k: "distSegM",        label: "Dist-seg",    align: "r", derived: true,
    get: f => f.distSegM, fmt: v => `${(v/1000).toFixed(2)}<span class="u"> km</span>`,
    range: true, field: "distSegM", unit: "m", step: 10 },
  { k: "avgSpeedDistKmh", label: "Avg speed",   align: "r", derived: true,
    get: f => f.avgSpeedDistKmh, fmt: v => `${v.toFixed(0)}<span class="u"> km/h</span>`,
    range: true, field: "avgSpeedDistKmh", unit: "km/h", step: 1 },
  { k: "maxSpeedKmh",     label: "Max speed",   align: "r", derived: true,
    get: f => f.maxSpeedKmh, fmt: v => `${v.toFixed(0)}<span class="u"> km/h</span>`,
    range: true, field: "maxSpeedKmh", unit: "km/h", step: 1 },
  { k: "maxAltBaro",      label: "Max alt",     align: "r", derived: true,
    get: f => f.maxAltBaro, fmt: v => `${v.toFixed(0)}<span class="u"> m</span>`,
    range: true, field: "maxAltBaro", unit: "m", step: 1 },
  { k: "predictedPayload",label: "Pred. payload", align: "r", derived: false,
    get: f => f.predictedPayload, fmt: v => v == null ? "—" : `${v}<span class="u"> cans</span>` },
  { k: "score",           label: "Score",       align: "r", derived: false,
    get: f => f.score, fmt: v => `<strong>${v.toFixed(0)}</strong>`,
    range: true, field: "score", unit: "pts", step: 1 },
  { k: "estFlightScore",  label: "Est. m·l²",   align: "r", derived: true,
    get: f => f.estFlightScore, fmt: v => v == null ? "—" : fmtRaw(v),
    range: true, field: "estFlightScore", unit: "", step: 1000 },
  { k: "overCurrentPenalty", label: "OC pen.",  align: "r", derived: true,
    get: f => f.overCurrentPenalty,
    fmt: v => v == null ? "—" : (v > 0 ? `<span class="pen">${v.toFixed(3)}</span>` : "0"),
    range: true, field: "overCurrentPenalty", unit: "", step: 0.01 },
];

// Columns that carry range filters, in table order.
const RANGE_COLS = COLS.filter(c => c.range);

let sort = { k: "score", asc: false };
const filters = { team: "", round: "", payload: "" };
// per-column numeric range bounds: field -> { min: number|null, max: number|null }
const ranges = {};
RANGE_COLS.forEach(c => { ranges[c.field] = { min: null, max: null }; });

function sortVal(col, f) {
  if (col.sort) return col.sort(f);
  const v = col.get(f);
  return v == null ? -Infinity : v;
}

// Apply the active filters to the flight index: team/university substring,
// exact round, exact predicted payload, plus per-column numeric [min, max] ranges.
function filteredIndex() {
  const q = filters.team.trim().toLowerCase();
  // only the ranges that actually have a bound set, resolved once per render.
  const activeRanges = RANGE_COLS
    .map(c => ({ field: c.field, ...ranges[c.field] }))
    .filter(r => r.min != null || r.max != null);
  return INDEX.filter(f => {
    if (filters.round && String(f.round) !== filters.round) return false;
    if (filters.payload && String(f.predictedPayload) !== filters.payload) return false;
    if (q) {
      const hay = `${f.team} ${f.university}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    for (const r of activeRanges) {
      const v = f[r.field];
      if (v == null) return false;                 // no value can't be in-range
      if (r.min != null && v < r.min) return false;
      if (r.max != null && v > r.max) return false;
    }
    return true;
  });
}

function renderTable() {
  const { k, asc } = sort;
  const col = COLS.find(c => c.k === k);
  const rows = filteredIndex().sort((a, b) => {
    const av = sortVal(col, a), bv = sortVal(col, b);
    if (typeof av === "string") return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    return asc ? av - bv : bv - av;
  });

  const countEl = document.getElementById("fCount");
  if (countEl) countEl.textContent =
    rows.length === INDEX.length ? `${INDEX.length} flights`
                                 : `${rows.length} of ${INDEX.length} flights`;

  const body = document.getElementById("flBody");
  if (!rows.length) {
    const span = COLS.length;
    body.innerHTML = `<tr><td class="l" colspan="${span}" style="color:var(--muted);padding:18px 8px">No flights match these filters.</td></tr>`;
    document.querySelectorAll("#flTable th").forEach(th => {
      th.classList.toggle("sorted", th.dataset.k === k);
      th.classList.toggle("asc", th.dataset.k === k && asc);
    });
    return;
  }

  body.innerHTML = rows.map(f => {
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

// data min/max per range field, for input placeholders and bound hints.
function dataExtent(field) {
  let lo = Infinity, hi = -Infinity;
  for (const f of INDEX) {
    const v = f[field];
    if (v == null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 0 };
}

// Serialize all active filters (incl. ranges) into the URL so a view is shareable.
function syncUrl() {
  const p = new URLSearchParams();
  if (filters.team) p.set("team", filters.team);
  if (filters.round) p.set("round", filters.round);
  if (filters.payload) p.set("payload", filters.payload);
  for (const c of RANGE_COLS) {
    const r = ranges[c.field];
    if (r.min != null) p.set(`min_${c.field}`, r.min);
    if (r.max != null) p.set(`max_${c.field}`, r.max);
  }
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

// Build the collapsible range-filter panel: a min/max pair per range column.
function buildRangePanel(params) {
  const wrap = document.getElementById("flRanges");
  if (!wrap) return;
  wrap.innerHTML = RANGE_COLS.map(c => {
    const { lo, hi } = dataExtent(c.field);
    const unit = c.unit ? ` <span class="ru">${c.unit}</span>` : "";
    const step = c.step || "any";
    // fixed decimals for the placeholder so tiny-step fields (penalty) read well.
    const dp = c.step && c.step < 1 ? 2 : 0;
    return `<div class="range" data-field="${c.field}">
      <label>${c.label}${unit}</label>
      <div class="range-inputs">
        <input type="number" step="${step}" data-bound="min" data-field="${c.field}"
               placeholder="${lo.toFixed(dp)}" aria-label="${c.label} minimum">
        <span class="dash">–</span>
        <input type="number" step="${step}" data-bound="max" data-field="${c.field}"
               placeholder="${hi.toFixed(dp)}" aria-label="${c.label} maximum">
      </div>
    </div>`;
  }).join("");

  // seed range values from URL, then wire live updates.
  wrap.querySelectorAll("input[type=number]").forEach(inp => {
    const field = inp.dataset.field, bound = inp.dataset.bound;
    const key = `${bound}_${field}`;
    if (params.has(key)) {
      const v = parseFloat(params.get(key));
      if (Number.isFinite(v)) { ranges[field][bound] = v; inp.value = v; }
    }
    inp.addEventListener("input", () => {
      const raw = inp.value.trim();
      ranges[field][bound] = raw === "" ? null : parseFloat(raw);
      if (Number.isNaN(ranges[field][bound])) ranges[field][bound] = null;
      renderTable(); syncUrl();
    });
  });
}

// Populate the round + payload dropdowns from the data and wire all filter
// controls to re-render. Round/payload options are the distinct values present.
function initFilters() {
  const teamEl = document.getElementById("fTeam");
  const roundEl = document.getElementById("fRound");
  const payloadEl = document.getElementById("fPayload");
  const clearEl = document.getElementById("fClear");

  const rounds = [...new Set(INDEX.map(f => f.round))].sort((a, b) => a - b);
  roundEl.insertAdjacentHTML("beforeend",
    rounds.map(r => `<option value="${r}">R${r}</option>`).join(""));

  const payloads = [...new Set(INDEX.map(f => f.predictedPayload).filter(v => v != null))]
    .sort((a, b) => a - b);
  payloadEl.insertAdjacentHTML("beforeend",
    payloads.map(p => `<option value="${p}">${p} cans</option>`).join(""));

  // seed from URL (?team=&round=&payload=&min_*=&max_*=) so views are shareable.
  const params = new URLSearchParams(location.search);
  if (params.has("team"))    { filters.team = params.get("team"); teamEl.value = filters.team; }
  if (params.has("round") && rounds.includes(+params.get("round")))
                             { filters.round = params.get("round"); roundEl.value = filters.round; }
  if (params.has("payload")) { filters.payload = params.get("payload"); payloadEl.value = filters.payload; }

  buildRangePanel(params);

  teamEl.addEventListener("input", () => { filters.team = teamEl.value; renderTable(); syncUrl(); });
  roundEl.addEventListener("change", () => { filters.round = roundEl.value; renderTable(); syncUrl(); });
  payloadEl.addEventListener("change", () => { filters.payload = payloadEl.value; renderTable(); syncUrl(); });
  clearEl.addEventListener("click", () => {
    filters.team = filters.round = filters.payload = "";
    teamEl.value = ""; roundEl.value = ""; payloadEl.value = "";
    RANGE_COLS.forEach(c => { ranges[c.field] = { min: null, max: null }; });
    document.querySelectorAll("#flRanges input[type=number]").forEach(i => { i.value = ""; });
    renderTable(); syncUrl();
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
  initFilters();
  renderTable();
})();
