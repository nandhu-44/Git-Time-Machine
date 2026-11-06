// Commit detail pane: metadata, changed files, and a file browser with blame.

import { api, html, raw, esc, $, avatar, refBadges, relTime, fullDate, short, bytes, plural, icons, copyText, loading, errorBox, empty, WORKTREE } from "./ui.js";
import { mountChanges } from "./diff.js";

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

export function renderDetail(pane, app, hash, initial = {}) {
  let alive = true;
  let commit = null;
  let opts = { tab: "changes", path: "", parent: 0, ...initial };
  const isWt = hash === WORKTREE;

  pane.innerHTML = String(loading("Loading commit"));
  pane.scrollTop = 0;

  api("commit", { rev: hash })
    .then((res) => {
      if (!alive) return;
      commit = res.commit;
      draw();
    })
    .catch((err) => {
      if (!alive) return;
      pane.innerHTML = String(html`<div class="detail-top"><span class="spacer"></span><a class="icon-btn" href="#/" aria-label="Close">${raw(icons.close)}</a></div>${errorBox(err)}`);
    });

  function link(tab, path = "") {
    return `#/commit/${commit.hash}${tab === "changes" ? "" : `/${tab}`}${path ? `/${enc(path)}` : ""}`;
  }

  function people() {
    const c = commit;
    if (isWt) return "";
    const sameCommitter = c.committer === c.author && c.committerEmail === c.email;
    return html`<div class="people">
      <div class="person">${avatar(c.author, c.email, 32)}
        <div><div class="who"><strong>${c.author}</strong> <span class="muted">${c.email}</span></div>
        <div class="muted small" title="${fullDate(c.date)}">authored ${relTime(c.date)} · ${fullDate(c.date)}</div></div>
      </div>
      ${sameCommitter && Math.abs(c.commitDate - c.date) < 60 ? "" : html`<div class="person sub">${avatar(c.committer, c.committerEmail, 20)}
        <div class="muted small" title="${fullDate(c.commitDate)}">committed by <strong>${c.committer}</strong> ${relTime(c.commitDate)}</div></div>`}
    </div>`;
  }

  function draw() {
    const c = commit;
    const remote = app.repo.remoteUrl;
    const parents = c.parents;
    pane.innerHTML = String(html`
      <div class="detail-top">
        <span class="sha-pill" title="${c.hash}">${isWt ? "working tree" : short(c.hash)}</span>
        ${isWt ? "" : html`<button class="icon-btn" data-act="copy" title="Copy full commit id" aria-label="Copy commit id">${raw(icons.copy)}</button>`}
        <span class="spacer"></span>
        ${!isWt && remote ? html`<a class="btn btn-sm btn-ghost" href="${remote}/commit/${c.hash}" target="_blank" rel="noopener noreferrer">${raw(icons.external)} Open on ${hostName(remote)}</a>` : ""}
        <a class="icon-btn" href="#/" title="Close (Esc)" aria-label="Close">${raw(icons.close)}</a>
      </div>
      <div class="detail-head">
        ${refBadges(c.refs, { max: 12 })}
        <h2 class="subject">${c.subject || "(no message)"}</h2>
        ${c.body ? html`<pre class="body">${c.body}</pre>` : ""}
        ${people()}
        <dl class="meta">
          ${parents.length ? html`<dt>${parents.length > 1 ? "Parents" : "Parent"}</dt><dd>${parents.map((p) => html`<a class="sha-link" href="#/commit/${p}">${short(p)}</a>`)}</dd>` : html`<dt>Parent</dt><dd class="muted">none (root commit)</dd>`}
          ${isWt ? "" : html`<dt>Contained in</dt><dd class="contains">${raw('<span class="muted small">…</span>')}</dd>`}
        </dl>
        <div class="detail-actions">
          ${parents.length && !isWt ? html`<a class="btn btn-sm" href="#/compare/${c.hash}..${WORKTREE}" title="What changed from this commit to your working tree">Compare with working tree</a>` : ""}
          ${!isWt && app.repo.head && c.hash !== app.repo.head ? html`<a class="btn btn-sm" href="#/compare/${c.hash}..HEAD" title="Changes from this commit to HEAD">Compare with HEAD</a>` : ""}
        </div>
      </div>
      <div class="detail-tabs" role="tablist">
        <a role="tab" href="${link("changes")}" class="${opts.tab === "changes" ? "active" : ""}">Changes</a>
        ${isWt ? "" : html`<a role="tab" href="${link("files")}" class="${opts.tab === "files" ? "active" : ""}">Files</a>`}
        ${parents.length > 1 && opts.tab === "changes" ? html`<label class="parent-pick">against
            <select data-act="parent">${parents.map((p, i) => html`<option value="${i}" ${i === opts.parent ? "selected" : ""}>parent ${i + 1} · ${short(p)}</option>`)}</select></label>` : ""}
      </div>
      <div class="detail-body"></div>`);

    if (!isWt) loadContains();
    drawBody();
  }

  async function loadContains() {
    const dd = $(".contains", pane);
    try {
      const res = await api("contains", { rev: commit.hash });
      if (!alive || !dd) return;
      const items = [
        ...res.branches.map((n) => html`<span class="ref ref-branch">${n}</span>`),
        ...res.tags.slice(0, 8).map((n) => html`<span class="ref ref-tag">${raw(icons.tag)}${n}</span>`),
        ...res.remotes.slice(0, 6).map((n) => html`<span class="ref ref-remote">${n}</span>`),
      ];
      const more = res.tags.length - 8 + Math.max(0, res.remotes.length - 6);
      dd.innerHTML = items.length
        ? String(html`<span class="refs wrap">${items}${more > 0 ? html`<span class="muted small">+${more} more</span>` : ""}</span>`)
        : `<span class="muted small">Not on any branch or tag</span>`;
    } catch {
      if (dd) dd.innerHTML = `<span class="muted small">unknown</span>`;
    }
  }

  function drawBody() {
    const body = $(".detail-body", pane);
    if (opts.tab === "files" && !isWt) return browse(body);
    const parent = commit.parents[opts.parent] ?? "";
    mountChanges(body, {
      from: isWt ? commit.parents[0] || "" : parent,
      to: commit.hash,
      note: commit.parents.length > 1 ? `vs parent ${opts.parent + 1}` : !commit.parents.length ? "root commit" : "",
      onOpenFile: isWt ? null : (p) => app.navigate(link("files", p)),
      onFileHistory: (p) => app.setFilter({ path: p, follow: true }),
    });
  }

  // ---------------------------------------------------------------- browsing

  function crumbs(path, isFile) {
    const parts = path ? path.split("/") : [];
    let acc = "";
    return html`<nav class="crumbs" aria-label="Path"><a href="${link("files")}">${raw(icons.folder)}root</a>${parts.map((p, i) => {
      acc += (acc ? "/" : "") + p;
      const last = i === parts.length - 1;
      return html`<span class="sep">/</span>${last && isFile ? html`<strong>${p}</strong>` : html`<a href="${link("files", acc)}">${p}</a>`}`;
    })}</nav>`;
  }

  async function browse(body) {
    const path = opts.path || "";
    body.innerHTML = String(loading());
    try {
      // A path may be a directory or a file: try the directory listing first.
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      let entry = null;
      if (path) {
        const listing = await api("tree", { rev: commit.hash, path: parent });
        entry = listing.entries.find((e) => e.path === path);
        if (!entry) throw new Error(`${path} does not exist in ${short(commit.hash)}`);
      }
      if (!alive) return;
      if (!entry || entry.type === "tree") return showDir(body, path);
      if (entry.type === "commit") {
        body.innerHTML = String(html`${crumbs(path, true)}${empty("Submodule", `Points at ${short(entry.oid)}`)}`);
        return;
      }
      return showFile(body, path, entry);
    } catch (err) {
      body.innerHTML = String(html`${crumbs(path, false)}${errorBox(err)}`);
    }
  }

  async function showDir(body, path) {
    const listing = await api("tree", { rev: commit.hash, path });
    if (!alive) return;
    body.innerHTML = String(html`${crumbs(path, false)}
      <div class="tree">${path ? html`<a class="tree-row" href="${link("files", path.split("/").slice(0, -1).join("/"))}"><span class="i"></span><span>..</span></a>` : ""}
      ${listing.entries.map(
        (e) => html`<a class="tree-row" href="${link("files", e.path)}">${raw(e.type === "tree" ? icons.folder : e.type === "commit" ? icons.module : icons.file)}<span class="${e.type === "tree" ? "dir" : ""}">${e.name}</span><span class="muted small">${e.type === "blob" ? bytes(e.size) : ""}</span></a>`,
      )}</div>`);
  }

  async function showFile(body, path, entry) {
    const blame = opts.blame;
    body.innerHTML = String(loading(blame ? "Running blame" : "Loading file"));
    const [blob, bl] = await Promise.all([
      api("blob", { rev: commit.hash, path }),
      blame ? api("blame", { rev: commit.hash, path }) : null,
    ]);
    if (!alive) return;
    const lines = blob.binary ? [] : blob.content.replace(/\n$/, "").split("\n");
    body.innerHTML = String(html`${crumbs(path, true)}
      <div class="file-bar">
        <span class="muted small">${blob.binary ? "binary" : plural(lines.length, "line")} · ${bytes(entry.size)}</span>
        <span class="spacer"></span>
        ${blob.binary ? "" : html`<button class="btn btn-sm ${blame ? "btn-primary" : ""}" data-act="blame" aria-pressed="${Boolean(blame)}">Blame</button>`}
        <button class="btn btn-sm" data-act="file-history">${raw(icons.history)} History</button>
        ${blob.binary ? "" : html`<button class="btn btn-sm" data-act="copy-file">${raw(icons.copy)} Copy</button>`}
      </div>
      ${blob.binary ? empty("Binary file", "Binary content is not displayed.") : raw(codeTable(lines, bl))}
      ${blob.truncated ? html`<div class="diff-note">File truncated (showing the first 2 MB)</div>` : ""}`);
    body._content = blob.content;
  }

  function codeTable(lines, bl) {
    const limit = 20000;
    let out = `<table class="code-view${bl ? " blame" : ""}"><tbody>`;
    let prev = null;
    let now = Date.now() / 1000;
    let oldest = now;
    if (bl) for (const c of Object.values(bl.commits)) oldest = Math.min(oldest, c.date || now);
    for (let i = 0; i < Math.min(lines.length, limit); i++) {
      let gutter = "";
      if (bl) {
        const h = bl.lines[i];
        const c = bl.commits[h] || {};
        const age = oldest < now ? (now - (c.date || now)) / (now - oldest) : 0;
        const first = h !== prev;
        prev = h;
        gutter = `<td class="blame-cell${first ? " first" : ""}" style="--age:${(1 - age).toFixed(2)}">${
          first ? `<a href="#/commit/${h}" title="${esc(c.subject || "")}"><span class="sha">${short(h)}</span><span class="who">${esc(c.author || "")}</span><span class="when">${c.date ? esc(relTime(c.date)) : ""}</span></a>` : ""
        }</td>`;
      }
      out += `<tr>${gutter}<td class="ln" data-n="${i + 1}"></td><td class="code">${esc(lines[i]) || " "}</td></tr>`;
    }
    out += "</tbody></table>";
    if (lines.length > limit) out += `<div class="diff-note">Showing the first ${limit.toLocaleString()} lines</div>`;
    return out;
  }

  // ---------------------------------------------------------------- events

  pane.onclick = (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    switch (t.dataset.act) {
      case "copy":
        return copyText(commit.hash, "Commit id copied");
      case "blame":
        opts.blame = !opts.blame;
        return drawBody();
      case "file-history":
        return app.setFilter({ path: opts.path, follow: true });
      case "copy-file":
        return copyText($(".detail-body", pane)._content ?? "", "File copied");
    }
  };
  pane.onchange = (e) => {
    if (e.target.dataset.act === "parent") {
      opts.parent = Number(e.target.value);
      drawBody();
    }
  };

  return {
    update(next) {
      const tabChanged = next.tab !== opts.tab;
      opts = { ...opts, ...next };
      if (!commit) return;
      if (tabChanged) {
        draw();
        pane.scrollTop = 0;
      } else {
        drawBody();
        const tabs = $(".detail-tabs", pane);
        if (tabs && tabs.getBoundingClientRect().top < pane.getBoundingClientRect().top) tabs.scrollIntoView();
      }
    },
    destroy() {
      alive = false;
    },
  };
}

function hostName(url) {
  try {
    const h = new URL(url).hostname;
    if (h === "github.com") return "GitHub";
    if (h === "gitlab.com") return "GitLab";
    if (h === "bitbucket.org") return "Bitbucket";
    return h;
  } catch {
    return "remote";
  }
}

