// Compare any two points in history: branches, tags, commits or the working tree.

import { api, html, raw, $, avatar, refBadges, relTime, fullDate, short, plural, empty, errorBox, loading, icons, WORKTREE } from "./ui.js";
import { mountChanges } from "./diff.js";

export function createCompare(app) {
  const el = document.createElement("div");
  el.className = "compare page";
  let spec = null; // { base, target, mode: "direct" | "merge-base" }
  let gen = 0;

  function defaults() {
    const r = app.repo;
    const names = r.branches.map((b) => b.name);
    const main = ["main", "master", "trunk", "develop"].find((n) => names.includes(n));
    if (r.branch && main && r.branch !== main) return { base: main, target: r.branch, mode: "merge-base" };
    if (r.changes && r.head) return { base: "HEAD", target: WORKTREE, mode: "direct" };
    if (r.head) return { base: "HEAD~1", target: "HEAD", mode: "direct" };
    return { base: "", target: "", mode: "direct" };
  }

  function parse(str) {
    if (!str) return null;
    let i = str.indexOf("...");
    let mode = "merge-base";
    let len = 3;
    if (i === -1) {
      i = str.indexOf("..");
      mode = "direct";
      len = 2;
    }
    if (i === -1) return null;
    return { base: decodeURIComponent(str.slice(0, i)), target: decodeURIComponent(str.slice(i + len)), mode };
  }

  function hashFor(sp) {
    return `#/compare/${encodeURIComponent(sp.base)}${sp.mode === "merge-base" ? "..." : ".."}${encodeURIComponent(sp.target)}`;
  }

  function form(sp) {
    const r = app.repo;
    const opts = [
      ...r.branches.map((b) => b.name),
      ...r.tags.slice(0, 300).map((t) => t.name),
      ...r.remotes.map((b) => b.name),
      "HEAD",
    ];
    return html`<form class="compare-form" autocomplete="off">
      <datalist id="ref-options">${opts.map((o) => html`<option value="${o}"></option>`)}</datalist>
      <label class="field"><span>Base</span><input name="base" list="ref-options" value="${sp.base}" placeholder="branch, tag or commit" required spellcheck="false"></label>
      <button type="button" class="icon-btn swap" data-act="swap" title="Swap" aria-label="Swap base and target">${raw(icons.swap)}</button>
      <label class="field"><span>Target</span><input name="target" list="ref-options" value="${sp.target === WORKTREE ? "" : sp.target}" placeholder="${sp.target === WORKTREE ? "working tree" : "branch, tag or commit"}" spellcheck="false"></label>
      <div class="seg" role="radiogroup" aria-label="Comparison mode">
        <button type="button" data-act="mode" data-mode="direct" aria-pressed="${sp.mode === "direct"}" title="Diff the two snapshots directly (base..target)">Direct</button>
        <button type="button" data-act="mode" data-mode="merge-base" aria-pressed="${sp.mode === "merge-base"}" title="Only changes made on target since it diverged from base (base...target), like a pull request">Since branch point</button>
      </div>
      <input type="hidden" name="mode" value="${sp.mode}">
      <button class="btn btn-primary" type="submit">Compare</button>
      ${r.changes && r.head ? html`<button type="button" class="btn btn-ghost" data-act="worktree" title="Compare base with uncommitted changes">vs working tree</button>` : ""}
    </form>`;
  }

  async function load(str) {
    spec = parse(str) || defaults();
    const my = ++gen;
    el.innerHTML = String(html`<div class="page-head"><h1>Compare</h1><p class="muted">See what changed between any two branches, tags or commits, or against your uncommitted work.</p></div>
      ${form(spec)}<div class="compare-result"></div>`);
    if (!spec.base || !spec.target) {
      $(".compare-result", el).innerHTML = String(empty("Pick two points in history", "Tip: in History, click a commit and shift-click another."));
      return;
    }
    const out = $(".compare-result", el);
    out.innerHTML = String(loading("Comparing"));
    try {
      const [baseRes, targetRes, range] = await Promise.all([
        api("commit", { rev: spec.base }),
        api("commit", { rev: spec.target }),
        api("range", { from: spec.base, to: spec.target }),
      ]);
      if (my !== gen) return;
      const base = baseRes.commit;
      const target = targetRes.commit;
      const wt = target.hash === WORKTREE;
      const from = spec.mode === "merge-base" && range.mergeBase ? range.mergeBase : base.hash;
      const side = (label, c, name) => html`<a class="cmp-side" href="#/commit/${c.hash}">
          <span class="muted small">${label}</span>
          <span class="cmp-name">${name === c.hash ? short(c.hash) : name === WORKTREE ? "Working tree" : name}</span>
          <span class="cmp-sub">${c.hash === WORKTREE ? "uncommitted changes" : html`${short(c.hash)} · ${c.subject}`}</span>
        </a>`;
      out.innerHTML = String(html`
        <div class="cmp-summary">
          ${side("Base", base, spec.base)}
          <span class="cmp-arrow" aria-hidden="true">→</span>
          ${side("Target", target, spec.target)}
        </div>
        <p class="cmp-stats">${wt
          ? html`Uncommitted changes compared with <strong>${spec.base}</strong>.`
          : html`<strong>${spec.target}</strong> is ${plural(range.aheadCount, "commit")} ahead and ${plural(range.behindCount, "commit")} behind <strong>${spec.base}</strong>.
            ${range.mergeBase ? html`They diverged at <a class="sha-link" href="#/commit/${range.mergeBase}">${short(range.mergeBase)}</a>.` : html`They share no history.`}
            ${spec.mode === "merge-base" && range.behindCount ? html`<span class="muted">Showing only changes made on ${spec.target} since then.</span>` : ""}`}</p>
        ${!wt && range.commits.length ? html`<details class="cmp-commits" ${range.commits.length <= 15 ? "open" : ""}>
          <summary>${plural(range.aheadCount, "commit")} on ${spec.target} not in ${spec.base}${range.aheadCount > range.commits.length ? html` <span class="muted">(showing ${range.commits.length})</span>` : ""}</summary>
          <div class="mini-log">${range.commits.map(
            (c) => html`<a class="mini-row" href="#/commit/${c.hash}">
              ${avatar(c.author, c.email, 18)}<span class="subject">${refBadges(c.refs, { max: 2 })}${c.subject}</span>
              <span class="muted small" title="${fullDate(c.date)}">${relTime(c.date)}</span><span class="sha">${short(c.hash)}</span></a>`,
          )}</div></details>` : ""}
        <div class="cmp-files"></div>`);
      mountChanges($(".cmp-files", out), {
        from,
        to: target.hash,
        onOpenFile: (p) => app.navigate(`#/commit/${target.hash}/files/${p.split("/").map(encodeURIComponent).join("/")}`),
        onFileHistory: (p) => app.setFilter({ path: p, follow: true }),
      });
    } catch (err) {
      if (my === gen) out.innerHTML = String(errorBox(err));
    }
  }

  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const base = f.base.value.trim();
    const target = f.target.value.trim() || (spec.target === WORKTREE ? WORKTREE : "");
    if (!base || !target) return;
    app.navigate(hashFor({ base, target, mode: f.mode.value }));
  });

  el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const f = $(".compare-form", el);
    if (t.dataset.act === "swap") {
      const target = f.target.value.trim() || (spec.target === WORKTREE ? WORKTREE : "");
      if (target === WORKTREE) return;
      [f.base.value, f.target.value] = [target, f.base.value];
      f.requestSubmit();
    } else if (t.dataset.act === "mode") {
      f.mode.value = t.dataset.mode;
      for (const b of f.querySelectorAll("[data-act=mode]")) b.setAttribute("aria-pressed", String(b === t));
      f.requestSubmit();
    } else if (t.dataset.act === "worktree") {
      app.navigate(hashFor({ base: f.base.value.trim() || "HEAD", target: WORKTREE, mode: "direct" }));
    }
  });

  return { el, load };
}

