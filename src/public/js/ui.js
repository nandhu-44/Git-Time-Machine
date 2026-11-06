// Shared helpers: API access, escaping, formatting, avatars, toasts.

export const WORKTREE = "WORKTREE";

const avatarMap = Object.create(null);

export async function api(path, params = {}, { method = "GET" } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== false) qs.set(k, v === true ? "1" : String(v));
  }
  const query = qs.toString();
  const url = `/api/${path}${query ? `?${query}` : ""}`;
  let res;
  try {
    res = await fetch(url, { method, headers: method === "GET" ? {} : { "x-git-tm": "1" } });
  } catch {
    // No HTTP response at all: the git-tm process is not running (or was restarted elsewhere).
    window.dispatchEvent(new Event("gtm-offline"));
    throw Object.assign(new Error("Can't reach the git-tm server. Is it still running in your terminal?"), { offline: true });
  }
  window.dispatchEvent(new Event("gtm-online"));
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  if (data && data.avatars) Object.assign(avatarMap, data.avatars);
  return data;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ESC[ch]);

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Raw(out);
}
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === false || v === null || v === undefined) return "";
  return esc(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const short = (hash) => (hash === WORKTREE ? "working tree" : String(hash).slice(0, 7));

// ------------------------------------------------------------------ dates

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const df = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function relTime(sec) {
  const diff = sec - Date.now() / 1000;
  const abs = Math.abs(diff);
  const units = [
    [60, "second", 1],
    [3600, "minute", 60],
    [86400, "hour", 3600],
    [604800, "day", 86400],
    [2629800, "week", 604800],
    [31557600, "month", 2629800],
    [Infinity, "year", 31557600],
  ];
  for (const [limit, unit, div] of units) {
    if (abs < limit) return rtf.format(Math.round(diff / div), unit);
  }
}
export const fullDate = (sec) => dtf.format(new Date(sec * 1000));
export const dayDate = (sec) => df.format(new Date(sec * 1000));

export function plural(n, word, pluralWord = word + "s") {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

export function bytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ------------------------------------------------------------------ avatars

function hue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function initials(name) {
  const parts = String(name || "?").trim().split(/[\s._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2);
  return s.toUpperCase();
}

/** Initials are always rendered; a remote image (if enabled) covers them once it loads. */
export function avatar(name, email, size = 20) {
  const url = email ? avatarMap[email] : null;
  return html`<span class="avatar" style="--av-h:${hue((email || name || "").toLowerCase())};--av-s:${size}px" aria-hidden="true">${initials(name)}${
    url ? html`<img src="${url}" alt="" loading="lazy" decoding="async">` : ""
  }</span>`;
}

// A failed avatar image is simply removed, revealing the initials underneath.
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.parentElement?.classList.contains("avatar")) e.target.remove();
  },
  true,
);

// ------------------------------------------------------------------ refs

export function refBadges(refs, { max = 4 } = {}) {
  if (!refs || !refs.length) return "";
  const order = { head: 0, detached: 0, branch: 1, remote: 2, tag: 3 };
  const sorted = [...refs].sort((a, b) => order[a.type] - order[b.type]);
  const shown = sorted.slice(0, max);
  const extra = sorted.length - shown.length;
  return html`<span class="refs">${shown.map(
    (r) => html`<span class="ref ref-${r.type}" title="${r.name}">${
      r.type === "tag" ? raw(icons.tag) : r.type === "head" ? raw(icons.head) : ""
    }${r.name}</span>`,
  )}${extra > 0 ? html`<span class="ref ref-more" title="${sorted.slice(max).map((r) => r.name).join(", ")}">+${extra}</span>` : ""}</span>`;
}

export const icons = {
  tag: '<svg viewBox="0 0 16 16" class="i"><path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/></svg>',
  head: '<svg viewBox="0 0 16 16" class="i"><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>',
  branch: '<svg viewBox="0 0 16 16" class="i"><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5" r="1.5"/><path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5"/></svg>',
  remote: '<svg viewBox="0 0 16 16" class="i"><path d="M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.8 1A2.5 2.5 0 0 0 4.5 12.5z"/></svg>',
  folder: '<svg viewBox="0 0 16 16" class="i"><path d="M2 4.5v8h12v-7H8L6.5 4H2z"/></svg>',
  file: '<svg viewBox="0 0 16 16" class="i"><path d="M4 2h5l3 3v9H4z M9 2v3h3"/></svg>',
  module: '<svg viewBox="0 0 16 16" class="i"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M6 8h4"/></svg>',
  copy: '<svg viewBox="0 0 16 16" class="i"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-3h-8v8h3"/></svg>',
  close: '<svg viewBox="0 0 16 16" class="i"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" class="i chev"><path d="M6 4l4 4-4 4"/></svg>',
  swap: '<svg viewBox="0 0 16 16" class="i"><path d="M3 5.5h10l-3-3M13 10.5H3l3 3"/></svg>',
  external: '<svg viewBox="0 0 16 16" class="i"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5"/></svg>',
  history: '<svg viewBox="0 0 16 16" class="i"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.7"/><path d="M2.5 2.5v3.2h3.2M8 5v3.2l2 1.3"/></svg>',
  compare: '<svg viewBox="0 0 16 16" class="i"><circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5V10a2 2 0 0 0 2 2h4M12 10.5V6a2 2 0 0 0-2-2H6"/></svg>',
  dot: '<svg viewBox="0 0 16 16" class="i"><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>',
};

// ------------------------------------------------------------------ toasts

export function toast(message, type = "info", ms = 3500) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.textContent = message;
  box.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 250);
  }, ms);
}

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, "success", 1500);
  } catch {
    toast("Clipboard not available", "error");
  }
}

export function loading(label = "Loading") {
  return html`<div class="loading" role="status"><span class="spinner"></span>${label}</div>`;
}

export function empty(title, detail = "") {
  return html`<div class="empty"><strong>${title}</strong>${detail ? html`<span>${detail}</span>` : ""}</div>`;
}

export function errorBox(err) {
  return html`<div class="empty error"><strong>Something went wrong</strong><span>${err?.message || err}</span></div>`;
}

export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`gtm-${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`gtm-${key}`, JSON.stringify(value));
    } catch {}
  },
};
