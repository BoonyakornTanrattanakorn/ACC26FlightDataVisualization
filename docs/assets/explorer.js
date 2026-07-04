"use strict";

// Flight explorer page: team/round selector, stat tiles, ground-track map,
// and altitude/voltage/current charts. Deep-linkable via ?team=&round=.

let curTeam = null, curRound = null;
let map, trackLayer, startMarker, endMarker;
const charts = {};

// ---------- selectors ----------
function buildTeamSelect() {
  const sel = document.getElementById("teamSel");
  const withFlights = SCORES.filter(t => roundsForTeam(t.id).length);
  sel.innerHTML = withFlights.map(t =>
    `<option value="${t.id}">${t.flag} ${esc(t.name)} — ${esc(t.university)}</option>`
  ).join("");
  sel.addEventListener("change", () => selectTeam(+sel.value));
}

function buildRoundPills() {
  const wrap = document.getElementById("roundPills");
  const avail = new Set(roundsForTeam(curTeam));
  wrap.innerHTML = [1,2,3,4].map(r =>
    `<button data-r="${r}" ${avail.has(r)?"":"disabled"}
       aria-pressed="${r===curRound}">R${r}</button>`
  ).join("");
  wrap.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => { if (!b.disabled) selectRound(+b.dataset.r); });
  });
}

function syncUrl() {
  if (curTeam == null || curRound == null) return;
  const q = `?team=${curTeam}&round=${curRound}`;
  history.replaceState(null, "", q);
}

async function selectTeam(teamId) {
  curTeam = teamId;
  const rounds = roundsForTeam(teamId);
  if (!rounds.length) return;
  if (!rounds.includes(curRound)) curRound = rounds[0];
  document.getElementById("teamSel").value = String(teamId);
  buildRoundPills();
  await refreshFlight();
  syncUrl();
}
async function selectRound(round) {
  curRound = round;
  buildRoundPills();
  await refreshFlight();
  syncUrl();
}

// ---------- stats ----------
function renderStats(flight) {
  const { rows, meta } = flight;
  const t = TEAMS[curTeam];
  const maxAlt = Math.max(...rows.map(r => r.altBaro));
  const vMax = Math.max(...rows.map(r => r.voltage));
  const iMax = Math.max(...rows.map(r => r.current));
  // rough distance along track
  let dist = 0;
  for (let i=1;i<rows.length;i++){ dist += Math.hypot(rows[i].x-rows[i-1].x, rows[i].y-rows[i-1].y); }
  const tile = (v,u,l) => `<div class="stat"><div class="v">${v}<span class="u"> ${u}</span></div><div class="l">${l}</div></div>`;
  document.getElementById("stats").innerHTML =
    tile(meta.durationS.toFixed(0), "s", "Duration") +
    tile(maxAlt.toFixed(1), "m", "Max altitude") +
    tile((dist/1000).toFixed(2), "km", "Track length") +
    tile(vMax.toFixed(2), "V", "Peak voltage") +
    tile(iMax.toFixed(1), "A", "Peak current") +
    tile((t.predictedPayload ?? "—"), "", "Pred. payload");
}

// ---------- map ----------
function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap"
  }).addTo(map);
  map.setView([48.639, 8.942], 16);
}
function renderMap(flight) {
  if (trackLayer) trackLayer.remove();
  if (startMarker) startMarker.remove();
  if (endMarker) endMarker.remove();
  const { rows } = flight;
  const alts = rows.map(r => r.altBaro);
  const lo = Math.min(...alts), hi = Math.max(...alts) || 1;
  const c = COL();
  // altitude-coloured polyline (sequential blue): draw as coloured segments
  const segs = [];
  for (let i=1;i<rows.length;i++){
    const frac = (rows[i].altBaro - lo) / (hi - lo || 1);
    segs.push(L.polyline(
      [[rows[i-1].lat,rows[i-1].lon],[rows[i].lat,rows[i].lon]],
      { color: seqBlue(frac), weight: 3, opacity: 0.95 }
    ));
  }
  trackLayer = L.layerGroup(segs).addTo(map);
  const a = rows[0], z = rows[rows.length-1];
  startMarker = L.circleMarker([a.lat,a.lon], {radius:6,color:"#fff",weight:2,fillColor:c.volt,fillOpacity:1}).bindTooltip("Start").addTo(map);
  endMarker = L.circleMarker([z.lat,z.lon], {radius:6,color:"#fff",weight:2,fillColor:c.accent,fillOpacity:1}).bindTooltip("End").addTo(map);
  const bounds = L.latLngBounds(rows.map(r=>[r.lat,r.lon]));
  map.fitBounds(bounds.pad(0.15));
  document.getElementById("mapnote").textContent =
    `Altitude range ${lo.toFixed(1)}–${hi.toFixed(1)} m · lighter → higher.`;
}
// sequential blue ramp 250→650
function seqBlue(f){
  const stops = ["#86b6ef","#5598e7","#3987e5","#256abf","#184f95","#104281"];
  const i = Math.min(stops.length-1, Math.max(0, Math.floor(f*(stops.length-1))));
  return stops[i];
}

// ---------- line charts ----------
function baseOpts(yLabel) {
  const c = COL();
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.surface, titleColor: c.text2, bodyColor: c.text2,
        borderColor: c.grid, borderWidth: 1,
        callbacks: { title: (it)=> `t = ${it[0].parsed.x.toFixed(1)} s` },
      },
    },
    scales: {
      x: { type:"linear", title:{display:true,text:"time (s)",color:c.muted},
           grid:{color:c.grid}, ticks:{color:c.muted}, border:{color:c.axis} },
      y: { title:{display:true,text:yLabel,color:c.muted},
           grid:{color:c.grid}, ticks:{color:c.muted}, border:{color:c.axis} },
    },
    elements: { point: { radius: 0, hoverRadius: 4 }, line: { borderWidth: 2 } },
  };
}
function mkLine(id, datasets, yLabel) {
  const ctx = document.getElementById(id);
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, { type:"line", data:{datasets}, options: baseOpts(yLabel) });
}
function renderCharts(flight) {
  const { rows } = flight;
  const c = COL();
  const xy = (key) => rows.map(r => ({ x: r.t, y: r[key] }));
  mkLine("altChart", [
    { label:"Baro", data: xy("altBaro"), borderColor:c.alt, tension:.15 },
    { label:"GPS",  data: xy("altGps"), borderColor:c.muted, borderDash:[4,4], tension:.15, hidden:false },
  ], "altitude (m)");
  mkLine("voltChart", [
    { label:"Voltage", data: xy("voltage"), borderColor:c.volt, tension:.15 },
  ], "voltage (V)");
  mkLine("currChart", [
    { label:"Current", data: xy("current"), borderColor:c.curr, tension:.15 },
  ], "current (A)");
}

// ---------- orchestration ----------
let lastFlight = null;
async function refreshFlight() {
  const errEl = document.getElementById("loadErr");
  errEl.textContent = "";
  try {
    const flight = await loadFlight(curTeam, curRound);
    if (!flight || flight.rows.length < 2) { errEl.textContent = "No flight data for this selection."; return; }
    lastFlight = flight;
    renderStats(flight);
    renderMap(flight);
    renderCharts(flight);
  } catch (e) {
    errEl.textContent = "Failed to load flight: " + e.message;
  }
}

// ---------- boot ----------
(async function(){
  renderChrome("explorer");
  // re-render map/charts on theme change so canvas colours update
  initTheme(() => { if (lastFlight) refreshFlight(); });
  initMap();
  try {
    await loadBase();
  } catch(e) {
    document.getElementById("loadErr").textContent =
      "Could not load data files. If viewing locally, serve over http (e.g. `python -m http.server` in docs/).";
    return;
  }
  buildTeamSelect();

  // Preselect from ?team=&round=, else default to the first team with flights.
  const params = new URLSearchParams(location.search);
  const wantTeam = params.has("team") ? +params.get("team") : null;
  const wantRound = params.has("round") ? +params.get("round") : null;

  let team = (wantTeam != null && roundsForTeam(wantTeam).length) ? wantTeam : null;
  if (team == null) {
    const first = SCORES.find(t => roundsForTeam(t.id).length);
    team = first ? first.id : null;
  }
  if (team == null) { document.getElementById("loadErr").textContent = "No flight data available."; return; }

  if (wantRound != null && roundsForTeam(team).includes(wantRound)) curRound = wantRound;
  await selectTeam(team);
})();
