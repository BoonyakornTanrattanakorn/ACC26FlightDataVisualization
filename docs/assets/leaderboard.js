"use strict";

// Leaderboard page: sortable standings table. Clicking a team that has flight
// data navigates to the explorer, deep-linked to that team's first round.

let lbSort = { k: "total", asc: false };

function firstRound(teamId) {
  const rs = roundsForTeam(teamId);
  return rs.length ? rs[0] : null;
}

function renderLeaderboard() {
  const body = document.getElementById("lbBody");
  const { k, asc } = lbSort;
  const rows = [...SCORES].sort((a,b) => {
    let av = a[k], bv = b[k];
    if (typeof av === "string") return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    return asc ? av - bv : bv - av;
  });
  body.innerHTML = rows.map(t => {
    const hasFlight = roundsForTeam(t.id).length > 0;
    const dsq = t.dsq ? " dsq" : "";
    const clk = hasFlight ? " clickable" : "";
    return `<tr class="lbrow${dsq}${clk}" data-id="${t.id}"${hasFlight ? "" : ' data-noflight="1"'}>
      <td class="l rank">${t.rank}</td>
      <td class="l"><span class="team-name">${t.flag} ${esc(t.name)}</span><br>
          <span class="team-uni">${esc(t.university)}</span></td>
      <td>${t.roundTotal}</td>
      <td>${t.presentation}</td>
      <td>${t.drawings}</td>
      <td>${t.report}</td>
      <td>${t.penalties ? "−"+t.penalties : "0"}</td>
      <td><strong>${t.total}</strong></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr.lbrow").forEach(tr => {
    if (tr.dataset.noflight) return;
    tr.addEventListener("click", () => {
      const id = +tr.dataset.id;
      const r = firstRound(id);
      window.location.href = `visualizer.html?team=${id}` + (r != null ? `&round=${r}` : "");
    });
  });
  document.querySelectorAll("#lbTable th").forEach(th => {
    th.classList.toggle("sorted", th.dataset.k === k);
    th.classList.toggle("asc", th.dataset.k === k && asc);
  });
}

function initSort() {
  document.querySelectorAll("#lbTable th").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (lbSort.k === k) lbSort.asc = !lbSort.asc;
      else lbSort = { k, asc: (k==="name"||k==="rank") };
      renderLeaderboard();
    });
  });
}

(async function(){
  renderChrome("leaderboard");
  initTheme();
  initSort();
  try {
    await loadBase();
  } catch(e) {
    document.getElementById("loadErr").textContent =
      "Could not load data files. If viewing locally, serve over http (e.g. `python -m http.server` in docs/).";
    return;
  }
  renderLeaderboard();
})();
