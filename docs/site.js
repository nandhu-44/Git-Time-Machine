// Theme toggle, copy buttons and table-of-contents highlighting. No dependencies.

(function () {
  const root = document.documentElement;

  // Theme: follow the system unless the visitor picked one.
  try {
    const saved = localStorage.getItem("gtm-docs-theme");
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch {}

  document.addEventListener("DOMContentLoaded", () => {
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
