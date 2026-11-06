// Compare / time travel: what happens when you move from one point in history
// to another, forwards, backwards or across branches.

import { api, html, raw, $, $$, avatar, refBadges, relTime, fullDate, short, plural, empty, errorBox, loading, icons, WORKTREE } from "./ui.js";
import { mountChanges } from "./diff.js";

const DAY = 86400;

/** "3 days", "2 months", ... for a span of seconds. */
function span(sec) {
  const s = Math.abs(sec);
  const units = [
    [31557600, "year"],
    [2629800, "month"],
    [604800, "week"],
    [DAY, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [n, unit] of units) if (s >= n) return plural(Math.round(s / n), unit);
  return "moments";
}

export function createCompare(app) {
  const el = document.createElement("div");
  el.className = "compare page";
  let spec = null; // { from, to, mode: "direct" | "merge-base", at }
  let gen = 0;
  let travel = null; // { from, to, diffFrom, path, index }
  let stepTimer = 0;

  function defaults() {
    const r = app.repo;
    const names = r.branches.map((b) => b.name);
    const main = ["main", "master", "trunk", "develop"].find((n) => names.includes(n));
    if (r.branch && main && r.branch !== main) return { from: main, to: r.branch, mode: "merge-base" };
    if (r.changes && r.head) return { from: "HEAD", to: WORKTREE, mode: "direct" };
    if (r.head) return { from: "HEAD~1", to: "HEAD", mode: "direct" };
    return { from: "", to: "", mode: "direct" };
  }

  /** "a..b", "a...b", optionally followed by "/at/<commit>". */
  function parse(str) {
    if (!str) return null;
    const [range, at] = str.split("/at/");
    let i = range.indexOf("...");
    let mode = "merge-base";
    let len = 3;
    if (i === -1) {
      i = range.indexOf("..");
      mode = "direct";
      len = 2;
    }
    if (i === -1) return null;
    return {
      from: decodeURIComponent(range.slice(0, i)),
      to: decodeURIComponent(range.slice(i + len)),
      mode,
      at: at ? decodeURIComponent(at) : null,
    };
  }

  function hashFor(sp) {
    return `#/compare/${encodeURIComponent(sp.from)}${sp.mode === "merge-base" ? "..." : ".."}${encodeURIComponent(sp.to)}${sp.at ? `/at/${encodeURIComponent(sp.at)}` : ""}`;
  }

  // ---------------------------------------------------------------- form

  function form(sp) {
    const display = (v) => (/^[0-9a-f]{40,64}$/.test(v) ? v.slice(0, 12) : v);
    const field = (name, label, value) => html`<div class="field">
        <label for="cmp-${name}">${label}</label>
        <div class="field-row">
          <input id="cmp-${name}" name="${name}" value="${value === WORKTREE ? "" : display(value)}" placeholder="${value === WORKTREE ? "working tree" : "commit, branch or tag"}" spellcheck="false" autocomplete="off">
          <button type="button" class="icon-btn" data-act="pick" data-field="${name}" title="Pick a commit" aria-label="Pick a commit for ${label}">${raw(icons.history)}</button>
        </div>
        <div class="picker" data-for="${name}" hidden></div>
      </div>`;
    return html`<form class="compare-form" autocomplete="off">
      ${field("from", "From", sp.from)}
      <button type="button" class="icon-btn swap" data-act="swap" title="Reverse: travel the other way" aria-label="Reverse direction">${raw(icons.swap)}</button>
      ${field("to", "To", sp.to)}
      <div class="seg" role="radiogroup" aria-label="Comparison mode">
        <button type="button" data-act="mode" data-mode="direct" aria-pressed="${sp.mode === "direct"}" title="Everything that changes between the two snapshots">Direct</button>
        <button type="button" data-act="mode" data-mode="merge-base" aria-pressed="${sp.mode === "merge-base"}" title="Only what To added since the two diverged, like a pull request">Since branch point</button>
      </div>
      <input type="hidden" name="mode" value="${sp.mode}">
      <button class="btn btn-primary" type="submit">Travel</button>
    </form>`;
  }

  // ---------------------------------------------------------------- commit picker

  let pickerSeq = 0;

  async function openPicker(name) {
    for (const p of $$(".picker", el)) p.hidden = p.dataset.for !== name || !p.hidden;
    const box = $(`.picker[data-for="${name}"]`, el);
    if (box.hidden) return;
    box.innerHTML = `<input class="picker-search" type="search" placeholder="Search commits, branches, tags" spellcheck="false" aria-label="Search"><div class="picker-list"></div>`;
    const input = $(".picker-search", box);
    input.focus();
    input.oninput = () => fillPicker(box, name, input.value.trim());
    input.onkeydown = (e) => {
      if (e.key === "Escape") {
        box.hidden = true;
        e.stopPropagation();
      } else if (e.key === "Enter") {
        e.preventDefault();
        $(".picker-item", box)?.click();
      }
    };
    fillPicker(box, name, "");
  }

  async function fillPicker(box, name, q) {
    const seq = ++pickerSeq;
    const list = $(".picker-list", box);
    const r = app.repo;
    const lq = q.toLowerCase();
    const refs = [
      ...(name === "to" && r.changes ? [{ value: WORKTREE, label: "Working tree", sub: plural(r.changes, "uncommitted change"), kind: "worktree" }] : []),
      ...r.branches.map((b) => ({ value: b.name, label: b.name, kind: "branch" })),
      ...r.tags.map((t) => ({ value: t.name, label: t.name, kind: "tag" })),
      ...r.remotes.map((b) => ({ value: b.name, label: b.name, kind: "remote" })),
    ]
      .filter((x) => !lq || x.label.toLowerCase().includes(lq))
      .slice(0, 8);
    const item = (x) => html`<button type="button" class="picker-item" data-value="${x.value}">
        <span class="picker-kind">${raw(x.kind === "tag" ? icons.tag : x.kind === "remote" ? icons.remote : x.kind === "commit" ? icons.dot : icons.branch)}</span>
        <span class="picker-label">${x.label}</span><span class="muted small">${x.sub || ""}</span></button>`;
    list.innerHTML = String(html`${refs.map(item)}<div class="picker-sep">Commits</div>${raw(String(loading()))}`);
    let commits = [];
    try {
      const sha = /^[0-9a-f]{4,64}$/i.test(q);
      const res = await api("log", { limit: 40, message: q && !sha ? q : undefined });
      commits = res.commits;
      if (sha) commits = commits.filter((c) => c.hash.startsWith(q.toLowerCase()));
      if (sha && !commits.length) {
        const one = await api("commit", { rev: q }).catch(() => null);
        if (one) commits = [one.commit];
      }
    } catch {
      /* show refs only */
    }
    if (seq !== pickerSeq) return;
    const rows = commits.map((c) => ({ value: c.hash.slice(0, 12), label: c.subject, sub: `${short(c.hash)} · ${relTime(c.date)}`, kind: "commit" }));
    list.innerHTML = String(html`${refs.map(item)}<div class="picker-sep">Commits</div>${rows.length ? rows.map(item) : html`<div class="picker-none">No matching commits</div>`}`);
  }

  function choose(name, value) {
    const f = $(".compare-form", el);
    f[name].value = value === WORKTREE ? "" : value;
    f[name].placeholder = value === WORKTREE ? "working tree" : "commit, branch or tag";
    f[name].dataset.worktree = value === WORKTREE ? "1" : "";
    for (const p of $$(".picker", el)) p.hidden = true;
    const other = name === "from" ? "to" : "from";
    if (f[other].value.trim() || f[other].dataset.worktree === "1") f.requestSubmit();
    else f[other].focus();
  }

  function fieldValue(f, name) {
    const v = f[name].value.trim();
    if (v) return v;
    if (f[name].dataset.worktree === "1") return WORKTREE;
    return name === "to" && spec.to === WORKTREE && !f[name].dataset.cleared ? WORKTREE : "";
  }

  // ---------------------------------------------------------------- results

  function direction(from, to, r) {
    if (to.hash === WORKTREE) return { cls: "wt", title: "Uncommitted changes", text: html`Everything you changed since <strong>${spec.from}</strong> that is not committed yet.` };
    const dt = to.date - from.date;
    const when = dt === 0 ? "" : dt > 0 ? `${span(dt)} later` : `${span(dt)} earlier`;
    if (!r.mergeBase) return { cls: "across", title: "Unrelated histories", text: html`These two commits share no history.` };
    if (!r.removedCount) return { cls: "forward", title: "Forward in time", text: html`${plural(r.addedCount, "commit")} applied${when ? html` · ${when}` : ""}.` };
    if (!r.addedCount) return { cls: "back", title: "Back in time", text: html`${plural(r.removedCount, "commit")} undone${when ? html` · ${when}` : ""}.` };
    return {
      cls: "across",
      title: "Across branches",
      text: html`${plural(r.removedCount, "commit")} undone back to their common ancestor <a class="sha-link" href="#/commit/${r.mergeBase}">${short(r.mergeBase)}</a>, then ${plural(r.addedCount, "commit")} applied${when ? html` · ${when}` : ""}.`,
    };
  }

  function side(label, c, name) {
    const isWt = c.hash === WORKTREE;
    return html`<a class="cmp-side" href="${isWt ? "#/" : `#/commit/${c.hash}`}">
      <span class="muted small">${label}</span>
      <span class="cmp-name">${isWt ? "Working tree" : name === c.hash || c.hash.startsWith(name) ? short(c.hash) : name}</span>
      <span class="cmp-sub">${isWt ? "uncommitted changes" : html`${short(c.hash)} · ${c.subject}`}</span>
      ${isWt ? "" : html`<span class="cmp-date muted small" title="${fullDate(c.date)}">${relTime(c.date)}</span>`}
    </a>`;
  }

  function commitList(title, list, total, kind) {
    if (!total) return "";
    const onPath = new Set(travel?.path.map((c) => c.hash) || []);
    return html`<details class="cmp-commits ${kind}" ${total <= 12 ? "open" : ""}>
      <summary><span class="dot-${kind}"></span>${title}${total > list.length ? html` <span class="muted">(showing ${list.length})</span>` : ""}</summary>
      <div class="mini-log">${list.map(
        (c) => html`<div class="mini-row ${onPath.has(c.hash) ? "on-path" : ""}" data-hash="${c.hash}" role="button" tabindex="0" title="${onPath.has(c.hash) ? "Step to this commit" : "Open commit"}">
          ${avatar(c.author, c.email, 18)}<span class="subject">${refBadges(c.refs, { max: 2 })}${c.subject}</span>
          <span class="muted small" title="${fullDate(c.date)}">${relTime(c.date)}</span>
          <a class="sha" href="#/commit/${c.hash}" title="Open commit">${short(c.hash)}</a></div>`,
      )}</div></details>`;
  }

  // ---------------------------------------------------------------- stepping

  function stepLabel() {
    const { path, index } = travel;
    if (index === 0) return html`<strong>Start</strong> <span class="muted">· at From, nothing has changed yet</span>`;
    const c = path[index - 1];
    const isBase = c.hash === travel.mergeBase && travel.removedCount && travel.addedCount;
    return html`<span class="step-count">Step ${index} of ${path.length}</span>
      <a class="sha-link" href="#/commit/${c.hash}">${short(c.hash)}</a>
      <span class="step-subject">${c.subject}</span>
      <span class="muted small" title="${fullDate(c.date)}">${relTime(c.date)}${isBase ? " · common ancestor" : ""}${index === path.length ? " · To" : ""}</span>`;
  }

  function timeline() {
    const { path, index } = travel;
    const backSteps = path.findIndex((c) => c.hash === travel.mergeBase) + 1;
    const pct = travel.removedCount && travel.addedCount && backSteps > 0 ? (backSteps / path.length) * 100 : !travel.addedCount ? 100 : 0;
    return html`<section class="travel" style="--back:${pct.toFixed(1)}%">
      <div class="travel-row">
        <button type="button" class="icon-btn" data-act="step" data-d="-1" title="Step back (←)" aria-label="Previous step">${raw('<svg viewBox="0 0 16 16" class="i"><path d="M10 4 6 8l4 4"/></svg>')}</button>
        <input type="range" class="travel-range" min="0" max="${path.length}" value="${index}" aria-label="Step through the journey from From to To">
        <button type="button" class="icon-btn" data-act="step" data-d="1" title="Step forward (→)" aria-label="Next step">${raw('<svg viewBox="0 0 16 16" class="i"><path d="M6 4l4 4-4 4"/></svg>')}</button>
      </div>
      <div class="travel-ends muted small"><span>From</span><span>${plural(path.length, "step")} along the way</span><span>To</span></div>
      <div class="travel-now">${stepLabel()}</div>
    </section>`;
  }

  function currentTarget() {
    const { path, index } = travel;
    return index === 0 ? null : path[index - 1].hash;
  }

  function showStep({ files = true } = {}) {
    const box = $(".travel", el);
    if (box) {
      $(".travel-now", box).innerHTML = String(stepLabel());
      $(".travel-range", box).value = String(travel.index);
    }
    for (const row of $$(".mini-row", el)) row.classList.toggle("current", row.dataset.hash === currentTarget());
    if (!files) return;
    clearTimeout(stepTimer);
    stepTimer = setTimeout(() => {
      const target = currentTarget();
      const atEnd = travel.index === travel.path.length;
      spec.at = atEnd ? null : target;
      history.replaceState(null, "", hashFor(spec));
      drawFiles(target);
    }, 180);
  }

  function step(d) {
    if (!travel) return;
    travel.index = Math.max(0, Math.min(travel.path.length, travel.index + d));
    showStep();
  }

  function drawFiles(target) {
    const box = $(".cmp-files", el);
    if (!box) return;
    if (!target) {
      box.innerHTML = String(empty("Nothing has changed yet", "Move the slider to travel towards To."));
      return;
    }
    mountChanges(box, {
      from: travel.diffFrom,
      to: target,
      note: travel.index < travel.path.length ? `at step ${travel.index} of ${travel.path.length}` : "",
      onOpenFile: (p) => app.navigate(`#/commit/${target}/files/${p.split("/").map(encodeURIComponent).join("/")}`),
      onFileHistory: (p) => app.setFilter({ path: p, follow: true }),
    });
  }

  // ---------------------------------------------------------------- load

  async function load(str) {
    spec = parse(str) || defaults();
    const my = ++gen;
    travel = null;
    el.innerHTML = String(html`<div class="page-head"><h1>Compare</h1>
        <p class="muted">Travel between any two points in history, forwards or backwards, and see exactly what changes on the way.</p></div>
      ${form(spec)}<div class="compare-result"></div>`);
    const out = $(".compare-result", el);
    if (!spec.from || !spec.to) {
      out.innerHTML = String(empty("Pick two points in history", "Use the pickers above, or in History click a commit and shift-click another."));
      return;
    }
    out.innerHTML = String(loading("Working out the journey"));
    try {
      const [fromRes, toRes, r] = await Promise.all([
        api("commit", { rev: spec.from }),
        api("commit", { rev: spec.to }),
        api("range", { from: spec.from, to: spec.to }),
      ]);
      if (my !== gen) return;
      const from = fromRes.commit;
      const to = toRes.commit;
      const wt = to.hash === WORKTREE;
      const diffFrom = spec.mode === "merge-base" && r.mergeBase ? r.mergeBase : from.hash;
      const dir = direction(from, to, r);

      if (!wt && from.hash !== to.hash && r.path.length) {
        const atIndex = spec.at ? r.path.findIndex((c) => c.hash.startsWith(spec.at)) + 1 : 0;
        travel = { ...r, diffFrom, index: atIndex > 0 ? atIndex : r.path.length };
      }

      out.innerHTML = String(html`
        <div class="cmp-summary">
          ${side("From", from, spec.from)}
          <span class="cmp-arrow ${dir.cls}" aria-hidden="true">→</span>
          ${side("To", to, spec.to)}
        </div>
        <p class="cmp-stats"><span class="dir-badge ${dir.cls}">${dir.title}</span> ${dir.text}
          ${spec.mode === "merge-base" && r.removedCount ? html`<span class="muted">Showing only what To added since they diverged.</span>` : ""}</p>
        ${from.hash === to.hash ? empty("Same commit", "From and To point at the same snapshot.") : ""}
        ${travel && spec.mode === "direct" ? timeline() : ""}
        ${commitList("Applied: in To, not in From", r.added, r.addedCount, "added")}
        ${commitList("Undone: in From, not in To", r.removed, r.removedCount, "removed")}
        <div class="cmp-files"></div>`);

      if (from.hash === to.hash) {
        $(".cmp-files", out).remove();
        return;
      }
      if (travel && spec.mode === "direct") {
        showStep({ files: false });
        drawFiles(currentTarget());
      } else {
        travel = travel && { ...travel, index: travel.path.length };
        mountChanges($(".cmp-files", out), {
          from: diffFrom,
          to: to.hash,
          onOpenFile: wt ? null : (p) => app.navigate(`#/commit/${to.hash}/files/${p.split("/").map(encodeURIComponent).join("/")}`),
          onFileHistory: (p) => app.setFilter({ path: p, follow: true }),
        });
      }
    } catch (err) {
      if (my === gen) out.innerHTML = String(errorBox(err));
    }
  }

  // ---------------------------------------------------------------- events

  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const from = fieldValue(f, "from");
    const to = fieldValue(f, "to");
    if (!from || !to) return;
    app.navigate(hashFor({ from, to, mode: f.mode.value }));
  });

  el.addEventListener("input", (e) => {
    if (e.target.classList.contains("travel-range")) {
      travel.index = Number(e.target.value);
      showStep();
    } else if (e.target.name === "from" || e.target.name === "to") {
      e.target.dataset.worktree = "";
      e.target.dataset.cleared = "1";
    }
  });

  el.addEventListener("keydown", (e) => {
    if (e.target.classList?.contains("mini-row") && e.key === "Enter") e.target.click();
  });

  el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    const f = $(".compare-form", el);
    if (!t) {
      const item = e.target.closest(".picker-item");
      if (item) return choose(item.closest(".picker").dataset.for, item.dataset.value);
      const row = e.target.closest(".mini-row");
      if (row && !e.target.closest("a")) {
        const i = travel ? travel.path.findIndex((c) => c.hash === row.dataset.hash) : -1;
        if (i >= 0 && $(".travel", el)) {
          travel.index = i + 1;
          showStep();
          $(".travel", el).scrollIntoView({ block: "nearest", behavior: "smooth" });
        } else {
          app.navigate(`#/commit/${row.dataset.hash}`);
        }
      }
      if (!e.target.closest(".field")) for (const p of $$(".picker", el)) p.hidden = true;
      return;
    }
    switch (t.dataset.act) {
      case "pick":
        return openPicker(t.dataset.field);
      case "swap": {
        const from = fieldValue(f, "from");
        const to = fieldValue(f, "to");
        if (!from || !to || from === WORKTREE || to === WORKTREE) return;
        return app.navigate(hashFor({ from: to, to: from, mode: f.mode.value }));
      }
      case "mode":
        f.mode.value = t.dataset.mode;
        for (const b of f.querySelectorAll("[data-act=mode]")) b.setAttribute("aria-pressed", String(b === t));
        return f.requestSubmit();
      case "step":
        return step(Number(t.dataset.d));
    }
  });

  return {
    el,
    load,
    onKey(e) {
      if (!travel || !$(".travel", el)) return;
      if (e.key === "ArrowLeft" || e.key === "[") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight" || e.key === "]") {
        e.preventDefault();
        step(1);
      }
    },
  };
}
