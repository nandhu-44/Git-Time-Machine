// Thin, dependency-free wrapper around the git CLI.
// Every command uses machine-readable output (NUL / record separators) so
// commit messages, file names and refs with odd characters parse correctly.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const WORKTREE = "WORKTREE";

const GLOBAL_ARGS = [
  "--no-pager",
  "-c", "core.quotepath=off",
  "-c", "color.ui=false",
  "-c", "log.showSignature=false",
];

const MB = 1024 * 1024;
const RS = "\x1e"; // record separator
const FS = "\x00"; // field separator

export class GitError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

/** Run git and resolve with stdout (string, or Buffer when raw). */
export function git(cwd, args, { raw = false, input, maxBytes = 64 * MB, timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...GLOBAL_ARGS, ...args], {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_PAGER: "cat",
        LC_ALL: "C",
      },
    });
    const out = [];
    const err = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);

    child.stdout.on("data", (chunk) => {
      if (truncated) return;
      size += chunk.length;
      if (size > maxBytes) {
        truncated = true;
        out.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
        child.kill();
      } else {
        out.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new GitError(e.code === "ENOENT" ? "git was not found in PATH" : e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new GitError(`git ${args[0]} timed out`, 504));
      const buf = Buffer.concat(out);
      if (code !== 0 && !truncated) {
        const msg = Buffer.concat(err).toString().trim().split("\n").pop() || `git ${args[0]} failed`;
        return reject(new GitError(msg.replace(/^(fatal|error): /, ""), 400));
      }
      if (raw) return resolve(Object.assign(buf, { truncated }));
      const text = buf.toString("utf8");
      resolve(truncated ? Object.assign(new String(text), { truncated: true }) : text);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const tryGit = (cwd, args, opts) => git(cwd, args, opts).catch(() => null);

// ---------------------------------------------------------------- validation

/** User supplied revision: never let it be parsed as an option. */
export function checkRev(rev) {
  if (typeof rev !== "string" || !rev || rev.length > 512 || rev.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(rev)) {
    throw new GitError(`Invalid revision: ${String(rev).slice(0, 80)}`, 400);
  }
  return rev;
}

export function checkPath(p) {
  if (typeof p !== "string" || p.length > 4096 || p.includes("\0")) throw new GitError("Invalid path", 400);
  return p.replace(/^\/+/, "");
}

// ---------------------------------------------------------------- repository

export async function openRepo(dir) {
  const inside = await tryGit(dir, ["rev-parse", "--is-bare-repository", "--absolute-git-dir"]);
  if (inside === null) throw new GitError(`Not a git repository: ${dir}`, 400);
  const [bare, gitDir] = inside.trim().split("\n");
  const isBare = bare === "true";
  const root = isBare ? gitDir : (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
  const emptyTree = (await git(root, ["hash-object", "-t", "tree", "--stdin"], { input: "" })).trim();
  return new Repo(path.resolve(root), path.resolve(gitDir), isBare, emptyTree);
}

/** Small LRU for results keyed by immutable object ids. */
class Cache {
  constructor(limit = 400) {
    this.limit = limit;
    this.map = new Map();
  }
  async get(key, fn) {
    if (this.map.has(key)) {
      const v = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, v);
      return v;
    }
    const pending = fn();
    this.map.set(key, pending);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    try {
      return await pending;
    } catch (e) {
      this.map.delete(key);
      throw e;
    }
  }
}

const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%D", "%s"].join("%x00") + "%x1e";

export function parseLog(out) {
  const commits = [];
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, "");
    if (!r) continue;
    const [hash, parents, an, ae, at, cn, ce, ct, refs, subject] = r.split(FS);
    if (!hash || hash.length < 40) continue;
    commits.push({
      hash,
      parents: parents ? parents.split(" ") : [],
      author: an,
      email: ae,
      date: Number(at),
      committer: cn,
      committerEmail: ce,
      commitDate: Number(ct),
      refs: parseDecorations(refs),
      subject: subject ?? "",
    });
  }
  return commits;
}

function parseDecorations(s) {
  if (!s) return [];
  const refs = [];
  for (let part of s.split(", ")) {
    part = part.trim();
    if (!part) continue;
    if (part.startsWith("HEAD -> ")) refs.push({ type: "head", name: part.slice(8) });
    else if (part === "HEAD") refs.push({ type: "detached", name: "HEAD" });
    else if (part.startsWith("tag: ")) refs.push({ type: "tag", name: part.slice(5) });
    else if (part.endsWith("/HEAD") || part === "refs/stash") continue;
    else refs.push({ type: "branch", name: part });
  }
  return refs;
}

/** Merge `git diff --raw -z` and `--numstat -z` output into one file list. */
export function parseFileChanges(rawOut, numOut) {
  const files = [];
  const raw = rawOut.split(FS);
  for (let i = 0; i < raw.length - 1; ) {
    const meta = raw[i++];
    if (!meta.startsWith(":")) continue;
    const [oldMode, newMode, , , statusField = "M"] = meta.slice(1).split(" ");
    const status = statusField[0];
    const oldPath = raw[i++];
    const newPath = status === "R" || status === "C" ? raw[i++] : oldPath;
    files.push({
      status,
      similarity: statusField.length > 1 ? Number(statusField.slice(1)) : undefined,
      path: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      oldMode,
      newMode,
      additions: 0,
      deletions: 0,
      binary: false,
    });
  }

  // numstat -z: "a\td\tpath\0", or for renames "a\td\t\0old\0new\0"
  const byPath = new Map(files.map((f) => [f.path, f]));
  const num = numOut.split(FS);
  for (let i = 0; i < num.length - 1; ) {
    const m = num[i++].match(/^(-|\d+)\t(-|\d+)\t([\s\S]*)$/);
    if (!m) continue;
    let p = m[3];
    if (p === "") {
      i++; // old path
      p = num[i++];
    }
    const f = byPath.get(p);
    if (!f) continue;
    if (m[1] === "-") f.binary = true;
    else {
      f.additions = Number(m[1]);
      f.deletions = Number(m[2]);
    }
  }
  return files;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export class Repo {
  constructor(root, gitDir, bare, emptyTree) {
    this.root = root;
    this.gitDir = gitDir;
    this.bare = bare;
    this.emptyTree = emptyTree;
    this.name = path.basename(bare ? root.replace(/[\\/]\.git$/, "").replace(/\.git$/, "") : root);
    this.cache = new Cache();
  }

  run(args, opts) {
    return git(this.root, args, opts);
  }

  /** Resolve any revision to a full commit id (or WORKTREE). */
  async resolve(rev) {
    if (rev === WORKTREE) {
      if (this.bare) throw new GitError("Bare repositories have no working tree", 400);
      return WORKTREE;
    }
    checkRev(rev);
    const out = await tryGit(this.root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    if (out) return out.trim();
    // Like `git checkout`: a branch that only exists on one remote resolves to it.
    const remote = /^[\w./-]+$/.test(rev) ? await tryGit(this.root, ["for-each-ref", "--format=%(objectname)", `refs/remotes/*/${rev}`]) : null;
    const hits = remote ? [...new Set(remote.trim().split("\n").filter(Boolean))] : [];
    if (hits.length === 1) return (await this.run(["rev-parse", "--verify", `${hits[0]}^{commit}`])).trim();
    throw new GitError(`Unknown revision: ${rev}`, 404);
  }

  // ---------------------------------------------------------- overview

  async info() {
    const [branch, head, refsOut, remoteUrl, statusOut, version] = await Promise.all([
      tryGit(this.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      tryGit(this.root, ["rev-parse", "--verify", "--quiet", "HEAD"]),
      this.run([
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(creatordate:unix)%00%(contents:subject)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ]),
      tryGit(this.root, ["config", "--get", "remote.origin.url"]),
      this.bare ? null : tryGit(this.root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
      tryGit(this.root, ["version"]),
    ]);

    const branches = [];
    const remotes = [];
    const tags = [];
    for (const line of refsOut.split("\n")) {
      if (!line) continue;
      const [ref, oid, peeled, upstream, track, date, subject] = line.split(FS);
      const target = peeled || oid;
      if (ref.startsWith("refs/heads/")) {
        const t = { ahead: 0, behind: 0, gone: track === "gone" };
        for (const m of track.matchAll(/(ahead|behind) (\d+)/g)) t[m[1]] = Number(m[2]);
        branches.push({ name: ref.slice(11), target, upstream: upstream || null, ...t, date: Number(date) });
      } else if (ref.startsWith("refs/remotes/")) {
        const name = ref.slice(13);
        if (name.endsWith("/HEAD")) continue;
        const slash = name.indexOf("/");
        remotes.push({ name, remote: name.slice(0, slash), short: name.slice(slash + 1), target, date: Number(date) });
      } else if (ref.startsWith("refs/tags/")) {
        tags.push({ name: ref.slice(10), target, annotated: Boolean(peeled), message: peeled ? subject : "", date: Number(date) });
      }
    }

    let changes = 0;
    if (statusOut) {
      const parts = statusOut.split(FS);
      for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        changes++;
        if (parts[i][0] === "R" || parts[i][0] === "C") i++; // rename source follows
      }
    }

    return {
      name: this.name,
      root: this.root,
      bare: this.bare,
      branch: branch ? branch.trim() : null,
      head: head ? head.trim() : null,
      branches,
      remotes,
      tags,
      changes,
      emptyTree: this.emptyTree,
      remoteUrl: webUrl(remoteUrl?.trim()),
      gitVersion: version?.trim().replace(/^git version /, "") ?? null,
    };
  }

  /** Cheap fingerprint the UI polls to notice repository changes. */
  async fingerprint() {
    const [refs, head, sym, index] = await Promise.all([
      this.run(["for-each-ref", "--format=%(objectname) %(refname)"]),
      tryGit(this.root, ["rev-parse", "--quiet", "--verify", "HEAD"]),
      tryGit(this.root, ["symbolic-ref", "--quiet", "HEAD"]),
      stat(path.join(this.gitDir, "index")).then((s) => s.mtimeMs, () => 0),
    ]);
    return createHash("sha1").update(`${refs}|${head}|${sym}|${index}`).digest("hex");
  }

  // ---------------------------------------------------------- history

  /**
   * One page of history.
   * ref: revision to start from (default: every branch, remote and tag).
   * message / author / code (pickaxe) / path narrow the result.
   */
  async log({ ref, skip = 0, limit = 300, message, author, code, path: p, follow = false } = {}) {
    const max = Math.min(2000, Math.max(1, limit | 0));
    const args = ["log", `--format=${LOG_FORMAT}`, "--date-order", `--skip=${Math.max(0, skip | 0)}`, `--max-count=${max}`];
    const filtered = Boolean(message || author || code || (p && follow));
    if (message) args.push("--fixed-strings", "--regexp-ignore-case", `--grep=${message}`);
    if (author) args.push("--regexp-ignore-case", `--author=${escapeRegex(author)}`);
    if (code) args.push(`-S${code}`);
    if (p && follow) args.push("--follow");
    else if (p && !filtered) args.push("--parents"); // rewritten parents keep the graph connected
    if (ref) {
      args.push(await this.resolve(ref));
    } else {
      const head = await tryGit(this.root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
      if (!head && !(await this.hasRefs())) return { commits: [], graph: true, done: true };
      if (head) args.push("HEAD");
      args.push("--branches", "--remotes", "--tags");
    }
    args.push("--");
    if (p) args.push(checkPath(p));
    const out = await this.run(args);
    const commits = parseLog(String(out));
    return { commits, graph: !filtered, done: commits.length < max };
  }

  async hasRefs() {
    const out = await tryGit(this.root, ["for-each-ref", "--count=1", "--format=x", "refs/heads", "refs/remotes", "refs/tags"]);
    return Boolean(out && out.trim());
  }

  async commit(rev) {
    const hash = await this.resolve(rev);
    if (hash === WORKTREE) return this.worktreeCommit();
    return this.cache.get(`commit:${hash}`, async () => {
      const out = await this.run(["show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%D%x00%B", hash]);
      const [h, parents, an, ae, at, cn, ce, ct, refs, ...body] = out.split(FS);
      const message = body.join("").replace(/\s+$/, "");
      const nl = message.indexOf("\n");
      return {
        hash: h,
        parents: parents ? parents.split(" ") : [],
        author: an,
        email: ae,
        date: Number(at),
        committer: cn,
        committerEmail: ce,
        commitDate: Number(ct),
        refs: parseDecorations(refs),
        subject: nl === -1 ? message : message.slice(0, nl),
        body: nl === -1 ? "" : message.slice(nl + 1).replace(/^\n+/, ""),
      };
    });
  }

  async worktreeCommit() {
    const head = await tryGit(this.root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return {
      hash: WORKTREE,
      parents: head ? [head.trim()] : [],
      subject: "Uncommitted changes",
      body: "",
      author: "",
      email: "",
      date: Math.floor(Date.now() / 1000),
      refs: [],
    };
  }

  /** Branches and tags whose history contains a commit. */
  async containedIn(rev) {
    const hash = await this.resolve(rev);
    const out = await this.run(
      ["for-each-ref", "--contains", hash, "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"],
      { timeout: 20_000 },
    );
    const res = { branches: [], remotes: [], tags: [] };
    for (const r of out.split("\n")) {
      if (r.startsWith("refs/heads/")) res.branches.push(r.slice(11));
      else if (r.startsWith("refs/remotes/") && !r.endsWith("/HEAD")) res.remotes.push(r.slice(13));
      else if (r.startsWith("refs/tags/")) res.tags.push(r.slice(10));
    }
    return res;
  }

  // ---------------------------------------------------------- diffs

  /** `from` may be "" (the empty tree, for root commits); `to` may be WORKTREE. */
  async endpoints(from, to) {
    const a = from ? await this.resolve(from) : this.emptyTree;
    const b = await this.resolve(to);
    if (a === WORKTREE) throw new GitError("The working tree can only be the target of a comparison", 400);
    return [a, b];
  }

  diffArgs(a, b, extra) {
    return b === WORKTREE ? ["diff", ...extra, a] : ["diff", ...extra, a, b];
  }

  async files(from, to, { ignoreWhitespace = false } = {}) {
    const [a, b] = await this.endpoints(from, to);
    const compute = async () => {
      const ws = ignoreWhitespace ? ["-w"] : [];
      const [raw, num] = await Promise.all([
        this.run(this.diffArgs(a, b, ["--raw", "-z", "-M", "--no-abbrev"])),
        this.run(this.diffArgs(a, b, ["--numstat", "-z", "-M", ...ws])),
      ]);
      const files = parseFileChanges(raw, num);
      if (b === WORKTREE) {
        const untracked = await this.run(["ls-files", "--others", "--exclude-standard", "-z"]);
        for (const p of untracked.split(FS)) {
          if (p) files.push({ status: "?", path: p, additions: 0, deletions: 0, binary: false });
        }
      }
      return files;
    };
    const files = b === WORKTREE ? await compute() : await this.cache.get(`files:${a}:${b}:${ignoreWhitespace}`, compute);
    let additions = 0;
    let deletions = 0;
    for (const f of files) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { from: a, to: b, files, additions, deletions };
  }

  async patch(from, to, file, oldFile, { ignoreWhitespace = false, context = 3 } = {}) {
    const [a, b] = await this.endpoints(from, to);
    const p = checkPath(file);
    const paths = oldFile && oldFile !== file ? [checkPath(oldFile), p] : [p];
    const ctx = Math.min(100000, Math.max(0, context | 0));
    const compute = async () => {
      const args = this.diffArgs(a, b, ["-M", `-U${ctx}`, "--no-ext-diff", ...(ignoreWhitespace ? ["-w"] : [])]);
      const out = await this.run([...args, "--", ...paths], { maxBytes: 4 * MB });
      return { patch: String(out), truncated: Boolean(out.truncated) };
    };
    if (b === WORKTREE) {
      const res = await compute();
      if (!res.patch) {
        const tracked = await tryGit(this.root, ["ls-files", "--error-unmatch", "--", p]);
        if (tracked === null) return this.untrackedPatch(p);
      }
      return res;
    }
    return this.cache.get(`patch:${a}:${b}:${paths.join("\0")}:${ignoreWhitespace}:${ctx}`, compute);
  }

  async untrackedPatch(p) {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(this.root + path.sep)) throw new GitError("Invalid path", 400);
    const buf = await readFile(full).catch(() => null);
    if (!buf) return { patch: "", truncated: false };
    if (isBinary(buf)) return { patch: `Binary files /dev/null and b/${p} differ\n`, truncated: false };
    const text = buf.subarray(0, 2 * MB).toString("utf8");
    if (!text) return { patch: "", truncated: false };
    const lines = text.replace(/\n$/, "").split("\n");
    return {
      patch: `--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => "+" + l).join("\n") + "\n",
      truncated: buf.length > 2 * MB,
    };
  }

  /** Commits reachable from `to` but not from `from`, plus ahead/behind counts. */
  async range(from, to) {
    const a = await this.resolve(from);
    const b = await this.resolve(to);
    if (a === WORKTREE || b === WORKTREE) return { commits: [], aheadCount: 0, behindCount: 0, mergeBase: null };
    const [counts, base, list] = await Promise.all([
      this.run(["rev-list", "--left-right", "--count", `${a}...${b}`]),
      tryGit(this.root, ["merge-base", a, b]),
      this.run(["log", `--format=${LOG_FORMAT}`, "--date-order", "--max-count=500", `${a}..${b}`]),
    ]);
    const [behindCount, aheadCount] = counts.trim().split(/\s+/).map(Number);
    return { commits: parseLog(list), aheadCount, behindCount, mergeBase: base ? base.trim() : null };
  }

  // ---------------------------------------------------------- browsing

  async tree(rev, dir = "") {
    const hash = await this.resolve(rev);
    if (hash === WORKTREE) throw new GitError("Pick a commit to browse", 400);
    const d = checkPath(dir).replace(/\/+$/, "");
    return this.cache.get(`tree:${hash}:${d}`, async () => {
      const out = await this.run(["ls-tree", "-z", "-l", hash, ...(d ? ["--", d + "/"] : [])]);
      const entries = [];
      for (const rec of out.split(FS)) {
        if (!rec) continue;
        const tab = rec.indexOf("\t");
        const [mode, type, oid, size] = rec.slice(0, tab).split(/\s+/);
        const full = rec.slice(tab + 1);
        entries.push({ name: full.split("/").pop(), path: full, type, mode, oid, size: size === "-" ? null : Number(size) });
      }
      const order = { tree: 0, commit: 1, blob: 2 };
      entries.sort((x, y) => order[x.type] - order[y.type] || x.name.localeCompare(y.name));
      return { rev: hash, path: d, entries };
    });
  }

  async blob(rev, file) {
    const hash = await this.resolve(rev);
    if (hash === WORKTREE) throw new GitError("Pick a commit to browse", 400);
    const p = checkPath(file);
    return this.cache.get(`blob:${hash}:${p}`, async () => {
      const spec = `${hash}:${p}`;
      const size = Number((await this.run(["cat-file", "-s", spec])).trim());
      const limit = 2 * MB;
      const buf = await this.run(["cat-file", "blob", spec], { raw: true, maxBytes: limit });
      if (isBinary(buf)) return { path: p, size, binary: true, content: "" };
      return { path: p, size, binary: false, truncated: size > limit, content: buf.toString("utf8") };
    });
  }

  async blame(rev, file) {
    const hash = await this.resolve(rev);
    if (hash === WORKTREE) throw new GitError("Pick a commit to blame", 400);
    const p = checkPath(file);
    return this.cache.get(`blame:${hash}:${p}`, async () => {
      const out = await this.run(["blame", "--porcelain", "-w", hash, "--", p], { maxBytes: 32 * MB, timeout: 120_000 });
      const commits = {};
      const lines = [];
      let cur = null;
      for (const line of out.split("\n")) {
        if (line.startsWith("\t")) {
          lines.push(cur);
          continue;
        }
        const head = line.match(/^([0-9a-f]{40,64}) \d+ \d+/);
        if (head) {
          cur = head[1];
          commits[cur] ??= {};
          continue;
        }
        const sp = line.indexOf(" ");
        const key = line.slice(0, sp);
        const val = line.slice(sp + 1);
        if (key === "author") commits[cur].author = val;
        else if (key === "author-mail") commits[cur].email = val.replace(/^<|>$/g, "");
        else if (key === "author-time") commits[cur].date = Number(val);
        else if (key === "summary") commits[cur].subject = val;
      }
      return { rev: hash, path: p, lines, commits };
    });
  }

  // ---------------------------------------------------------- insights

  async insights(ref) {
    const target = ref ? await this.resolve(ref) : null;
    const key = `insights:${target ?? "*"}:${await this.fingerprint()}`;
    return this.cache.get(key, async () => {
      const args = ["log", "--format=%at%x00%aN%x00%aE", "--use-mailmap", "--no-merges"];
      if (target) args.push(target);
      else if (await this.hasRefs()) args.push("--branches", "--remotes", "--tags");
      else return emptyInsights();
      const out = await this.run(args, { maxBytes: 512 * MB, timeout: 180_000 });
      const days = {};
      const punch = Array.from({ length: 7 }, () => Array(24).fill(0));
      const people = new Map();
      let first = Infinity;
      let last = 0;
      let total = 0;
      for (const line of out.split("\n")) {
        if (!line) continue;
        const [t, name, email] = line.split(FS);
        const ts = Number(t);
        total++;
        if (ts < first) first = ts;
        if (ts > last) last = ts;
        const d = new Date(ts * 1000);
        const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        days[day] = (days[day] || 0) + 1;
        punch[d.getDay()][d.getHours()]++;
        const k = (email || name).toLowerCase();
        const p = people.get(k) || { name, email, commits: 0, first: ts, last: ts };
        p.commits++;
        if (ts < p.first) p.first = ts;
        if (ts > p.last) p.last = ts;
        people.set(k, p);
      }
      const contributors = [...people.values()].sort((a, b) => b.commits - a.commits);
      return {
        total,
        first: total ? first : null,
        last: total ? last : null,
        days,
        punch,
        contributorCount: contributors.length,
        contributors: contributors.slice(0, 100),
      };
    });
  }

  // ---------------------------------------------------------- network

  fetch() {
    return this.run(["fetch", "--all", "--prune", "--quiet"], { timeout: 180_000 });
  }
}

function emptyInsights() {
  return { total: 0, first: null, last: null, days: {}, punch: Array.from({ length: 7 }, () => Array(24).fill(0)), contributorCount: 0, contributors: [] };
}

const pad = (n) => String(n).padStart(2, "0");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Turn a remote URL into a browsable https URL (GitHub, GitLab, ...). */
export function webUrl(url) {
  if (!url) return null;
  let m = url.match(/^(?:ssh:\/\/)?[\w.-]+@([\w.-]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  m = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  return null;
}
