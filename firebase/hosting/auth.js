import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
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
  store: {
    realMoney: false,
    categories: {
      upgrades: [
        { storeItemId: "upgrade:upgrade_drill_power", kind: "upgrade", displayName: "Drill Power", purchaseState: "affordable", cost: { spaceBucks: 180, materials: { mat_iron: 4 } } },
        { storeItemId: "upgrade:upgrade_drone_automation", kind: "upgrade", displayName: "Drone Automation", purchaseState: "unaffordable", cost: { spaceBucks: 1450, materials: { mat_quartz: 2 } } }
      ],
      machines: [
        { storeItemId: "machine:machine_circuit_loom", kind: "machine", displayName: "Circuit Loom", purchaseState: "locked", cost: { spaceBucks: 750, materials: {} } }
      ],
      baseModules: [
        { storeItemId: "base_module:base_workshop", kind: "base_module", displayName: "Workshop", purchaseState: "affordable", cost: { spaceBucks: 150, materials: { mat_chonks: 80 } } }
      ],
      cosmetics: [
        { storeItemId: "cosmetic:cosmetic_suit_trim_teal", kind: "cosmetic", displayName: "Teal Suit Trim", purchaseState: "affordable", cost: { spaceBucks: 90, materials: {} } }
      ]
    }
  },
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

const EMPTY_CLOUD_DASHBOARD = {
  mode: "Cloud profile ready",
  source: "Waiting for Codex sync",
  hasCloudState: false,
  profile: {
    displayName: "Local Prospector",
    minerName: "Prospector"
  },
  player: {
    spaceBucks: 0,
    suitCondition: 100
  },
  settings: {
    reportMode: "meaningful_turns_only",
    cloudSyncEnabled: true
  },
  cloudState: {
    eventCount: 0,
    workScoreTotal: 0,
    lastSequence: 0,
    lastEventId: null,
    updatedAt: "No synced state yet"
  },
  syncMetadata: {
    lastSequence: 0,
    conflictState: "none",
    acceptedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0
  },
  inventory: [],
  orders: [],
  asteroid: {
    displayName: "No synced asteroid",
    mined: 0,
    depletionSize: 0,
    percentComplete: 0,
    rareFindChance: "n/a"
  },
  upgrades: [],
  store: {
    realMoney: false,
    categories: {
      upgrades: [],
      machines: [],
      baseModules: [],
      cosmetics: []
    }
  },
  reports: [],
  base: {
    moduleCount: 0,
    droneLevel: 0,
    storageBonus: "1.00x"
  }
};

const AUTH_ERROR_MESSAGES = {
  "auth/email-already-in-use": "That email already has an MCP Miner account. Try signing in.",
  "auth/invalid-credential": "Email or password did not match an MCP Miner account.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/operation-not-allowed": "That sign-in method is not enabled for this MCP Miner project.",
  "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
  "auth/popup-blocked": "Allow popups for MCP Miner, then try Google sign-in again.",
  "auth/missing-email": "Enter your email address.",
  "auth/missing-password": "Enter your password.",
  "auth/network-request-failed": "Network connection failed. Try again in a moment.",
  "auth/too-many-requests": "Too many attempts. Wait a moment, then try again.",
  "auth/unauthorized-domain": "This domain is not authorized for MCP Miner sign-in yet.",
  "auth/user-not-found": "Email or password did not match an MCP Miner account.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/wrong-password": "Email or password did not match an MCP Miner account."
};
const FORM_VALIDATION_MESSAGE = "Check the highlighted email and password fields.";
const DASHBOARD_REFRESH_SUCCESS = "Dashboard refreshed.";
const DASHBOARD_REFRESH_PARTIAL = "Some cloud data could not be refreshed. Showing available owner data.";
const SYNC_API_REFRESH_PARTIAL = "Cloud sync API did not respond. Showing available owner data.";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
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
const googleSignInButton = document.querySelector("#google-sign-in");
const signInButton = document.querySelector("#sign-in");
const createAccount = document.querySelector("#create-account");
const signOutButton = document.querySelector("#sign-out");
const refreshDashboard = document.querySelector("#refresh-dashboard");
const authStatus = document.querySelector("#auth-status");
const authIdentity = document.querySelector("#auth-identity");
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
const storeBalance = document.querySelector("#store-balance");
const storeList = document.querySelector("#store-list");
const reportsList = document.querySelector("#reports-list");
const baseDetail = document.querySelector("#base-detail");
const deviceLinkPanel = document.querySelector("[data-panel=\"device-link\"]");
const deviceLinkStatus = document.querySelector("#device-link-status");
const deviceLinkSummary = document.querySelector("#device-link-summary");
const deviceLinkCode = document.querySelector("#device-link-code");
const approveDeviceLink = document.querySelector("#approve-device-link");
const rejectDeviceLink = document.querySelector("#reject-device-link");
const linkParams = new URLSearchParams(window.location.search);
const pendingLink = {
  sessionId: linkParams.get("sessionId") || "",
  code: linkParams.get("linkCode") || linkParams.get("code") || ""
};

let currentUser = null;
let activeDashboard = cloneDemo();

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#9a3412" : "#1f7a5a";
}

function cloneDemo(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...DEMO_DASHBOARD, ...overrides }));
}

function cloneEmptyCloud(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...EMPTY_CLOUD_DASHBOARD, ...overrides }));
}

function updateAuthControls(user) {
  const signedIn = Boolean(user);
  email.disabled = signedIn;
  password.disabled = signedIn;
  googleSignInButton.disabled = signedIn;
  signInButton.disabled = signedIn;
  createAccount.disabled = signedIn;
  signOutButton.disabled = !signedIn;
}

function hasPendingLink() {
  return Boolean(pendingLink.sessionId || pendingLink.code);
}

function renderDeviceLink(user, status = "waiting") {
  if (!hasPendingLink()) {
    deviceLinkPanel.hidden = true;
    return;
  }

  const signedIn = Boolean(user);
  deviceLinkPanel.hidden = false;
  deviceLinkCode.textContent = pendingLink.code || "From link";
  approveDeviceLink.disabled = !signedIn || status === "approved" || status === "rejected";
  rejectDeviceLink.disabled = !signedIn || status === "approved" || status === "rejected";

  if (!signedIn) {
    deviceLinkStatus.textContent = "Sign in";
    deviceLinkSummary.textContent = "Sign in to approve this Codex device. Approval syncs only abstract MCP Miner game progress.";
    return;
  }

  if (status === "approved") {
    deviceLinkStatus.textContent = "Approved";
    deviceLinkSummary.textContent = "Device approved. Return to Codex and run complete_account_link.";
    return;
  }

  if (status === "rejected") {
    deviceLinkStatus.textContent = "Rejected";
    deviceLinkSummary.textContent = "Device link rejected. Codex will not receive a sync token.";
    return;
  }

  deviceLinkStatus.textContent = "Ready";
  deviceLinkSummary.textContent = "Approve this Codex device to sync Chonks, inventory, orders, upgrades, and abstract event counts. Prompts, code, commands, paths, repo names, terminal output, browser content, OpenAI account data, and transcripts are not synced.";
}

async function submitDeviceLink(action) {
  if (!currentUser || !hasPendingLink()) {
    renderDeviceLink(currentUser);
    return;
  }

  const callable = httpsCallable(functions, action === "approve" ? "approveLinkSession" : "rejectLinkSession");
  approveDeviceLink.disabled = true;
  rejectDeviceLink.disabled = true;
  try {
    await callable({
      sessionId: pendingLink.sessionId,
      code: pendingLink.code
    });
    renderDeviceLink(currentUser, action === "approve" ? "approved" : "rejected");
    setMessage(action === "approve" ? "Codex device approved." : "Codex device rejected.");
  } catch (error) {
    renderDeviceLink(currentUser);
    setMessage(error.message || "Device link update failed.", true);
  }
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
    setMessage(friendlyAuthMessage(error), true);
  } finally {
    password.value = "";
  }
}

function validateAuthForm() {
  if (form.reportValidity()) {
    return true;
  }
  setMessage(FORM_VALIDATION_MESSAGE, true);
  return false;
}

function handleInvalidAuthField() {
  setMessage(FORM_VALIDATION_MESSAGE, true);
}

function friendlyAuthMessage(error) {
  return AUTH_ERROR_MESSAGES[error && error.code] || "Authentication failed. Try again.";
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

function reportModeLabel(mode) {
  return displayNameFromId(mode || "meaningful_turns_only");
}

function eventLabel(cloudState) {
  const eventId = cloudState.lastEventId || cloudState.last_event_id;
  const sequence = numberValue(cloudState.lastSequence || cloudState.last_sequence);
  if (!eventId) {
    return "No events yet";
  }
  return sequence > 0 ? `Event ${formatNumber(sequence)}` : displayNameFromId(eventId);
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

function normalizeDeviceRows(snapshot) {
  const rows = [];
  snapshot.forEach((entry) => {
    const data = entry.data();
    rows.push({
      deviceId: data.deviceId || data.device_id || entry.id,
      deviceName: data.deviceName || data.device_name || "Codex device",
      status: data.status || "linked",
      lastUsedAt: data.lastUsedAt || data.last_used_at || null
    });
  });
  return rows.filter((device) => device.status !== "revoked").slice(0, 8);
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

function docExists(results, index) {
  const result = results[index];
  return Boolean(result && result.status === "fulfilled" && result.value.exists());
}

function queryResult(results, index) {
  const result = results[index];
  if (!result || result.status !== "fulfilled") {
    return null;
  }
  return result.value;
}

function refreshWarning(reads) {
  const failedIndexes = reads
    .map((result, index) => result && result.status === "rejected" ? index : null)
    .filter((index) => index !== null);
  if (!failedIndexes.length) {
    return "";
  }
  if (failedIndexes.includes(10)) {
    return SYNC_API_REFRESH_PARTIAL;
  }
  return DASHBOARD_REFRESH_PARTIAL;
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
    getDocs(query(collection(db, "players", user.uid, "syncDevices"), limit(8))),
    getSyncState({})
  ]);

  const player = docsData(reads, 0) || {};
  const profile = docsData(reads, 1) || {};
  const settings = docsData(reads, 2) || {};
  const directStateExists = docExists(reads, 3);
  const directSyncExists = docExists(reads, 4);
  const directState = docsData(reads, 3) || {};
  const directSync = docsData(reads, 4) || {};
  const callable = reads[10] && reads[10].status === "fulfilled" ? reads[10].value.data : {};
  const cloudState = callable.state || directState;
  const syncMetadata = callable.syncMetadata || directSync;
  const inventory = normalizeInventoryRows(queryResult(reads, 7) || { forEach() {} }, cloudState);
  const orders = normalizeOrderRows(queryResult(reads, 8) || { forEach() {} });
  const syncDevices = normalizeDeviceRows(queryResult(reads, 9) || { forEach() {} });
  const upgrades = normalizeUpgradeRows(docsData(reads, 5));
  const base = docsData(reads, 6) || {};
  const hasCloudState = directStateExists ||
    directSyncExists ||
    inventory.length > 0 ||
    orders.length > 0 ||
    upgrades.length > 0 ||
    cloudState.spaceBucks !== undefined ||
    cloudState.space_bucks !== undefined ||
    cloudState.eventCount !== undefined ||
    cloudState.lastSequence !== undefined;
  const fallback = cloneEmptyCloud({
    source: hasCloudState ? "Synced from Codex" : "Waiting for Codex sync",
    hasCloudState,
    refreshWarning: refreshWarning(reads)
  });

  fallback.profile = { ...fallback.profile, ...profile, ...player };
  fallback.player = {
    ...fallback.player,
    spaceBucks: numberValue(cloudState.spaceBucks ?? cloudState.space_bucks, fallback.player.spaceBucks),
    suitCondition: numberValue(cloudState.suitCondition ?? cloudState.suit_condition, fallback.player.suitCondition)
  };
  fallback.settings = { ...fallback.settings, ...settings, cloudSyncEnabled: settings.cloudSyncEnabled ?? player.cloudSyncEnabled ?? true };
  fallback.cloudState = { ...fallback.cloudState, ...cloudState };
  fallback.syncMetadata = { ...fallback.syncMetadata, ...syncMetadata };
  fallback.inventory = inventory.length ? inventory : fallback.inventory;
  fallback.orders = orders.length ? orders : fallback.orders;
  fallback.syncDevices = syncDevices;
  fallback.asteroid = cloudState.asteroidProgress || cloudState.asteroid_progress || cloudState.currentAsteroid || cloudState.current_asteroid ? normalizeAsteroid(cloudState) : fallback.asteroid;
  fallback.upgrades = upgrades.length ? upgrades : fallback.upgrades;
  fallback.store = cloudState.store || fallback.store;
  fallback.base = { ...fallback.base, ...base };
  fallback.reports = Array.isArray(cloudState.reports) && cloudState.reports.length ? cloudState.reports.slice(0, 5) : fallback.reports;
  return fallback;
}

function renderDashboard(data) {
  activeDashboard = data;
  const inventory = data.inventory || [];
  const cloudState = data.cloudState || {};
  const syncMetadata = data.syncMetadata || {};
  const asteroid = data.asteroid || {};
  const progress = Math.max(0, Math.min(100, numberValue(asteroid.percentComplete)));
  const syncOn = Boolean(data.settings && data.settings.cloudSyncEnabled);
  const hasCloudState = Boolean(data.hasCloudState);
  const conflictState = syncMetadata.conflictState || syncMetadata.conflict_state || (numberValue(syncMetadata.rejectedCount || syncMetadata.rejected_count) > 0 ? "needs review" : "none");

  connectionPill.textContent = currentUser ? "Signed in" : "Demo mode";
  dashboardMode.textContent = data.mode || (currentUser ? "Cloud profile ready" : "Signed-out demo");
  dashboardSource.textContent = data.source || "Local demo snapshot";
  lastUpdated.textContent = timestampLabel(cloudState.updatedAt || syncMetadata.updatedAt || new Date());
  metricSpaceBucks.textContent = formatNumber(data.player && data.player.spaceBucks);
  metricChonks.textContent = formatNumber(materialQuantity(inventory, "mat_chonks"));
  metricSuit.textContent = formatPercent(data.player && data.player.suitCondition);
  metricEvents.textContent = formatNumber(cloudState.eventCount || syncMetadata.acceptedCount || 0);
  syncStatus.textContent = currentUser && !hasCloudState ? "No data" : (syncOn ? "Enabled" : "Off");
  syncEvents.textContent = formatNumber(cloudState.eventCount || syncMetadata.acceptedCount || 0);
  syncSequence.textContent = formatNumber(syncMetadata.lastSequence || cloudState.lastSequence || 0);
  syncConflicts.textContent = conflictState === "none" ? "None" : displayNameFromId(conflictState);
  const hasAsteroidProgress = numberValue(asteroid.depletionSize) > 0;
  asteroidName.textContent = asteroid.displayName || "-";
  asteroidProgressLabel.textContent = hasAsteroidProgress
    ? `${formatNumber(asteroid.mined)} / ${formatNumber(asteroid.depletionSize)} mined`
    : "No asteroid progress synced yet.";
  asteroidProgressPercent.textContent = hasAsteroidProgress ? formatPercent(progress) : "";
  asteroidProgressPercent.hidden = !hasAsteroidProgress;
  asteroidProgressFill.style.width = `${progress}%`;
  progressTrack.hidden = !hasAsteroidProgress;
  progressTrack.setAttribute("aria-valuenow", String(progress));

  renderInventory(inventory);
  renderOrders(data.orders || []);
  renderUpgrades(data.upgrades || []);
  renderStore(data);
  renderReports(data.reports || []);
  renderCloudDetail(cloudState, asteroid, data.syncDevices || []);
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
    const reward = formatNumber(order.rewardSpaceBucks);
    return `
      <div class="row-item order-row">
        <div>
          <strong>${escapeHtml(order.productName)}</strong>
          <span>${escapeHtml(order.buyerName)} - ${order.canFulfill ? "ready" : `${missing} missing`}</span>
        </div>
        <b>${reward} SB</b>
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

function normalizeStoreCategories(store) {
  const categories = store && store.categories ? store.categories : {};
  return {
    upgrades: categories.upgrades || [],
    machines: categories.machines || [],
    baseModules: categories.baseModules || categories.base_modules || [],
    cosmetics: categories.cosmetics || []
  };
}

function storeCostLabel(cost) {
  const spaceBucks = numberValue(cost && (cost.spaceBucks ?? cost.space_bucks));
  const materials = (cost && cost.materials) || {};
  const materialLabels = Object.entries(materials)
    .filter(([, quantity]) => numberValue(quantity) > 0)
    .map(([materialId, quantity]) => `${formatNumber(quantity)} ${displayNameFromId(materialId)}`);
  return `${formatNumber(spaceBucks)} SB${materialLabels.length ? ` + ${materialLabels.join(", ")}` : ""}`;
}

function storeActionLabel(state, canBuy) {
  if (canBuy) {
    return "Buy";
  }
  if (currentUser && state === "affordable") {
    return "Unavailable";
  }
  const disabledLabels = {
    locked: "Unavailable",
    maxed: "Maxed",
    owned: "Owned",
    purchased: "Owned",
    unaffordable: "Need more"
  };
  return disabledLabels[state] || displayNameFromId(state);
}

function storeButtonAccessibleLabel(item, actionLabel) {
  const itemName = item.displayName || item.display_name || "Store item";
  const kind = displayNameFromId(item.kind || "store");
  if (actionLabel === "Buy") {
    return `Buy ${itemName} ${kind}`;
  }
  if (actionLabel === "Need more") {
    return `Need more for ${itemName} ${kind}`;
  }
  if (actionLabel === "Unavailable") {
    return `${itemName} ${kind} unavailable`;
  }
  if (actionLabel === "Owned") {
    return `${itemName} ${kind} owned`;
  }
  if (actionLabel === "Maxed") {
    return `${itemName} ${kind} maxed`;
  }
  return `${actionLabel} ${itemName} ${kind}`;
}

function renderStore(data) {
  const categories = normalizeStoreCategories(data.store);
  const items = [
    ...categories.upgrades,
    ...categories.machines,
    ...categories.baseModules,
    ...categories.cosmetics
  ].slice(0, 8);
  storeBalance.textContent = `${formatNumber(data.player && data.player.spaceBucks)} Space Bucks`;

  if (!items.length) {
    storeList.innerHTML = `<p class="empty-state">No store catalog has been synced yet.</p>`;
    return;
  }

  storeList.innerHTML = items.map((item) => {
    const state = item.purchaseState || item.purchase_state || "locked";
    const canBuy = state === "affordable" && !currentUser;
    const actionLabel = storeActionLabel(state, canBuy);
    const accessibleLabel = storeButtonAccessibleLabel(item, actionLabel);
    const storeItemId = item.storeItemId || item.store_item_id;
    return `
      <div class="store-row" data-state="${escapeHtml(state)}">
        <div>
          <strong>${escapeHtml(item.displayName || item.display_name)}</strong>
          <span>${escapeHtml(displayNameFromId(item.kind || "store"))} - ${escapeHtml(storeCostLabel(item.cost))}</span>
        </div>
        <span class="store-state">${escapeHtml(displayNameFromId(state))}</span>
        <button type="button" class="button-secondary store-buy" data-store-item-id="${escapeHtml(storeItemId)}" aria-label="${escapeHtml(accessibleLabel)}" ${canBuy ? "" : "disabled"}>${escapeHtml(actionLabel)}</button>
      </div>
    `;
  }).join("");
}

function findStoreItem(data, storeItemId) {
  const categories = normalizeStoreCategories(data.store);
  return [
    ...categories.upgrades,
    ...categories.machines,
    ...categories.baseModules,
    ...categories.cosmetics
  ].find((item) => (item.storeItemId || item.store_item_id) === storeItemId);
}

function applyDemoStorePurchase(storeItemId) {
  const item = findStoreItem(activeDashboard, storeItemId);
  if (!item) {
    setMessage("Store item is unavailable.", true);
    return;
  }
  const state = item.purchaseState || item.purchase_state;
  if (state !== "affordable") {
    setMessage(`${item.displayName || item.display_name} is ${state}.`, true);
    return;
  }

  const cost = item.cost || {};
  const materials = cost.materials || {};
  activeDashboard.player.spaceBucks = numberValue(activeDashboard.player.spaceBucks) - numberValue(cost.spaceBucks ?? cost.space_bucks);
  Object.entries(materials).forEach(([materialId, quantity]) => {
    const inventoryItem = activeDashboard.inventory.find((candidate) => candidate.materialId === materialId);
    if (inventoryItem) {
      inventoryItem.quantity = Math.max(0, numberValue(inventoryItem.quantity) - numberValue(quantity));
    }
  });
  if (item.kind === "upgrade") {
    const upgradeId = String(item.storeItemId || item.store_item_id || "").replace(/^upgrade:/, "");
    const upgrade = activeDashboard.upgrades.find((candidate) => candidate.upgradeId === upgradeId);
    if (upgrade) {
      upgrade.level = Math.min(numberValue(upgrade.level) + 1, numberValue(upgrade.maxLevel, 5));
      upgrade.effect = upgrade.nextEffect || upgrade.effect;
    }
  }
  if (item.kind === "base_module") {
    activeDashboard.base.moduleCount = numberValue(activeDashboard.base.moduleCount || activeDashboard.base.module_count) + 1;
  }
  item.purchaseState = "purchased";
  item.purchase_state = "purchased";
  renderDashboard(activeDashboard);
  setMessage(`${item.displayName || item.display_name} purchased with earned Space Bucks.`);
}

function renderReports(reports) {
  if (!reports.length) {
    reportsList.innerHTML = `<p class="empty-state">No cloud reports have been synced yet.</p>`;
    return;
  }

  reportsList.innerHTML = reports.slice(0, 5).map((report) => `
    <article>
      <p>${escapeHtml(report)}</p>
    </article>
  `).join("");
}

function renderCloudDetail(cloudState, asteroid, syncDevices = []) {
  cloudDetail.innerHTML = `
    <div><dt>Work score</dt><dd>${formatNumber(cloudState.workScoreTotal || 0)}</dd></div>
    <div><dt>Last event</dt><dd>${escapeHtml(eventLabel(cloudState))}</dd></div>
    <div><dt>Rare find</dt><dd>${escapeHtml(asteroid.rareFindChance || "n/a")}</dd></div>
    <div><dt>Linked devices</dt><dd>${formatNumber(syncDevices.length)}</dd></div>
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
    ["Owner scope", currentUser ? "Private profile boundary" : "Local demo"],
    ["Data class", "Abstract progress only"],
    ["Report mode", reportModeLabel(data.settings && data.settings.reportMode)],
    ["Private details", "Not collected"]
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
      setMessage("Demo preview refreshed.");
      return;
    }
    const data = await loadDashboardForUser(currentUser);
    renderDashboard(data);
    if (data.refreshWarning) {
      setMessage(data.refreshWarning, true);
    } else {
      setMessage(DASHBOARD_REFRESH_SUCCESS);
    }
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
  if (!validateAuthForm()) {
    return;
  }
  handleAuth(() => signInWithEmailAndPassword(auth, email.value, password.value));
});

form.addEventListener("invalid", handleInvalidAuthField, true);

createAccount.addEventListener("click", () => {
  if (!validateAuthForm()) {
    return;
  }
  handleAuth(() => createUserWithEmailAndPassword(auth, email.value, password.value));
});

googleSignInButton.addEventListener("click", () => {
  handleAuth(() => signInWithPopup(auth, googleProvider));
});

signOutButton.addEventListener("click", () => {
  handleAuth(() => signOut(auth));
});

refreshDashboard.addEventListener("click", () => {
  refreshForCurrentUser();
});

approveDeviceLink.addEventListener("click", () => {
  submitDeviceLink("approve");
});

rejectDeviceLink.addEventListener("click", () => {
  submitDeviceLink("reject");
});

storeList.addEventListener("click", (event) => {
  const button = event.target.closest(".store-buy");
  if (!button) {
    return;
  }
  if (currentUser) {
    setMessage("Store purchases are validated through the local MCP store flow.", true);
    return;
  }
  applyDemoStorePurchase(button.dataset.storeItemId);
});

onAuthStateChanged(auth, async (user) => {
  const previousUser = currentUser;
  currentUser = user;
  updateAuthControls(user);
  renderDeviceLink(user);
  if (!user) {
    authStatus.textContent = "Signed out";
    authIdentity.textContent = "Not signed in";
    profileStatus.textContent = "Demo preview";
    if (previousUser) {
      email.value = "";
    }
    password.value = "";
    setMessage("");
    renderDashboard(cloneDemo());
    return;
  }

  authStatus.textContent = "Signed in";
  authIdentity.textContent = "Private profile";
  email.value = "";
  profileStatus.textContent = "Loading";
  setMessage("Loading profile.");
  renderDashboard(cloneEmptyCloud({
    source: "Checking cloud sync..."
  }));

  try {
    const result = await ensureLinkedProfile(user);
    profileStatus.textContent = result;
    setMessage("Profile linked.");
    renderDeviceLink(user);
  } catch (error) {
    profileStatus.textContent = "Link error";
    setMessage(error.message || "Profile link failed.", true);
  }

  await refreshForCurrentUser();
});

renderDashboard(cloneDemo());
