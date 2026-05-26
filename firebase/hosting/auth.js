import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
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
  orderBy,
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
  entitlement: {
    plan: "free",
    displayName: "Free",
    syncCadenceSeconds: 60
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
    asteroidClassId: "asteroid_quartz_belt",
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
  rawSyncEvents: [
    {
      eventId: "evt_demo_018",
      eventType: "work_apply_patch",
      receiptSchemaVersion: 2,
      sequence: 18,
      observedFields: {
        score: 8.5,
        scoreSource: "server_receipt_v2",
        serverCalculated: true
      },
      privacyClass: "abstract",
      source: "codex_hook"
    }
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
  entitlement: {
    plan: "free",
    displayName: "Free",
    syncCadenceSeconds: 60
  },
  inventory: [],
  orders: [],
  asteroid: {
    asteroidClassId: "",
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
  rawSyncEvents: [],
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
const EMAIL_VERIFICATION_REQUIRED = "Verify your email before cloud sync or Codex linking.";
const EMAIL_VERIFICATION_SENT = "Verification email sent. Check your inbox, then refresh this dashboard after verifying.";
const EMAIL_VERIFICATION_FAILED = "Account created, but the verification email could not be sent. Use Resend Verification.";
const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
const THEME_STORAGE_KEY = "mcp-miner-theme";
const ASTEROID_CLASSES = [
  {
    id: "asteroid_starter_rubble",
    displayName: "Starter Rubble",
    unlockTier: 1,
    image: "/assets/asteroids/asteroid_starter_rubble.svg",
    base: "#8d8174",
    shade: "#544d45",
    glow: "#42d998"
  },
  {
    id: "asteroid_quartz_belt",
    displayName: "Quartz Belt",
    unlockTier: 2,
    image: "/assets/asteroids/asteroid_quartz_belt.svg",
    base: "#7d8d98",
    shade: "#3f505d",
    glow: "#6ee7ff"
  },
  {
    id: "asteroid_iron_tumblers",
    displayName: "Iron Tumblers",
    unlockTier: 3,
    image: "/assets/asteroids/asteroid_iron_tumblers.svg",
    base: "#94634f",
    shade: "#4c3029",
    glow: "#ffb66e"
  },
  {
    id: "asteroid_sapphire_debris_field",
    displayName: "Sapphire Debris Field",
    unlockTier: 3,
    image: "/assets/asteroids/asteroid_sapphire_debris_field.svg",
    base: "#536c98",
    shade: "#202e56",
    glow: "#6ea8ff"
  },
  {
    id: "asteroid_ember_rocks",
    displayName: "Ember Rocks",
    unlockTier: 4,
    image: "/assets/asteroids/asteroid_ember_rocks.svg",
    base: "#884839",
    shade: "#341a1a",
    glow: "#ff6f3d"
  },
  {
    id: "asteroid_amethyst_archive_belt",
    displayName: "Amethyst Archive Belt",
    unlockTier: 4,
    image: "/assets/asteroids/asteroid_amethyst_archive_belt.svg",
    base: "#6b5a8e",
    shade: "#2e214c",
    glow: "#cf8dff"
  },
  {
    id: "asteroid_diamond_class_body",
    displayName: "Diamond-Class Body",
    unlockTier: 5,
    image: "/assets/asteroids/asteroid_diamond_class_body.svg",
    base: "#a8bac7",
    shade: "#485967",
    glow: "#f8fbff"
  }
];
const ASTEROID_BY_ID = new Map(ASTEROID_CLASSES.map((asteroid) => [asteroid.id, asteroid]));
const ASTEROID_ID_BY_NAME = new Map(ASTEROID_CLASSES.map((asteroid) => [asteroid.displayName.toLowerCase(), asteroid.id]));

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
const topbarSignOutButton = document.querySelector("#topbar-sign-out");
const sendVerificationEmailButton = document.querySelector("#send-verification-email");
const themeToggle = document.querySelector("#theme-toggle");
const themeToggleLabel = document.querySelector("#theme-toggle-label");
const refreshDashboard = document.querySelector("#refresh-dashboard");
const authStatus = document.querySelector("#auth-status");
const authIdentity = document.querySelector("#auth-identity");
const emailVerificationStatus = document.querySelector("#email-verification-status");
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
const asteroidArt = document.querySelector("#asteroid-art");
const asteroidCanvas = document.querySelector("#asteroid-canvas");
const asteroidAtlas = document.querySelector("#asteroid-atlas");
const progressTrack = document.querySelector(".progress-track");
const cloudDetail = document.querySelector("#cloud-detail");
const inventoryList = document.querySelector("#inventory-list");
const ordersList = document.querySelector("#orders-list");
const upgradesList = document.querySelector("#upgrades-list");
const storeBalance = document.querySelector("#store-balance");
const storeList = document.querySelector("#store-list");
const reportsList = document.querySelector("#reports-list");
const rawSyncList = document.querySelector("#raw-sync-list");
const rawSyncCount = document.querySelector("#raw-sync-count");
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
let activeAsteroidVisual = ASTEROID_CLASSES[0];
let activeAsteroidProgress = 0;
let asteroidAnimationStarted = false;
let verificationEmailSentAt = 0;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.dataset.tone = isError ? "error" : "success";
}

function preferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  themeToggle.setAttribute("aria-pressed", nextTheme === "dark" ? "true" : "false");
  themeToggle.setAttribute("aria-label", nextTheme === "dark" ? "Use light mode" : "Use dark mode");
  themeToggleLabel.textContent = nextTheme === "dark" ? "Light" : "Dark";
  drawAsteroidCanvas(performance.now());
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function cloneDemo(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...DEMO_DASHBOARD, ...overrides }));
}

function cloneEmptyCloud(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...EMPTY_CLOUD_DASHBOARD, ...overrides }));
}

function isPasswordProviderUser(user) {
  return Boolean(user && Array.isArray(user.providerData) && user.providerData.some((provider) => provider.providerId === "password"));
}

function requiresEmailVerification(user) {
  return Boolean(user && user.email && isPasswordProviderUser(user) && user.emailVerified !== true);
}

function verificationDashboard() {
  return cloneEmptyCloud({
    mode: "Verify email",
    source: "Verify email before cloud sync",
    settings: {
      ...EMPTY_CLOUD_DASHBOARD.settings,
      cloudSyncEnabled: false
    },
    cloudState: {
      ...EMPTY_CLOUD_DASHBOARD.cloudState,
      updatedAt: "Email verification pending"
    }
  });
}

function emailVerificationLabel(user) {
  if (!user) {
    return "Not signed in";
  }
  if (!isPasswordProviderUser(user)) {
    return "Verified by provider";
  }
  return user.emailVerified ? "Verified" : "Verification required";
}

function updateVerificationControls(user) {
  const pendingVerification = requiresEmailVerification(user);
  const cooldownRemaining = Math.max(0, VERIFICATION_RESEND_COOLDOWN_MS - (Date.now() - verificationEmailSentAt));
  emailVerificationStatus.textContent = emailVerificationLabel(user);
  sendVerificationEmailButton.hidden = !pendingVerification;
  sendVerificationEmailButton.disabled = !pendingVerification || cooldownRemaining > 0;
  sendVerificationEmailButton.textContent = cooldownRemaining > 0 ? "Verification Sent" : "Resend Verification";
}

function updateAuthControls(user) {
  const signedIn = Boolean(user);
  email.disabled = signedIn;
  password.disabled = signedIn;
  googleSignInButton.disabled = signedIn;
  signInButton.disabled = signedIn;
  createAccount.disabled = signedIn;
  signOutButton.disabled = !signedIn;
  topbarSignOutButton.hidden = !signedIn;
  topbarSignOutButton.disabled = !signedIn;
  updateVerificationControls(user);
}

function hasPendingLink() {
  return Boolean(pendingLink.sessionId || pendingLink.code);
}

function setLinkMode() {
  document.body.dataset.linkMode = hasPendingLink() ? "pending" : "dashboard";
}

function linkModeLabel(user) {
  if (!hasPendingLink()) {
    return null;
  }
  if (!user) {
    return {
      pill: "Device link",
      mode: "Sign in to connect",
      source: "Codex link request",
      updated: "Awaiting account"
    };
  }
  if (requiresEmailVerification(user)) {
    return {
      pill: "Verify email",
      mode: "Verify before approval",
      source: "Codex link request",
      updated: "Awaiting verification"
    };
  }
  return {
    pill: "Ready to approve",
    mode: "Approve Codex device",
    source: "Codex link request",
    updated: "Awaiting approval"
  };
}

function renderDeviceLink(user, status = "waiting") {
  if (!hasPendingLink()) {
    deviceLinkPanel.hidden = true;
    return;
  }

  setLinkMode();
  const signedIn = Boolean(user);
  const verificationRequired = requiresEmailVerification(user);
  deviceLinkPanel.hidden = false;
  deviceLinkCode.textContent = pendingLink.code || "From link";
  approveDeviceLink.disabled = !signedIn || verificationRequired || status === "approved" || status === "rejected";
  rejectDeviceLink.disabled = !signedIn || verificationRequired || status === "approved" || status === "rejected";

  if (!signedIn) {
    deviceLinkStatus.textContent = "Sign in";
    deviceLinkSummary.textContent = "Sign in to approve this Codex device. Approval syncs only abstract MCP Miner game progress.";
    return;
  }

  if (verificationRequired) {
    deviceLinkStatus.textContent = "Verify email";
    deviceLinkSummary.textContent = "Verify your email before approving this Codex device. Codex sync uses only abstract game progress after approval.";
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
    await reloadCurrentUser();
    if (requiresEmailVerification(currentUser)) {
      renderDeviceLink(currentUser);
      setMessage(EMAIL_VERIFICATION_REQUIRED, true);
      return;
    }
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

async function reloadCurrentUser() {
  if (!currentUser) {
    return null;
  }
  await reload(currentUser);
  await currentUser.getIdToken(true);
  updateAuthControls(currentUser);
  return currentUser;
}

async function sendVerificationEmailFor(user = currentUser) {
  if (!requiresEmailVerification(user)) {
    updateAuthControls(user);
    setMessage("Email is already verified.");
    return;
  }

  await sendEmailVerification(user);
  verificationEmailSentAt = Date.now();
  updateAuthControls(user);
  setTimeout(() => updateAuthControls(currentUser), VERIFICATION_RESEND_COOLDOWN_MS + 250);
  setMessage(EMAIL_VERIFICATION_SENT);
}

async function createPasswordAccount() {
  const credential = await createUserWithEmailAndPassword(auth, email.value, password.value);
  try {
    await sendVerificationEmailFor(credential.user);
  } catch (error) {
    updateAuthControls(credential.user);
    setMessage(EMAIL_VERIFICATION_FAILED, true);
  }
}

async function signOutCurrentUser() {
  await signOut(auth);
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

function asteroidClassIdFrom(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return ASTEROID_CLASSES[0].id;
  }
  if (ASTEROID_BY_ID.has(normalized)) {
    return normalized;
  }
  const lowered = normalized.toLowerCase();
  return ASTEROID_ID_BY_NAME.get(lowered) || ASTEROID_CLASSES[0].id;
}

function asteroidClassFor(asteroid) {
  const classId = asteroid && (asteroid.asteroidClassId || asteroid.asteroid_class_id || asteroid.id || asteroid.classId || asteroid.class_id || asteroid.displayName);
  return ASTEROID_BY_ID.get(asteroidClassIdFrom(classId)) || ASTEROID_CLASSES[0];
}

function hashString(value) {
  let hash = 2166136261;
  String(value).split("").forEach((char) => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return hash >>> 0;
}

function seededRandom(seed) {
  let next = seed >>> 0;
  return () => {
    next += 0x6D2B79F5;
    let value = next;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const value = String(hex || "#ffffff").replace("#", "");
  const number = Number.parseInt(value.length === 3 ? value.split("").map((char) => char + char).join("") : value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

function rgba(hex, alpha) {
  const color = hexToRgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function asteroidModel(meta) {
  const random = seededRandom(hashString(meta.id));
  const pointCount = 22;
  const points = Array.from({ length: pointCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / pointCount;
    return {
      angle,
      radius: 0.72 + random() * 0.34
    };
  });
  const craters = Array.from({ length: 9 }, () => ({
    angle: random() * Math.PI * 2,
    distance: 0.18 + random() * 0.58,
    radius: 0.035 + random() * 0.055,
    shade: 0.18 + random() * 0.22
  }));
  const sparks = Array.from({ length: 20 }, () => ({
    x: random(),
    y: random(),
    radius: 0.7 + random() * 1.8,
    alpha: 0.24 + random() * 0.54
  }));
  return { points, craters, sparks };
}

function drawAsteroidCanvas(timestamp = 0) {
  if (!asteroidCanvas || !activeAsteroidVisual) {
    return;
  }
  const rect = asteroidCanvas.getBoundingClientRect();
  const size = Math.max(120, Math.round(Math.min(rect.width || 320, rect.height || 320) * window.devicePixelRatio));
  if (asteroidCanvas.width !== size || asteroidCanvas.height !== size) {
    asteroidCanvas.width = size;
    asteroidCanvas.height = size;
  }
  const ctx = asteroidCanvas.getContext("2d");
  const meta = activeAsteroidVisual;
  const model = asteroidModel(meta);
  const center = size / 2;
  const radius = size * 0.28;
  const rotation = reducedMotion.matches ? 0.35 : timestamp / 4200;
  const progress = Math.max(0, Math.min(1, activeAsteroidProgress / 100));

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  model.sparks.forEach((spark) => {
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 255, 255, ${spark.alpha})`;
    ctx.arc(spark.x * size, spark.y * size, spark.radius * window.devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.translate(center, center);
  ctx.rotate(rotation);
  ctx.beginPath();
  model.points.forEach((point, index) => {
    const phase = point.angle;
    const squash = 0.78 + Math.cos(rotation + phase) * 0.08;
    const x = Math.cos(phase) * radius * point.radius;
    const y = Math.sin(phase) * radius * point.radius * squash;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
  const fill = ctx.createRadialGradient(-radius * 0.36, -radius * 0.42, radius * 0.12, 0, 0, radius * 1.2);
  fill.addColorStop(0, rgba(meta.glow, 0.74));
  fill.addColorStop(0.32, meta.base);
  fill.addColorStop(1, meta.shade);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rgba(meta.glow, 0.62);
  ctx.lineWidth = Math.max(1, size * 0.008);
  ctx.stroke();

  model.craters.forEach((crater) => {
    const x = Math.cos(crater.angle) * radius * crater.distance;
    const y = Math.sin(crater.angle) * radius * crater.distance * 0.72;
    ctx.beginPath();
    ctx.fillStyle = `rgba(0, 0, 0, ${crater.shade})`;
    ctx.ellipse(x, y, radius * crater.radius * 1.6, radius * crater.radius, -rotation, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  ctx.beginPath();
  ctx.strokeStyle = rgba(meta.glow, 0.68);
  ctx.lineWidth = Math.max(3, size * 0.018);
  ctx.arc(center, center, size * 0.39, Math.PI * 0.58, Math.PI * (0.58 + 1.18 * progress));
  ctx.stroke();
}

function startAsteroidAnimation() {
  if (asteroidAnimationStarted || !asteroidCanvas) {
    return;
  }
  asteroidAnimationStarted = true;
  const tick = (timestamp) => {
    drawAsteroidCanvas(timestamp);
    if (!reducedMotion.matches) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
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

function normalizeRawSyncRows(snapshot) {
  const rows = [];
  snapshot.forEach((entry) => {
    rows.push(rawSyncEventPayload({ ...entry.data(), eventId: entry.id }));
  });
  return rows.slice(0, 8);
}

function rawSyncEventPayload(event) {
  const observedFields = event.observedFields && typeof event.observedFields === "object" ? event.observedFields : {};
  const payload = {
    eventId: event.eventId || event.event_id || "",
    eventType: event.eventType || event.event_type || "",
    schemaVersion: event.schemaVersion || event.schema_version || 1,
    receiptSchemaVersion: event.receiptSchemaVersion || event.receipt_schema_version || null,
    receiptType: event.receiptType || event.receipt_type || null,
    sequence: numberValue(event.sequence),
    timestamp: event.timestamp || null,
    sessionId: event.sessionId || event.session_id || null,
    turnId: event.turnId || event.turn_id || null,
    observedFields: {
      category: observedFields.category || null,
      rewardControlReasons: Array.isArray(observedFields.rewardControlReasons) ? observedFields.rewardControlReasons : [],
      scoreHint: observedFields.scoreHint ?? null,
      score: observedFields.score ?? null,
      scoreSource: observedFields.scoreSource || null,
      serverCalculated: observedFields.serverCalculated === true,
      scoreCapped: observedFields.scoreCapped === true
    },
    privacyClass: event.privacyClass || event.privacy_class || "abstract",
    source: event.source || "codex_hook",
    checksum: event.checksum || null,
    signature: event.signature || null,
    receivedAt: event.receivedAt || event.received_at || null,
    reducedAt: event.reducedAt || event.reduced_at || null
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null && value !== undefined));
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
  const displayName = (currentAsteroid && (currentAsteroid.displayName || currentAsteroid.display_name)) ||
    (progress && (progress.displayName || progress.display_name)) ||
    "Cloud asteroid";
  const asteroidClassId = (progress && (progress.asteroidClassId || progress.asteroid_class_id || progress.id)) ||
    (currentAsteroid && (currentAsteroid.asteroidClassId || currentAsteroid.asteroid_class_id || currentAsteroid.id)) ||
    asteroidClassIdFrom(displayName);
  return {
    asteroidClassId,
    displayName,
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
  if (failedIndexes.includes(11)) {
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
    getDocs(query(collection(db, "players", user.uid, "rewardEvents"), orderBy("receivedAt", "desc"), limit(8))),
    getSyncState({})
  ]);

  const player = docsData(reads, 0) || {};
  const profile = docsData(reads, 1) || {};
  const settings = docsData(reads, 2) || {};
  const directStateExists = docExists(reads, 3);
  const directSyncExists = docExists(reads, 4);
  const directState = docsData(reads, 3) || {};
  const directSync = docsData(reads, 4) || {};
  const callable = reads[11] && reads[11].status === "fulfilled" ? reads[11].value.data : {};
  const cloudState = callable.state || directState;
  const syncMetadata = callable.syncMetadata || directSync;
  const inventory = normalizeInventoryRows(queryResult(reads, 7) || { forEach() {} }, cloudState);
  const orders = normalizeOrderRows(queryResult(reads, 8) || { forEach() {} });
  const syncDevices = normalizeDeviceRows(queryResult(reads, 9) || { forEach() {} });
  const rawSyncEvents = normalizeRawSyncRows(queryResult(reads, 10) || { forEach() {} });
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
  fallback.entitlement = callable.entitlement || {};
  fallback.inventory = inventory.length ? inventory : fallback.inventory;
  fallback.orders = orders.length ? orders : fallback.orders;
  fallback.syncDevices = syncDevices;
  fallback.rawSyncEvents = rawSyncEvents;
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

  const linkLabel = linkModeLabel(currentUser);
  connectionPill.textContent = linkLabel ? linkLabel.pill : (currentUser ? "Signed in" : "Demo mode");
  dashboardMode.textContent = linkLabel ? linkLabel.mode : (data.mode || (currentUser ? "Cloud profile ready" : "Signed-out demo"));
  dashboardSource.textContent = linkLabel ? linkLabel.source : (data.source || "Local demo snapshot");
  lastUpdated.textContent = linkLabel ? linkLabel.updated : timestampLabel(cloudState.updatedAt || syncMetadata.updatedAt || new Date());
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
  renderAsteroidArt(asteroid, progress);
  renderAsteroidAtlas(asteroid);

  renderInventory(inventory);
  renderOrders(data.orders || []);
  renderUpgrades(data.upgrades || []);
  renderStore(data);
  renderReports(data.reports || []);
  renderRawSyncEvents(data.rawSyncEvents || []);
  renderCloudDetail(cloudState, asteroid, data.syncDevices || []);
  renderBase(data.base || {});
  renderPrivacy(data);
}

function renderAsteroidArt(asteroid, progress) {
  const meta = asteroidClassFor(asteroid);
  activeAsteroidVisual = meta;
  activeAsteroidProgress = progress;
  asteroidArt.src = meta.image;
  asteroidArt.alt = `${meta.displayName} procedural asteroid visualization`;
  asteroidArt.dataset.asteroidId = meta.id;
  asteroidCanvas.dataset.asteroidId = meta.id;
  drawAsteroidCanvas(performance.now());
  startAsteroidAnimation();
}

function renderAsteroidAtlas(asteroid) {
  const currentId = asteroidClassFor(asteroid).id;
  asteroidAtlas.innerHTML = ASTEROID_CLASSES.map((item) => `
    <article class="asteroid-card" aria-current="${item.id === currentId ? "true" : "false"}">
      <img src="${item.image}" alt="${escapeHtml(item.displayName)} asteroid class art">
      <strong>${escapeHtml(item.displayName)}</strong>
      <span>Tier ${formatNumber(item.unlockTier)}</span>
    </article>
  `).join("");
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

function renderRawSyncEvents(events) {
  rawSyncCount.textContent = `${formatNumber(events.length)} shown`;
  if (!events.length) {
    rawSyncList.innerHTML = `<p class="empty-state">No abstract sync payloads have been stored yet.</p>`;
    return;
  }

  rawSyncList.innerHTML = events.slice(0, 8).map((event) => {
    const title = `${eventLabel({ lastEventId: event.eventType })} #${formatNumber(event.sequence)}`;
    return `
      <article class="raw-sync-item">
        <div class="raw-sync-meta">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(timestampLabel(event.receivedAt || event.timestamp))}</span>
        </div>
        <pre class="raw-sync-json">${escapeHtml(JSON.stringify(event, null, 2))}</pre>
      </article>
    `;
  }).join("");
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
    await reloadCurrentUser();
    if (requiresEmailVerification(currentUser)) {
      renderDeviceLink(currentUser);
      renderDashboard(verificationDashboard());
      setMessage(EMAIL_VERIFICATION_REQUIRED, true);
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
  handleAuth(() => createPasswordAccount());
});

googleSignInButton.addEventListener("click", () => {
  handleAuth(() => signInWithPopup(auth, googleProvider));
});

sendVerificationEmailButton.addEventListener("click", () => {
  handleAuth(() => sendVerificationEmailFor(currentUser));
});

signOutButton.addEventListener("click", () => {
  handleAuth(() => signOutCurrentUser());
});

topbarSignOutButton.addEventListener("click", () => {
  handleAuth(() => signOutCurrentUser());
});

themeToggle.addEventListener("click", () => {
  toggleTheme();
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
  setLinkMode();
  updateAuthControls(user);
  renderDeviceLink(user);
  if (!user) {
    authStatus.textContent = "Signed out";
    authIdentity.textContent = "Not signed in";
    emailVerificationStatus.textContent = "Not signed in";
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

  if (requiresEmailVerification(user)) {
    authStatus.textContent = "Verify email";
    authIdentity.textContent = "Email pending";
    profileStatus.textContent = "Verification required";
    renderDeviceLink(user);
    renderDashboard(verificationDashboard());
    const verificationJustSent = Date.now() - verificationEmailSentAt < 5000;
    setMessage(verificationJustSent ? EMAIL_VERIFICATION_SENT : EMAIL_VERIFICATION_REQUIRED, !verificationJustSent);
    return;
  }

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

applyTheme(preferredTheme());
setLinkMode();
renderDeviceLink(currentUser);
renderDashboard(cloneDemo());
