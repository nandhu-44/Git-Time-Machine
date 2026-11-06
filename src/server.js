// Local HTTP server: JSON API over the repository + the static UI.
// Uses only node:http. Bound to loopback by default and checks the Host
// header so other websites cannot read the repository via DNS rebinding.

import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GitError } from "./git.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://www.gravatar.com",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function md5(s) {
  return createHash("md5").update(s).digest("hex");
}

/** Avatar URL for an email: GitHub noreply addresses map exactly, otherwise Gravatar. */
function avatarUrl(email) {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  const gh = e.match(/^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/);
  if (gh && gh[1]) return `https://avatars.githubusercontent.com/u/${gh[1]}?s=64&v=4`;
  return `https://www.gravatar.com/avatar/${md5(e)}?s=64&d=blank`;
}

function attachAvatars(enabled, ...lists) {
  if (!enabled) return {};
  const map = {};
  for (const list of lists) {
    for (const item of list || []) {
      for (const email of [item.email, item.committerEmail]) {
        if (email && !(email in map)) map[email] = avatarUrl(email);
      }
    }
  }
  return map;
}

export function createServer(repo, { avatars = true, host = "127.0.0.1" } = {}) {
  const staticCache = new Map();
  const checkHost = LOOPBACK.has(host);

  const bool = (v) => v === "1" || v === "true";

  const routes = {
    "GET /api/repo": async () => ({ ...(await repo.info()), avatars }),
    "GET /api/state": async () => ({ fingerprint: await repo.fingerprint() }),
    "GET /api/history": async (q) => {
      const res = await repo.log({
        ref: q.get("rev") || undefined,
        skip: Number(q.get("skip")) || 0,
        limit: Number(q.get("limit")) || 300,
        message: q.get("message") || undefined,
        author: q.get("author") || undefined,
        code: q.get("code") || undefined,
        path: q.get("path") || undefined,
        follow: bool(q.get("follow")),
      });
      return { ...res, avatars: attachAvatars(avatars, res.commits) };
    },
    "GET /api/commit": async (q) => {
      const commit = await repo.commit(required(q, "rev"));
      return { commit, avatars: attachAvatars(avatars, [commit]) };
    },
    "GET /api/contains": async (q) => repo.containedIn(required(q, "rev")),
    "GET /api/files": async (q) =>
      repo.files(q.get("from") || "", required(q, "to"), { ignoreWhitespace: bool(q.get("ws")) }),
    "GET /api/patch": async (q) =>
      repo.patch(q.get("from") || "", required(q, "to"), required(q, "path"), q.get("oldPath") || undefined, {
        ignoreWhitespace: bool(q.get("ws")),
        context: q.has("context") ? Number(q.get("context")) : 3,
      }),
    "GET /api/range": async (q) => {
      const res = await repo.range(required(q, "from"), required(q, "to"));
      return { ...res, avatars: attachAvatars(avatars, res.added, res.removed, res.path) };
    },
    "GET /api/tree": async (q) => repo.tree(required(q, "rev"), q.get("path") || ""),
    "GET /api/blob": async (q) => repo.blob(required(q, "rev"), required(q, "path")),
    "GET /api/blame": async (q) => {
      const res = await repo.blame(required(q, "rev"), required(q, "path"));
      return { ...res, avatars: attachAvatars(avatars, Object.values(res.commits)) };
    },
    "GET /api/insights": async (q) => {
      const res = await repo.insights(q.get("rev") || undefined);
      return { ...res, avatars: attachAvatars(avatars, res.contributors) };
    },
    "POST /api/fetch": async () => {
      await repo.fetch();
      return { ok: true };
    },
  };

  async function serveStatic(res, pathname) {
    const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "Forbidden");
    let body = staticCache.get(file);
    if (!body) {
      body = await readFile(file).catch(() => null);
      if (!body) return send(res, 404, "Not found");
      staticCache.set(file, body);
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      ...securityHeaders(),
    });
    res.end(body);
  }

  return http.createServer(async (req, res) => {
    try {
      if (checkHost) {
        const h = (req.headers.host || "").replace(/:\d+$/, "");
        if (!LOOPBACK.has(h)) return send(res, 421, "Misdirected request");
      }
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
        return await serveStatic(res, url.pathname);
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return json(res, 404, { error: "Unknown endpoint" });
      // Simple CSRF guard: browsers will not send this custom header cross-origin without a preflight.
      if (req.method !== "GET" && req.headers["x-git-tm"] !== "1") return json(res, 403, { error: "Forbidden" });
      const data = await route(url.searchParams);
      json(res, 200, data);
    } catch (err) {
      const status = err instanceof GitError ? err.status : 500;
      if (status >= 500) console.error(`${req.method} ${req.url}: ${err instanceof GitError ? err.message : err.stack}`);
      if (res.headersSent) res.destroy();
      else json(res, status, { error: err.message || "Internal error" });
    }
  });
}

function required(q, name) {
  const v = q.get(name);
  if (!v) throw new GitError(`Missing parameter: ${name}`, 400);
  return v;
}

function securityHeaders() {
  return {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders() });
  res.end(text);
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  res.end(JSON.stringify(data));
}

/** Listen on the first free port starting at `port`. */
export function listen(server, port, host, attempts = 20) {
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      const onError = (err) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && left > 0) tryPort(p + 1, left - 1);
        else reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server.address().port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, host);
    };
    tryPort(port, attempts);
  });
}
