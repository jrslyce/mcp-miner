import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-functions.js";

const firebaseConfig = window.MCP_MINER_FIREBASE_CONFIG || {
  apiKey: "demo-api-key",
  authDomain: "demo-mcp-miner.firebaseapp.com",
  projectId: "demo-mcp-miner",
  appId: "1:000000000000:web:mcpminerlocal"
};

const DEMO_DASHBOARD = {
  mode: "Signed-out demo",
  source: "Local demo snapshot",
  profile: {
    displayName: "Local Prospector",
    minerName: "Chonk Runner"
  },
  player: {
    spaceBucks: 1240,
    suitCondition: 96
  },
  settings: {
    reportMode: "meaningful_turns_only",
    cloudSyncEnabled: false
  },
  cloudState: {
    eventCount: 18,
    workScoreTotal: 842,
    lastSequence: 18,
    lastEventId: "evt_demo_018",
    updatedAt: "Demo snapshot"
  },
  syncMetadata: {
    lastSequence: 18,
    conflictState: "none",
    acceptedCount: 18,
    duplicateCount: 0,
    rejectedCount: 0
  },
  inventory: [
    { materialId: "mat_chonks", displayName: "Chonks", category: "core", quantity: 1840, totalSpaceBucks: 0 },
    { materialId: "mat_iron", displayName: "Iron", category: "ore", quantity: 64, totalSpaceBucks: 128 },
    { materialId: "mat_quartz", displayName: "Quartz", category: "gem", quantity: 9, totalSpaceBucks: 225 },
    { materialId: "refined:mat_nickel", displayName: "Refined Nickel", category: "refined", quantity: 12, totalSpaceBucks: 180 }
  ],
  orders: [
    { orderId: "order_demo_1", buyerName: "Noodle Rock Canteen", productName: "Quartz lens batch", rewardSpaceBucks: 320, canFulfill: true, missingMaterials: {} },
    { orderId: "order_demo_2", buyerName: "Orbital Tool Shed", productName: "Refined nickel spool", rewardSpaceBucks: 210, canFulfill: false, missingMaterials: { "refined:mat_nickel": 4 } }
  ],
  asteroid: {
    displayName: "A-17 Noodle Rock",
    mined: 840,
    depletionSize: 1200,
    percentComplete: 70,
    rareFindChance: "3.5%"
  },
  upgrades: [
    { upgradeId: "upgrade_drill_power", displayName: "Drill Power", level: 2, maxLevel: 5, effect: "1.35x mining", nextEffect: "1.55x mining" },
    { upgradeId: "upgrade_scanner_precision", displayName: "Scanner Precision", level: 1, maxLevel: 5, effect: "+2% rare find", nextEffect: "+3% rare find" },
    { upgradeId: "upgrade_suit_plating", displayName: "Suit Plating", level: 1, maxLevel: 5, effect: "8% hazard reduction", nextEffect: "14% hazard reduction" }
  ],
  reports: [
    "Mined 64 Chonks and mapped a quartz pocket.",
    "Order board has one fulfillable buyer request.",
    "Cloud sync remains optional; shared state is abstract."
  ],
  base: {
    moduleCount: 2,
    droneLevel: 1,
    storageBonus: "1.10x"
  }
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const useEmulators = localHostnames.has(window.location.hostname) || window.location.hostname.endsWith(".local");

if (useEmulators && !window.__MCP_MINER_EMULATORS_CONNECTED) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  window.__MCP_MINER_EMULATORS_CONNECTED = true;
}

const form = document.querySelector("#auth-form");
const email = document.querySelector("#email");
const password = document.querySelector("#password");
const createAccount = document.querySelector("#create-account");
const signOutButton = document.querySelector("#sign-out");
const refreshDashboard = document.querySelector("#refresh-dashboard");
const authStatus = document.querySelector("#auth-status");
const authUid = document.querySelector("#auth-uid");
const profileStatus = document.querySelector("#profile-status");
const dashboardSource = document.querySelector("#dashboard-source");
const message = document.querySelector("#auth-message");
const connectionPill = document.querySelector("#connection-pill");
const dashboardMode = document.querySelector("#dashboard-mode");
const lastUpdated = document.querySelector("#last-updated");
const metricSpaceBucks = document.querySelector("#metric-space-bucks");
const metricChonks = document.querySelector("#metric-chonks");
const metricSuit = document.querySelector("#metric-suit");
const metricEvents = document.querySelector("#metric-events");
const syncStatus = document.querySelector("#sync-status");
const syncEvents = document.querySelector("#sync-events");
const syncSequence = document.querySelector("#sync-sequence");
const syncConflicts = document.querySelector("#sync-conflicts");
const privacyList = document.querySelector("#privacy-list");
const asteroidName = document.querySelector("#asteroid-name");
const asteroidProgressLabel = document.querySelector("#asteroid-progress-label");
const asteroidProgressPercent = document.querySelector("#asteroid-progress-percent");
const asteroidProgressFill = document.querySelector("#asteroid-progress-fill");
const progressTrack = document.querySelector(".progress-track");
const cloudDetail = document.querySelector("#cloud-detail");
const inventoryList = document.querySelector("#inventory-list");
const ordersList = document.querySelector("#orders-list");
const upgradesList = document.querySelector("#upgrades-list");
const reportsList = document.querySelector("#reports-list");
const baseDetail = document.querySelector("#base-detail");

let currentUser = null;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#9a3412" : "#1f7a5a";
}

function cloneDemo(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...DEMO_DASHBOARD, ...overrides }));
}

function profilePayload(user) {
  const displayName = user.displayName || "Local Prospector";
  return {
    ownerUid: user.uid,
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    privacyClass: "abstract",
    displayName,
    minerName: displayName,
    cloudSyncEnabled: true,
    accountLinkedAt: serverTimestamp()
  };
}

async function ensureLinkedProfile(user) {
  const playerRef = doc(db, "players", user.uid);
  const profileRef = doc(db, "players", user.uid, "profile", "current");
  const settingsRef = doc(db, "players", user.uid, "settings", "current");
  const existing = await getDoc(playerRef);

  if (!existing.exists()) {
    await setDoc(playerRef, profilePayload(user));
  } else {
    await setDoc(playerRef, {
      ownerUid: user.uid,
      updatedAt: serverTimestamp(),
      privacyClass: "abstract",
      cloudSyncEnabled: true
    }, { merge: true });
  }

  await setDoc(profileRef, {
    ownerUid: user.uid,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
    privacyClass: "abstract",
    displayName: user.displayName || "Local Prospector",
    minerName: user.displayName || "Prospector"
  }, { merge: true });

  await setDoc(settingsRef, {
    ownerUid: user.uid,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
    privacyClass: "abstract",
    reportMode: "meaningful_turns_only",
    cloudSyncEnabled: true
  }, { merge: true });

  return existing.exists() ? "Loaded" : "Created";
}

async function handleAuth(fn) {
  try {
    setMessage("");
    await fn();
  } catch (error) {
    setMessage(error.message || "Authentication failed.", true);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(numberValue(value));
}

function formatPercent(value) {
  return `${Math.round(numberValue(value))}%`;
}

function timestampLabel(value) {
  if (!value) {
    return "Ready";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value.toDate) {
    return value.toDate().toLocaleString();
  }
  return String(value);
}

function displayNameFromId(id) {
  return String(id || "Unknown")
    .replace(/^refined:/, "Refined ")
    .replace(/^mat_/, "")
    .replace(/^upgrade_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function materialQuantity(items, materialId) {
  const item = items.find((candidate) => candidate.materialId === materialId);
  return item ? item.quantity : 0;
}

function normalizeInventoryRows(snapshot, state) {
  const rows = [];
  snapshot.forEach((entry) => {
    const data = entry.data();
    if (Array.isArray(data.items)) {
      data.items.forEach((item) => rows.push(normalizeInventoryItem(item, entry.id)));
      return;
    }
    if (data.materialId || data.material_id || data.quantity !== undefined) {
      rows.push(normalizeInventoryItem(data, entry.id));
      return;
    }
    Object.entries(data).forEach(([key, value]) => {
      if (typeof value === "number" && value > 0) {
        rows.push(normalizeInventoryItem({ materialId: key, quantity: value }, entry.id));
      }
    });
  });

  if (!rows.length && state && state.inventory && typeof state.inventory === "object") {
    Object.entries(state.inventory).forEach(([key, value]) => {
      if (typeof value === "number" && value > 0) {
        rows.push(normalizeInventoryItem({ materialId: key, quantity: value }, "state"));
      }
    });
  }

  return rows.sort((a, b) => b.quantity - a.quantity).slice(0, 8);
}

function normalizeInventoryItem(item, bucket) {
  const materialId = item.materialId || item.material_id || item.id || bucket;
  const quantity = numberValue(item.quantity || item.count || item.amount);
  const displayName = item.displayName || item.display_name || displayNameFromId(materialId);
  return {
    materialId,
    displayName,
    category: item.category || item.rarity || "material",
    quantity,
    totalSpaceBucks: numberValue(item.totalSpaceBucks || item.total_space_bucks || item.total_raw_space_bucks)
  };
}

function normalizeOrderRows(snapshot) {
  const rows = [];
  snapshot.forEach((entry) => {
    const data = entry.data();
    rows.push({
      orderId: data.orderId || data.order_id || entry.id,
      buyerName: data.buyerName || data.buyer_name || data.customer || "Buyer",
      productName: data.productName || data.product_name || data.recipeName || data.recipe_id || "Material order",
      rewardSpaceBucks: numberValue(data.rewardSpaceBucks || data.reward_space_bucks || data.payout || data.space_bucks),
      canFulfill: Boolean(data.canFulfill || data.can_fulfill),
      missingMaterials: data.missingMaterials || data.missing_materials || {}
    });
  });
  return rows.slice(0, 6);
}

function normalizeUpgradeRows(data) {
  if (!data) {
    return [];
  }
  if (Array.isArray(data.items)) {
    return data.items.map(normalizeUpgradeItem);
  }
  if (Array.isArray(data.upgrades)) {
    return data.upgrades.map(normalizeUpgradeItem);
  }
  const levels = data.levels || data;
  return Object.entries(levels)
    .filter(([, value]) => typeof value === "number")
    .map(([upgradeId, level]) => normalizeUpgradeItem({ upgradeId, level }));
}

function normalizeUpgradeItem(item) {
  const upgradeId = item.upgradeId || item.upgrade_id || item.id;
  return {
    upgradeId,
    displayName: item.displayName || item.display_name || displayNameFromId(upgradeId),
    level: numberValue(item.level),
    maxLevel: numberValue(item.maxLevel || item.max_level, 5),
    effect: item.effect || item.currentEffect || item.current_effect || "Active",
    nextEffect: item.nextEffect || item.next_effect || ""
  };
}

function normalizeAsteroid(state) {
  const progress = state && (state.asteroidProgress || state.asteroid_progress || state.currentAsteroid || state.current_asteroid);
  const mined = numberValue(progress && (progress.mined || progress.minedUnits));
  const depletionSize = numberValue(progress && (progress.depletionSize || progress.depletion_size), mined || 1);
  const percentComplete = depletionSize > 0 ? Math.min(100, Math.round((mined / depletionSize) * 100)) : 0;
  const currentAsteroid = state && (state.currentAsteroid || state.current_asteroid);
  return {
    displayName: (currentAsteroid && (currentAsteroid.displayName || currentAsteroid.display_name)) || "Cloud asteroid",
    mined,
    depletionSize,
    percentComplete,
    rareFindChance: state && state.rareFindChance
  };
}

function docsData(results, index) {
  const result = results[index];
  if (!result || result.status !== "fulfilled") {
    return null;
  }
  return result.value.exists() ? result.value.data() : null;
}

function queryResult(results, index) {
  const result = results[index];
  if (!result || result.status !== "fulfilled") {
    return null;
  }
  return result.value;
}

async function loadDashboardForUser(user) {
  const getSyncState = httpsCallable(functions, "getSyncState");
  const reads = await Promise.allSettled([
    getDoc(doc(db, "players", user.uid)),
    getDoc(doc(db, "players", user.uid, "profile", "current")),
    getDoc(doc(db, "players", user.uid, "settings", "current")),
    getDoc(doc(db, "players", user.uid, "gameState", "current")),
    getDoc(doc(db, "players", user.uid, "syncMetadata", "default")),
    getDoc(doc(db, "players", user.uid, "upgrades", "current")),
    getDoc(doc(db, "players", user.uid, "base", "current")),
    getDocs(query(collection(db, "players", user.uid, "inventory"), limit(12))),
    getDocs(query(collection(db, "players", user.uid, "orders"), limit(8))),
    getSyncState({})
  ]);

  const player = docsData(reads, 0) || {};
  const profile = docsData(reads, 1) || {};
  const settings = docsData(reads, 2) || {};
  const directState = docsData(reads, 3) || {};
  const directSync = docsData(reads, 4) || {};
  const callable = reads[9] && reads[9].status === "fulfilled" ? reads[9].value.data : {};
  const cloudState = callable.state || directState;
  const syncMetadata = callable.syncMetadata || directSync;
  const inventory = normalizeInventoryRows(queryResult(reads, 7) || { forEach() {} }, cloudState);
  const orders = normalizeOrderRows(queryResult(reads, 8) || { forEach() {} });
  const upgrades = normalizeUpgradeRows(docsData(reads, 5));
  const base = docsData(reads, 6) || {};
  const hasCloudEconomy = inventory.length || orders.length || upgrades.length || cloudState.spaceBucks !== undefined;
  const fallback = cloneDemo({
    mode: "Firebase profile",
    source: hasCloudEconomy ? "Firebase owner data" : "Firebase profile plus demo economy preview"
  });

  fallback.profile = { ...fallback.profile, ...profile, ...player };
  fallback.player = {
    ...fallback.player,
    spaceBucks: numberValue(cloudState.spaceBucks || cloudState.space_bucks, fallback.player.spaceBucks),
    suitCondition: numberValue(cloudState.suitCondition || cloudState.suit_condition, fallback.player.suitCondition)
  };
  fallback.settings = { ...fallback.settings, ...settings, cloudSyncEnabled: settings.cloudSyncEnabled ?? player.cloudSyncEnabled ?? true };
  fallback.cloudState = { ...fallback.cloudState, ...cloudState };
  fallback.syncMetadata = { ...fallback.syncMetadata, ...syncMetadata };
  fallback.inventory = inventory.length ? inventory : fallback.inventory;
  fallback.orders = orders.length ? orders : fallback.orders;
  fallback.asteroid = cloudState.asteroidProgress || cloudState.asteroid_progress || cloudState.currentAsteroid || cloudState.current_asteroid ? normalizeAsteroid(cloudState) : fallback.asteroid;
  fallback.upgrades = upgrades.length ? upgrades : fallback.upgrades;
  fallback.base = { ...fallback.base, ...base };
  fallback.reports = Array.isArray(cloudState.reports) && cloudState.reports.length ? cloudState.reports.slice(0, 5) : fallback.reports;
  return fallback;
}

function renderDashboard(data) {
  const inventory = data.inventory || [];
  const cloudState = data.cloudState || {};
  const syncMetadata = data.syncMetadata || {};
  const asteroid = data.asteroid || {};
  const progress = Math.max(0, Math.min(100, numberValue(asteroid.percentComplete)));
  const syncOn = Boolean(data.settings && data.settings.cloudSyncEnabled);
  const conflictState = syncMetadata.conflictState || syncMetadata.conflict_state || (numberValue(syncMetadata.rejectedCount || syncMetadata.rejected_count) > 0 ? "needs review" : "none");

  connectionPill.textContent = currentUser ? "Firebase profile" : "Demo mode";
  dashboardMode.textContent = data.mode || (currentUser ? "Firebase profile" : "Signed-out demo");
  dashboardSource.textContent = data.source || "Local demo snapshot";
  lastUpdated.textContent = timestampLabel(cloudState.updatedAt || syncMetadata.updatedAt || new Date());
  metricSpaceBucks.textContent = formatNumber(data.player && data.player.spaceBucks);
  metricChonks.textContent = formatNumber(materialQuantity(inventory, "mat_chonks"));
  metricSuit.textContent = formatPercent(data.player && data.player.suitCondition);
  metricEvents.textContent = formatNumber(cloudState.eventCount || syncMetadata.acceptedCount || 0);
  syncStatus.textContent = syncOn ? "Enabled" : "Off";
  syncEvents.textContent = formatNumber(cloudState.eventCount || syncMetadata.acceptedCount || 0);
  syncSequence.textContent = formatNumber(syncMetadata.lastSequence || cloudState.lastSequence || 0);
  syncConflicts.textContent = conflictState === "none" ? "None" : displayNameFromId(conflictState);
  asteroidName.textContent = asteroid.displayName || "-";
  asteroidProgressLabel.textContent = `${formatNumber(asteroid.mined)} / ${formatNumber(asteroid.depletionSize)} mined`;
  asteroidProgressPercent.textContent = formatPercent(progress);
  asteroidProgressFill.style.width = `${progress}%`;
  progressTrack.setAttribute("aria-valuenow", String(progress));

  renderInventory(inventory);
  renderOrders(data.orders || []);
  renderUpgrades(data.upgrades || []);
  renderReports(data.reports || []);
  renderCloudDetail(cloudState, asteroid);
  renderBase(data.base || {});
  renderPrivacy(data);
}

function renderInventory(items) {
  if (!items.length) {
    inventoryList.innerHTML = `<p class="empty-state">No material buckets have been synced yet.</p>`;
    return;
  }
  inventoryList.innerHTML = items.map((item) => `
    <div class="row-item">
      <div>
        <strong>${escapeHtml(item.displayName)}</strong>
        <span>${escapeHtml(item.category || "material")}</span>
      </div>
      <b>${formatNumber(item.quantity)}</b>
    </div>
  `).join("");
}

function renderOrders(orders) {
  if (!orders.length) {
    ordersList.innerHTML = `<p class="empty-state">No active cloud orders yet.</p>`;
    return;
  }
  ordersList.innerHTML = orders.map((order) => {
    const missing = Object.keys(order.missingMaterials || {}).length;
    return `
      <div class="row-item order-row">
        <div>
          <strong>${escapeHtml(order.productName)}</strong>
          <span>${escapeHtml(order.buyerName)} - ${order.canFulfill ? "ready" : `${missing} missing`}</span>
        </div>
        <b>${formatNumber(order.rewardSpaceBucks)}</b>
      </div>
    `;
  }).join("");
}

function renderUpgrades(upgrades) {
  if (!upgrades.length) {
    upgradesList.innerHTML = `<p class="empty-state">No upgrade state has been reduced yet.</p>`;
    return;
  }
  upgradesList.innerHTML = upgrades.slice(0, 6).map((upgrade) => {
    const maxLevel = Math.max(numberValue(upgrade.maxLevel, 1), 1);
    const level = Math.min(numberValue(upgrade.level), maxLevel);
    return `
      <div class="upgrade-row">
        <div class="progress-meta">
          <strong>${escapeHtml(upgrade.displayName)}</strong>
          <span>Level ${formatNumber(level)} / ${formatNumber(maxLevel)}</span>
        </div>
        <div class="mini-track"><span style="width: ${Math.round((level / maxLevel) * 100)}%"></span></div>
        <small>${escapeHtml(upgrade.effect || upgrade.nextEffect || "Active")}</small>
      </div>
    `;
  }).join("");
}

function renderReports(reports) {
  reportsList.innerHTML = reports.slice(0, 5).map((report) => `
    <article>
      <p>${escapeHtml(report)}</p>
    </article>
  `).join("");
}

function renderCloudDetail(cloudState, asteroid) {
  cloudDetail.innerHTML = `
    <div><dt>Work score</dt><dd>${formatNumber(cloudState.workScoreTotal || 0)}</dd></div>
    <div><dt>Last event</dt><dd>${escapeHtml(cloudState.lastEventId || "none")}</dd></div>
    <div><dt>Rare find</dt><dd>${escapeHtml(asteroid.rareFindChance || "n/a")}</dd></div>
  `;
}

function renderBase(base) {
  baseDetail.innerHTML = `
    <div><dt>Modules</dt><dd>${formatNumber(base.moduleCount || base.module_count || 0)}</dd></div>
    <div><dt>Drone level</dt><dd>${formatNumber(base.droneLevel || base.drone_level || 0)}</dd></div>
    <div><dt>Storage</dt><dd>${escapeHtml(base.storageBonus || base.storage_bonus || "1.00x")}</dd></div>
  `;
}

function renderPrivacy(data) {
  const privacyItems = [
    ["Owner scope", currentUser ? "Firebase UID boundary" : "Local demo"],
    ["Data class", "abstract"],
    ["Report mode", data.settings && data.settings.reportMode ? data.settings.reportMode : "meaningful_turns_only"],
    ["Private details", "not fetched"]
  ];
  privacyList.innerHTML = privacyItems.map(([label, value]) => `
    <li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>
  `).join("");
}

async function refreshForCurrentUser() {
  refreshDashboard.disabled = true;
  try {
    if (!currentUser) {
      renderDashboard(cloneDemo());
      return;
    }
    const data = await loadDashboardForUser(currentUser);
    renderDashboard(data);
    setMessage("Dashboard refreshed.");
  } catch (error) {
    renderDashboard(cloneDemo({
      mode: "Demo fallback",
      source: "Firebase read failed; showing local preview"
    }));
    setMessage(error.message || "Dashboard refresh failed.", true);
  } finally {
    refreshDashboard.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleAuth(() => signInWithEmailAndPassword(auth, email.value, password.value));
});

createAccount.addEventListener("click", () => {
  handleAuth(() => createUserWithEmailAndPassword(auth, email.value, password.value));
});

signOutButton.addEventListener("click", () => {
  handleAuth(() => signOut(auth));
});

refreshDashboard.addEventListener("click", () => {
  refreshForCurrentUser();
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    authStatus.textContent = "Signed out";
    authUid.textContent = "-";
    profileStatus.textContent = "Demo preview";
    signOutButton.disabled = true;
    setMessage("");
    renderDashboard(cloneDemo());
    return;
  }

  authStatus.textContent = "Signed in";
  authUid.textContent = user.uid;
  signOutButton.disabled = false;

  try {
    const result = await ensureLinkedProfile(user);
    profileStatus.textContent = result;
    setMessage("Profile linked.");
  } catch (error) {
    profileStatus.textContent = "Link error";
    setMessage(error.message || "Profile link failed.", true);
  }

  await refreshForCurrentUser();
});

renderDashboard(cloneDemo());
