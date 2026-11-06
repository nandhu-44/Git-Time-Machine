// Insights: activity heatmap, weekly rhythm, contributors.

import { api, html, raw, $, avatar, dayDate, relTime, plural, loading, errorBox, empty } from "./ui.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function levels(values) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return () => 0;
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
  return (v) => (v <= 0 ? 0 : v <= a ? 1 : v <= b ? 2 : v <= c ? 3 : 4);
}

function heatmap(days, endTs) {
  // 53 weeks ending at the week of the latest commit (or today).
  const end = new Date(Math.min(Date.now(), (endTs || Date.now() / 1000) * 1000 + 86400000));
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const start = new Date(last);
  start.setDate(start.getDate() - 7 * 52 - start.getDay());
  const cells = [];
  const months = [];
  let total = 0;
  for (let d = new Date(start), i = 0; d <= last; d.setDate(d.getDate() + 1), i++) {
    const v = days[key(d)] || 0;
    total += v;
    cells.push({ i, v, label: `${plural(v, "commit")} on ${d.toDateString()}` });
    if (d.getDate() === 1) months.push({ col: Math.floor(i / 7), name: MONTHS[d.getMonth()] });
  }
  const lv = levels(cells.map((c) => c.v));
  const size = 11;
  const gap = 3;
  const weeks = Math.ceil(cells.length / 7);
  const w = 28 + weeks * (size + gap);
  const h = 18 + 7 * (size + gap);
  let svg = `<svg class="heatmap" viewBox="0 0 ${w} ${h}" role="img" aria-label="Commit activity over the last year">`;
  for (const m of months) svg += `<text x="${28 + m.col * (size + gap)}" y="10" class="axis">${m.name}</text>`;
  for (const r of [1, 3, 5]) svg += `<text x="0" y="${18 + r * (size + gap) + size - 2}" class="axis">${DAYS[r]}</text>`;
  for (const c of cells) {
    const x = 28 + Math.floor(c.i / 7) * (size + gap);
    const y = 18 + (c.i % 7) * (size + gap);
    svg += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2.5" class="l${lv(c.v)}"><title>${c.label}</title></rect>`;
  }
  svg += "</svg>";
  return { svg, total };
}

function punchcard(punch) {
  const max = Math.max(1, ...punch.flat());
  const cw = 22;
  const rh = 24;
  const w = 40 + 24 * cw;
  const h = 7 * rh + 20;
  let svg = `<svg class="punch" viewBox="0 0 ${w} ${h}" role="img" aria-label="Commits by weekday and hour">`;
  for (let d = 0; d < 7; d++) {
    svg += `<text x="0" y="${d * rh + rh / 2 + 4}" class="axis">${DAYS[d]}</text>`;
    for (let hr = 0; hr < 24; hr++) {
      const v = punch[d][hr];
      if (!v) continue;
      const r = 2 + Math.sqrt(v / max) * 8;
      svg += `<circle cx="${40 + hr * cw + cw / 2}" cy="${d * rh + rh / 2}" r="${r.toFixed(1)}"><title>${plural(v, "commit")} · ${DAYS[d]} ${hr}:00</title></circle>`;
    }
  }
  for (const hr of [0, 6, 12, 18, 23]) svg += `<text x="${40 + hr * cw + cw / 2}" y="${h - 4}" class="axis" text-anchor="middle">${hr}h</text>`;
  svg += "</svg>";
  return svg;
}

export function createInsights(app) {
  const el = document.createElement("div");
  el.className = "insights page";
  let cacheKey = null;
  let gen = 0;

  async function load() {
    const k = app.ref || "*";
    if (cacheKey === k && el.childElementCount) return;
    cacheKey = k;
    const my = ++gen;
    el.innerHTML = String(html`<div class="page-head"><h1>Insights</h1><p class="muted">${app.ref ? html`History of <strong>${app.ref}</strong>` : "All branches and tags"} · merges excluded</p></div>${loading("Crunching history")}`);
    try {
      const d = await api("insights", { ref: app.ref });
      if (my !== gen) return;
      draw(d);
    } catch (err) {
      if (my === gen) el.lastElementChild.outerHTML = String(errorBox(err));
    }
  }

  function draw(d) {
    const r = app.repo;
    if (!d.total) {
      el.innerHTML = String(html`<div class="page-head"><h1>Insights</h1></div>${empty("No commits yet")}`);
      return;
    }
    const span = d.last - d.first;
    const years = span / 31557600;
    const { svg, total } = heatmap(d.days, d.last);
    const top = d.contributors[0]?.commits || 1;
    el.innerHTML = String(html`
      <div class="page-head"><h1>Insights</h1><p class="muted">${app.ref ? html`History of <strong>${app.ref}</strong>` : "All branches and tags"} · merges excluded</p></div>
      <div class="tiles">
        <div class="tile"><span class="tile-v">${d.total.toLocaleString()}</span><span class="tile-l">commits</span></div>
        <div class="tile"><span class="tile-v">${d.contributorCount.toLocaleString()}</span><span class="tile-l">contributors</span></div>
        <div class="tile"><span class="tile-v">${r.branches.length}</span><span class="tile-l">branches</span></div>
        <div class="tile"><span class="tile-v">${r.tags.length}</span><span class="tile-l">tags</span></div>
        <div class="tile"><span class="tile-v" title="${dayDate(d.first)}">${years >= 1 ? `${years.toFixed(1)} y` : `${Math.max(1, Math.round(span / 86400))} d`}</span><span class="tile-l">since first commit</span></div>
        <div class="tile"><span class="tile-v" title="${dayDate(d.last)}">${relTime(d.last)}</span><span class="tile-l">latest commit</span></div>
      </div>
      <section class="card">
        <header><h2>Activity</h2><span class="muted small">${plural(total, "commit")} in the year up to ${dayDate(Math.min(d.last, Date.now() / 1000))}</span></header>
        <div class="scroll-x">${raw(svg)}</div>
        <div class="legend muted small">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</div>
      </section>
      <div class="grid-2">
        <section class="card">
          <header><h2>Contributors</h2><span class="muted small">${d.contributorCount > d.contributors.length ? `top ${d.contributors.length} of ${d.contributorCount}` : ""}</span></header>
          <div class="people-list">${d.contributors.map(
            (p) => html`<button class="person-row" data-author="${p.email || p.name}" title="Show commits by ${p.name}">
              ${avatar(p.name, p.email, 28)}
              <span class="pr-main"><span class="pr-name">${p.name}</span><span class="muted small">${p.email} · ${dayDate(p.first)} – ${dayDate(p.last)}</span></span>
              <span class="pr-bar"><i style="width:${((p.commits / top) * 100).toFixed(1)}%"></i></span>
              <span class="pr-count">${p.commits.toLocaleString()}</span>
            </button>`,
          )}</div>
        </section>
        <section class="card">
          <header><h2>Weekly rhythm</h2><span class="muted small">local time</span></header>
          <div class="scroll-x">${raw(punchcard(d.punch))}</div>
        </section>
      </div>`);
  }

  el.addEventListener("click", (e) => {
    const p = e.target.closest("[data-author]");
    if (p) app.setFilter({ author: p.dataset.author });
  });

  return {
    el,
    load,
    invalidate() {
      cacheKey = null;
    },
  };
}

