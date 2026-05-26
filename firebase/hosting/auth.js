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

const FREE_ENTITLEMENT = {
  plan: "free",
  billingStatus: "free",
  entitlementStatus: "free",
  providerCustomerId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  syncCadenceSeconds: 60,
  maxDevices: 1,
  historyRetentionDays: 7,
  features: {
    nearRealTimeSync: false,
    deviceManagement: false,
    backupRestore: false,
    advancedDashboard: false,
    premiumCosmetics: false,
    weeklyDigest: false,
    exports: false,
    priorityBetaAccess: false
  }
};

const PORTAL_POLLING = {
  minSeconds: 10,
  freeSeconds: 60
};

const DEMO_COSMETICS = {
  schemaVersion: 1,
  privacyClass: "abstract",
  noProgressionEffects: true,
  retentionRules: {
    free: "Always available and retained.",
    unlockable: "Retained after downgrade once earned or granted.",
    pro_included: "Active only while Pro access is active.",
    retired: "Retained only by accounts that already own it.",
    beta: "Active only with Pro priority beta access."
  },
  applied: {
    requested: {
      suit_trim: "suit_trim_basic",
      portal_theme: "portal_theme_standard",
      base_skin: "base_skin_cabin_warm",
      profile_badge: "profile_badge_rookie",
      seasonal_variant: "seasonal_variant_none"
    },
    active: {
      suit_trim: "suit_trim_basic",
      portal_theme: "portal_theme_standard",
      base_skin: "base_skin_cabin_warm",
      profile_badge: "profile_badge_rookie",
      seasonal_variant: "seasonal_variant_none"
    },
    inactive: {}
  },
  categories: {
    suit_trim: [
      { id: "suit_trim_basic", category: "suit_trim", displayName: "Standard Suit Trim", description: "Default pressure-suit trim.", availability: "free", state: "owned", owned: true, locked: false, lockedReason: null, canPreview: true, canApply: true, active: true, swatch: "#1f7a5a", noProgressionEffects: true },
      { id: "suit_trim_aurora", category: "suit_trim", displayName: "Aurora Suit Trim", description: "Pro included suit accent.", availability: "pro_included", state: "locked", owned: false, locked: true, lockedReason: "plan_limit_premium_cosmetic", canPreview: true, canApply: false, active: false, swatch: "#58c79b", noProgressionEffects: true }
    ],
    portal_theme: [
      { id: "portal_theme_standard", category: "portal_theme", displayName: "Standard Portal", description: "Default high-contrast portal theme.", availability: "free", state: "owned", owned: true, locked: false, lockedReason: null, canPreview: true, canApply: true, active: true, swatch: "#17201b", themeKey: "standard", noProgressionEffects: true },
      { id: "portal_theme_nebula", category: "portal_theme", displayName: "Nebula Console", description: "Pro included portal colors.", availability: "pro_included", state: "locked", owned: false, locked: true, lockedReason: "plan_limit_premium_cosmetic", canPreview: true, canApply: false, active: false, swatch: "#2d5b91", themeKey: "nebula", noProgressionEffects: true }
    ],
    base_skin: [
      { id: "base_skin_cabin_warm", category: "base_skin", displayName: "Warm Cabin", description: "Standard cozy base-room skin.", availability: "free", state: "owned", owned: true, locked: false, lockedReason: null, canPreview: true, canApply: true, active: true, swatch: "#92400e", noProgressionEffects: true }
    ],
    profile_badge: [
      { id: "profile_badge_rookie", category: "profile_badge", displayName: "Rookie Miner Badge", description: "Starter profile badge.", availability: "free", state: "owned", owned: true, locked: false, lockedReason: null, canPreview: true, canApply: true, active: true, swatch: "#15583f", noProgressionEffects: true },
      { id: "profile_badge_founder_legacy", category: "profile_badge", displayName: "Founder Legacy Badge", description: "Retired badge retained by existing owners.", availability: "retired", state: "locked", owned: false, locked: true, lockedReason: "retired", canPreview: true, canApply: false, active: false, swatch: "#334155", noProgressionEffects: true }
    ],
    seasonal_variant: [
      { id: "seasonal_variant_none", category: "seasonal_variant", displayName: "Standard Season", description: "No seasonal overlay.", availability: "free", state: "owned", owned: true, locked: false, lockedReason: null, canPreview: true, canApply: true, active: true, swatch: "#66766d", noProgressionEffects: true }
    ]
  }
};

const DEMO_WEEKLY_DIGEST = {
  ok: true,
  schemaVersion: 1,
  privacyClass: "abstract",
  status: "locked",
  week: {
    label: "Demo week",
    startAt: null,
    endAt: null
  },
  preferences: {
    weeklyDigestEnabled: true,
    betaFeaturesEnabled: false,
    betaAvailable: false,
    effectiveBetaAccess: false
  },
  summary: {
    events: {
      eventCount: 18,
      workScore: 842,
      categories: [
        { category: "implementation", events: 9, score: 420 },
        { category: "validation", events: 5, score: 260 }
      ]
    },
    chonks: {
      mined: 1840
    },
    spaceBucks: {
      current: 1240
    },
    materials: {
      types: 4,
      units: 1925,
      valueSpaceBucks: 533
    },
    orders: {
      activeOrders: 2,
      fulfillableOrders: 1,
      rewardSpaceBucks: 530
    },
    sync: {
      acceptedCount: 18,
      duplicateCount: 0,
      rejectedCount: 0,
      conflictState: "none",
      activeDevices: 1
    },
    milestones: {
      eventMilestones: 0,
      scoreMilestones: 3,
      asteroidMilestones: 3,
      orderReadyMilestone: true,
      materialMilestone: true
    },
    base: {
      moduleCount: 2,
      droneLevel: 1
    },
    cosmetics: {
      activeSelections: 5,
      categories: ["base_skin", "portal_theme", "profile_badge", "seasonal_variant", "suit_trim"]
    }
  },
  highlights: [
    "18 abstract work events scored this week.",
    "1840 Chonks are reflected in synced inventory.",
    "1 order ready for fulfillment."
  ],
  delivery: {
    inPortal: true,
    email: "not_enabled"
  }
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
    cloudSyncEnabled: false,
    weeklyDigestEnabled: true,
    betaFeaturesEnabled: false
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
    lastAcceptedBatchAt: "Demo snapshot",
    duplicateCount: 0,
    rejectedCount: 0
  },
  syncCadence: {
    cadenceSeconds: 60,
    mode: "batch",
    nextEligibleSyncAt: null,
    retryAfterSeconds: 0,
    canAcceptNow: true
  },
  syncDevices: [
    {
      deviceId: "device_demo",
      deviceName: "Demo Codex",
      status: "active",
      createdAt: "Demo snapshot",
      lastUsedAt: "Demo snapshot"
    }
  ],
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
      schemaVersion: 2,
      receiptSchemaVersion: 2,
      receiptType: "abstract_work",
      sequence: 18,
      observedFields: {
        score: 8,
        scoreHint: 8,
        category: "implementation",
        scoreSource: "server_receipt_v2",
        serverCalculated: true
      },
      privacyClass: "abstract",
      source: "codex_hook",
      receivedAt: "Demo snapshot"
    }
  ],
  base: {
    moduleCount: 2,
    droneLevel: 1,
    storageBonus: "1.10x"
  },
  analytics: {
    retention: {
      days: 7,
      limited: true,
      returnedEvents: 18
    },
    trends: {
      workScoreOverTime: [
        { day: "Demo", score: 842, events: 18 }
      ],
      eventsByCategory: [
        { category: "implementation", events: 9, score: 420 },
        { category: "validation", events: 5, score: 260 }
      ],
      spaceBucksTrend: [
        { day: "Demo", value: 1240 }
      ],
      materialValueTrend: [
        { day: "Demo", value: 533 }
      ],
      orderEfficiency: [
        { day: "Demo", value: 50 }
      ]
    },
    syncHealth: {
      acceptedCount: 18,
      duplicateCount: 0,
      rejectedCount: 0,
      conflictState: "none",
      activeDevices: 1
    },
    current: {
      spaceBucks: 1240,
      materialValue: 533,
      orderEfficiency: {
        readyPercent: 50,
        activeOrders: 2,
        fulfillableOrders: 1
      }
    },
    history: []
  },
  cosmetics: DEMO_COSMETICS,
  weeklyDigest: DEMO_WEEKLY_DIGEST,
  entitlement: FREE_ENTITLEMENT
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
    cloudSyncEnabled: true,
    weeklyDigestEnabled: true,
    betaFeaturesEnabled: false
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
    lastAcceptedBatchAt: null,
    duplicateCount: 0,
    rejectedCount: 0
  },
  syncCadence: {
    cadenceSeconds: 60,
    mode: "batch",
    nextEligibleSyncAt: null,
    retryAfterSeconds: 0,
    canAcceptNow: true
  },
  syncDevices: [],
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
  },
  analytics: {
    retention: {
      days: 7,
      limited: true,
      returnedEvents: 0
    },
    trends: {
      workScoreOverTime: [],
      eventsByCategory: [],
      spaceBucksTrend: [],
      materialValueTrend: [],
      orderEfficiency: []
    },
    syncHealth: {
      acceptedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      conflictState: "none",
      activeDevices: 0
    },
    current: {
      spaceBucks: 0,
      materialValue: 0,
      orderEfficiency: {
        readyPercent: 0,
        activeOrders: 0,
        fulfillableOrders: 0
      }
    },
    history: []
  },
  cosmetics: DEMO_COSMETICS,
  weeklyDigest: {
    ...DEMO_WEEKLY_DIGEST,
    status: "locked",
    highlights: [],
    summary: {
      ...DEMO_WEEKLY_DIGEST.summary,
      events: {
        eventCount: 0,
        workScore: 0,
        categories: []
      },
      chonks: {
        mined: 0
      },
      spaceBucks: {
        current: 0
      },
      materials: {
        types: 0,
        units: 0,
        valueSpaceBucks: 0
      },
      orders: {
        activeOrders: 0,
        fulfillableOrders: 0,
        rewardSpaceBucks: 0
      }
    }
  },
  entitlement: FREE_ENTITLEMENT
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
const LINK_STATE_MESSAGES = {
  approved: {
    label: "Approved",
    summary: "Device approved. Return to Codex and run complete_account_link."
  },
  rejected: {
    label: "Rejected",
    summary: "Device link rejected. Start a new link from Codex if you want to connect later."
  },
  expired: {
    label: "Expired",
    summary: "This link code expired. Return to Codex and start a new account link."
  },
  invalid: {
    label: "Invalid link",
    summary: "This link code was not found. Return to Codex and start a new account link."
  },
  alreadyApproved: {
    label: "Already approved",
    summary: "This Codex device was already approved. Return to Codex and complete the account link."
  },
  alreadyExchanged: {
    label: "Completed",
    summary: "This link was already completed. Return to Codex or start a new link for another device."
  },
  approving: {
    label: "Approving",
    summary: "Approving this Codex device for abstract MCP Miner game progress sync."
  },
  rejecting: {
    label: "Rejecting",
    summary: "Rejecting this Codex device link."
  }
};
const LINK_LOCKED_STATES = new Set(["approved", "rejected", "expired", "invalid", "alreadyApproved", "alreadyExchanged", "approving", "rejecting"]);
const LINK_ERROR_MESSAGES = [
  { status: "expired", patterns: ["expired"], message: LINK_STATE_MESSAGES.expired.summary },
  { status: "invalid", patterns: ["not_found", "not-found", "not found"], message: LINK_STATE_MESSAGES.invalid.summary },
  { status: "alreadyApproved", patterns: ["already_approved", "already approved"], message: LINK_STATE_MESSAGES.alreadyApproved.summary },
  { status: "alreadyExchanged", patterns: ["already_exchanged", "already exchanged", "exchanged"], message: LINK_STATE_MESSAGES.alreadyExchanged.summary },
  { status: "rejected", patterns: ["already_rejected", "link session rejected", " rejected"], message: LINK_STATE_MESSAGES.rejected.summary },
  { status: "invalid", patterns: ["invalid-argument", "invalid argument", "permission-denied", "permission denied"], message: "This link could not be verified. Return to Codex and start a new account link." },
  { status: "waiting", patterns: ["unauthenticated"], message: "Sign in before approving this Codex device." }
];
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
const syncCadence = document.querySelector("#sync-cadence");
const syncNextRefresh = document.querySelector("#sync-next-refresh");
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
const analyticsSummary = document.querySelector("#analytics-summary");
const analyticsList = document.querySelector("#analytics-list");
const exportJson = document.querySelector("#export-json");
const exportCsv = document.querySelector("#export-csv");
const exportStatus = document.querySelector("#export-status");
const weeklyDigestStatus = document.querySelector("#weekly-digest-status");
const weeklyDigestSummary = document.querySelector("#weekly-digest-summary");
const weeklyDigestList = document.querySelector("#weekly-digest-list");
const weeklyDigestEnabled = document.querySelector("#weekly-digest-enabled");
const betaFeaturesEnabled = document.querySelector("#beta-features-enabled");
const betaAccessStatus = document.querySelector("#beta-access-status");
const cosmeticsSummary = document.querySelector("#cosmetics-summary");
const cosmeticsList = document.querySelector("#cosmetics-list");
const cosmeticsStatus = document.querySelector("#cosmetics-status");
const billingStatus = document.querySelector("#billing-status");
const billingSummary = document.querySelector("#billing-summary");
const billingPlan = document.querySelector("#billing-plan");
const billingDevices = document.querySelector("#billing-devices");
const billingSync = document.querySelector("#billing-sync");
const planCards = document.querySelector("#plan-cards");
const checkoutMonthly = document.querySelector("#checkout-monthly");
const checkoutAnnual = document.querySelector("#checkout-annual");
const manageBilling = document.querySelector("#manage-billing");
const deviceLinkPanel = document.querySelector("[data-panel=\"device-link\"]");
const deviceLinkStatus = document.querySelector("#device-link-status");
const deviceLinkSummary = document.querySelector("#device-link-summary");
const deviceLinkCode = document.querySelector("#device-link-code");
const approveDeviceLink = document.querySelector("#approve-device-link");
const rejectDeviceLink = document.querySelector("#reject-device-link");
const linkedDevicesUsage = document.querySelector("#linked-devices-usage");
const linkedDevicesSummary = document.querySelector("#linked-devices-summary");
const linkedDevicesList = document.querySelector("#linked-devices-list");
const linkParams = new URLSearchParams(window.location.search);
const pendingLink = {
  sessionId: linkParams.get("sessionId") || "",
  code: linkParams.get("linkCode") || linkParams.get("code") || ""
};

let currentUser = null;
let activeDashboard = cloneDemo();
let activeCosmeticPreview = null;
let activeAsteroidVisual = ASTEROID_CLASSES[0];
let activeAsteroidProgress = 0;
let asteroidAnimationStarted = false;
let deviceLinkState = "waiting";
let verificationEmailSentAt = 0;
let portalRefreshTimer = null;
let portalRefreshInFlight = false;
let planCatalog = {
  currency: "usd",
  annualMonthsCharged: 11,
  plans: []
};
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.dataset.tone = isError ? "error" : "success";
}

async function loadPlanCatalog() {
  try {
    const response = await fetch("/subscription-plans.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const catalog = await response.json();
    if (Array.isArray(catalog.plans)) {
      planCatalog = catalog;
      renderBilling(activeDashboard.entitlement);
    }
  } catch (error) {
    // The dashboard still renders the signed-out demo if the public catalog cannot be fetched.
  }
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

function planLabel(plan) {
  const labels = {
    free: "Free",
    pro_monthly: "Pro Monthly",
    pro_annual: "Pro Annual"
  };
  return labels[plan] || displayNameFromId(plan || "free");
}

function moneyFromCents(cents, suffix = "") {
  const value = numberValue(cents) / 100;
  return value <= 0 ? "$0" : `$${value.toFixed(value % 1 === 0 ? 0 : 2)}${suffix}`;
}

function planPriceLabel(plan) {
  if (plan.billingInterval === "annual") {
    return `${moneyFromCents(plan.annualPriceCents)}/yr`;
  }
  if (plan.billingInterval === "monthly") {
    return `${moneyFromCents(plan.monthlyPriceCents)}/mo`;
  }
  return "$0";
}

function annualDiscountCopy() {
  const monthly = planCatalog.plans.find((plan) => plan.id === "pro_monthly");
  const annual = planCatalog.plans.find((plan) => plan.id === "pro_annual");
  const monthsCharged = numberValue(planCatalog.annualMonthsCharged, 11);
  if (!monthly || !annual || !monthly.monthlyPriceCents || !annual.annualPriceCents) {
    return "Annual billing gives 12 months for the price of 11.";
  }
  const expectedAnnual = monthly.monthlyPriceCents * monthsCharged;
  const consistent = expectedAnnual === annual.annualPriceCents;
  return consistent
    ? `Annual: 12 months for the price of ${formatNumber(monthsCharged)}.`
    : "Annual discount follows the configured yearly price.";
}

function normalizedEntitlement(entitlement) {
  return {
    ...FREE_ENTITLEMENT,
    ...(entitlement || {}),
    features: {
      ...FREE_ENTITLEMENT.features,
      ...((entitlement && entitlement.features) || {})
    }
  };
}

function billingSummaryText(entitlement) {
  if (!currentUser) {
    return "Free works locally; Pro adds faster cloud sync and portal convenience without collecting private work data.";
  }
  if (requiresEmailVerification(currentUser)) {
    return "Verify your email before starting checkout or managing billing.";
  }
  if (entitlement.billingStatus === "past_due") {
    const grace = entitlement.gracePeriodEnd ? ` through ${timestampLabel(entitlement.gracePeriodEnd)}` : "";
    return `Payment needs attention. Pro access remains active${grace}, then Free limits apply until billing is fixed.`;
  }
  if (entitlement.billingStatus === "unpaid") {
    return "Payment failed. This account is on Free limits until billing is updated.";
  }
  if (entitlement.cancelAtPeriodEnd) {
    const end = entitlement.currentPeriodEnd ? ` on ${timestampLabel(entitlement.currentPeriodEnd)}` : " at period end";
    return `Cancellation scheduled. Pro access ends${end}, then Free cadence and one-device limits apply.`;
  }
  if (entitlement.entitlementStatus === "pro") {
    const renewal = entitlement.cancelAtPeriodEnd ? "ends" : "renews";
    const period = entitlement.currentPeriodEnd ? ` ${renewal} ${timestampLabel(entitlement.currentPeriodEnd)}` : "";
    return `${planLabel(entitlement.plan)}${period}. Up to ${formatNumber(entitlement.maxDevices)} Codex devices with near-real-time sync.`;
  }
  if (entitlement.accessReason === "canceled" || entitlement.billingStatus === "canceled") {
    return "Pro access has ended. Free cloud sync remains available for one Codex device every minute.";
  }
  if (entitlement.billingStatus === "checkout_pending") {
    return "Checkout started. Pro unlocks only after Stripe confirms the subscription webhook.";
  }
  return "Free sync batches every minute for one Codex device.";
}

function renderBilling(rawEntitlement) {
  const entitlement = normalizedEntitlement(rawEntitlement);
  const signedIn = Boolean(currentUser);
  const verificationRequired = requiresEmailVerification(currentUser);
  const pro = entitlement.entitlementStatus === "pro";
  billingStatus.textContent = pro ? "Pro" : "Free";
  billingPlan.textContent = planLabel(entitlement.plan);
  billingDevices.textContent = `${formatNumber(entitlement.maxDevices)} Codex`;
  billingSync.textContent = entitlement.features.nearRealTimeSync ? "Near real time" : `${formatNumber(entitlement.syncCadenceSeconds)} sec`;
  billingSummary.textContent = billingSummaryText(entitlement);
  billingSummary.dataset.tone = pro ? "success" : "";
  checkoutMonthly.disabled = !signedIn || verificationRequired || pro;
  checkoutAnnual.disabled = !signedIn || verificationRequired || pro;
  manageBilling.disabled = !signedIn || verificationRequired || !entitlement.providerCustomerId;
  renderPlanCards(entitlement);
}

function planActionState(plan, entitlement, signedIn, verificationRequired) {
  const current = entitlement.plan === plan.id || (entitlement.entitlementStatus !== "pro" && plan.id === "free");
  if (current) {
    return { label: "Current", disabled: true };
  }
  if (plan.id === "free") {
    return { label: "Included", disabled: true };
  }
  if (!signedIn) {
    return { label: "Sign in", disabled: true };
  }
  if (verificationRequired) {
    return { label: "Verify email", disabled: true };
  }
  if (entitlement.entitlementStatus === "pro") {
    return { label: "Manage", disabled: true };
  }
  return { label: plan.billingInterval === "annual" ? "Upgrade annual" : "Upgrade monthly", disabled: false };
}

function renderPlanCards(entitlement) {
  const signedIn = Boolean(currentUser);
  const verificationRequired = requiresEmailVerification(currentUser);
  if (!planCatalog.plans.length) {
    planCards.innerHTML = "<p class=\"empty-state\">Loading subscription plans.</p>";
    return;
  }

  planCards.innerHTML = planCatalog.plans.map((plan) => {
    const action = planActionState(plan, entitlement, signedIn, verificationRequired);
    const entitlements = plan.entitlements || {};
    const cadence = entitlements.nearRealTimeSync ? `${formatNumber(entitlements.syncCadenceSeconds)} sec sync` : `${formatNumber(entitlements.syncCadenceSeconds)} sec batches`;
    const annual = plan.billingInterval === "annual" ? `<span>${escapeHtml(annualDiscountCopy())}</span>` : "";
    return `
      <article class="plan-card" role="listitem" data-current="${action.label === "Current" ? "true" : "false"}">
        <div class="plan-card-top">
          <strong>${escapeHtml(plan.publicName)}</strong>
          <span>${escapeHtml(planPriceLabel(plan))}</span>
        </div>
        <p>${escapeHtml(plan.shortCopy)}</p>
        <div class="plan-facts">
          <span>${escapeHtml(formatNumber(entitlements.maxCodexDevices || 1))} Codex ${numberValue(entitlements.maxCodexDevices, 1) === 1 ? "device" : "devices"}</span>
          <span>${escapeHtml(cadence)}</span>
          <span>${escapeHtml(formatNumber(entitlements.historyRetentionDays || 7))} day history</span>
          ${annual}
        </div>
        <p class="plan-privacy">${escapeHtml(plan.privacyCopy)}</p>
        <button type="button" class="button-secondary plan-action" data-plan="${escapeHtml(plan.id)}" ${action.disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>
      </article>
    `;
  }).join("");
}

function activeDeviceCount(devices) {
  return devices.filter((device) => device.status !== "revoked").length;
}

function deviceLimitSummary(entitlement, devices) {
  const activeCount = activeDeviceCount(devices);
  const maxDevices = numberValue(entitlement.maxDevices, 1);
  if (!currentUser) {
    return "Sign in to manage connected Codex computers.";
  }
  if (maxDevices <= 1) {
    return activeCount >= 1
      ? "Free includes one active Codex device. Upgrade to Pro for up to five connected computers."
      : "Free includes one active Codex device. Link this computer from Codex when ready.";
  }
  if (activeCount >= maxDevices) {
    return `Pro device slots are full: ${formatNumber(activeCount)} of ${formatNumber(maxDevices)} active. Revoke a device before linking another.`;
  }
  return `Pro device slots used: ${formatNumber(activeCount)} of ${formatNumber(maxDevices)}.`;
}

function renderLinkedDevices(devices = [], rawEntitlement = FREE_ENTITLEMENT) {
  const entitlement = normalizedEntitlement(rawEntitlement);
  const activeCount = activeDeviceCount(devices);
  const maxDevices = numberValue(entitlement.maxDevices, 1);
  linkedDevicesUsage.textContent = `${formatNumber(activeCount)} / ${formatNumber(maxDevices)}`;
  linkedDevicesSummary.textContent = deviceLimitSummary(entitlement, devices);
  linkedDevicesSummary.dataset.tone = entitlement.entitlementStatus === "pro" ? "success" : "";

  if (!currentUser) {
    linkedDevicesList.innerHTML = "<p class=\"empty-state\">Sign in to manage linked Codex devices.</p>";
    return;
  }
  if (!devices.length) {
    linkedDevicesList.innerHTML = "<p class=\"empty-state\">No linked Codex devices yet.</p>";
    return;
  }

  linkedDevicesList.innerHTML = devices.map((device) => {
    const revoked = device.status === "revoked";
    const name = device.deviceName || "Codex device";
    return `
      <article class="device-row" data-device-id="${escapeHtml(device.deviceId)}">
        <div class="device-main">
          <input class="device-name-input" value="${escapeHtml(name)}" aria-label="Device name" maxlength="80" ${revoked ? "disabled" : ""}>
          <span>${escapeHtml(revoked ? "Revoked" : "Active")} - Created ${escapeHtml(timestampLabel(device.createdAt))}</span>
          <span>Last sync ${escapeHtml(timestampLabel(device.lastUsedAt))}</span>
        </div>
        <div class="device-actions">
          <button type="button" class="button-secondary device-rename" ${revoked ? "disabled" : ""}>Rename</button>
          <button type="button" class="button-secondary device-revoke" ${revoked ? "disabled" : ""}>Revoke</button>
        </div>
      </article>
    `;
  }).join("");
}

function nextEligibleFromMetadata(syncMetadata, cadenceSeconds) {
  const lastAccepted = syncMetadata && (syncMetadata.lastAcceptedBatchAt || syncMetadata.last_accepted_batch_at);
  const lastMillis = Date.parse(lastAccepted || "");
  if (Number.isNaN(lastMillis) || cadenceSeconds <= 0) {
    return null;
  }
  return new Date(lastMillis + (cadenceSeconds * 1000)).toISOString();
}

function syncCadenceModel(rawCadence, rawEntitlement, syncMetadata = {}) {
  const entitlement = normalizedEntitlement(rawEntitlement);
  const cadence = rawCadence || {};
  const cadenceSeconds = numberValue(cadence.cadenceSeconds || cadence.cadence_seconds, entitlement.syncCadenceSeconds);
  const nextEligibleSyncAt = cadence.nextEligibleSyncAt || cadence.next_eligible_sync_at || nextEligibleFromMetadata(syncMetadata, cadenceSeconds);
  const retryAfterSeconds = numberValue(cadence.retryAfterSeconds || cadence.retry_after_seconds, 0);
  const nextMillis = Date.parse(nextEligibleSyncAt || "");
  const canAcceptNow = Object.prototype.hasOwnProperty.call(cadence, "canAcceptNow") || Object.prototype.hasOwnProperty.call(cadence, "can_accept_now")
    ? cadence.canAcceptNow !== false && cadence.can_accept_now !== false
    : Number.isNaN(nextMillis) || nextMillis <= Date.now();
  return {
    cadenceSeconds,
    mode: cadence.mode || (entitlement.features.nearRealTimeSync ? "near_real_time" : "batch"),
    nextEligibleSyncAt,
    retryAfterSeconds,
    canAcceptNow
  };
}

function syncCadenceLabel(details) {
  return details.mode === "near_real_time"
    ? `${formatNumber(details.cadenceSeconds)} sec`
    : `${formatNumber(details.cadenceSeconds)} sec batch`;
}

function clearPortalRefreshTimer() {
  if (portalRefreshTimer) {
    window.clearTimeout(portalRefreshTimer);
    portalRefreshTimer = null;
  }
}

function portalPollingSeconds(rawEntitlement) {
  const entitlement = normalizedEntitlement(rawEntitlement);
  if (!currentUser || requiresEmailVerification(currentUser)) {
    return 0;
  }
  const cadenceSeconds = numberValue(entitlement.syncCadenceSeconds, PORTAL_POLLING.freeSeconds);
  return entitlement.features.nearRealTimeSync
    ? Math.max(PORTAL_POLLING.minSeconds, cadenceSeconds)
    : Math.max(PORTAL_POLLING.freeSeconds, cadenceSeconds);
}

function schedulePortalRefresh(rawEntitlement) {
  clearPortalRefreshTimer();
  const seconds = portalPollingSeconds(rawEntitlement);
  if (!seconds) {
    return null;
  }
  const nextRefreshAt = new Date(Date.now() + (seconds * 1000)).toISOString();
  portalRefreshTimer = window.setTimeout(() => {
    portalRefreshTimer = null;
    refreshForCurrentUser({ quiet: true, scheduled: true });
  }, seconds * 1000);
  return nextRefreshAt;
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
  if (deviceLinkState === "approved") {
    return {
      pill: "Approved",
      mode: "Return to Codex",
      source: "Codex link request",
      updated: "Link approved"
    };
  }
  if (deviceLinkState === "rejected") {
    return {
      pill: "Rejected",
      mode: "Start a new link",
      source: "Codex link request",
      updated: "Link rejected"
    };
  }
  if (LINK_STATE_MESSAGES[deviceLinkState] && LINK_LOCKED_STATES.has(deviceLinkState)) {
    return {
      pill: LINK_STATE_MESSAGES[deviceLinkState].label,
      mode: "Start a new link",
      source: "Codex link request",
      updated: LINK_STATE_MESSAGES[deviceLinkState].label
    };
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

function renderLinkModeHeader(user = currentUser) {
  const linkLabel = linkModeLabel(user);
  if (!linkLabel) {
    return false;
  }
  connectionPill.textContent = linkLabel.pill;
  dashboardMode.textContent = linkLabel.mode;
  dashboardSource.textContent = linkLabel.source;
  lastUpdated.textContent = linkLabel.updated;
  return true;
}

function friendlyLinkMessage(error) {
  const raw = `${(error && error.code) || ""} ${(error && error.message) || ""}`.toLowerCase();
  return LINK_ERROR_MESSAGES.find((entry) => entry.patterns.some((pattern) => raw.includes(pattern))) || {
    status: "invalid",
    message: "This link could not be updated. Return to Codex and start a new account link."
  };
}

function deviceLinkContent(user, status) {
  if (LINK_STATE_MESSAGES[status]) {
    return LINK_STATE_MESSAGES[status];
  }
  if (!user) {
    return {
      label: "Sign in",
      summary: "Use Google, Sign In, or Create Account below to approve this Codex device. Approval syncs only abstract MCP Miner game progress."
    };
  }
  if (requiresEmailVerification(user)) {
    return {
      label: "Verify email",
      summary: "Verify your email, then refresh this dashboard before approving this Codex device. Codex sync uses only abstract game progress after approval."
    };
  }
  return {
    label: "Ready",
    summary: "Approve this Codex device to sync Chonks, inventory, orders, upgrades, and abstract event counts. Prompts, code, commands, paths, repo names, terminal output, browser content, OpenAI account data, and transcripts are not synced."
  };
}

function renderDeviceLink(user, status = deviceLinkState) {
  if (!hasPendingLink()) {
    deviceLinkPanel.hidden = true;
    return;
  }

  setLinkMode();
  deviceLinkState = status;
  const signedIn = Boolean(user);
  const verificationRequired = requiresEmailVerification(user);
  const linkLocked = LINK_LOCKED_STATES.has(status);
  const content = deviceLinkContent(user, status);
  deviceLinkPanel.hidden = false;
  deviceLinkCode.textContent = pendingLink.code || "From link";
  approveDeviceLink.disabled = !signedIn || verificationRequired || linkLocked;
  rejectDeviceLink.disabled = !signedIn || verificationRequired || linkLocked;
  deviceLinkStatus.textContent = content.label;
  deviceLinkSummary.textContent = content.summary;
  renderLinkModeHeader(user);
}

async function submitDeviceLink(action) {
  if (!currentUser || !hasPendingLink()) {
    renderDeviceLink(currentUser);
    return;
  }

  const callable = httpsCallable(functions, action === "approve" ? "approveLinkSession" : "rejectLinkSession");
  renderDeviceLink(currentUser, action === "approve" ? "approving" : "rejecting");
  try {
    await reloadCurrentUser();
    if (requiresEmailVerification(currentUser)) {
      renderDeviceLink(currentUser, "waiting");
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
    const friendly = friendlyLinkMessage(error);
    renderDeviceLink(currentUser, friendly.status);
    setMessage(friendly.message, true);
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
    cloudSyncEnabled: true,
    weeklyDigestEnabled: true,
    betaFeaturesEnabled: false
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
      createdAt: data.createdAt || data.created_at || null,
      updatedAt: data.updatedAt || data.updated_at || null,
      lastUsedAt: data.lastUsedAt || data.last_used_at || null,
      revokedAt: data.revokedAt || data.revoked_at || null
    });
  });
  return rows
    .sort((left, right) => {
      const leftRevoked = left.status === "revoked" ? 1 : 0;
      const rightRevoked = right.status === "revoked" ? 1 : 0;
      if (leftRevoked !== rightRevoked) {
        return leftRevoked - rightRevoked;
      }
      return String(right.lastUsedAt || right.createdAt || "").localeCompare(String(left.lastUsedAt || left.createdAt || ""));
    })
    .slice(0, 12);
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
    observedFields: {
      score: numberValue(observedFields.score),
      scoreHint: observedFields.scoreHint,
      category: observedFields.category || null,
      scoreSource: observedFields.scoreSource || null,
      serverCalculated: observedFields.serverCalculated === true,
      scoreCapped: observedFields.scoreCapped === true
    },
    privacyClass: event.privacyClass || event.privacy_class || "",
    source: event.source || "",
    checksum: event.checksum || "",
    signature: event.signature ? "<redacted-signature>" : "",
    timestamp: event.timestamp || null,
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
  const getDashboardAnalytics = httpsCallable(functions, "getDashboardAnalytics");
  const getWeeklyDigest = httpsCallable(functions, "getWeeklyDigest");
  const getCosmeticCatalog = httpsCallable(functions, "getCosmeticCatalog");
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
    getSyncState({}),
    getDashboardAnalytics({}),
    getWeeklyDigest({}),
    getCosmeticCatalog({})
  ]);

  const player = docsData(reads, 0) || {};
  const profile = docsData(reads, 1) || {};
  const settings = docsData(reads, 2) || {};
  const directStateExists = docExists(reads, 3);
  const directSyncExists = docExists(reads, 4);
  const directState = docsData(reads, 3) || {};
  const directSync = docsData(reads, 4) || {};
  const callable = reads[11] && reads[11].status === "fulfilled" ? reads[11].value.data : {};
  const analytics = reads[12] && reads[12].status === "fulfilled" ? reads[12].value.data : null;
  const weeklyDigest = reads[13] && reads[13].status === "fulfilled" ? reads[13].value.data.weeklyDigest : null;
  const cosmetics = reads[14] && reads[14].status === "fulfilled" ? reads[14].value.data.cosmetics : null;
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
  fallback.entitlement = normalizedEntitlement(callable.entitlement);
  fallback.syncCadence = syncCadenceModel(callable.syncCadence, fallback.entitlement, fallback.syncMetadata);
  fallback.inventory = inventory.length ? inventory : fallback.inventory;
  fallback.orders = orders.length ? orders : fallback.orders;
  fallback.syncDevices = syncDevices;
  fallback.rawSyncEvents = rawSyncEvents;
  fallback.asteroid = cloudState.asteroidProgress || cloudState.asteroid_progress || cloudState.currentAsteroid || cloudState.current_asteroid ? normalizeAsteroid(cloudState) : fallback.asteroid;
  fallback.upgrades = upgrades.length ? upgrades : fallback.upgrades;
  fallback.store = cloudState.store || fallback.store;
  fallback.base = { ...fallback.base, ...base };
  fallback.reports = Array.isArray(cloudState.reports) && cloudState.reports.length ? cloudState.reports.slice(0, 5) : fallback.reports;
  fallback.analytics = analytics || fallback.analytics;
  fallback.weeklyDigest = weeklyDigest || fallback.weeklyDigest;
  fallback.cosmetics = cosmetics || fallback.cosmetics;
  return fallback;
}

function renderDashboard(data) {
  activeDashboard = data;
  const inventory = data.inventory || [];
  const cloudState = data.cloudState || {};
  const syncMetadata = data.syncMetadata || {};
  const cadence = syncCadenceModel(data.syncCadence, data.entitlement, syncMetadata);
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
  syncCadence.textContent = syncCadenceLabel(cadence);
  syncNextRefresh.textContent = cadence.canAcceptNow ? "Now" : timestampLabel(cadence.nextEligibleSyncAt);
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
  renderAnalytics(data.analytics || EMPTY_CLOUD_DASHBOARD.analytics, data.entitlement);
  renderWeeklyDigest(data.weeklyDigest || DEMO_WEEKLY_DIGEST, data.entitlement, data.settings || {});
  renderCosmetics(data.cosmetics || DEMO_COSMETICS);
  renderPrivacy(data);
  renderBilling(data.entitlement);
  renderLinkedDevices(data.syncDevices || [], data.entitlement);
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

function trendLastValue(rows, key = "value") {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return 0;
  }
  const last = list[list.length - 1];
  return numberValue(last[key]);
}

function topCategoryLabel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return "No categories";
  }
  const top = list[0];
  return `${displayNameFromId(top.category)} (${formatNumber(top.events)})`;
}

function renderAnalytics(analytics, rawEntitlement) {
  const entitlement = normalizedEntitlement(rawEntitlement);
  const retention = analytics.retention || {};
  const trends = analytics.trends || {};
  const current = analytics.current || {};
  const syncHealth = analytics.syncHealth || {};
  const orderEfficiency = current.orderEfficiency || {};
  const pro = entitlement.entitlementStatus === "pro";
  analyticsSummary.textContent = `${formatNumber(retention.days || entitlement.historyRetentionDays || 7)} day ${retention.limited ? "sample" : "history"}`;
  exportJson.disabled = !currentUser || !pro;
  exportCsv.disabled = !currentUser || !pro;
  exportStatus.textContent = pro ? "Exports contain abstract gameplay history only." : "Pro unlocks history export.";
  exportStatus.dataset.tone = pro ? "success" : "";
  analyticsList.innerHTML = [
    ["Work score", formatNumber(trendLastValue(trends.workScoreOverTime, "score")), `${formatNumber((analytics.history || []).length)} retained events`],
    ["Events by category", topCategoryLabel(trends.eventsByCategory), "Aggregated abstract work types"],
    ["Space Bucks", formatNumber(current.spaceBucks ?? trendLastValue(trends.spaceBucksTrend)), "Current cloud aggregate"],
    ["Material value", `${formatNumber(current.materialValue ?? trendLastValue(trends.materialValueTrend))} SB`, "Current synced inventory value"],
    ["Order efficiency", `${formatPercent(orderEfficiency.readyPercent ?? trendLastValue(trends.orderEfficiency))}`, `${formatNumber(orderEfficiency.fulfillableOrders)} / ${formatNumber(orderEfficiency.activeOrders)} ready`],
    ["Sync health", syncHealth.conflictState === "none" ? "Clear" : displayNameFromId(syncHealth.conflictState), `${formatNumber(syncHealth.activeDevices)} active devices`]
  ].map(([label, value, detail]) => `
    <article class="analytics-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");
}

function digestStatusLabel(status, entitlement) {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "disabled") {
    return "Disabled";
  }
  return normalizedEntitlement(entitlement).entitlementStatus === "pro" ? "Paused" : "Pro";
}

function topDigestCategory(categories = []) {
  if (!Array.isArray(categories) || !categories.length) {
    return "No categories";
  }
  const top = categories[0];
  return `${displayNameFromId(top.category)} (${formatNumber(top.events)})`;
}

function renderWeeklyDigest(digest, rawEntitlement, settings = {}) {
  const entitlement = normalizedEntitlement(rawEntitlement);
  const summary = (digest && digest.summary) || DEMO_WEEKLY_DIGEST.summary;
  const events = summary.events || {};
  const chonks = summary.chonks || {};
  const spaceBucks = summary.spaceBucks || {};
  const materials = summary.materials || {};
  const orders = summary.orders || {};
  const sync = summary.sync || {};
  const milestones = summary.milestones || {};
  const preferences = (digest && digest.preferences) || {};
  const pro = entitlement.entitlementStatus === "pro";
  weeklyDigestStatus.textContent = digestStatusLabel(digest && digest.status, entitlement);
  weeklyDigestStatus.dataset.tone = digest && digest.status === "ready" ? "success" : "";
  weeklyDigestEnabled.checked = preferences.weeklyDigestEnabled !== false && settings.weeklyDigestEnabled !== false;
  weeklyDigestEnabled.disabled = !currentUser;
  betaFeaturesEnabled.checked = preferences.betaFeaturesEnabled === true || settings.betaFeaturesEnabled === true;
  betaFeaturesEnabled.disabled = !currentUser || !pro || preferences.betaAvailable !== true;
  betaAccessStatus.textContent = preferences.effectiveBetaAccess ? "Beta on" : (preferences.betaAvailable ? "Beta off" : "Beta locked");

  weeklyDigestSummary.innerHTML = [
    ["Week", digest && digest.week ? digest.week.label : "Demo week", digest && digest.delivery && digest.delivery.inPortal ? "Portal" : "Portal only"],
    ["Work", `${formatNumber(events.eventCount)} events`, `${formatNumber(events.workScore)} score`],
    ["Chonks", formatNumber(chonks.mined), `${formatNumber(materials.types)} material types`],
    ["Space Bucks", formatNumber(spaceBucks.current), `${formatNumber(materials.valueSpaceBucks)} material value`],
    ["Orders", `${formatNumber(orders.fulfillableOrders)} / ${formatNumber(orders.activeOrders)} ready`, `${formatNumber(orders.rewardSpaceBucks)} SB queued`],
    ["Sync", sync.conflictState === "none" ? "Clear" : displayNameFromId(sync.conflictState), `${formatNumber(sync.activeDevices)} active devices`],
    ["Milestones", formatNumber(numberValue(milestones.eventMilestones) + numberValue(milestones.scoreMilestones) + numberValue(milestones.asteroidMilestones)), topDigestCategory(events.categories)]
  ].map(([label, value, detail]) => `
    <article class="digest-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");

  const highlights = Array.isArray(digest && digest.highlights) ? digest.highlights : [];
  weeklyDigestList.innerHTML = highlights.length
    ? highlights.map((highlight) => `<p>${escapeHtml(highlight)}</p>`).join("")
    : `<p class="empty-state">${pro ? "No weekly highlights yet." : "Pro unlocks the weekly portal digest."}</p>`;
}

function flattenCosmetics(cosmetics) {
  if (!cosmetics || typeof cosmetics !== "object") {
    return [];
  }
  if (Array.isArray(cosmetics.items)) {
    return cosmetics.items;
  }
  return Object.values(cosmetics.categories || {}).flat();
}

function cosmeticStateLabel(item) {
  if (activeCosmeticPreview === item.id) {
    return "Preview";
  }
  if (item.active) {
    return "Active";
  }
  if (item.inactive) {
    return "Inactive";
  }
  if (item.locked) {
    return displayNameFromId(item.lockedReason || "locked");
  }
  if (item.owned) {
    return "Owned";
  }
  return displayNameFromId(item.state || item.availability || "available");
}

function cosmeticCategoryLabel(category) {
  const labels = {
    suit_trim: "Suit Trims",
    portal_theme: "Portal Themes",
    base_skin: "Base Skins",
    profile_badge: "Profile Badges",
    seasonal_variant: "Seasonal"
  };
  return labels[category] || displayNameFromId(category);
}

function cosmeticApplyLabel(item) {
  if (item.active) {
    return "Applied";
  }
  if (item.locked) {
    return "Locked";
  }
  return "Apply";
}

function applyCosmeticTheme(cosmetics) {
  const activeThemeId = cosmetics && cosmetics.applied && cosmetics.applied.active
    ? cosmetics.applied.active.portal_theme
    : null;
  const previewItem = activeCosmeticPreview
    ? flattenCosmetics(cosmetics).find((item) => item.id === activeCosmeticPreview)
    : null;
  const activeTheme = flattenCosmetics(cosmetics).find((item) => item.id === activeThemeId);
  const themeKey = previewItem && previewItem.category === "portal_theme"
    ? previewItem.themeKey
    : activeTheme && activeTheme.themeKey;
  if (themeKey && themeKey !== "standard") {
    document.documentElement.dataset.cosmeticTheme = themeKey;
  } else {
    delete document.documentElement.dataset.cosmeticTheme;
  }
}

function renderCosmetics(cosmetics) {
  const catalog = cosmetics || DEMO_COSMETICS;
  const items = flattenCosmetics(catalog);
  const activeCount = items.filter((item) => item.active).length;
  const lockedCount = items.filter((item) => item.locked).length;
  cosmeticsSummary.textContent = `${formatNumber(activeCount)} active`;
  cosmeticsStatus.textContent = catalog.noProgressionEffects
    ? "Cosmetics are visual only and do not affect mining rewards, Space Bucks, or orders."
    : "Cosmetic rules unavailable.";
  cosmeticsStatus.dataset.tone = catalog.noProgressionEffects ? "success" : "error";
  applyCosmeticTheme(catalog);

  if (!items.length) {
    cosmeticsList.innerHTML = "<p class=\"empty-state\">No cosmetic catalog is available.</p>";
    return;
  }

  cosmeticsList.innerHTML = Object.entries(catalog.categories || {}).map(([category, categoryItems]) => `
    <section class="cosmetic-category" aria-label="${escapeHtml(cosmeticCategoryLabel(category))}">
      <div class="cosmetic-category-heading">
        <strong>${escapeHtml(cosmeticCategoryLabel(category))}</strong>
        <span>${formatNumber((categoryItems || []).filter((item) => item.locked).length)} locked</span>
      </div>
      ${(categoryItems || []).map((item) => {
        const stateLabel = cosmeticStateLabel(item);
        const applyLabel = cosmeticApplyLabel(item);
        return `
          <article class="cosmetic-row" data-cosmetic-id="${escapeHtml(item.id)}" data-category="${escapeHtml(item.category)}" data-state="${escapeHtml(activeCosmeticPreview === item.id ? "preview" : item.state || "available")}" data-locked="${item.locked ? "true" : "false"}">
            <span class="cosmetic-swatch" style="--cosmetic-swatch: ${escapeHtml(item.swatch || "#66766d")}"></span>
            <div>
              <strong>${escapeHtml(item.displayName)}</strong>
              <span>${escapeHtml(item.description || displayNameFromId(item.availability))}</span>
              <small>${escapeHtml(displayNameFromId(item.availability))}</small>
            </div>
            <span class="store-state">${escapeHtml(stateLabel)}</span>
            <div class="cosmetic-actions">
              <button type="button" class="button-secondary cosmetic-preview" data-cosmetic-id="${escapeHtml(item.id)}">Preview</button>
              <button type="button" class="button-secondary cosmetic-apply" data-cosmetic-id="${escapeHtml(item.id)}" data-category="${escapeHtml(item.category)}" ${!currentUser || !item.canApply || item.active ? "disabled" : ""}>${escapeHtml(applyLabel)}</button>
            </div>
          </article>
        `;
      }).join("")}
    </section>
  `).join("");

  if (lockedCount > 0 && !currentUser) {
    cosmeticsSummary.textContent = "Demo preview";
  }
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

async function refreshForCurrentUser(options = {}) {
  if (portalRefreshInFlight) {
    return;
  }
  portalRefreshInFlight = true;
  clearPortalRefreshTimer();
  refreshDashboard.disabled = true;
  const quiet = options.quiet === true;
  try {
    if (!currentUser) {
      renderDashboard(cloneDemo());
      if (!quiet) {
        setMessage("Demo preview refreshed.");
      }
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
    schedulePortalRefresh(data.entitlement);
    if (data.refreshWarning) {
      if (!quiet) {
        setMessage(data.refreshWarning, true);
      }
    } else if (!quiet) {
      setMessage(DASHBOARD_REFRESH_SUCCESS);
    }
  } catch (error) {
    renderDashboard(cloneDemo({
      mode: "Demo fallback",
      source: "Firebase read failed; showing local preview"
    }));
    if (!quiet) {
      setMessage(error.message || "Dashboard refresh failed.", true);
    }
  } finally {
    refreshDashboard.disabled = false;
    portalRefreshInFlight = false;
  }
}

async function openBillingSession(callableName, payload = {}) {
  if (!currentUser) {
    setMessage("Sign in before managing MCP Miner Pro.", true);
    return;
  }
  if (requiresEmailVerification(currentUser)) {
    setMessage(EMAIL_VERIFICATION_REQUIRED, true);
    return;
  }

  checkoutMonthly.disabled = true;
  checkoutAnnual.disabled = true;
  manageBilling.disabled = true;
  planCards.setAttribute("aria-busy", "true");
  planCards.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  setMessage("Opening secure billing.");
  try {
    const callable = httpsCallable(functions, callableName);
    const result = await callable({
      ...payload,
      uid: currentUser.uid,
      dashboardUrl: window.location.origin
    });
    const url = result && result.data && result.data.url;
    if (!url) {
      throw new Error("Stripe did not return a billing URL.");
    }
    window.location.assign(url);
  } catch (error) {
    planCards.removeAttribute("aria-busy");
    setMessage(error.message || "Stripe billing session failed.", true);
    renderBilling(activeDashboard && activeDashboard.entitlement);
  }
}

function friendlyDeviceError(error) {
  const reason = error && error.details && error.details.reason;
  if (reason === "plan_limit_device_count") {
    return "This plan has no available Codex device slots.";
  }
  return error && error.message ? error.message : "Linked device update failed.";
}

async function updateLinkedDevice(action, deviceId, name = "") {
  if (!currentUser) {
    setMessage("Sign in before managing linked Codex devices.", true);
    return;
  }
  if (requiresEmailVerification(currentUser)) {
    setMessage(EMAIL_VERIFICATION_REQUIRED, true);
    return;
  }

  const callable = httpsCallable(functions, action === "rename" ? "renameSyncDevice" : "revokeSyncDevice");
  try {
    await callable(action === "rename" ? { deviceId, name } : { deviceId });
    await refreshForCurrentUser();
    setMessage(action === "rename" ? "Device renamed." : "Device revoked.");
  } catch (error) {
    setMessage(friendlyDeviceError(error), true);
  }
}

async function requestHistoryExport(format) {
  if (!currentUser) {
    setMessage("Sign in before exporting history.", true);
    return;
  }
  if (requiresEmailVerification(currentUser)) {
    setMessage(EMAIL_VERIFICATION_REQUIRED, true);
    return;
  }

  exportJson.disabled = true;
  exportCsv.disabled = true;
  exportStatus.textContent = "Preparing export.";
  try {
    const callable = httpsCallable(functions, "exportDashboardHistory");
    const result = await callable({ format });
    const payload = result.data || {};
    const blob = new Blob([payload.content || ""], { type: payload.mimeType || "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = payload.filename || `mcp-miner-history.${format}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    exportStatus.textContent = `${format.toUpperCase()} export ready.`;
    exportStatus.dataset.tone = "success";
  } catch (error) {
    exportStatus.textContent = error.message || "History export failed.";
    exportStatus.dataset.tone = "error";
  } finally {
    const pro = normalizedEntitlement(activeDashboard.entitlement).entitlementStatus === "pro";
    exportJson.disabled = !currentUser || !pro;
    exportCsv.disabled = !currentUser || !pro;
  }
}

async function requestCosmeticApply(category, cosmeticId) {
  if (!currentUser) {
    setMessage("Sign in before applying portal cosmetics.", true);
    return;
  }
  if (requiresEmailVerification(currentUser)) {
    setMessage(EMAIL_VERIFICATION_REQUIRED, true);
    return;
  }

  cosmeticsList.setAttribute("aria-busy", "true");
  cosmeticsStatus.textContent = "Applying cosmetic.";
  try {
    const callable = httpsCallable(functions, "applyCosmeticSelection");
    const result = await callable({
      uid: currentUser.uid,
      category,
      cosmeticId
    });
    activeDashboard.cosmetics = result.data && result.data.cosmetics ? result.data.cosmetics : activeDashboard.cosmetics;
    activeDashboard.entitlement = result.data && result.data.entitlement ? result.data.entitlement : activeDashboard.entitlement;
    activeCosmeticPreview = null;
    renderDashboard(activeDashboard);
    setMessage("Cosmetic applied.");
  } catch (error) {
    cosmeticsStatus.textContent = error.message || "Cosmetic update failed.";
    cosmeticsStatus.dataset.tone = "error";
  } finally {
    cosmeticsList.removeAttribute("aria-busy");
  }
}

async function updatePortalPreference(field, value) {
  if (!currentUser) {
    setMessage("Sign in before updating portal preferences.", true);
    return;
  }
  if (requiresEmailVerification(currentUser)) {
    setMessage(EMAIL_VERIFICATION_REQUIRED, true);
    return;
  }
  const allowed = new Set(["weeklyDigestEnabled", "betaFeaturesEnabled"]);
  if (!allowed.has(field)) {
    setMessage("Portal preference is unavailable.", true);
    return;
  }

  weeklyDigestEnabled.disabled = true;
  betaFeaturesEnabled.disabled = true;
  try {
    await setDoc(doc(db, "players", currentUser.uid, "settings", "current"), {
      ownerUid: currentUser.uid,
      schemaVersion: 1,
      updatedAt: serverTimestamp(),
      privacyClass: "abstract",
      [field]: value
    }, { merge: true });
    await refreshForCurrentUser({ quiet: true });
    setMessage("Portal preference updated.");
  } catch (error) {
    setMessage(error.message || "Portal preference update failed.", true);
    renderWeeklyDigest(activeDashboard.weeklyDigest || DEMO_WEEKLY_DIGEST, activeDashboard.entitlement, activeDashboard.settings || {});
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

checkoutMonthly.addEventListener("click", () => {
  openBillingSession("createCheckoutSession", { plan: "pro_monthly" });
});

checkoutAnnual.addEventListener("click", () => {
  openBillingSession("createCheckoutSession", { plan: "pro_annual" });
});

manageBilling.addEventListener("click", () => {
  openBillingSession("createCustomerPortalSession");
});

exportJson.addEventListener("click", () => {
  requestHistoryExport("json");
});

exportCsv.addEventListener("click", () => {
  requestHistoryExport("csv");
});

cosmeticsList.addEventListener("click", (event) => {
  const preview = event.target.closest(".cosmetic-preview");
  if (preview) {
    activeCosmeticPreview = activeCosmeticPreview === preview.dataset.cosmeticId ? null : preview.dataset.cosmeticId;
    renderCosmetics(activeDashboard.cosmetics || DEMO_COSMETICS);
    return;
  }
  const apply = event.target.closest(".cosmetic-apply");
  if (!apply || apply.disabled) {
    return;
  }
  requestCosmeticApply(apply.dataset.category, apply.dataset.cosmeticId);
});

weeklyDigestEnabled.addEventListener("change", () => {
  updatePortalPreference("weeklyDigestEnabled", weeklyDigestEnabled.checked);
});

betaFeaturesEnabled.addEventListener("change", () => {
  updatePortalPreference("betaFeaturesEnabled", betaFeaturesEnabled.checked);
});

planCards.addEventListener("click", (event) => {
  const button = event.target.closest(".plan-action");
  if (!button || button.disabled) {
    return;
  }
  openBillingSession("createCheckoutSession", { plan: button.dataset.plan });
});

linkedDevicesList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const row = event.target.closest("[data-device-id]");
  if (!button || !row) {
    return;
  }
  const deviceId = row.dataset.deviceId;
  if (button.classList.contains("device-revoke")) {
    updateLinkedDevice("revoke", deviceId);
    return;
  }
  if (button.classList.contains("device-rename")) {
    const input = row.querySelector(".device-name-input");
    updateLinkedDevice("rename", deviceId, input ? input.value : "");
  }
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
    clearPortalRefreshTimer();
    activeCosmeticPreview = null;
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
    clearPortalRefreshTimer();
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
loadPlanCatalog();
