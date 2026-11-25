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
