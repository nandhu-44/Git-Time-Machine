// History view: virtualised commit list with graph + commit detail pane.

import { api, html, raw, esc, $, avatar, refBadges, relTime, fullDate, short, plural, empty, errorBox, loading, icons, storage, WORKTREE } from "./ui.js";
import { createLayout, layout, rowSvg, LANE_W } from "./graph.js";
import { renderDetail } from "./detail.js";

const ROW_H = 34;
const PAGE = 400;
const MAX_LANES = 14;

export function createHistory(app) {
  const el = document.createElement("div");
  el.className = "history";
  el.innerHTML = `
    <section class="log-pane" aria-label="Commits">
      <div class="log-head"></div>
      <div class="log-cols" aria-hidden="true"><span class="c-graph"></span><span>Description</span><span class="c-author">Author</span><span class="c-date">Date</span><span class="c-sha">Commit</span></div>
      <div class="log-scroll" tabindex="-1"><div class="log-spacer"><div class="log-rows" role="listbox" aria-label="Commits"></div></div><div class="log-status"></div></div>
    </section>
    <div class="resizer" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
    <section class="detail-pane" hidden></section>`;

  const head = $(".log-head", el);
  const scroller = $(".log-scroll", el);
  const spacer = $(".log-spacer", el);
  const rows = $(".log-rows", el);
  const status = $(".log-status", el);
  const pane = $(".detail-pane", el);
  const resizer = $(".resizer", el);

  let s = null; // list state
  let gen = 0; // request generation, to drop stale responses
  let openHash = null;
  let detailCtl = null;

  function fresh() {
    return { commits: [], index: new Map(), graph: true, layout: createLayout(), done: false, busy: false, selected: -1, maxLanes: 1, error: null };
  }

  // ---------------------------------------------------------------- loading

  async function reload() {
    gen++;
    s = fresh();
    scroller.scrollTop = 0;
    renderHead();
    await loadMore();
  }

  async function loadMore() {
    if (s.busy || s.done) return;
    s.busy = true;
    const my = gen;
    renderStatus();
    try {
      const f = app.filter || {};
      const res = await api("log", { ref: app.ref, skip: s.commits.length - (s.hasWorktree ? 1 : 0), limit: PAGE, message: f.message, author: f.author, code: f.code, path: f.path, follow: f.follow });
      if (my !== gen) return;
      let page = res.commits;
      if (!s.commits.length) {
        s.graph = res.graph;
        // Show uncommitted changes as a pseudo commit on top of HEAD.
        const r = app.repo;
        const showWt = r.changes && r.head && !app.filter && (!app.ref || app.ref === r.branch || app.ref === "HEAD");
        if (showWt) {
          s.hasWorktree = true;
          page = [{ hash: WORKTREE, parents: [r.head], subject: `Uncommitted changes`, author: "", email: "", date: null, refs: [], worktree: true }, ...page];
        }
      }
      if (s.graph) layout(s.layout, page);
      for (const c of page) {
        s.index.set(c.hash, s.commits.length);
        s.commits.push(c);
        if (s.graph && c.g.width > s.maxLanes) s.maxLanes = c.g.width;
      }
      s.done = res.done;
    } catch (err) {
      if (my !== gen) return;
      s.error = err;
      s.done = true;
    } finally {
      if (my === gen) s.busy = false;
    }
    if (my !== gen) return;
    const lanes = Math.min(s.maxLanes, MAX_LANES);
    el.style.setProperty("--graph-w", s.graph ? `${lanes * LANE_W + 10}px` : "0px");
    el.classList.toggle("no-graph", !s.graph);
    spacer.style.height = `${s.commits.length * ROW_H}px`;
    renderHead();
    renderStatus();
    paint(true);
    if (openHash && s.index.has(openHash) && s.selected === -1) {
      s.selected = s.index.get(openHash);
      paint(true);
    }
  }

  // ---------------------------------------------------------------- rendering

  function renderHead() {
    const f = app.filter;
    const chips = [];
    if (f?.message) chips.push(["message", `“${f.message}”`]);
    if (f?.author) chips.push(["author", `author: ${f.author}`]);
    if (f?.path) chips.push(["path", `${f.follow ? "file" : "path"}: ${f.path}`]);
    if (f?.code) chips.push(["code", `code: ${f.code}`]);
    const title = app.ref ? html`${raw(icons.branch)}<strong>${app.ref}</strong>` : html`<strong>All branches</strong>`;
    const count = s.commits.length - (s.hasWorktree ? 1 : 0);
    head.innerHTML = String(html`<div class="log-title">${title}
        ${app.ref ? html`<button class="chip" data-act="clear-ref" title="Show all branches">${raw(icons.close)}</button>` : ""}</div>
      ${chips.map(([k, label]) => html`<span class="chip filter" title="Remove filter"><span>${label}</span><button data-act="clear-filter" data-key="${k}" aria-label="Remove filter">${raw(icons.close)}</button></span>`)}
      <span class="spacer"></span>
      <span class="muted small">${count ? `${s.done ? "" : "≥ "}${plural(count, "commit")}` : ""}</span>`);
  }

  function renderStatus() {
    status.style.top = `${s.commits.length * ROW_H}px`;
    if (s.error) status.innerHTML = String(errorBox(s.error));
    else if (s.busy) status.innerHTML = String(loading(s.commits.length ? "Loading more" : "Loading history"));
    else if (!s.commits.length) status.innerHTML = String(app.filter ? empty("No matching commits", "Try a different search, or clear the filter.") : empty("No commits", "This repository has no history yet."));
    else status.innerHTML = "";
  }

  let lastRange = "";
  function paint(force = false) {
    if (!s) return;
    const top = scroller.scrollTop;
    const h = scroller.clientHeight || 800;
    const start = Math.max(0, Math.floor(top / ROW_H) - 8);
    const end = Math.min(s.commits.length, Math.ceil((top + h) / ROW_H) + 8);
    const key = `${start}:${end}`;
    if (!force && key === lastRange) return;
    lastRange = key;
    const head = app.repo.head;
    let out = "";
    for (let i = start; i < end; i++) out += row(s.commits[i], i, head);
    rows.innerHTML = out;
    if (!s.done && !s.busy && end > s.commits.length - 60) loadMore();
  }

  function row(c, i, headHash) {
    const cls = ["row"];
    if (i === s.selected) cls.push("selected");
    if (c.hash === openHash) cls.push("open");
    if (c.worktree) cls.push("worktree");
    const merge = c.parents.length > 1;
    const graph = s.graph ? rowSvg(c.g, { height: ROW_H, maxLanes: MAX_LANES, merge: merge || c.worktree, head: c.hash === headHash }) : "";
    if (c.worktree) {
      return `<div class="${cls.join(" ")}" style="transform:translateY(${i * ROW_H}px)" data-i="${i}" role="option" aria-selected="${i === s.selected}">
        <div class="c-graph">${graph}</div>
        <div class="c-msg"><span class="subject">Uncommitted changes</span><span class="muted small">${plural(app.repo.changes, "file")}</span></div>
        <div class="c-author"></div><div class="c-date"></div><div class="c-sha muted">—</div></div>`;
    }
    return `<div class="${cls.join(" ")}" style="transform:translateY(${i * ROW_H}px)" data-i="${i}" role="option" aria-selected="${i === s.selected}">
      <div class="c-graph">${graph}</div>
      <div class="c-msg">${refBadges(c.refs, { max: 3 })}<span class="subject${merge ? " merge" : ""}">${esc(c.subject)}</span></div>
      <div class="c-author" title="${esc(c.author)} <${esc(c.email)}>">${avatar(c.author, c.email, 18)}<span>${esc(c.author)}</span></div>
      <div class="c-date" title="${esc(fullDate(c.date))}">${esc(relTime(c.date))}</div>
      <div class="c-sha">${short(c.hash)}</div>
    </div>`;
  }

  let raf = 0;
  scroller.addEventListener("scroll", () => {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), paint()));
  });
  new ResizeObserver(() => paint(true)).observe(scroller);

  // ---------------------------------------------------------------- interaction

  rows.addEventListener("click", (e) => {
    const r = e.target.closest(".row");
    if (!r) return;
    const i = Number(r.dataset.i);
    const c = s.commits[i];
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // Second commit of a comparison.
      const other = openHash;
      if (other && other !== c.hash) {
        const [a, b] = orderPair(other, c.hash);
        return app.navigate(`#/compare/${a}..${b}`);
      }
    }
    s.selected = i;
    app.navigate(`#/commit/${c.hash}`);
  });

  /** Older commit first, so the diff reads forward in time. */
  function orderPair(x, y) {
    if (x === WORKTREE) return [y, x];
    if (y === WORKTREE) return [x, y];
    const ix = s.index.get(x) ?? -1;
    const iy = s.index.get(y) ?? -1;
    return ix > iy ? [x, y] : [y, x];
  }

  head.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "clear-ref") app.setRef(null);
    if (act.dataset.act === "clear-filter") {
      const f = { ...app.filter };
      delete f[act.dataset.key];
      if (act.dataset.key === "path") delete f.follow;
      app.setFilter(f);
    }
  });

  function scrollIntoView(i) {
    const top = i * ROW_H;
    const h = scroller.clientHeight;
    if (top < scroller.scrollTop + ROW_H) scroller.scrollTop = Math.max(0, top - ROW_H * 2);
    else if (top + ROW_H > scroller.scrollTop + h - ROW_H) scroller.scrollTop = top - h + ROW_H * 3;
  }

  function move(delta) {
    if (!s.commits.length) return;
    s.selected = Math.max(0, Math.min(s.commits.length - 1, (s.selected < 0 ? -1 : s.selected) + delta));
    scrollIntoView(s.selected);
    paint(true);
    if (openHash) app.navigate(`#/commit/${s.commits[s.selected].hash}`);
  }

  function onKey(e) {
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" && s.selected >= 0) {
      app.navigate(`#/commit/${s.commits[s.selected].hash}`);
    }
  }

  // ---------------------------------------------------------------- detail pane

  function open(hash, opts = {}) {
    if (!hash) {
      openHash = null;
      pane.hidden = true;
      el.classList.remove("has-detail");
      detailCtl?.destroy?.();
      detailCtl = null;
      paint(true);
      return;
    }
    const changed = hash !== openHash;
    openHash = hash;
    if (s && s.index.has(hash)) {
      s.selected = s.index.get(hash);
      if (changed) scrollIntoView(s.selected);
    }
    pane.hidden = false;
    el.classList.add("has-detail");
    paint(true);
    if (changed || !detailCtl) {
      detailCtl?.destroy?.();
      detailCtl = renderDetail(pane, app, hash, opts);
    } else {
      detailCtl.update(opts);
    }
  }

  // Resizable split between the list and the detail pane.
  const savedW = storage.get("detail-width", null);
  if (savedW) el.style.setProperty("--detail-w", `${savedW}px`);
  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const onMove = (ev) => {
      const w = Math.max(360, Math.min(rect.width - 320, rect.right - ev.clientX));
      el.style.setProperty("--detail-w", `${w}px`);
    };
    const onUp = (ev) => {
      resizer.removeEventListener("pointermove", onMove);
      resizer.removeEventListener("pointerup", onUp);
      const w = parseInt(getComputedStyle(el).getPropertyValue("--detail-w"), 10);
      if (w) storage.set("detail-width", w);
      paint(true);
    };
    resizer.addEventListener("pointermove", onMove);
    resizer.addEventListener("pointerup", onUp);
  });

  s = fresh();
  reload();

  return {
    el,
    reload,
    open,
    onKey,
    show: () => requestAnimationFrame(() => paint(true)),
  };
}
