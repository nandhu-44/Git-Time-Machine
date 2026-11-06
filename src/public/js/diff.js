// Changed-file list with lazily loaded, unified or side-by-side diffs.

import { api, html, raw, esc, icons, plural, storage, $, $$, loading, errorBox, WORKTREE } from "./ui.js";

const STATUS = {
  A: ["added", "Added"],
  D: ["deleted", "Deleted"],
  M: ["modified", "Modified"],
  R: ["renamed", "Renamed"],
  C: ["copied", "Copied"],
  T: ["modified", "Type changed"],
  "?": ["untracked", "Untracked"],
};

const MAX_LINES = 2500;

// ------------------------------------------------------------------ parsing

function parsePatch(text) {
  const hunks = [];
  let binary = false;
  let hunk = null;
  let o = 0;
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
      if (!m) continue;
      o = Number(m[1]);
      n = Number(m[2]);
      hunk = { header: line, section: m[3], lines: [] };
      hunks.push(hunk);
    } else if (!hunk) {
      if (line.startsWith("Binary files") || line === "GIT binary patch") binary = true;
    } else if (line.startsWith("+")) {
      hunk.lines.push({ t: "+", text: line.slice(1), n: n++ });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ t: "-", text: line.slice(1), o: o++ });
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ t: " ", text: line.slice(1), o: o++, n: n++ });
    } else if (line.startsWith("\\")) {
      hunk.lines.push({ t: "\\", text: line.slice(2) });
    }
  }
  return { hunks, binary };
}

// ------------------------------------------------------------------ word diff

const TOKEN = /\w+|\s+|[^\w\s]/g;

/** Highlight the changed middle of a removed/added line pair (token prefix/suffix). */
function wordDiff(a, b) {
  if (a.length > 400 || b.length > 400) return [esc(a), esc(b)];
  const ta = a.match(TOKEN) || [];
  const tb = b.match(TOKEN) || [];
  let p = 0;
  while (p < ta.length && p < tb.length && ta[p] === tb[p]) p++;
  let s = 0;
  while (s < ta.length - p && s < tb.length - p && ta[ta.length - 1 - s] === tb[tb.length - 1 - s]) s++;
  const changedA = ta.length - p - s;
  const changedB = tb.length - p - s;
  // Mostly-different lines read better without highlights.
  if (changedA > ta.length * 0.7 && changedB > tb.length * 0.7) return [esc(a), esc(b)];
  const mark = (t, cls) => {
    const mid = t.slice(p, t.length - s).join("");
    return esc(t.slice(0, p).join("")) + (mid ? `<mark class="${cls}">${esc(mid)}</mark>` : "") + esc(t.slice(t.length - s).join(""));
  };
  return [mark(ta, "del"), mark(tb, "ins")];
}

/** Pair runs of removed lines with the added lines that follow them. */
function withWordDiff(lines) {
  const out = lines.map((l) => ({ ...l, html: esc(l.text) }));
  for (let i = 0; i < out.length; ) {
    if (out[i].t !== "-") {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j].t === "-") j++;
    let k = j;
    while (k < out.length && out[k].t === "+") k++;
    const pairs = Math.min(j - i, k - j);
    for (let x = 0; x < pairs; x++) {
      const [d, a] = wordDiff(out[i + x].text, out[j + x].text);
      out[i + x].html = d;
      out[j + x].html = a;
    }
    i = k;
  }
  return out;
}

// ------------------------------------------------------------------ rendering

function hunkRow(h, cols) {
  return `<tr class="hunk"><td class="ln" colspan="${cols - 1}"></td><td class="code">${esc(h.header.replace(/ @@.*$/, " @@"))}<span class="section">${esc(h.section)}</span></td></tr>`;
}

function renderUnified(hunks, limit) {
  let rows = "";
  let count = 0;
  for (const h of hunks) {
    rows += hunkRow(h, 3);
    for (const l of withWordDiff(h.lines)) {
      if (count++ >= limit) return { rows, cut: true };
      if (l.t === "\\") {
        rows += `<tr class="note"><td class="ln"></td><td class="ln"></td><td class="code">${esc(l.text)}</td></tr>`;
        continue;
      }
      const cls = l.t === "+" ? "add" : l.t === "-" ? "del" : "ctx";
      rows += `<tr class="${cls}"><td class="ln" data-n="${l.o ?? ""}"></td><td class="ln" data-n="${l.n ?? ""}"></td><td class="code"><span class="sign">${l.t === " " ? " " : l.t}</span>${l.html}</td></tr>`;
    }
  }
  return { rows, cut: false };
}

function renderSplit(hunks, limit) {
  let rows = "";
  let count = 0;
  const cell = (l, side) => {
    if (!l) return `<td class="ln blank"></td><td class="code blank"></td>`;
    const cls = l.t === "+" ? "add" : l.t === "-" ? "del" : "ctx";
    const num = side === "old" ? l.o : l.n;
    return `<td class="ln ${cls}" data-n="${num ?? ""}"></td><td class="code ${cls}">${l.html}</td>`;
  };
  for (const h of hunks) {
    rows += `<tr class="hunk"><td class="ln"></td><td class="code" colspan="3">${esc(h.header.replace(/ @@.*$/, " @@"))}<span class="section">${esc(h.section)}</span></td></tr>`;
    const lines = withWordDiff(h.lines.filter((l) => l.t !== "\\"));
    for (let i = 0; i < lines.length; ) {
      if (count >= limit) return { rows, cut: true };
      const l = lines[i];
      if (l.t === " ") {
        rows += `<tr>${cell(l, "old")}${cell(l, "new")}</tr>`;
        i++;
        count++;
        continue;
      }
      let j = i;
      while (j < lines.length && lines[j].t === "-") j++;
      let k = j;
      while (k < lines.length && lines[k].t === "+") k++;
      const dels = lines.slice(i, j);
      const adds = lines.slice(j, k);
      for (let x = 0; x < Math.max(dels.length, adds.length); x++) {
        rows += `<tr>${cell(dels[x], "old")}${cell(adds[x], "new")}</tr>`;
        count++;
      }
      i = k;
    }
  }
  return { rows, cut: false };
}

function renderPatch(text, { split = false, limit = MAX_LINES } = {}) {
  const { hunks, binary } = parsePatch(text);
  if (binary) return `<div class="diff-note">Binary file changed</div>`;
  if (!hunks.length) return `<div class="diff-note">No content changes (mode change, rename or whitespace only)</div>`;
  const { rows, cut } = split ? renderSplit(hunks, limit) : renderUnified(hunks, limit);
  return (
    `<table class="diff ${split ? "split" : "unified"}"><colgroup>${split ? '<col class="c-ln"><col><col class="c-ln"><col>' : '<col class="c-ln"><col class="c-ln"><col>'}</colgroup><tbody>${rows}</tbody></table>` +
    (cut ? `<div class="diff-note"><button class="btn btn-sm" data-act="all-lines">Show all lines</button></div>` : "")
  );
}

// ------------------------------------------------------------------ file list

function splitPath(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)];
}

function statBar(a, d) {
  const total = a + d;
  if (!total) return "";
  const blocks = 5;
  const add = Math.round((a / total) * blocks);
  let s = "";
  for (let i = 0; i < blocks; i++) s += `<i class="${i < add ? "a" : "d"}"></i>`;
  return `<span class="statbar" aria-hidden="true">${s}</span>`;
}

function fileHeader(f) {
  const [cls, label] = STATUS[f.status] || STATUS.M;
  const [dir, name] = splitPath(f.path);
  return html`<button class="file-head" data-act="toggle" aria-expanded="false">
    ${raw(icons.chevron)}
    <span class="status status-${cls}" title="${label}${f.similarity !== undefined && f.status === "R" ? ` (${f.similarity}% similar)` : ""}">${f.status === "?" ? "U" : f.status}</span>
    <span class="path" title="${f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}">${f.oldPath ? html`<span class="old">${f.oldPath}</span><span class="arrow">→</span>` : ""}<span class="dir">${dir}</span><span class="name">${name}</span></span>
    <span class="nums">${f.binary ? html`<span class="bin">binary</span>` : html`${f.additions ? html`<span class="a">+${f.additions}</span>` : ""}${f.deletions ? html`<span class="d">−${f.deletions}</span>` : ""}`}${raw(statBar(f.additions, f.deletions))}</span>
  </button>`;
}

/**
 * Mount a changed-files view.
 * opts: { from, to, onOpenFile(path, rev), onFileHistory(path), note }
 */
export async function mountChanges(el, opts) {
  const state = {
    split: storage.get("split", false),
    ws: storage.get("ignore-ws", false),
    data: null,
  };
  const { from = "", to } = opts;

  async function load() {
    el.innerHTML = String(loading("Loading changes"));
    try {
      state.data = await api("files", { from, to, ws: state.ws });
    } catch (err) {
      el.innerHTML = String(errorBox(err));
      return;
    }
    draw();
  }

  function draw() {
    const { files, additions, deletions } = state.data;
    if (!files.length) {
      el.innerHTML = `<div class="empty"><strong>No changes</strong><span>${state.ws ? "Only whitespace differs." : "Both sides have identical trees."}</span></div>`;
      return;
    }
    el.innerHTML = String(html`
      <div class="changes-bar">
        <span class="summary">${plural(files.length, "file")} changed
          ${additions ? html`<span class="a">+${additions.toLocaleString()}</span>` : ""}
          ${deletions ? html`<span class="d">−${deletions.toLocaleString()}</span>` : ""}</span>
        ${opts.note ? html`<span class="muted small">${opts.note}</span>` : ""}
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Diff layout">
          <button data-act="layout" data-split="0" aria-pressed="${!state.split}">Unified</button>
          <button data-act="layout" data-split="1" aria-pressed="${state.split}">Split</button>
        </div>
        <label class="check" title="Ignore whitespace changes"><input type="checkbox" data-act="ws" ${state.ws ? "checked" : ""}> Hide whitespace</label>
        <button class="btn btn-sm btn-ghost" data-act="expand-all">Expand all</button>
      </div>
      <div class="files">${files.map(
        (f, i) => html`<section class="file" data-i="${i}">${fileHeader(f)}<div class="file-body" hidden></div></section>`,
      )}</div>`);

    // Open small change sets right away.
    const total = additions + deletions;
    const auto = files.length <= 8 && total <= 600 ? files.length : files.length <= 30 ? 1 : 0;
    $$(".file", el).slice(0, auto).forEach((sec) => toggle(sec, true));
  }

  async function toggle(sec, open) {
    const body = $(".file-body", sec);
    const head = $(".file-head", sec);
    const willOpen = open ?? body.hidden;
    body.hidden = !willOpen;
    head.setAttribute("aria-expanded", String(willOpen));
    sec.classList.toggle("open", willOpen);
    if (willOpen && !body.dataset.loaded) await loadPatch(sec);
  }

  async function loadPatch(sec, { full = false } = {}) {
    const f = state.data.files[Number(sec.dataset.i)];
    const body = $(".file-body", sec);
    body.dataset.loaded = "1";
    body.innerHTML = String(loading());
    try {
      sec._res = await api("patch", { from, to, path: f.path, oldPath: f.oldPath, ws: state.ws, context: full ? 100000 : undefined });
      sec._full = full;
      sec._all = false;
      paint(sec);
    } catch (err) {
      body.innerHTML = String(errorBox(err));
    }
  }

  function paint(sec) {
    const f = state.data.files[Number(sec.dataset.i)];
    const res = sec._res;
    const tools = html`<div class="file-tools">
        ${to !== WORKTREE && f.status !== "D" && opts.onOpenFile ? html`<button class="btn btn-sm btn-ghost" data-act="open-file">View file</button>` : ""}
        ${opts.onFileHistory ? html`<button class="btn btn-sm btn-ghost" data-act="file-history">${raw(icons.history)} History</button>` : ""}
        ${f.binary ? "" : html`<button class="btn btn-sm btn-ghost" data-act="full" aria-pressed="${sec._full}">${sec._full ? "Show changes only" : "Show full file"}</button>`}
      </div>`;
    $(".file-body", sec).innerHTML =
      String(tools) +
      renderPatch(res.patch, { split: state.split, limit: sec._all ? Infinity : MAX_LINES }) +
      (res.truncated ? `<div class="diff-note">Diff truncated (too large to display)</div>` : "");
  }

  el.onclick = async (e) => {
    const t = e.target.closest("[data-act]");
    if (!t || !el.contains(t)) return;
    const sec = t.closest(".file");
    const f = sec ? state.data.files[Number(sec.dataset.i)] : null;
    switch (t.dataset.act) {
      case "toggle":
        return toggle(sec);
      case "layout":
        state.split = t.dataset.split === "1";
        storage.set("split", state.split);
        $$("[data-act=layout]", el).forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
        for (const s of $$(".file", el)) if (s._res) paint(s);
        return;
      case "expand-all": {
        const secs = $$(".file", el);
        const anyClosed = secs.some((s) => !s.classList.contains("open"));
        t.textContent = anyClosed ? "Collapse all" : "Expand all";
        for (const s of secs) toggle(s, anyClosed);
        return;
      }
      case "full":
        return loadPatch(sec, { full: !sec._full });
      case "all-lines":
        sec._all = true;
        return paint(sec);
      case "open-file":
        return opts.onOpenFile(f.path, to);
      case "file-history":
        return opts.onFileHistory(f.path);
    }
  };
  el.onchange = (e) => {
    if (e.target.dataset.act === "ws") {
      state.ws = e.target.checked;
      storage.set("ignore-ws", state.ws);
      load();
    }
  };

  await load();
}
