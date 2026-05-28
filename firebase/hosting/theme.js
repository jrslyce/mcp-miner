(() => {
  const saved = localStorage.getItem("mcp-miner-theme");
  const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved === "light" || saved === "dark" ? saved : (systemDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
})();
