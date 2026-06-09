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
  const clean = decoded === "/"
    ? "/index.html"
    : (decoded === "/portal" || decoded.startsWith("/portal/") || decoded === "/link" || decoded.startsWith("/link/")
        ? "/portal.html"
        : (decoded === "/instructions" || decoded.startsWith("/instructions/") ? "/instructions.html" : decoded));
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

async function assertPortalLayoutRoutes(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/portal.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const overview = await page.evaluate(() => ({
    view: document.body.dataset.dashboardView,
    tab: document.body.dataset.dashboardTab,
    quickStartLabel: document.querySelector("#quick-start-toggle-label")?.textContent?.trim(),
    quickTitle: document.querySelector("#portal-onboarding-title")?.textContent?.trim(),
    hasQuickCharter: Boolean(document.querySelector("#quick-space-user-name")),
    hasQuickCompany: Boolean(document.querySelector("#company-name")),
    hasQuickReferral: Boolean(document.querySelector("#quick-referral-code")),
    hasQuickInstall: Boolean(document.querySelector("#portal-install-prompt")),
    hasQuickLink: Boolean(document.querySelector("#portal-link-prompt")),
    hasDevicesMainTab: Boolean(document.querySelector("[data-dashboard-tab='devices']")),
    hasDevicesMenuLink: Boolean(document.querySelector("[data-menu-page='devices']")),
    mainHidden: getComputedStyle(document.querySelector(".main-board")).display === "none",
    railHidden: getComputedStyle(document.querySelector(".side-rail")).display === "none",
    modeHidden: document.querySelector(".mode-strip")?.hidden,
    mainWidth: document.querySelector(".main-board")?.getBoundingClientRect().width,
    shellWidth: document.querySelector(".dashboard-shell")?.getBoundingClientRect().width
  }));
  await page.click("[data-dashboard-tab='orders']");
  await page.waitForTimeout(100);
  const orders = await page.evaluate(() => ({
    path: window.location.pathname,
    tab: document.body.dataset.dashboardTab,
    modeHidden: document.querySelector(".mode-strip")?.hidden,
    ordersHidden: document.querySelector("[data-panel='orders']")?.hidden
  }));
  await page.goto(`${baseUrl}/portal/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const profile = await page.evaluate(() => ({
    path: window.location.pathname,
    view: document.body.dataset.dashboardView,
    tab: document.body.dataset.dashboardTab,
    mainHidden: getComputedStyle(document.querySelector(".main-board")).display === "none",
    railHidden: getComputedStyle(document.querySelector(".side-rail")).display === "none",
    quickStartHidden: getComputedStyle(document.querySelector("#quick-start")).display === "none",
    tabsHidden: getComputedStyle(document.querySelector(".dashboard-tabs")).display === "none",
    authHidden: document.querySelector("[data-panel='auth']")?.hidden,
    billingHidden: document.querySelector("[data-panel='billing']")?.hidden,
    avatarAccept: document.querySelector("#profile-avatar-input")?.getAttribute("accept"),
    hasAvatarPreview: Boolean(document.querySelector("#profile-avatar-preview-image")),
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  const failures = [];
  if (overview.view !== "game" || overview.tab !== "overview") failures.push(`overview route ${overview.view}/${overview.tab}`);
  if (overview.hasDevicesMainTab || !overview.hasDevicesMenuLink) failures.push("devices should be in the user menu, not the main tabs");
  if (overview.mainHidden || !overview.railHidden) failures.push("overview should show full-width main board only");
  if (overview.modeHidden) failures.push("overview mode strip should be visible");
  if (overview.shellWidth && overview.mainWidth && overview.mainWidth < overview.shellWidth * 0.9) failures.push(`main board too narrow ${overview.mainWidth}/${overview.shellWidth}`);
  if (overview.quickStartLabel !== "Hide") failures.push(`quick start label=${overview.quickStartLabel}`);
  if (overview.quickTitle !== "Launch your mining outfit in five steps.") failures.push(`quick start title=${overview.quickTitle}`);
  if (!overview.hasQuickCharter || !overview.hasQuickCompany || !overview.hasQuickReferral || !overview.hasQuickInstall || !overview.hasQuickLink) {
    failures.push("quick start five-step controls missing");
  }
  if (orders.path !== "/portal/orders" || orders.tab !== "orders") failures.push(`orders route ${orders.path}/${orders.tab}`);
  if (!orders.modeHidden || orders.ordersHidden) failures.push("orders should hide overview summary and show orders");
  if (profile.path !== "/portal/profile" || profile.view !== "account" || profile.tab !== "profile") failures.push(`profile route ${profile.path}/${profile.view}/${profile.tab}`);
  if (!profile.quickStartHidden || !profile.tabsHidden) failures.push("profile route should hide quick start and secondary portal nav");
  if (!profile.mainHidden || profile.railHidden || profile.authHidden || !profile.billingHidden) failures.push("profile route should show account page full width");
  if (profile.avatarAccept !== "image/png,image/jpeg,image/webp" || !profile.hasAvatarPreview) failures.push("profile avatar upload controls missing");
  if (profile.bodyWidth > profile.viewportWidth + 2) failures.push(`profile horizontal overflow ${profile.bodyWidth}/${profile.viewportWidth}`);
  if (failures.length) {
    throw new Error(`portal route layout failed: ${failures.join("; ")}`);
  }
  return { overview, orders, profile };
}

async function assertInstructionsRoute(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/instructions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    path: window.location.pathname,
    title: document.querySelector("h1")?.textContent?.trim(),
    hasSuit: document.body.innerText.includes("Suit %"),
    hasSync: document.body.innerText.includes("What sync sends"),
    artCount: document.querySelectorAll(".generated-topic-art svg").length,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  const failures = [];
  if (state.path !== "/instructions") failures.push(`instructions path=${state.path}`);
  if (state.title !== "MCP Miner Instructions") failures.push(`instructions title=${state.title}`);
  if (!state.hasSuit || !state.hasSync) failures.push("instructions content missing core gameplay/sync sections");
  if (state.artCount < 4) failures.push(`instructions generated art count=${state.artCount}`);
  if (state.bodyWidth > state.viewportWidth + 2) failures.push(`instructions horizontal overflow ${state.bodyWidth}/${state.viewportWidth}`);
  if (failures.length) {
    throw new Error(`instructions route failed: ${failures.join("; ")}`);
  }
  return state;
}

async function assertDeviceLinkRoutes(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/portal/devices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const devices = await page.evaluate(() => ({
    path: window.location.pathname,
    tab: document.body.dataset.dashboardTab,
    linkMode: document.body.dataset.linkMode,
    linkHidden: document.querySelector("[data-panel='device-link']")?.hidden,
    linkedDevicesHidden: document.querySelector("[data-panel='linked-devices']")?.hidden,
    code: document.querySelector("#device-link-code")?.textContent?.trim(),
    summary: document.querySelector("#device-link-summary")?.textContent?.trim()
  }));
  await page.goto(`${baseUrl}/link?linkCode=ABCD-1234&sessionId=link_ABCDEFGHIJKLMNOPQRST`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const link = await page.evaluate(() => ({
    path: window.location.pathname,
    tab: document.body.dataset.dashboardTab,
    linkMode: document.body.dataset.linkMode,
    linkHidden: document.querySelector("[data-panel='device-link']")?.hidden,
    code: document.querySelector("#device-link-code")?.textContent?.trim(),
    summary: document.querySelector("#device-link-summary")?.textContent?.trim()
  }));
  await page.goto(`${baseUrl}/portal/devices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const recovered = await page.evaluate(() => ({
    path: window.location.pathname,
    tab: document.body.dataset.dashboardTab,
    linkMode: document.body.dataset.linkMode,
    linkHidden: document.querySelector("[data-panel='device-link']")?.hidden,
    code: document.querySelector("#device-link-code")?.textContent?.trim()
  }));
  const failures = [];
  if (devices.path !== "/portal/devices" || devices.tab !== "devices") failures.push(`devices route ${devices.path}/${devices.tab}`);
  if (devices.linkMode !== "dashboard" || devices.linkHidden !== true) failures.push(`plain devices exposed link panel ${devices.linkMode}/${devices.linkHidden}/${devices.summary}`);
  if (devices.linkedDevicesHidden) failures.push("plain devices should show linked devices panel");
  if (devices.code !== "-") failures.push(`plain devices code=${devices.code}`);
  if (link.path !== "/link" || link.tab !== "devices" || link.linkMode !== "pending") failures.push(`link route ${link.path}/${link.tab}/${link.linkMode}`);
  if (link.linkHidden || link.code !== "ABCD-1234") failures.push(`link panel hidden/code ${link.linkHidden}/${link.code}`);
  if (!/sign in/i.test(link.summary)) failures.push(`link summary=${link.summary}`);
  if (recovered.linkMode !== "pending" || recovered.linkHidden || recovered.code !== "ABCD-1234") failures.push(`recovered link ${recovered.linkMode}/${recovered.linkHidden}/${recovered.code}`);
  if (failures.length) {
    throw new Error(`device link route layout failed: ${failures.join("; ")}`);
  }
  return { devices, link, recovered };
}

async function main() {
  const { server, url } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const desktop = await assertPortalState(page, url, { width: 1280, height: 900 });
    const mobile = await assertPortalState(page, url, { width: 390, height: 844 });
    const routes = await assertPortalLayoutRoutes(page, url);
    const deviceRoutes = await assertDeviceLinkRoutes(page, url);
    const instructions = await assertInstructionsRoute(page, url);
    console.log(JSON.stringify({
      ok: true,
      checks: 5,
      desktop: {
        connection: desktop.connection,
        source: desktop.source
      },
      mobile: {
        connection: mobile.connection,
        source: mobile.source
      },
      routes: {
        overview: routes.overview.tab,
        ordersPath: routes.orders.path,
        profileView: routes.profile.view,
        devicesLinkHidden: deviceRoutes.devices.linkHidden,
        recoveredLinkCode: deviceRoutes.recovered.code,
        instructionsArt: instructions.artCount
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
