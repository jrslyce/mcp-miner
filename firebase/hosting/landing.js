const THEME_STORAGE_KEY = "mcp-miner-theme";

function preferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return "dark";
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  const themeToggle = document.querySelector("#theme-toggle");
  const themeToggleLabel = document.querySelector("#theme-toggle-label");
  document.documentElement.dataset.theme = nextTheme;
  if (themeToggle && themeToggleLabel) {
    themeToggle.setAttribute("aria-pressed", nextTheme === "dark" ? "true" : "false");
    themeToggle.setAttribute("aria-label", nextTheme === "dark" ? "Use light mode" : "Use dark mode");
    themeToggleLabel.textContent = nextTheme === "dark" ? "Light" : "Dark";
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // Fall through to the selection-based copy path.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-1000px";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) {
    throw new Error("Clipboard permission denied.");
  }
}

function setupPromptCopyButtons(root = document) {
  root.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      if (!target) {
        return;
      }
      const original = button.textContent;
      try {
        await copyTextToClipboard(target.textContent.trim());
        button.textContent = "Copied";
      } catch (_) {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        button.textContent = original;
      }, 1800);
    });
  });
}

function selectOsPrompt(os) {
  document.querySelectorAll("[data-os-card]").forEach((card) => {
    card.hidden = card.dataset.osCard !== os;
  });
  document.querySelectorAll("[data-os-target]").forEach((button) => {
    const selected = button.dataset.osTarget === os;
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function guessedOs() {
  const platform = `${navigator.userAgent || ""} ${navigator.platform || ""}`.toLowerCase();
  if (platform.includes("win")) {
    return "windows";
  }
  if (platform.includes("linux")) {
    return "linux";
  }
  if (platform.includes("mac")) {
    return navigator.maxTouchPoints > 1 ? "mac-silicon" : "mac-silicon";
  }
  return "mac-silicon";
}

document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
});

document.querySelectorAll("[data-os-target]").forEach((button) => {
  button.addEventListener("click", () => {
    selectOsPrompt(button.dataset.osTarget);
  });
});

applyTheme(preferredTheme());
setupPromptCopyButtons();
selectOsPrompt(guessedOs());
