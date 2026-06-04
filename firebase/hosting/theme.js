(() => {
  const saved = localStorage.getItem("mcp-miner-theme");
  const theme = saved === "light" || saved === "dark" ? saved : "dark";
  document.documentElement.dataset.theme = theme;
})();
