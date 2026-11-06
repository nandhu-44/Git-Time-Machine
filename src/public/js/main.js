import { api, html, raw, $, $$, icons, toast, storage, WORKTREE } from "./ui.js";
import { createHistory } from "./history.js";
import { createCompare } from "./compare.js";
import { createInsights } from "./insights.js";

const app = {
  repo: null,
  ref: null, // history start point; null = all refs
  filter: null, // { message, author, path, code, follow }
  views: {},
  current: null,

  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },

  setRef(ref) {
    app.ref = ref || null;
    renderSidebar();
    app.views.history.reload();
    if (app.current !== "history" || location.hash.startsWith("#/commit/")) app.navigate("#/");
    closeSidebar();
  },

  setFilter(filter) {
    app.filter = filter && Object.values(filter).some(Boolean) ? filter : null;
    $("#search").value = app.filter ? filterToQuery(app.filter) : "";
    app.views.history.reload();
    if (app.current !== "history") app.navigate("#/");
  },

  async reloadRepo() {
    app.repo = await api("repo");
    renderRepo();
    renderSidebar();
  },
};

// ------------------------------------------------------------------ search

function parseQuery(q) {
  const f = {};
  const rest = [];
  for (const m of q.matchAll(/(\w+):("[^"]*"|\S+)|("[^"]*"|\S+)/g)) {
    if (m[1]) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^"|"$/g, "");
      if (key === "author") f.author = val;
      else if (key === "path" || key === "file") f.path = val;
      else if (key === "code" || key === "s") f.code = val;
      else rest.push(m[0]);
    } else {
      rest.push(m[3].replace(/^"|"$/g, ""));
    }
  }
  if (rest.length) f.message = rest.join(" ");
  return f;
}

function filterToQuery(f) {
  const quote = (v) => (/\s/.test(v) ? `"${v}"` : v);
  const parts = [];
  if (f.author) parts.push(`author:${quote(f.author)}`);
  if (f.path) parts.push(`path:${quote(f.path)}`);
  if (f.code) parts.push(`code:${quote(f.code)}`);
  if (f.message) parts.push(f.message);
  return parts.join(" ");
}

async function onSearch(e) {
  e.preventDefault();
  const q = $("#search").value.trim();
  if (!q) return app.setFilter(null);
  if (/^[0-9a-f]{4,64}$/i.test(q)) {
    try {
      const { commit } = await api("commit", { rev: q });
      $("#search").blur();
      return app.navigate(`#/commit/${commit.hash}`);
    } catch {
      /* not a commit id: search messages instead */
    }
  }
  app.setFilter(parseQuery(q));
  $("#search").blur();
}

// ------------------------------------------------------------------ header + sidebar

function renderRepo() {
  const r = app.repo;
  const where = r.branch ?? (r.head ? `detached at ${r.head.slice(0, 7)}` : "no commits yet");
  $("#repo").innerHTML = String(html`<span class="repo-name" title="${r.root}">${r.name}</span>
    <span class="repo-branch" title="Current branch">${raw(icons.branch)}${where}</span>`);
  document.title = `${r.name} · Git Time Machine`;
}

const collapsed = new Set(storage.get("collapsed", ["tags"]));

function section(id, title, count, body) {
  const isCollapsed = collapsed.has(id);
  return html`<section class="side-section ${isCollapsed ? "collapsed" : ""}" data-section="${id}">
    <button class="side-title" data-toggle="${id}" aria-expanded="${!isCollapsed}">${raw(icons.chevron)}<span>${title}</span><span class="count">${count}</span></button>
    <div class="side-body">${body}</div>
  </section>`;
}

function refItem({ ref, label, icon, extra = "", title, current = false }) {
  const active = (app.ref ?? null) === ref;
  return html`<div class="side-item ${active ? "active" : ""} ${current ? "current" : ""}" data-ref="${ref ?? ""}" title="${title || label}" role="button" tabindex="0">
    ${raw(icon)}<span class="label">${label}</span>${extra}
    ${ref ? html`<button class="mini-btn" data-compare="${ref}" title="Compare with ${app.repo.branch || "HEAD"}" aria-label="Compare ${label}">${raw(icons.compare)}</button>` : ""}
  </div>`;
}

function renderSidebar() {
  const r = app.repo;
  const q = ($("#ref-filter")?.value || "").toLowerCase();
  const match = (name) => !q || name.toLowerCase().includes(q);

  const branches = r.branches.filter((b) => match(b.name));
  const remotes = r.remotes.filter((b) => match(b.name));
  const tags = r.tags.filter((t) => match(t.name));

  const byRemote = {};
  for (const rb of remotes) (byRemote[rb.remote] ??= []).push(rb);

  const branchItems = branches.map((b) =>
    refItem({
      ref: b.name,
      label: b.name,
      icon: b.name === r.branch ? icons.head : icons.branch,
      current: b.name === r.branch,
      title: b.upstream ? `${b.name} → ${b.upstream}${b.gone ? " (gone)" : ""}` : b.name,
      extra: html`<span class="track">${b.ahead ? html`<span title="${b.ahead} ahead of ${b.upstream}">↑${b.ahead}</span>` : ""}${
        b.behind ? html`<span title="${b.behind} behind ${b.upstream}">↓${b.behind}</span>` : ""
      }${b.gone ? html`<span title="Upstream branch was deleted">gone</span>` : ""}</span>`,
    }),
  );

  const remoteBody = Object.entries(byRemote).map(
    ([name, list]) => html`<div class="side-group">${list.map((rb) => refItem({ ref: rb.name, label: rb.name, icon: icons.remote }))}</div>`,
  );

  const tagItems = tags.slice(0, 500).map((t) =>
    refItem({ ref: t.name, label: t.name, icon: icons.tag, title: t.message ? `${t.name}: ${t.message}` : t.name }),
  );

  const head = r.head
    ? html`<div class="side-list">
        ${refItem({ ref: null, label: "All branches", icon: icons.history })}
        ${r.changes ? html`<a class="side-item worktree" href="#/compare/HEAD..${WORKTREE}">${raw(icons.dot)}<span class="label">Uncommitted changes</span><span class="count">${r.changes}</span></a>` : ""}
      </div>`
    : html`<div class="empty small"><span>This repository has no commits yet.</span></div>`;

  $("#sidebar").innerHTML = String(html`
    <div class="side-filter"><input id="ref-filter" type="search" placeholder="Filter branches and tags" value="${q}" autocomplete="off" spellcheck="false" aria-label="Filter branches and tags"></div>
    <div class="side-scroll">
      ${head}
      ${r.branches.length ? section("branches", "Branches", r.branches.length, branchItems.length ? branchItems : html`<div class="side-none">No match</div>`) : ""}
      ${r.remotes.length ? section("remotes", "Remotes", r.remotes.length, remoteBody.length ? remoteBody : html`<div class="side-none">No match</div>`) : ""}
      ${r.tags.length ? section("tags", "Tags", r.tags.length, tagItems.length ? tagItems : html`<div class="side-none">No match</div>`) : ""}
    </div>
    <div class="side-foot">${r.gitVersion ? `git ${r.gitVersion}` : ""}</div>`);

  if (q) {
    const input = $("#ref-filter");
    input.focus();
    input.setSelectionRange(q.length, q.length);
  }
}

function onSidebarClick(e) {
  const cmp = e.target.closest("[data-compare]");
  if (cmp) {
    e.stopPropagation();
    const base = app.repo.branch || "HEAD";
    closeSidebar();
    return app.navigate(`#/compare/${encodeURIComponent(base)}...${encodeURIComponent(cmp.dataset.compare)}`);
  }
  const tog = e.target.closest("[data-toggle]");
  if (tog) {
    const id = tog.dataset.toggle;
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    storage.set("collapsed", [...collapsed]);
    const sec = tog.closest(".side-section");
    sec.classList.toggle("collapsed");
    tog.setAttribute("aria-expanded", String(!collapsed.has(id)));
    return;
  }
  const item = e.target.closest("[data-ref]");
  if (item) app.setRef(item.dataset.ref || null);
  if (e.target.closest(".worktree")) closeSidebar();
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

// ------------------------------------------------------------------ routing

function route() {
  const hash = decodeURI(location.hash.slice(1) || "/");
  const [, view = "", ...rest] = hash.split("/");
  let name = "history";
  if (view === "compare") name = "compare";
  else if (view === "insights") name = "insights";

  for (const a of $$("#tabs a")) a.classList.toggle("active", a.dataset.view === name);

  if (app.current !== name) {
    app.views[app.current]?.hide?.();
    const v = app.views[name];
    const main = $("#main");
    main.replaceChildren(v.el);
    app.current = name;
    v.show?.();
  }

  if (name === "history") {
    if (view === "commit" && rest[0]) {
      const [hashId, tab, ...pathParts] = rest;
      app.views.history.open(hashId, { tab: tab || "changes", path: pathParts.map(decodeURIComponent).join("/") });
    } else {
      app.views.history.open(null);
    }
  } else if (name === "compare") {
    app.views.compare.load(rest.join("/"));
  } else if (name === "insights") {
    app.views.insights.load();
  }
}

// ------------------------------------------------------------------ live updates

let fingerprint = null;
let offline = false;

async function poll() {
  if (document.hidden && !offline) return;
  try {
    const { fingerprint: fp } = await api("state");
    if (fingerprint && fp !== fingerprint) {
      await app.reloadRepo();
      showBanner("changed");
    }
    fingerprint = fp;
  } catch {
    /* the offline banner is shown by the gtm-offline event */
  }
}

function showBanner(kind) {
  const b = $("#banner");
  b.dataset.kind = kind;
  b.innerHTML =
    kind === "offline"
      ? `<span class="spinner"></span><span>Lost connection to git-tm. Start it again in your terminal; this page reconnects by itself.</span>`
      : `<span>The repository changed on disk.</span><button class="btn btn-sm btn-primary" data-act="reload">Refresh history</button><button class="icon-btn" data-act="dismiss" aria-label="Dismiss">${icons.close}</button>`;
  b.hidden = false;
}

window.addEventListener("gtm-offline", () => {
  if (offline) return;
  offline = true;
  showBanner("offline");
});

window.addEventListener("gtm-online", async () => {
  if (!offline) return;
  offline = false;
  $("#banner").hidden = true;
  try {
    await app.reloadRepo();
  } catch {
    return;
  }
  app.views.history.reload();
  app.views.insights.invalidate();
  route();
  toast("Reconnected to git-tm", "success");
});

$("#banner").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  $("#banner").hidden = true;
  if (act === "reload") {
    app.views.history.reload();
    app.views.insights.invalidate();
  }
});

async function onFetch() {
  const btn = $("#fetch-btn");
  if (btn.classList.contains("busy")) return;
  btn.classList.add("busy");
  try {
    await api("fetch", {}, { method: "POST" });
    await app.reloadRepo();
    app.views.history.reload();
    toast("Fetched all remotes", "success");
  } catch (err) {
    toast(`Fetch failed: ${err.message}`, "error", 6000);
  } finally {
    btn.classList.remove("busy");
  }
}

// ------------------------------------------------------------------ theme

function cycleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("gtm-theme", next);
  } catch {}
}

// ------------------------------------------------------------------ keyboard

let pendingG = false;
function onKey(e) {
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if (e.key === "Escape") {
    if (typing) {
      e.target.blur();
      if (e.target.id === "search" && app.filter) app.setFilter(null);
      return;
    }
    if (document.body.classList.contains("sidebar-open")) return closeSidebar();
    if (app.current === "history") {
      if (app.views.history.cancelPicking()) return;
      if (location.hash.startsWith("#/commit/")) return app.navigate("#/");
      if (app.filter) return app.setFilter(null);
    }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (pendingG) {
    pendingG = false;
    const to = { h: "#/", c: "#/compare", i: "#/insights" }[e.key];
    if (to) {
      e.preventDefault();
      return app.navigate(to);
    }
  }
  switch (e.key) {
    case "/":
      e.preventDefault();
      $("#search").focus();
      $("#search").select();
      return;
    case "?":
      return $("#help").showModal();
    case "g":
      pendingG = true;
      setTimeout(() => (pendingG = false), 800);
      return;
  }
  if (app.current === "history") app.views.history.onKey(e);
  else if (app.current === "compare") app.views.compare.onKey(e);
}

// ------------------------------------------------------------------ boot

async function boot() {
  $("#search-form").addEventListener("submit", onSearch);
  $("#search").addEventListener("search", () => {
    if (!$("#search").value && app.filter) app.setFilter(null);
  });
  $("#sidebar").addEventListener("click", onSidebarClick);
  $("#sidebar").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-ref]")) app.setRef(e.target.dataset.ref || null);
  });
  $("#sidebar").addEventListener("input", (e) => {
    if (e.target.id === "ref-filter") renderSidebar();
  });
  $("#sidebar-toggle").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  $("#fetch-btn").addEventListener("click", onFetch);
  $("#theme-btn").addEventListener("click", cycleTheme);
  $("#help-btn").addEventListener("click", () => $("#help").showModal());
  $("#help-close").addEventListener("click", () => $("#help").close());
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", route);

  try {
    await app.reloadRepo();
  } catch (err) {
    $("#main").innerHTML = `<div class="empty error"><strong>Could not load the repository</strong><span>${err.message}</span></div>`;
    return;
  }
  if (!app.repo.remotes.length) $("#fetch-btn").hidden = true;

  app.views.history = createHistory(app);
  app.views.compare = createCompare(app);
  app.views.insights = createInsights(app);
  route();

  setInterval(poll, 3000);
  poll();
  document.addEventListener("visibilitychange", poll);
}

boot();

