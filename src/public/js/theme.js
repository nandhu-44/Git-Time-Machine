// Runs before first paint so the page never flashes the wrong theme.
try {
  const t = localStorage.getItem("gtm-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {}
