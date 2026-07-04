"use strict";

// ============================================================================
// Shared across all pages: palette helpers, escaping, theme, nav, data loading.
// Each page includes this first, then its own page script.
// ============================================================================

// ---------- palette helpers (read live CSS vars so theme swaps apply) ----------
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COL = () => ({
  alt: css("--alt"), volt: css("--volt"), curr: css("--curr"),
  accent: css("--accent"), grid: css("--grid"), axis: css("--axis"),
  text2: css("--text-2"), muted: css("--muted"), surface: css("--surface"),
});

function esc(s){ return String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

// ---------- shared data (populated by loadBase) ----------
let SCORES = [];   // scores.json
let INDEX = [];    // flights_index.json
const TEAMS = {};  // id -> team record

async function loadBase() {
  const [scores, index] = await Promise.all([
    fetch("data/scores.json").then(r => r.json()),
    fetch("data/flights_index.json").then(r => r.json()),
  ]);
  SCORES = scores;
  INDEX = index;
  SCORES.forEach(t => { TEAMS[t.id] = t; });
}

function roundsForTeam(teamId) {
  return INDEX.filter(f => f.teamId === teamId).map(f => f.round).sort((a,b)=>a-b);
}
function flightMeta(teamId, round) {
  return INDEX.find(f => f.teamId === teamId && f.round === round);
}

async function loadFlight(teamId, round) {
  const meta = flightMeta(teamId, round);
  if (!meta) return null;
  const text = await fetch(meta.file).then(r => r.text());
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const idx = Object.fromEntries(head.map((h,i)=>[h,i]));
  const rows = lines.slice(1).map(line => {
    const c = line.split(",");
    return {
      t: +c[idx.t], x: +c[idx.x], y: +c[idx.y],
      altGps: +c[idx.altGps], altBaro: +c[idx.altBaro],
      voltage: +c[idx.voltage], current: +c[idx.current],
      lat: +c[idx.lat], lon: +c[idx.lon],
    };
  });
  return { meta, rows };
}

// ---------- shared header + nav ----------
// Renders the top bar (title, theme button) and site nav into #siteHeader.
// `active` is one of "home" | "leaderboard" | "explorer".
function renderChrome(active) {
  const links = [
    { key: "home",        href: "index.html",       label: "Home" },
    { key: "leaderboard", href: "leaderboard.html", label: "Leaderboard" },
    { key: "explorer",    href: "explorer.html",    label: "Flight Explorer" },
  ];
  const nav = links.map(l =>
    `<a href="${l.href}"${l.key === active ? ' aria-current="page"' : ""}>${l.label}</a>`
  ).join("");
  const host = document.getElementById("siteHeader");
  host.innerHTML = `
    <header class="top">
      <div><h1>Air Cargo Challenge 2026 — Flight Telemetry</h1></div>
      <button class="theme-btn" id="themeBtn" type="button">Toggle theme</button>
    </header>
    <p class="sub">33 teams · 4 competition rounds · GPS track, altitude, voltage &amp; current per flight. Field at 48.639° N, 8.942° E.</p>
    <nav class="site">${nav}</nav>`;
}

// ---------- theme ----------
// `onChange` (optional) is called after a toggle so a page can re-render
// canvas/map elements that don't pick up CSS-var changes automatically.
function initTheme(onChange) {
  document.getElementById("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const mql = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = cur ? cur === "dark" : mql;
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
    if (typeof onChange === "function") onChange();
  });
}
