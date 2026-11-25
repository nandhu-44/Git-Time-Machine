// Theme toggle, syntax colours, copy buttons and table-of-contents highlighting. No dependencies.

(function () {
  const root = document.documentElement;

  // Theme: follow the system unless the visitor picked one.
  try {
    const saved = localStorage.getItem("gtm-docs-theme");
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch {}


  // Syntax colours for <code class="language-js|bash"> blocks.
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const tok = (cls, s) => `<span class="tok-${cls}">${esc(s)}</span>`;
  const JS = new RegExp(
    [
      /(\/\/[^\n]*)/, // comment
      /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/, // string
      /\b(import|from|export|const|let|var|await|async|for|of|in|new|return|if|else|function|try|catch|throw|class)\b/, // keyword
      /\b(\d+(?:\.\d+)?)\b/, // number
      /([A-Za-z_$][\w$]*)(?=\()/, // function call
    ]
      .map((r) => r.source)
      .join("|"),
    "g",
  );
  const highlightJs = (src) => {
    let out = "";
    let last = 0;
    for (const m of src.matchAll(JS)) {
      const [text, com, str, kw, num] = m;
      out += esc(src.slice(last, m.index));
      last = m.index + text.length;
      if (com) out += tok("comment", text);
      else if (str && text[0] === "`") {
        // Colour ${...} inside template literals as code.
        out += text
          .split(/(\$\{[^}]*\})/)
          .map((part) => (part.startsWith("${") ? tok("punct", "${") + highlightJs(part.slice(2, -1)) + tok("punct", "}") : part && tok("string", part)))
          .join("");
      } else if (str) out += tok("string", text);
      else if (kw) out += tok("keyword", text);
      else if (num) out += tok("number", text);
      else out += tok("function", text);
    }
    return out + esc(src.slice(last));
  };
  const highlightBash = (src) =>
    src
      .split("\n")
      .map((line) => {
        let first = true;
        return line.replace(/(#.*$)|("(?:\\.|[^"\\])*"|'[^']*')|(\s)(--?[\w-]+)|(\S+)/g, (m, com, str, sp, flag, word) => {
          if (com) return tok("comment", m);
          if (str) return tok("string", m);
          if (flag) return sp + tok("number", flag);
          if (first) {
            first = false;
            return tok("function", word);
          }
          return esc(word);
        });
      })
      .join("\n");

  // Tap an image to view it full screen, where it can be pinched, dragged,
  // double-tapped or scrolled to zoom. Tap outside it, the close button or Esc to close.
  function lightbox(images) {
    if (!images.length || typeof HTMLDialogElement === "undefined") return;
    const dlg = document.createElement("dialog");
    dlg.className = "lightbox";
    dlg.innerHTML = '<button class="lightbox-close" type="button" aria-label="Close">&times;</button><img alt="" draggable="false" />';
    document.body.append(dlg);
    const big = dlg.querySelector("img");
    big.tabIndex = -1; // focused on open, so the close button shows no focus ring
    let scale = 1;
    let x = 0;
    let y = 0;
    const apply = () => (big.style.transform = `translate(${x}px, ${y}px) scale(${scale})`);
    const zoomTo = (s, cx = 0, cy = 0) => {
      // Keep the point under (cx, cy), relative to the image centre, in place.
      const next = Math.min(5, Math.max(1, s));
      x = cx - ((cx - x) * next) / scale;
      y = cy - ((cy - y) * next) / scale;
      scale = next;
      if (scale === 1) x = y = 0;
      apply();
    };
    const centre = (px, py) => {
      const r = dlg.getBoundingClientRect();
      return [px - r.width / 2, py - r.height / 2];
    };

    for (const img of images) {
      img.classList.add("zoomable");
      img.addEventListener("click", () => {
        big.src = img.currentSrc || img.src;
        big.alt = img.alt;
        scale = 1;
        x = y = 0;
        apply();
        dlg.showModal();
        big.focus({ preventScroll: true });
      });
    }
    dlg.querySelector(".lightbox-close").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });

    const pointers = new Map();
    let gesture = null;
    let lastTap = 0;
    const begin = () => {
      const p = [...pointers.values()];
      if (p.length >= 2) {
        const [a, b] = p;
        gesture = { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), scale, mid: centre((a.x + b.x) / 2, (a.y + b.y) / 2) };
      } else if (p.length === 1) {
        gesture = { pinch: false, px: p[0].x, py: p[0].y, x, y };
      } else gesture = null;
    };
    big.addEventListener("pointerdown", (e) => {
      big.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      begin();
    });
    big.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = [...pointers.values()];
      if (gesture.pinch && p.length >= 2) {
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        zoomTo((gesture.scale * d) / gesture.dist, ...gesture.mid);
      } else if (!gesture.pinch && scale > 1) {
        x = gesture.x + e.clientX - gesture.px;
        y = gesture.y + e.clientY - gesture.py;
        apply();
      }
    });
    const end = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (e.type === "pointerup" && pointers.size === 0 && gesture && !gesture.pinch) {
        const moved = Math.abs(e.clientX - gesture.px) + Math.abs(e.clientY - gesture.py) > 10;
        const now = Date.now();
        if (!moved && now - lastTap < 300) {
          zoomTo(scale > 1 ? 1 : 2.5, ...centre(e.clientX, e.clientY));
          lastTap = 0;
        } else if (!moved) lastTap = now;
      }
      begin();
    };
    big.addEventListener("pointerup", end);
    big.addEventListener("pointercancel", end);
    dlg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), ...centre(e.clientX, e.clientY));
      },
      { passive: false },
    );
  }

  function highlight() {
    for (const code of document.querySelectorAll("pre code[class*='language-']")) {
      const text = code.textContent;
      if (code.classList.contains("language-js")) code.innerHTML = highlightJs(text);
      else if (code.classList.contains("language-bash")) code.innerHTML = highlightBash(text);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    highlight();

    // Respect reduced motion: show the demo's poster instead of playing it.
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const v of document.querySelectorAll("video[autoplay]")) {
      if (reduceMotion) {
        v.pause();
        v.controls = true;
      } else if (v.paused) {
        // Some mobile browsers skip autoplay; the video is muted, so starting it is allowed.
        v.play().catch(() => {});
      }
    }

    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
        try {
          localStorage.setItem("gtm-docs-theme", root.dataset.theme);
        } catch {}
      });
    }

    // Copy buttons on code blocks and the install box.
    const copy = async (text, btn) => {
      try {
        await navigator.clipboard.writeText(text);
        const label = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("done");
        setTimeout(() => {
          btn.textContent = label;
          btn.classList.remove("done");
        }, 1400);
      } catch {}
    };
    for (const pre of document.querySelectorAll("pre")) {
      const btn = document.createElement("button");
      btn.className = "copy";
      btn.type = "button";
      btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code") || pre;
        const text = [...code.childNodes]
          .filter((n) => !(n.classList && n.classList.contains("comment")))
          .map((n) => n.textContent)
          .join("")
          .replace(/[ \t]+$/gm, "")
          .trim();
        copy(text, btn);
      });
      pre.append(btn);
    }
    lightbox(document.querySelectorAll(".content img, .split img"));

    for (const btn of document.querySelectorAll("[data-copy]")) {
      btn.addEventListener("click", () => copy(btn.dataset.copy, btn));
    }

    // Anchor links on guide headings.
    for (const h of document.querySelectorAll(".content h2[id], .content h3[id]")) {
      const a = document.createElement("a");
      a.className = "anchor";
      a.href = `#${h.id}`;
      a.textContent = "#";
      a.setAttribute("aria-label", `Link to ${h.textContent}`);
      h.append(a);
    }

    // Highlight the current section in the table of contents.
    const links = new Map([...document.querySelectorAll(".toc a")].map((a) => [a.getAttribute("href").slice(1), a]));
    if (links.size && "IntersectionObserver" in window) {
      const visible = new Set();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
          const first = [...links.keys()].find((id) => visible.has(id));
          if (!first) return;
          for (const [id, a] of links) a.classList.toggle("active", id === first);
        },
        { rootMargin: "-80px 0px -65% 0px" },
      );
      for (const id of links.keys()) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      }
    }
  });
})();
