"use strict";

// Flight Visualizer: one flight at a time. A custom Three.js 3D scene shows the
// flight path (coloured by phase) with a plane that flies the track on a
// replayable timeline whose clock reads flight time (T+0 = take-off), plus
// altitude / speed / voltage / current charts (Chart.js + drag-to-zoom) with
// phase-boundary markers. Deep-linkable via ?team=&round=.

let curTeam = null, curRound = null;
let lastFlight = null;
const charts = {};

// ---------- flight-clock helper (T+0 = take-off) ----------
function flightClock(tSeconds, t0) {
  const s = tSeconds - t0;
  const sign = s < 0 ? "−" : "+";
  const a = Math.abs(s);
  const mm = Math.floor(a / 60);
  const ss = Math.floor(a % 60);
  return `T${sign}${mm}:${String(ss).padStart(2, "0")}`;
}

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
  history.replaceState(null, "", `?team=${curTeam}&round=${curRound}`);
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
function tile(v, u, l) {
  return `<div class="stat"><div class="v">${v}<span class="u"> ${u}</span></div><div class="l">${l}</div></div>`;
}
function renderStats(flight) {
  const { meta } = flight;
  document.getElementById("stats").innerHTML =
    tile(meta.durationS.toFixed(0), "s", "Duration") +
    tile((meta.distSegM/1000).toFixed(2), "km", "Distance segment °") +
    tile(meta.avgSpeedDistKmh.toFixed(0), "km/h", "Avg speed (seg) °") +
    tile(meta.maxSpeedKmh.toFixed(0), "km/h", "Max speed °") +
    tile(meta.maxAltBaro.toFixed(0), "m", "Max altitude °") +
    tile(meta.predictedPayload ?? "—", "cans", "Pred. payload") +
    tile(meta.score.toFixed(0), "", "Round score");
}

// ---------- phase helpers ----------
function phaseOf(t, meta) {
  if (t < meta.t0) return "pre";
  if (t < meta.climbEndS) return "climb";
  if (t < meta.distEndS) return "distance";
  return "landing";
}

// ============================================================================
// Three.js flight scene
// ============================================================================
const SC = {
  ready: false,
  renderer: null, scene: null, camera: null, controls: null,
  pathGroup: null, plane: null, marks: null,
  // per-flight replay state
  rows: null, meta: null,
  worldPts: null,          // THREE.Vector3[] path in world coords (Y-up)
  cumT: null,              // cumulative time per sample (== rows[i].t)
  playing: false, speed: 4, tSim: 0, tEnd: 0,
  lastFrame: 0, raf: null,
};

// data (x East, y North, altBaro up) -> three world (Y up), centred at origin.
// world: X = East, Y = altitude, Z = -North.  Filled with a per-flight offset.
function toWorld(r, off) {
  // world: X = East, Y = height above the flight's ground reference, Z = -North.
  return new THREE.Vector3(r.x - off.x, Math.max(0, r.altBaro - off.y), -(r.y - off.z));
}

function initScene() {
  const host = document.getElementById("scene3d");
  const w = host.clientWidth, h = host.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // sky gradient background + fog fading to the horizon colour.
  scene.background = skyTexture();
  const HORIZON = 0xbcd6ea;
  scene.fog = new THREE.Fog(HORIZON, 1500, 9000);

  const camera = new THREE.PerspectiveCamera(52, w / h, 0.5, 40000);
  camera.position.set(300, 260, 340);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = Math.PI * 0.492;  // don't go under the ground
  controls.minDistance = 8;
  controls.maxDistance = 12000;

  // large grass ground plane at y=0.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;   // just below the path shadow / grid
  scene.add(ground);
  SC.ground = ground;

  // daylight lighting: sky/ground hemisphere + a warm sun key.
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a7a3a, 1.0));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.15);
  key.position.set(0.6, 1.4, 0.8);
  scene.add(key);

  SC.renderer = renderer; SC.scene = scene; SC.camera = camera; SC.controls = controls;
  SC.ready = true;

  window.addEventListener("resize", onResize);
  animate(performance.now());
}

function onResize() {
  if (!SC.ready) return;
  const host = document.getElementById("scene3d");
  const w = host.clientWidth, h = host.clientHeight;
  SC.camera.aspect = w / h;
  SC.camera.updateProjectionMatrix();
  SC.renderer.setSize(w, h);
}

// Build (or rebuild) all per-flight geometry.
function buildFlightScene(flight) {
  const { rows, meta } = flight;
  const c = COL();
  const scene = SC.scene;

  // clear previous flight geometry
  if (SC.pathGroup) { scene.remove(SC.pathGroup); disposeGroup(SC.pathGroup); }
  if (SC.plane) { scene.remove(SC.plane); disposeGroup(SC.plane); }
  if (SC.grid) { scene.remove(SC.grid); SC.grid.geometry.dispose(); SC.grid.material.dispose(); }

  // centre the track: offset by mean East/North, and by the flight's MINIMUM
  // baro altitude so the ground reference sits at world y=0. (altBaro is not
  // guaranteed to be ground-relative — some flights baseline it at a few hundred
  // metres — so subtracting the min is what puts the track on the grass.)
  const cx = rows.reduce((s,r)=>s+r.x,0)/rows.length;
  const cz = rows.reduce((s,r)=>s+r.y,0)/rows.length;
  const minAlt = Math.min(...rows.map(r => r.altBaro));
  const off = { x: cx, y: minAlt, z: cz };
  const worldPts = rows.map(r => toWorld(r, off));

  // ground grid sized to the track footprint.
  const spanX = Math.max(...rows.map(r=>Math.abs(r.x-cx))) * 2;
  const spanZ = Math.max(...rows.map(r=>Math.abs(r.y-cz))) * 2;
  const gridSize = Math.max(spanX, spanZ, 200) * 1.4;
  const div = 20;
  const grid = new THREE.GridHelper(gridSize, div, 0xffffff, 0xffffff);
  grid.material.transparent = true;
  grid.material.opacity = 0.12;   // faint white lines over the grass, for scale
  grid.position.y = 0.02;
  scene.add(grid);
  SC.grid = grid;

  // path as phase-coloured segments; each phase is its own line for its colour.
  const phaseColor = {
    climb: new THREE.Color(c.volt),
    distance: new THREE.Color(c.alt),
    landing: new THREE.Color(c.curr),
    pre: new THREE.Color(c.muted),
  };
  const group = new THREE.Group();

  // ground shadow: the track projected onto the grid (y=0), faint, ties the
  // floating path to the ground so altitude reads clearly.
  const shadowPts = worldPts.map(p => new THREE.Vector3(p.x, 0.15, p.z));
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(shadowPts),
    new THREE.LineBasicMaterial({ color: 0x1c2a12, transparent: true, opacity: 0.4 })
  ));

  let segStart = 0;
  for (let i = 1; i <= rows.length; i++) {
    const boundary = i === rows.length ||
      phaseOf(rows[i].t, meta) !== phaseOf(rows[segStart].t, meta);
    if (!boundary) continue;
    const ph = phaseOf(rows[segStart].t, meta);
    // include the boundary sample (i) so adjacent phase segments visually join
    // without a gap; the segment's colour is still its OWN phase.
    const pts = worldPts.slice(segStart, Math.min(i + 1, rows.length));
    if (pts.length >= 2) {
      const col = phaseColor[ph] || phaseColor.pre;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      // glow underlay: a wider, dim, additive line behind the crisp core line.
      group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, linewidth: 1,
      })));
      group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col })));
    }
    segStart = i;
  }

  // start / end markers, sized to the track.
  const mkR = Math.max(gridSize * 0.006, 2);
  const mk = (p, col) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(mkR, 16, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(col) })
    );
    m.position.copy(p);
    return m;
  };
  group.add(mk(worldPts[0], c.volt));
  group.add(mk(worldPts[worldPts.length-1], c.curr));

  scene.add(group);
  SC.pathGroup = group;

  // the plane, drawn TO SCALE: real ACC aircraft wingspan ~2 m. The silhouette's
  // wingspan occupies 88% of the icon quad, so the quad is 2 / 0.88 m wide.
  const WINGSPAN_M = 2.0;
  SC.planeQuadW = WINGSPAN_M / 0.88;
  SC.plane = makePlane(c.accent, SC.planeQuadW);
  scene.add(SC.plane);

  // A 2 m plane is a speck on a ~1 km track, so add a screen-constant locator
  // ring that keeps the aircraft findable when zoomed out. It's resized every
  // frame (see animate) to hold a fixed on-screen size, independent of distance.
  if (SC.locator) { scene.remove(SC.locator); SC.locator.material.map.dispose(); SC.locator.material.dispose(); }
  SC.locator = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ringTexture(), color: new THREE.Color(c.accent),
    transparent: true, opacity: 0.9, depthWrite: false, depthTest: false,
  }));
  SC.locator.renderOrder = 999;
  scene.add(SC.locator);

  // frame the camera on the track with an oblique view.
  frameTrack(worldPts);

  // stash replay state
  SC.rows = rows; SC.meta = meta;
  SC.worldPts = worldPts;
  SC.cumT = rows.map(r => r.t);
  SC.tEnd = rows[rows.length-1].t;
  SC.tSim = 0;
  SC.playing = false;

  // Heading jitter guard: only re-aim the plane once it has moved at least this
  // far horizontally since the last heading update. Scaled to the track so it's
  // a few metres on a real field — enough to swamp GPS noise while stationary.
  SC.headingThresh = Math.max(gridSize * 0.008, 3);
  SC.lastHeadingPos = worldPts[0].clone();
  // seed a sensible initial heading from the first real motion in the data.
  SC.headingQuat = initialHeadingQuat(worldPts, SC.headingThresh);
  SC.plane.quaternion.copy(SC.headingQuat);

  // Take-off point (plane position at t0) — the "Start POV" camera stands here,
  // a couple of metres off the ground, like a pilot watching from the line.
  SC.startPovPos = worldPtAtTime(meta.t0).clone();
  SC.startPovPos.y = Math.max(SC.startPovPos.y, 0) + 1.7;  // eye height

  // preserve the current view mode across flight changes.
  SC.view = SC.view || "orbit";

  updateScrubUI();
  updatePlaneAt(0, true);
  applyViewMode(SC.view, true);
}

// world position along the path at flight-time t (no side effects).
function worldPtAtTime(t) {
  const cum = SC.cumT;
  let i = binSearch(cum, t);
  i = Math.max(0, Math.min(i, SC.worldPts.length - 2));
  const ta = cum[i], tb = cum[i+1];
  const f = tb > ta ? (t - ta) / (tb - ta) : 0;
  return SC.worldPts[i].clone().lerp(SC.worldPts[i+1], Math.max(0, Math.min(1, f)));
}

function makePlane(colorStr, quadW) {
  const g = new THREE.Group();

  // A flat, textured quad carrying a top-down plane silhouette. It lies in the
  // XZ plane (facing up) so from the oblique camera it reads as an aircraft seen
  // from above; we rotate the whole group around Y to point it along heading.
  // The silhouette texture is drawn pointing toward +Z (the travel direction).
  const tex = planeIconTexture(colorStr);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  quad.rotation.x = -Math.PI / 2;   // lay flat, top face up
  g.add(quad);

  g.scale.setScalar(quadW);         // unit quad -> quadW metres wide (to scale)
  g.userData.iconMat = mat;
  return g;
}

// Sky gradient (blue at top fading to a pale horizon), used as scene.background.
let _skyTex = null;
function skyTexture() {
  if (_skyTex) return _skyTex;
  const cv = document.createElement("canvas");
  cv.width = 8; cv.height = 256;
  const ctx = cv.getContext("2d");
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.0, "#4a86c4");   // zenith
  grd.addColorStop(0.55, "#8db8dd");
  grd.addColorStop(1.0, "#cfe1ee");   // horizon haze
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 8, 256);
  _skyTex = new THREE.CanvasTexture(cv);
  _skyTex.colorSpace = THREE.SRGBColorSpace;
  return _skyTex;
}

// Procedural grass texture: green base with subtle blade-like speckle, tiled.
let _grassTex = null;
function grassTexture() {
  if (_grassTex) return _grassTex;
  const s = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#4f7a35";
  ctx.fillRect(0, 0, s, s);
  // speckle with lighter/darker green flecks for a mown-grass feel.
  const greens = ["#3f6a2b", "#5a8a3d", "#456f2f", "#628f42", "#547f38"];
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = greens[(Math.random() * greens.length) | 0];
    const x = Math.random() * s, y = Math.random() * s;
    ctx.fillRect(x, y, 1.4, 2.4);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(400, 400);          // many tiles across the big ground plane
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _grassTex = tex;
  return tex;
}

// Hollow ring texture for the screen-constant locator (cached).
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(s/2, s/2, s/2 - 6, 0, Math.PI * 2); ctx.stroke();
  _ringTex = new THREE.CanvasTexture(cv);
  return _ringTex;
}

// Draw a top-down plane silhouette on a canvas, nose pointing UP (+ -> maps to
// +Z once the quad is laid flat). Cached per colour.
const _planeIconCache = {};
function planeIconTexture(colorStr) {
  if (_planeIconCache[colorStr]) return _planeIconCache[colorStr];
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  ctx.translate(S / 2, S / 2);
  ctx.scale(S / 100, S / 100);      // work in a ~100-unit box centred at origin

  // soft glow behind the silhouette so it's findable when zoomed out.
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 52);
  glow.addColorStop(0, "rgba(255,255,255,0.45)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 52, 0, Math.PI * 2); ctx.fill();

  // plane silhouette (nose toward -Y in canvas = "up"); white fill, dark edge.
  ctx.beginPath();
  ctx.moveTo(0, -42);               // nose
  ctx.lineTo(6, -8);
  ctx.lineTo(44, 10);               // right wingtip
  ctx.lineTo(44, 20);
  ctx.lineTo(6, 12);
  ctx.lineTo(5, 30);
  ctx.lineTo(18, 40);               // right tailplane
  ctx.lineTo(18, 46);
  ctx.lineTo(0, 40);
  ctx.lineTo(-18, 46);              // left tailplane
  ctx.lineTo(-18, 40);
  ctx.lineTo(-5, 30);
  ctx.lineTo(-6, 12);
  ctx.lineTo(-44, 20);              // left wingtip
  ctx.lineTo(-44, 10);
  ctx.lineTo(-6, -8);
  ctx.closePath();
  ctx.fillStyle = "#f2f4f8";
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = colorStr;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  _planeIconCache[colorStr] = tex;
  return tex;
}

function disposeGroup(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m=>m.dispose());
      else o.material.dispose();
    }
  });
}

function frameTrack(worldPts) {
  const box = new THREE.Box3().setFromPoints(worldPts);
  const size = new THREE.Vector3(); box.getSize(size);
  const centre = new THREE.Vector3(); box.getCenter(centre);
  const radius = Math.max(size.length() * 0.5, 60);
  SC.controls.target.copy(centre);
  // oblique: back off along a SW-ish, tilted direction. Tighter than before so
  // the path fills the frame rather than floating in a large void.
  const dir = new THREE.Vector3(0.62, 0.5, 0.68).normalize();
  SC.camera.position.copy(centre.clone().add(dir.multiplyScalar(radius * 1.7)));
  SC.camera.near = Math.max(0.5, radius / 500);
  SC.camera.far = radius * 40;
  SC.camera.updateProjectionMatrix();
  SC.controls.update();
}

// ---------- camera view modes: orbit | start | plane ----------
function applyViewMode(mode, force) {
  if (!force && SC.view === mode) return;
  SC.view = mode;
  // reflect on the buttons
  document.querySelectorAll("#viewBtns .tp-btn").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.view === mode)));

  if (mode === "orbit") {
    SC.controls.enabled = true;
    if (SC.worldPts) frameTrack(SC.worldPts);
  } else {
    // POV modes: hand the camera to updatePovCamera, disable manual orbit.
    SC.controls.enabled = false;
    SC.camera.near = 0.3;
    SC.camera.far = 40000;
    SC.camera.updateProjectionMatrix();
    updatePovCamera();
  }
}

let _tmpTarget = null, _tmpPos = null;
function updatePovCamera() {
  if (!SC.plane) return;
  if (!_tmpTarget) { _tmpTarget = new THREE.Vector3(); _tmpPos = new THREE.Vector3(); }
  const planePos = SC.plane.position;

  if (SC.view === "start") {
    // Stand at the take-off point and watch the aircraft fly.
    SC.camera.position.copy(SC.startPovPos);
    SC.camera.up.set(0, 1, 0);
    SC.camera.lookAt(planePos);
  } else if (SC.view === "plane") {
    // Chase cam: sit behind & slightly above the plane, along its heading. The
    // aircraft nose points along the group's local -Z (see headingQuatFromDir).
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(SC.plane.quaternion);
    const back = fwd.clone().multiplyScalar(-14);   // 14 m behind the nose
    _tmpPos.copy(planePos).add(back);
    _tmpPos.y += 5;                                  // 5 m above
    _tmpPos.y = Math.max(_tmpPos.y, 1.5);           // never under ground
    // smooth follow to avoid GPS-driven jitter in the camera.
    SC.camera.position.lerp(_tmpPos, 0.15);
    SC.camera.up.set(0, 1, 0);
    _tmpTarget.copy(planePos).add(fwd.multiplyScalar(8)); // look ahead of the nose
    SC.camera.lookAt(_tmpTarget);
  }
}

// Yaw-only heading quaternion that aims the aircraft's NOSE along a horizontal
// travel direction (dx, dz). The silhouette is drawn nose-up (canvas -Y), and
// the quad is laid flat with rotation.x = -90°, which makes the world-space nose
// point along the group's local -Z. So we rotate group +Z to (-dx, -dz), i.e.
// yaw = atan2(-dx, -dz). (Vertical GPS noise never tilts the flat icon.)
function headingQuatFromDir(dx, dz) {
  const yaw = Math.atan2(-dx, -dz);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

// Seed the initial heading from the first movement exceeding `thresh`.
function initialHeadingQuat(pts, thresh) {
  const a = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - a.x, dz = pts[i].z - a.z;
    if (Math.hypot(dx, dz) >= thresh) return headingQuatFromDir(dx, dz);
  }
  return new THREE.Quaternion();  // never moved enough; identity
}

// interpolate world position at flight-time t, place the plane, and update the
// heading ONLY once it has moved past the jitter threshold (so GPS noise while
// stationary on the ground doesn't spin the icon).
function updatePlaneAt(t, snap) {
  if (!SC.worldPts) return;
  const cum = SC.cumT;
  let i = binSearch(cum, t);
  i = Math.max(0, Math.min(i, SC.worldPts.length - 2));
  const ta = cum[i], tb = cum[i+1];
  const f = tb > ta ? (t - ta) / (tb - ta) : 0;
  const p0 = SC.worldPts[i], p1 = SC.worldPts[i+1];
  const pos = p0.clone().lerp(p1, Math.max(0, Math.min(1, f)));
  SC.plane.position.copy(pos);

  // Heading update, guarded by a minimum horizontal displacement.
  const dx = pos.x - SC.lastHeadingPos.x;
  const dz = pos.z - SC.lastHeadingPos.z;
  if (Math.hypot(dx, dz) >= SC.headingThresh) {
    SC.headingQuat = headingQuatFromDir(dx, dz);
    SC.lastHeadingPos.copy(pos);
  }
  // Ease toward the target heading while playing; snap when scrubbing/seeking.
  if (snap) SC.plane.quaternion.copy(SC.headingQuat);
  else SC.plane.quaternion.slerp(SC.headingQuat, 0.25);

  // clock overlay + scrub label
  const lbl = flightClock(t, SC.meta.t0);
  document.getElementById("sceneClock").textContent = lbl;
  document.getElementById("scrubLabel").textContent = lbl;
}

function binSearch(arr, t) {
  let lo = 0, hi = arr.length - 1;
  if (t <= arr[0]) return 0;
  if (t >= arr[hi]) return hi - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < t) lo = mid + 1; else hi = mid;
  }
  return Math.max(0, lo - 1);
}

// ---------- replay transport ----------
function updateScrubUI() {
  const scrub = document.getElementById("scrub");
  scrub.value = String(Math.round((SC.tSim / SC.tEnd) * 1000) || 0);
  document.getElementById("playBtn").textContent = SC.playing ? "⏸" : "▶";
}

function setPlaying(on) {
  SC.playing = on;
  if (on && SC.tSim >= SC.tEnd) SC.tSim = 0; // restart if at end
  document.getElementById("playBtn").textContent = on ? "⏸" : "▶";
}

function animate(now) {
  SC.raf = requestAnimationFrame(animate);
  if (!SC.ready) return;
  const dt = (now - (SC.lastFrame || now)) / 1000;
  SC.lastFrame = now;

  if (SC.playing && SC.worldPts) {
    SC.tSim += dt * SC.speed;
    if (SC.tSim >= SC.tEnd) { SC.tSim = SC.tEnd; setPlaying(false); }
    updatePlaneAt(SC.tSim);
    updateScrubUI();
  }

  // POV cameras drive the camera directly each frame; orbit uses OrbitControls.
  if (SC.view === "start" || SC.view === "plane") updatePovCamera();
  else SC.controls && SC.controls.update();

  // Keep the locator ring on the plane at a constant on-screen size. Hidden in
  // plane-chase (you're on the plane) and when zoomed in close enough to see it.
  if (SC.locator && SC.plane) {
    const camDist = SC.camera.position.distanceTo(SC.plane.position);
    const ringM = camDist * 0.035;            // ~constant screen size
    SC.locator.position.copy(SC.plane.position);
    SC.locator.scale.setScalar(ringM);
    const near = SC.planeQuadW * 12;
    SC.locator.visible = SC.view !== "plane" && camDist > near;
  }

  SC.renderer && SC.renderer.render(SC.scene, SC.camera);
}

function wireTransport() {
  document.getElementById("playBtn").addEventListener("click", () => setPlaying(!SC.playing));
  document.getElementById("restartBtn").addEventListener("click", () => {
    SC.tSim = 0; SC.lastHeadingPos.copy(SC.worldPts[0]); updatePlaneAt(0, true); updateScrubUI(); setPlaying(true);
  });
  document.getElementById("scrub").addEventListener("input", (e) => {
    setPlaying(false);
    SC.tSim = (+e.target.value / 1000) * SC.tEnd;
    updatePlaneAt(SC.tSim, true);
  });
  document.getElementById("speedSel").addEventListener("change", (e) => {
    SC.speed = +e.target.value;
  });
  document.querySelectorAll("#viewBtns .tp-btn").forEach(b => {
    b.addEventListener("click", () => applyViewMode(b.dataset.view));
  });
}

// ============================================================================
// Charts (Chart.js + drag-to-zoom + phase markers)
// ============================================================================
const phaseLinePlugin = {
  id: "phaseLines",
  afterDatasetsDraw(chart) {
    const marks = chart.$phaseMarks;
    if (!marks) return;
    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
    ctx.save();
    ctx.strokeStyle = css("--muted");
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const m of marks) {
      const px = x.getPixelForValue(m.x);
      if (px < x.left || px > x.right) continue;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
    }
    ctx.restore();
  },
};

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
      zoom: {
        zoom: {
          drag: { enabled: true, backgroundColor: "rgba(42,120,214,0.15)", borderColor: c.alt, borderWidth: 1 },
          wheel: { enabled: true, speed: 0.08 },
          mode: "x",
        },
        pan: { enabled: true, mode: "x", modifierKey: "shift" },
        limits: { x: { minRange: 2 } },
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
function mkLine(id, datasets, yLabel, marks) {
  const ctx = document.getElementById(id);
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: "line", data: { datasets }, options: baseOpts(yLabel),
    plugins: [phaseLinePlugin],
  });
  charts[id].$phaseMarks = marks;
  // double-click to reset zoom
  ctx.ondblclick = () => charts[id].resetZoom();
  charts[id].update();
}
function renderCharts(flight) {
  const { rows, meta } = flight;
  const c = COL();
  const marks = [
    { x: meta.t0 }, { x: meta.climbEndS }, { x: meta.distEndS },
  ];
  const xy = (key) => rows.map(r => ({ x: r.t, y: r[key] }));
  mkLine("altChart", [
    { label:"Baro", data: xy("altBaro"), borderColor:c.alt, tension:.15 },
    { label:"GPS",  data: xy("altGps"), borderColor:c.muted, borderDash:[4,4], tension:.15 },
  ], "altitude (m)", marks);
  mkLine("speedChart", [
    { label:"Speed", data: xy("speed"), borderColor:c.accent, tension:.15 },
  ], "ground speed (km/h)", marks);
  mkLine("voltChart", [
    { label:"Voltage", data: xy("voltage"), borderColor:c.volt, tension:.15 },
  ], "voltage (V)", marks);
  mkLine("currChart", [
    { label:"Current", data: xy("current"), borderColor:c.curr, tension:.15 },
  ], "current (A)", marks);
}

// ---------- orchestration ----------
async function refreshFlight() {
  const errEl = document.getElementById("loadErr");
  errEl.textContent = "";
  try {
    const flight = await loadFlight(curTeam, curRound);
    if (!flight || flight.rows.length < 2) { errEl.textContent = "No flight data for this selection."; return; }
    lastFlight = flight;
    renderStats(flight);
    if (SC.ready) buildFlightScene(flight);
    renderCharts(flight);
    document.getElementById("mapnote").textContent =
      `Path coloured by phase from flight-time start (T+0 = take-off): climb T+0–60 s, ` +
      `distance T+60–180 s, landing after. Altitude is metres above the field. ` +
      `Drag to orbit · wheel to zoom · right-drag to pan.`;
    window.__vis = { SC, flight };
  } catch (e) {
    errEl.textContent = "Failed to load flight: " + e.message;
    console.error(e);
  }
}

// ---------- boot ----------
function boot() {
  renderChrome("visualizer");
  initTheme(() => { if (lastFlight) { renderCharts(lastFlight); if (SC.ready) buildFlightScene(lastFlight); } });
  wireTransport();
  (async function(){
    try {
      await loadBase();
    } catch(e) {
      document.getElementById("loadErr").textContent =
        "Could not load data files. If viewing locally, serve over http (e.g. `python -m http.server` in docs/).";
      return;
    }
    buildTeamSelect();

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
}

// Three.js loads as an ES module and signals via `three-ready`. Init the scene
// once it's available, then boot the page (data + charts don't need Three).
function whenThreeReady(cb) {
  if (window.THREE && window.OrbitControls) cb();
  else window.addEventListener("three-ready", cb, { once: true });
}
whenThreeReady(() => {
  try { initScene(); }
  catch (e) { document.getElementById("loadErr").textContent = "3D scene failed: " + e.message; console.error(e); }
  boot();
});
