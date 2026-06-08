"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const HOSTING_ROOT = path.join(ROOT, "firebase", "hosting");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function staticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?", 1)[0]);
  const clean = decoded === "/" ? "/index.html" : decoded;
  const target = path.normalize(path.join(HOSTING_ROOT, clean));
  if (!target.startsWith(HOSTING_ROOT)) {
    return null;
  }
  return target;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const target = staticPath(request.url || "/");
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(target)] || "application/octet-stream"
    });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

async function assertPortalState(page, baseUrl, viewport) {
  await page.setViewportSize(viewport);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.goto(`${baseUrl}/portal.html?login=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    title: document.title,
    connection: document.querySelector("#connection-pill")?.textContent?.trim(),
    authStatus: document.querySelector("#auth-status")?.textContent?.trim(),
    profileStatus: document.querySelector("#profile-status")?.textContent?.trim(),
    source: document.querySelector("#dashboard-source")?.textContent?.trim(),
    userMenuHidden: document.querySelector("#user-menu-wrapper")?.hidden,
    bodyTab: document.body.dataset.dashboardTab,
    authVisible: !document.querySelector("[data-panel='auth']")?.hidden,
    hasRawUidLabel: document.body.innerText.includes("UID"),
    hasDemoSnapshot: document.body.innerText.includes("Demo snapshot"),
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth
  }));

  const failures = [];
  if (state.connection !== "Signed out") failures.push(`connection=${state.connection}`);
  if (state.authStatus !== "Signed out") failures.push(`authStatus=${state.authStatus}`);
  if (state.profileStatus !== "Sign in required") failures.push(`profileStatus=${state.profileStatus}`);
  if (state.source !== "No account loaded") failures.push(`source=${state.source}`);
  if (state.userMenuHidden !== true) failures.push("signed-out user menu is visible");
  if (!state.authVisible) failures.push("auth panel is hidden");
  if (state.hasRawUidLabel) failures.push("raw UID label rendered");
  if (state.hasDemoSnapshot) failures.push("signed-out page rendered demo snapshot copy");
  if (state.bodyWidth > state.viewportWidth + 2) failures.push(`horizontal overflow ${state.bodyWidth}/${state.viewportWidth}`);
  if (errors.length) failures.push(`browser errors: ${errors.join(" | ")}`);
  if (failures.length) {
    throw new Error(`portal smoke failed at ${viewport.width}x${viewport.height}: ${failures.join("; ")}`);
  }
  return state;
}

async function main() {
  const { server, url } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const desktop = await assertPortalState(page, url, { width: 1280, height: 900 });
    const mobile = await assertPortalState(page, url, { width: 390, height: 844 });
    console.log(JSON.stringify({
      ok: true,
      checks: 2,
      desktop: {
        connection: desktop.connection,
        source: desktop.source
      },
      mobile: {
        connection: mobile.connection,
        source: mobile.source
      }
    }, null, 2));
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
