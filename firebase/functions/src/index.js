"use strict";

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const {
  CURRENT_SYNC_SCHEMA_VERSION,
  prepareSyncBatch,
  reduceCloudState
} = require("./sync");
const {
  DEVICE_TOKEN_PREFIX,
  deviceTokenHash,
  hasDeviceScope,
  newDeviceToken,
  newLinkSession,
  normalizeLinkCode,
  publicLinkSession,
  requirePendingSession,
  sanitizeDashboardUrl,
  secretHash,
  validateLinkSession
} = require("./linking");
const {
  deviceLimitDecision,
  evaluateEntitlement,
  publicEntitlement,
  syncCadenceStatus,
  syncCadenceDecision
} = require("./entitlements");
const {
  assertUidMatchesRequest,
  createCheckoutSession,
  createCustomerPortalSession,
  createStripeClient,
  stripeCustomerIdFromBilling
} = require("./billing");
const {
  handleStripeWebhookEvent,
  verifyStripeWebhookEvent
} = require("./stripe_webhooks");
const {
  backupConflict,
  sanitizeBackupPayload
} = require("./backups");
const {
  buildDashboardAnalytics,
  exportDashboardAnalytics
} = require("./analytics");
const {
  buildWeeklyDigest
} = require("./digests");
const {
  COSMETIC_SCHEMA_VERSION,
  normalizedCosmeticState,
  publicCosmeticCatalog,
  validateCosmeticSelection
} = require("./cosmetics");
const {
  RATE_LIMITS,
  rateLimitPublicDetails,
  recordRateLimit
} = require("./observability");

admin.initializeApp();
const db = admin.firestore();

function requestIp(request) {
  const raw = request.rawRequest || {};
  const forwarded = raw.headers && raw.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return raw.ip || "unknown";
}

function rateLimitSubjectForAuth(auth) {
  if (!auth) {
    return {
      subject: "anonymous",
      subjectType: "anonymous"
    };
  }
  if (auth.authType === "device_token") {
    return {
      subject: `${auth.uid}:${auth.deviceId}`,
      subjectType: "device_token"
    };
  }
  return {
    subject: auth.uid,
    subjectType: "firebase_uid"
  };
}

function rateLimitSubjectForRequest(request) {
  if (request.auth && request.auth.uid) {
    return {
      subject: request.auth.uid,
      subjectType: "firebase_uid"
    };
  }
  return {
    subject: requestIp(request),
    subjectType: "ip"
  };
}

async function requireOperationCapacity(operation, subjectInfo, now = new Date().toISOString()) {
  const policy = RATE_LIMITS[operation];
  if (!policy) {
    return null;
  }
  const decision = await recordRateLimit({
    db,
    operation,
    subject: subjectInfo.subject,
    subjectType: subjectInfo.subjectType,
    policy,
    now
  });
  if (decision.ok) {
    return decision;
  }
  logger.warn("mcp_miner_rate_limit_rejected", {
    privacyClass: "abstract",
    operation,
    subjectType: subjectInfo.subjectType,
    limit: decision.limit,
    windowSeconds: decision.windowSeconds,
    retryAfterSeconds: decision.retryAfterSeconds
  });
  throw new HttpsError("resource-exhausted", "Too many MCP Miner requests. Try again after the retry window.", rateLimitPublicDetails(operation, decision));
}

function logEntitlementRejection(decision, entitlement, context = {}) {
  if (!decision || decision.ok) {
    return;
  }
  logger.warn("mcp_miner_entitlement_operation_rejected", {
    privacyClass: "abstract",
    operation: context.operation || "unknown",
    authType: context.authType || null,
    uidPresent: context.uidPresent !== false,
    reason: decision.reason || "entitlement_limit",
    plan: entitlement && entitlement.plan ? entitlement.plan : "free",
    billingStatus: entitlement && entitlement.billingStatus ? entitlement.billingStatus : "missing",
    entitlementStatus: entitlement && entitlement.entitlementStatus ? entitlement.entitlementStatus : "free",
    maxDevices: decision.maxDevices || null,
    activeDevices: decision.activeDevices || null,
    cadenceSeconds: decision.cadenceSeconds || null,
    retryAfterSeconds: decision.retryAfterSeconds || null
  });
}

function logBillingError(operation, uidPresent, error, extra = {}) {
  logger.warn("mcp_miner_billing_error", {
    privacyClass: "abstract",
    operation,
    uidPresent,
    code: error && error.code ? error.code : "internal",
    ...extra
  });
}

function dashboardUrlFromRequest(request) {
  const requested = request.data && request.data.dashboardUrl;
  const configured = process.env.MCP_MINER_DASHBOARD_URL;
  try {
    return sanitizeDashboardUrl(requested, configured);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message);
  }
}

function bearerToken(request) {
  const header = request.rawRequest && request.rawRequest.headers && request.rawRequest.headers.authorization;
  const match = String(header || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function deviceTokenFromRequest(request) {
  const headers = request.rawRequest && request.rawRequest.headers ? request.rawRequest.headers : {};
  const explicit = headers["x-mcp-miner-device-token"] || headers["x-mcp-miner-sync-token"];
  if (explicit) {
    return String(explicit).trim();
  }

  const token = bearerToken(request);
  return token && token.startsWith(DEVICE_TOKEN_PREFIX) ? token : null;
}

function firebaseSignInProvider(request) {
  const token = request.auth && request.auth.token ? request.auth.token : {};
  return token.firebase && token.firebase.sign_in_provider ? token.firebase.sign_in_provider : "";
}

function requiresVerifiedPasswordEmail(request) {
  const token = request.auth && request.auth.token ? request.auth.token : {};
  return Boolean(token.email) &&
    firebaseSignInProvider(request) === "password" &&
    token.email_verified !== true;
}

function requireVerifiedFirebaseAuth(request) {
  if (requiresVerifiedPasswordEmail(request)) {
    throw new HttpsError("permission-denied", "Verify your email before using MCP Miner cloud sync.");
  }
}

function requireSignedInOwner(request, action) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", `Sign in before ${action}.`);
  }
  requireVerifiedFirebaseAuth(request);
  return request.auth.uid;
}

function cleanDeviceId(value) {
  const deviceId = String(value || "").trim();
  if (!/^device_[a-zA-Z0-9_-]{8,80}$/.test(deviceId)) {
    throw new HttpsError("invalid-argument", "A valid MCP Miner device ID is required.");
  }
  return deviceId;
}

function cleanDeviceName(value) {
  const name = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!name) {
    throw new HttpsError("invalid-argument", "Device name is required.");
  }
  return name;
}

function rethrowBillingError(error) {
  if (error instanceof HttpsError) {
    throw error;
  }
  const code = typeof error.code === "string" ? error.code : "internal";
  const allowed = new Set([
    "invalid-argument",
    "failed-precondition",
    "permission-denied",
    "unauthenticated",
    "internal"
  ]);
  throw new HttpsError(allowed.has(code) ? code : "internal", error.message || "Stripe billing failed.");
}

function activeDevicesQuery(uid) {
  return db.collection(`players/${uid}/syncDevices`).where("status", "==", "active");
}

function activeDevicesFromSnapshot(snapshot, currentDeviceId = null) {
  const devices = snapshot && snapshot.docs ? snapshot.docs.map((doc) => ({
    deviceId: doc.id,
    ...doc.data()
  })) : [];
  if (currentDeviceId && !devices.some((device) => device.deviceId === currentDeviceId)) {
    devices.push({
      deviceId: currentDeviceId,
      status: "active",
      createdAt: null
    });
  }
  return devices;
}

function entitlementLimitMessage(decision, entitlement) {
  const plan = entitlement && entitlement.plan ? entitlement.plan : "free";
  if (decision.reason === "plan_limit_device_count") {
    return plan === "free"
      ? "Free accounts can link one active Codex device. Disconnect another device or upgrade to Pro for up to five."
      : `Your MCP Miner plan allows ${decision.maxDevices} active Codex devices. Disconnect another device before linking this one.`;
  }
  if (decision.reason === "plan_limit_sync_cadence") {
    const cadence = Number(decision.cadenceSeconds || 60);
    const retry = Number(decision.retryAfterSeconds || cadence);
    return plan === "free"
      ? `Free cloud sync accepts one batch per minute. Local progress is still queued; retry in about ${retry} seconds or upgrade to Pro for near-real-time sync.`
      : `Cloud sync is limited to one batch every ${cadence} seconds for this plan. Local progress is still queued; retry in about ${retry} seconds.`;
  }
  return "MCP Miner plan entitlement limit reached.";
}

function throwEntitlementDecision(decision, entitlement, context = {}) {
  if (decision.ok) {
    return;
  }
  logEntitlementRejection(decision, entitlement, context);
  throw new HttpsError("resource-exhausted", entitlementLimitMessage(decision, entitlement), {
    reason: decision.reason,
    entitlement: publicEntitlement(entitlement),
    maxDevices: decision.maxDevices || null,
    activeDevices: decision.activeDevices || null,
    cadenceSeconds: decision.cadenceSeconds || null,
    retryAfterSeconds: decision.retryAfterSeconds || null,
    nextEligibleSyncAt: decision.nextEligibleSyncAt || null,
    syncMode: decision.mode || null
  });
}

function publicSyncCadence(status) {
  return {
    cadenceSeconds: status.cadenceSeconds || 0,
    mode: status.mode || "batch",
    nextEligibleSyncAt: status.nextEligibleSyncAt || null,
    retryAfterSeconds: status.retryAfterSeconds || 0,
    canAcceptNow: status.canAcceptNow !== false
  };
}

function requireBackupEntitlement(entitlement, context = {}) {
  if (!entitlement || !entitlement.features || entitlement.features.backupRestore !== true) {
    logEntitlementRejection({ ok: false, reason: "plan_limit_backup_restore" }, entitlement, context);
    throw new HttpsError("resource-exhausted", "Cloud backup and restore is a Pro benefit. Local play continues on Free.", {
      reason: "plan_limit_backup_restore",
      entitlement: publicEntitlement(entitlement)
    });
  }
}

function publicBackupMetadata(snapshot) {
  if (!snapshot || !snapshot.exists) {
    return null;
  }
  const data = snapshot.data() || {};
  return {
    backupId: snapshot.id,
    schemaVersion: data.schemaVersion || 1,
    privacyClass: "abstract",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    sourceDeviceId: data.sourceDeviceId || null,
    sourceUpdatedAt: data.sourceUpdatedAt || null,
    checksum: data.checksum || null,
    byteSize: data.byteSize || 0
  };
}

function requireExportEntitlement(entitlement, context = {}) {
  if (!entitlement || !entitlement.features || entitlement.features.exports !== true) {
    logEntitlementRejection({ ok: false, reason: "plan_limit_exports" }, entitlement, context);
    throw new HttpsError("resource-exhausted", "History exports are a Pro benefit.", {
      reason: "plan_limit_exports",
      entitlement: publicEntitlement(entitlement)
    });
  }
}

function rethrowCosmeticError(error, entitlement) {
  if (error instanceof HttpsError) {
    throw error;
  }
  const reason = error && error.reason ? error.reason : "cosmetic_validation_failed";
  const code = reason.startsWith("plan_limit_")
    ? "resource-exhausted"
    : (reason === "unknown_category" || reason === "unknown_cosmetic" ? "invalid-argument" : "failed-precondition");
  throw new HttpsError(code, error.message || "Cosmetic selection failed validation.", {
    reason,
    entitlement: publicEntitlement(entitlement)
  });
}

function publicCosmeticsFromSnapshots({ entitlement, profileSnap, cosmeticsSnap }) {
  return publicCosmeticCatalog({
    entitlement,
    profile: profileSnap && profileSnap.exists ? profileSnap.data() : {},
    cosmeticState: cosmeticsSnap && cosmeticsSnap.exists ? cosmeticsSnap.data() : {}
  });
}

function entitlementWithPortalPreferences(entitlement, settings = {}) {
  const next = {
    ...entitlement,
    features: {
      ...((entitlement && entitlement.features) || {})
    }
  };
  if (settings && settings.betaFeaturesEnabled === false) {
    next.features.priorityBetaAccess = false;
  }
  return next;
}

function snapshotDocs(snapshot) {
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
}

function activeDeviceCountFromSnapshot(snapshot) {
  return snapshot.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    return data.status !== "revoked";
  }).length;
}

async function loadAnalyticsData(uid, entitlement, now) {
  const eventLimit = entitlement.entitlementStatus === "pro" ? 2000 : 100;
  const [
    eventsSnap,
    stateSnap,
    syncSnap,
    inventorySnap,
    ordersSnap,
    devicesSnap
  ] = await Promise.all([
    db.collection(`players/${uid}/rewardEvents`).orderBy("timestamp", "desc").limit(eventLimit).get(),
    db.doc(`players/${uid}/gameState/current`).get(),
    db.doc(`players/${uid}/syncMetadata/default`).get(),
    db.collection(`players/${uid}/inventory`).limit(50).get(),
    db.collection(`players/${uid}/orders`).limit(50).get(),
    db.collection(`players/${uid}/syncDevices`).limit(50).get()
  ]);
  return buildDashboardAnalytics({
    events: snapshotDocs(eventsSnap),
    state: stateSnap.exists ? stateSnap.data() : {},
    syncMetadata: syncSnap.exists ? syncSnap.data() : {},
    inventory: snapshotDocs(inventorySnap),
    orders: snapshotDocs(ordersSnap),
    deviceCount: activeDeviceCountFromSnapshot(devicesSnap),
    entitlement,
    now
  });
}

async function loadWeeklyDigestData(uid, entitlement, settings, now) {
  const [
    eventsSnap,
    stateSnap,
    syncSnap,
    inventorySnap,
    ordersSnap,
    devicesSnap,
    baseSnap,
    cosmeticsSnap
  ] = await Promise.all([
    db.collection(`players/${uid}/rewardEvents`).orderBy("timestamp", "desc").limit(500).get(),
    db.doc(`players/${uid}/gameState/current`).get(),
    db.doc(`players/${uid}/syncMetadata/default`).get(),
    db.collection(`players/${uid}/inventory`).limit(50).get(),
    db.collection(`players/${uid}/orders`).limit(50).get(),
    db.collection(`players/${uid}/syncDevices`).limit(50).get(),
    db.doc(`players/${uid}/base/current`).get(),
    db.doc(`players/${uid}/cosmetics/current`).get()
  ]);
  return buildWeeklyDigest({
    events: snapshotDocs(eventsSnap),
    state: stateSnap.exists ? stateSnap.data() : {},
    syncMetadata: syncSnap.exists ? syncSnap.data() : {},
    inventory: snapshotDocs(inventorySnap),
    orders: snapshotDocs(ordersSnap),
    deviceCount: activeDeviceCountFromSnapshot(devicesSnap),
    base: baseSnap.exists ? baseSnap.data() : {},
    cosmeticState: cosmeticsSnap.exists ? cosmeticsSnap.data() : {},
    entitlement,
    settings,
    now
  });
}

async function readEntitlementInTransaction(transaction, uid, now) {
  const entitlementSnap = await transaction.get(db.doc(`players/${uid}/entitlements/current`));
  return evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
}

async function readActiveDevicesInTransaction(transaction, uid, currentDeviceId = null) {
  const snapshot = await transaction.get(activeDevicesQuery(uid));
  return activeDevicesFromSnapshot(snapshot, currentDeviceId);
}

function enforceActiveDeviceAccess({ entitlement, activeDevices, auth, operation }) {
  if (!auth || auth.authType !== "device_token") {
    return;
  }
  throwEntitlementDecision(deviceLimitDecision({
    entitlement,
    activeDevices,
    deviceId: auth.deviceId
  }), entitlement, {
    operation: operation || "device_token_access",
    authType: auth.authType,
    uidPresent: true
  });
}

function syncCursorId(auth) {
  return auth && auth.authType === "device_token" && auth.deviceId ? auth.deviceId : "default";
}

function syncCursorRef(uid, auth) {
  return db.doc(`players/${uid}/syncMetadata/${syncCursorId(auth)}`);
}

function legacyCursorFromDefault(cursorId, defaultSync) {
  const sync = defaultSync && typeof defaultSync === "object" ? defaultSync : {};
  if (cursorId !== "default") {
    return {};
  }
  return sync;
}

async function resolveLinkSessionRef(data) {
  const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
  if (sessionId) {
    return db.doc(`linkSessions/${sessionId}`);
  }

  const code = normalizeLinkCode(data.code || data.linkCode);
  if (!code) {
    throw new HttpsError("invalid-argument", "A link session ID or code is required.");
  }

  const codeSnap = await db.doc(`linkCodes/${code}`).get();
  if (codeSnap.exists && codeSnap.data().sessionId) {
    return db.doc(`linkSessions/${codeSnap.data().sessionId}`);
  }

  const snapshot = await db.collection("linkSessions")
    .where("code", "==", code)
    .where("status", "in", ["pending", "approved"])
    .limit(1)
    .get();
  if (snapshot.empty) {
    throw new HttpsError("not-found", "Link session not found.");
  }
  return snapshot.docs[0].ref;
}

async function resolveSyncAuth(request, requiredScope = null) {
  if (request.auth) {
    requireVerifiedFirebaseAuth(request);
    return {
      uid: request.auth.uid,
      authType: "firebase",
      deviceId: null,
      tokenHash: null
    };
  }

  const token = deviceTokenFromRequest(request);
  if (!token || !token.startsWith(DEVICE_TOKEN_PREFIX)) {
    throw new HttpsError("unauthenticated", "MCP Miner sync requires Firebase Auth or a linked device token.");
  }

  const hash = deviceTokenHash(token);
  const tokenSnap = await db.doc(`deviceTokens/${hash}`).get();
  const tokenData = tokenSnap.exists ? tokenSnap.data() : null;
  if (!tokenData || tokenData.status !== "active" || !tokenData.uid || !tokenData.deviceId) {
    throw new HttpsError("unauthenticated", "Linked device token is invalid or revoked.");
  }
  if (!hasDeviceScope(tokenData, requiredScope)) {
    throw new HttpsError("permission-denied", `Linked device token is missing ${requiredScope}.`);
  }

  return {
    uid: tokenData.uid,
    authType: "device_token",
    deviceId: tokenData.deviceId,
    tokenHash: hash
  };
}

function touchDeviceWrites(transaction, auth, now) {
  if (!auth || auth.authType !== "device_token") {
    return;
  }
  transaction.set(db.doc(`deviceTokens/${auth.tokenHash}`), {
    lastUsedAt: now
  }, { merge: true });
  transaction.set(db.doc(`players/${auth.uid}/syncDevices/${auth.deviceId}`), {
    lastUsedAt: now,
    status: "active"
  }, { merge: true });
}

exports.ping = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");

  logger.info("mcp_miner_ping", {
    privacyClass: "abstract",
    uidPresent: true,
    authType: auth.authType,
    emulator: process.env.FUNCTIONS_EMULATOR === "true"
  });

  return {
    ok: true,
    service: "mcp-miner",
    privacyClass: "abstract",
    authType: auth.authType,
    uid: auth.uid
  };
});

exports.syncRewardEvents = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:write");
  const uid = auth.uid;
  const events = Array.isArray(request.data && request.data.events) ? request.data.events : [];
  const receivedAt = new Date().toISOString();
  await requireOperationCapacity("syncRewardEvents", rateLimitSubjectForAuth(auth), receivedAt);
  const playerRef = db.doc(`players/${uid}`);
  const stateRef = db.doc(`players/${uid}/gameState/current`);
  const defaultSyncRef = db.doc(`players/${uid}/syncMetadata/default`);
  const cursorRef = syncCursorRef(uid, auth);
  const cursorId = syncCursorId(auth);
  const entitlementNow = receivedAt;
  const eventRefs = events.map((event, index) => {
    const eventId = event && typeof event.eventId === "string" && /^evt_[a-zA-Z0-9_-]+$/.test(event.eventId)
      ? event.eventId
      : `_invalid_${index}`;
    return db.doc(`players/${uid}/rewardEvents/${eventId}`);
  });

  try {
    const result = await db.runTransaction(async (transaction) => {
      const stateSnap = await transaction.get(stateRef);
      const defaultSyncSnap = await transaction.get(defaultSyncRef);
      const cursorSnap = cursorRef.path === defaultSyncRef.path ? defaultSyncSnap : await transaction.get(cursorRef);
      const entitlement = await readEntitlementInTransaction(transaction, uid, entitlementNow);
      const activeDevices = await readActiveDevicesInTransaction(transaction, uid, auth.deviceId);
      const eventSnaps = [];
      for (const ref of eventRefs) {
        eventSnaps.push(await transaction.get(ref));
      }
      enforceActiveDeviceAccess({ entitlement, activeDevices, auth, operation: "syncRewardEvents" });

      const state = stateSnap.exists ? stateSnap.data() : {
        ownerUid: uid,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract",
        eventCount: 0,
        workScoreTotal: 0,
        workEvents: {},
        lastSequence: 0
      };
      const defaultSync = defaultSyncSnap.exists ? defaultSyncSnap.data() : {};
      const cursorSync = cursorSnap.exists ? cursorSnap.data() : legacyCursorFromDefault(cursorId, defaultSync);
      const existingEventIds = eventSnaps
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => snapshot.id);
      const batch = prepareSyncBatch({
        uid,
        events,
        existingEventIds,
        lastSequence: Number(cursorSync.lastSequence || 0),
        receivedAt
      });
      throwEntitlementDecision(syncCadenceDecision({
        entitlement,
        lastAcceptedBatchAt: cursorSync.lastAcceptedBatchAt,
        now: receivedAt,
        acceptedCount: batch.accepted.length
      }), entitlement, {
        operation: "syncRewardEvents",
        authType: auth.authType,
        uidPresent: true
      });

      let reducedState = {
        ...state,
        ownerUid: uid,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract"
      };
      for (const event of batch.accepted) {
        const eventRef = db.doc(`players/${uid}/rewardEvents/${event.eventId}`);
        const enrichedEvent = {
          ...event,
          deviceId: auth.deviceId || null,
          authType: auth.authType,
          cursorId
        };
        transaction.set(eventRef, enrichedEvent, { merge: false });
        reducedState = reduceCloudState(reducedState, enrichedEvent, receivedAt);
      }

      transaction.set(playerRef, {
        ownerUid: uid,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract",
        cloudSyncEnabled: true,
        updatedAt: receivedAt
      }, { merge: true });
      transaction.set(stateRef, reducedState, { merge: true });
      const nextCursorSequence = Math.max(Number(cursorSync.lastSequence || 0), Number(batch.lastSequence || 0));
      const cursorUpdate = {
        ownerUid: uid,
        cursorId,
        deviceId: auth.deviceId || null,
        authType: auth.authType,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract",
        updatedAt: receivedAt,
        lastCloudEventId: batch.accepted.length > 0 ? reducedState.lastEventId : cursorSync.lastCloudEventId || null,
        lastSequence: nextCursorSequence,
        acceptedCount: FieldValue.increment(batch.accepted.length),
        duplicateCount: FieldValue.increment(batch.duplicates.length),
        rejectedCount: FieldValue.increment(batch.rejected.length),
        lastAcceptedBatchAt: batch.accepted.length > 0 ? receivedAt : cursorSync.lastAcceptedBatchAt || null,
        migratedFromDefault: cursorId !== "default" && !cursorSnap.exists && defaultSyncSnap.exists ? true : cursorSync.migratedFromDefault || false
      };
      transaction.set(cursorRef, cursorUpdate, { merge: true });
      if (cursorRef.path !== defaultSyncRef.path) {
        transaction.set(defaultSyncRef, {
          ownerUid: uid,
          cursorId: "default",
          schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
          privacyClass: "abstract",
          cursorMode: "per_device",
          updatedAt: receivedAt,
          lastCloudEventId: reducedState.lastEventId || defaultSync.lastCloudEventId || null,
          lastSequence: Math.max(Number(defaultSync.lastSequence || 0), Number(reducedState.lastSequence || 0), Number(batch.lastSequence || 0)),
          acceptedCount: FieldValue.increment(batch.accepted.length),
          duplicateCount: FieldValue.increment(batch.duplicates.length),
          rejectedCount: FieldValue.increment(batch.rejected.length),
          lastAcceptedBatchAt: batch.accepted.length > 0 ? receivedAt : defaultSync.lastAcceptedBatchAt || null,
          lastAcceptedBatchAuthType: batch.accepted.length > 0 ? auth.authType : defaultSync.lastAcceptedBatchAuthType || null,
          lastAcceptedBatchDeviceId: batch.accepted.length > 0 ? auth.deviceId : defaultSync.lastAcceptedBatchDeviceId || null
        }, { merge: true });
      }
      touchDeviceWrites(transaction, auth, receivedAt);

      const cadence = syncCadenceStatus({
        entitlement,
        lastAcceptedBatchAt: batch.accepted.length > 0 ? receivedAt : cursorSync.lastAcceptedBatchAt,
        now: receivedAt
      });

      return {
        ok: true,
        accepted: batch.accepted.map((event) => event.eventId),
        duplicates: batch.duplicates,
        rejected: batch.rejected,
        state: {
          eventCount: reducedState.eventCount,
          workScoreTotal: reducedState.workScoreTotal,
          lastEventId: reducedState.lastEventId,
          lastSequence: reducedState.lastSequence,
          workEvents: reducedState.workEvents
        },
        entitlement,
        syncCursor: {
          cursorId,
          deviceId: auth.deviceId || null,
          lastSequence: nextCursorSequence
        },
        syncCadence: publicSyncCadence(cadence)
      };
    });

    logger.info("mcp_miner_sync_reward_events", {
      privacyClass: "abstract",
      uidPresent: true,
      authType: auth.authType,
      requestedCount: events.length,
      acceptedCount: result.accepted.length,
      duplicateCount: result.duplicates.length,
      rejectedCount: result.rejected.length,
      cursorId: result.syncCursor.cursorId
    });

    return {
      ...result,
      entitlement: publicEntitlement(result.entitlement),
      privacyClass: "abstract"
    };
  } catch (error) {
    logger.warn("mcp_miner_sync_reward_events_rejected", {
      privacyClass: "abstract",
      uidPresent: true,
      authType: auth.authType,
      requestedCount: events.length,
      code: error.code || "invalid-argument",
      reason: error.details && error.details.reason ? error.details.reason : null
    });
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("invalid-argument", error.message || "Invalid MCP Miner sync payload.");
  }
});

exports.getSyncState = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");
  const uid = auth.uid;
  const entitlementNow = new Date().toISOString();
  const cursorRef = syncCursorRef(uid, auth);
  const defaultSyncRef = db.doc(`players/${uid}/syncMetadata/default`);
  const [stateSnap, syncSnap, cursorSnap, entitlementSnap, activeDevicesSnap] = await Promise.all([
    db.doc(`players/${uid}/gameState/current`).get(),
    defaultSyncRef.get(),
    cursorRef.path === defaultSyncRef.path ? defaultSyncRef.get() : cursorRef.get(),
    db.doc(`players/${uid}/entitlements/current`).get(),
    auth.authType === "device_token" ? activeDevicesQuery(uid).get() : Promise.resolve(null)
  ]);
  const entitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now: entitlementNow });
  enforceActiveDeviceAccess({
    entitlement,
    activeDevices: activeDevicesFromSnapshot(activeDevicesSnap, auth.deviceId),
    auth,
    operation: "getSyncState"
  });
  if (auth.authType === "device_token") {
    const now = new Date().toISOString();
    await Promise.all([
      db.doc(`deviceTokens/${auth.tokenHash}`).set({ lastUsedAt: now }, { merge: true }),
      db.doc(`players/${uid}/syncDevices/${auth.deviceId}`).set({ lastUsedAt: now, status: "active" }, { merge: true })
    ]);
  }

  logger.info("mcp_miner_get_sync_state", {
    privacyClass: "abstract",
    uidPresent: true,
    authType: auth.authType,
    hasState: stateSnap.exists
  });

  const cursorSync = cursorSnap.exists ? cursorSnap.data() : legacyCursorFromDefault(syncCursorId(auth), syncSnap.exists ? syncSnap.data() : {});
  return {
    ok: true,
    privacyClass: "abstract",
    state: stateSnap.exists ? stateSnap.data() : null,
    syncMetadata: syncSnap.exists ? syncSnap.data() : null,
    deviceSyncMetadata: cursorSync,
    entitlement,
    syncCadence: publicSyncCadence(syncCadenceStatus({
      entitlement,
      lastAcceptedBatchAt: cursorSync.lastAcceptedBatchAt,
      now: entitlementNow
    }))
  };
});

exports.getDashboardAnalytics = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");
  const now = new Date().toISOString();
  const entitlementSnap = await db.doc(`players/${auth.uid}/entitlements/current`).get();
  const entitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
  const analytics = await loadAnalyticsData(auth.uid, entitlement, now);
  return {
    ...analytics,
    entitlement: publicEntitlement(entitlement)
  };
});

exports.getWeeklyDigest = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");
  const now = new Date().toISOString();
  const [entitlementSnap, settingsSnap] = await Promise.all([
    db.doc(`players/${auth.uid}/entitlements/current`).get(),
    db.doc(`players/${auth.uid}/settings/current`).get()
  ]);
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const entitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
  const digest = await loadWeeklyDigestData(auth.uid, entitlement, settings, now);
  return {
    ok: true,
    privacyClass: "abstract",
    entitlement: publicEntitlement(entitlement),
    weeklyDigest: digest
  };
});

exports.getCosmeticCatalog = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");
  const now = new Date().toISOString();
  const [entitlementSnap, profileSnap, cosmeticsSnap, settingsSnap] = await Promise.all([
    db.doc(`players/${auth.uid}/entitlements/current`).get(),
    db.doc(`players/${auth.uid}/profile/current`).get(),
    db.doc(`players/${auth.uid}/cosmetics/current`).get(),
    db.doc(`players/${auth.uid}/settings/current`).get()
  ]);
  const evaluatedEntitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
  const entitlement = entitlementWithPortalPreferences(evaluatedEntitlement, settingsSnap.exists ? settingsSnap.data() : {});
  const cosmetics = publicCosmeticsFromSnapshots({ entitlement, profileSnap, cosmeticsSnap });
  return {
    ok: true,
    privacyClass: "abstract",
    entitlement: publicEntitlement(evaluatedEntitlement),
    cosmetics
  };
});

exports.applyCosmeticSelection = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:write");
  const requestedUid = request.data && request.data.uid ? String(request.data.uid) : null;
  if (requestedUid && requestedUid !== auth.uid) {
    throw new HttpsError("permission-denied", "Cosmetic selections are owner-scoped.");
  }

  const now = new Date().toISOString();
  const profileRef = db.doc(`players/${auth.uid}/profile/current`);
  const cosmeticsRef = db.doc(`players/${auth.uid}/cosmetics/current`);
  const entitlementRef = db.doc(`players/${auth.uid}/entitlements/current`);
  const settingsRef = db.doc(`players/${auth.uid}/settings/current`);

  const result = await db.runTransaction(async (transaction) => {
    const [entitlementSnap, profileSnap, cosmeticsSnap, settingsSnap] = await Promise.all([
      transaction.get(entitlementRef),
      transaction.get(profileRef),
      transaction.get(cosmeticsRef),
      transaction.get(settingsRef)
    ]);
    const evaluatedEntitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
    const entitlement = entitlementWithPortalPreferences(evaluatedEntitlement, settingsSnap.exists ? settingsSnap.data() : {});
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const cosmeticState = cosmeticsSnap.exists ? cosmeticsSnap.data() : {};
    let selection;
    try {
      selection = validateCosmeticSelection({
        selection: request.data || {},
        entitlement,
        profile,
        cosmeticState
      });
    } catch (error) {
      rethrowCosmeticError(error, entitlement);
    }

    const normalizedState = normalizedCosmeticState(cosmeticState);
    const nextState = {
      ownerUid: auth.uid,
      schemaVersion: COSMETIC_SCHEMA_VERSION,
      privacyClass: "abstract",
      applied: selection.applied,
      ownedCosmeticIds: normalizedState.ownedCosmeticIds,
      retainedCosmeticIds: normalizedState.retainedCosmeticIds,
      updatedAt: now,
      noProgressionEffects: true
    };
    transaction.set(cosmeticsRef, nextState, { merge: true });

    return {
      entitlement: evaluatedEntitlement,
      cosmetics: publicCosmeticCatalog({
        entitlement,
        profile,
        cosmeticState: nextState
      }),
      changedCategories: selection.changedCategories
    };
  });

  logger.info("mcp_miner_cosmetic_selection_applied", {
    privacyClass: "abstract",
    uidPresent: true,
    authType: auth.authType,
    changedCategories: result.changedCategories
  });

  return {
    ok: true,
    privacyClass: "abstract",
    entitlement: publicEntitlement(result.entitlement),
    cosmetics: result.cosmetics
  };
});

exports.exportDashboardHistory = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");
  const now = new Date().toISOString();
  await requireOperationCapacity("exportDashboardHistory", rateLimitSubjectForAuth(auth), now);
  const requestedUid = request.data && request.data.uid ? String(request.data.uid) : null;
  if (requestedUid && requestedUid !== auth.uid) {
    throw new HttpsError("permission-denied", "History exports are owner-scoped.");
  }
  const entitlementSnap = await db.doc(`players/${auth.uid}/entitlements/current`).get();
  const entitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
  requireExportEntitlement(entitlement, {
    operation: "exportDashboardHistory",
    authType: auth.authType,
    uidPresent: true
  });
  const format = request.data && request.data.format === "csv" ? "csv" : "json";
  const analytics = await loadAnalyticsData(auth.uid, entitlement, now);
  const exported = exportDashboardAnalytics(analytics, format);
  logger.info("mcp_miner_dashboard_history_exported", {
    privacyClass: "abstract",
    uidPresent: true,
    authType: auth.authType,
    format: exported.format,
    rowCount: exported.rowCount || 0
  });
  return {
    ok: true,
    privacyClass: "abstract",
    filename: `mcp-miner-history-${new Date(now).toISOString().slice(0, 10)}.${exported.format}`,
    ...exported
  };
});

exports.getCloudBackupStatus = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");
  const now = new Date().toISOString();
  const [entitlementSnap, backupSnap] = await Promise.all([
    db.doc(`players/${auth.uid}/entitlements/current`).get(),
    db.doc(`players/${auth.uid}/cloudBackups/current`).get()
  ]);
  const entitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
  return {
    ok: true,
    privacyClass: "abstract",
    eligible: entitlement.features && entitlement.features.backupRestore === true,
    entitlement: publicEntitlement(entitlement),
    backup: publicBackupMetadata(backupSnap)
  };
});

exports.createCloudBackup = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:write");
  const now = new Date().toISOString();
  await requireOperationCapacity("createCloudBackup", rateLimitSubjectForAuth(auth), now);
  const entitlementSnap = await db.doc(`players/${auth.uid}/entitlements/current`).get();
  const entitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
  requireBackupEntitlement(entitlement, {
    operation: "createCloudBackup",
    authType: auth.authType,
    uidPresent: true
  });

  let payload;
  try {
    payload = sanitizeBackupPayload(request.data && request.data.backup);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message || "Invalid MCP Miner backup payload.");
  }

  const backupDoc = {
    ownerUid: auth.uid,
    schemaVersion: payload.schemaVersion,
    privacyClass: "abstract",
    sourceDeviceId: auth.deviceId || (request.data && request.data.deviceId) || null,
    sourceUpdatedAt: request.data && request.data.localUpdatedAt ? String(request.data.localUpdatedAt) : now,
    payload,
    checksum: payload.checksum,
    byteSize: payload.byteSize,
    createdAt: now,
    updatedAt: now
  };
  await db.doc(`players/${auth.uid}/cloudBackups/current`).set(backupDoc, { merge: true });
  logger.info("mcp_miner_cloud_backup_created", {
    privacyClass: "abstract",
    uidPresent: true,
    authType: auth.authType,
    byteSize: payload.byteSize
  });

  return {
    ok: true,
    privacyClass: "abstract",
    backup: publicBackupMetadata({ id: "current", exists: true, data: () => backupDoc })
  };
});

exports.restoreCloudBackup = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request, "sync:read");
  const now = new Date().toISOString();
  await requireOperationCapacity("restoreCloudBackup", rateLimitSubjectForAuth(auth), now);
  if (!request.data || request.data.confirm !== true) {
    throw new HttpsError("failed-precondition", "Restore requires explicit confirmation.");
  }
  const [entitlementSnap, backupSnap] = await Promise.all([
    db.doc(`players/${auth.uid}/entitlements/current`).get(),
    db.doc(`players/${auth.uid}/cloudBackups/current`).get()
  ]);
  const entitlement = evaluateEntitlement(entitlementSnap.exists ? entitlementSnap.data() : null, { now });
  requireBackupEntitlement(entitlement, {
    operation: "restoreCloudBackup",
    authType: auth.authType,
    uidPresent: true
  });
  if (!backupSnap.exists) {
    throw new HttpsError("not-found", "No MCP Miner cloud backup is available for this account.");
  }
  const backup = backupSnap.data() || {};
  let restorePayload;
  try {
    restorePayload = sanitizeBackupPayload(backup.payload && backup.payload.sections ? backup.payload.sections : backup.payload);
    const storedChecksum = backup.checksum || (backup.payload && backup.payload.checksum);
    if (storedChecksum && restorePayload.checksum !== storedChecksum) {
      throw new Error("Stored backup checksum mismatch.");
    }
  } catch (error) {
    throw new HttpsError("data-loss", "Stored MCP Miner cloud backup failed safety validation.", {
      reason: "backup_validation_failed"
    });
  }
  const conflict = backupConflict({
    localUpdatedAt: request.data.localUpdatedAt || null,
    cloudUpdatedAt: backup.sourceUpdatedAt || backup.updatedAt || backup.createdAt,
    sourceDeviceId: backup.sourceDeviceId || null,
    targetDeviceId: auth.deviceId || null
  });
  logger.info("mcp_miner_cloud_backup_restore_requested", {
    privacyClass: "abstract",
    uidPresent: true,
    authType: auth.authType,
    freshness: conflict.freshness,
    deviceRelation: conflict.deviceRelation
  });

  return {
    ok: true,
    privacyClass: "abstract",
    backup: publicBackupMetadata(backupSnap),
    conflict,
    payload: restorePayload
  };
});

exports.createCheckoutSession = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before starting MCP Miner Pro checkout.");
  }
  requireVerifiedFirebaseAuth(request);
  const uid = request.auth.uid;
  const data = request.data || {};
  const now = new Date().toISOString();
  await requireOperationCapacity("createCheckoutSession", rateLimitSubjectForRequest(request), now);

  try {
    assertUidMatchesRequest(data, uid);
    const dashboardUrl = dashboardUrlFromRequest(request);
    logger.info("mcp_miner_stripe_checkout_start", {
      privacyClass: "abstract",
      uidPresent: true,
      plan: data.plan || null
    });
    const stripe = createStripeClient();
    const billingRef = db.doc(`players/${uid}/billing/current`);
    const entitlementRef = db.doc(`players/${uid}/entitlements/current`);
    const [billingSnap, entitlementSnap] = await Promise.all([
      billingRef.get(),
      entitlementRef.get()
    ]);
    const result = await createCheckoutSession(stripe, {
      uid,
      email: request.auth.token && request.auth.token.email,
      plan: data.plan,
      dashboardUrl,
      billing: billingSnap.exists ? billingSnap.data() : null,
      entitlement: entitlementSnap.exists ? entitlementSnap.data() : null,
      env: process.env,
      now
    });
    if (result.pendingBilling) {
      await billingRef.set(result.pendingBilling, { merge: true });
    }

    logger.info("mcp_miner_stripe_checkout_session", {
      privacyClass: "abstract",
      uidPresent: true,
      destination: result.destination,
      plan: result.plan || "manage"
    });

    return {
      ok: true,
      privacyClass: "abstract",
      destination: result.destination,
      plan: result.plan || null,
      sessionId: result.sessionId || null,
      url: result.url
    };
  } catch (error) {
    logBillingError("createCheckoutSession", true, error, {
      plan: data.plan || null
    });
    rethrowBillingError(error);
  }
});

exports.createCustomerPortalSession = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before managing MCP Miner Pro billing.");
  }
  requireVerifiedFirebaseAuth(request);
  const uid = request.auth.uid;
  const data = request.data || {};
  const now = new Date().toISOString();
  await requireOperationCapacity("createCustomerPortalSession", rateLimitSubjectForRequest(request), now);

  try {
    assertUidMatchesRequest(data, uid);
    const dashboardUrl = dashboardUrlFromRequest(request);
    logger.info("mcp_miner_stripe_customer_portal_start", {
      privacyClass: "abstract",
      uidPresent: true
    });
    const stripe = createStripeClient();
    const billingSnap = await db.doc(`players/${uid}/billing/current`).get();
    const customerId = stripeCustomerIdFromBilling(billingSnap.exists ? billingSnap.data() : null);
    const result = await createCustomerPortalSession(stripe, { customerId, dashboardUrl });

    logger.info("mcp_miner_stripe_customer_portal_session", {
      privacyClass: "abstract",
      uidPresent: true
    });

    return {
      ok: true,
      privacyClass: "abstract",
      destination: "portal",
      sessionId: result.sessionId || null,
      url: result.url
    };
  } catch (error) {
    logBillingError("createCustomerPortalSession", true, error);
    rethrowBillingError(error);
  }
});

exports.stripeWebhook = onRequest({ region: "us-central1" }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const stripe = createStripeClient();
    const signature = request.headers["stripe-signature"];
    const rawBody = request.rawBody || Buffer.from(JSON.stringify(request.body || {}));
    const event = verifyStripeWebhookEvent(stripe, rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    const result = await handleStripeWebhookEvent({
      event,
      db,
      stripe,
      env: process.env,
      now: new Date().toISOString()
    });
    logger.info("mcp_miner_stripe_webhook_processed", {
      privacyClass: "abstract",
      eventId: event.id,
      eventType: event.type,
      action: result.action,
      duplicate: result.duplicate === true
    });
    if (result.action === "project" && result.uid) {
      logger.info("mcp_miner_entitlement_projection_changed", {
        privacyClass: "abstract",
        provider: "stripe",
        uidPresent: true,
        eventId: event.id,
        plan: result.plan || null,
        billingStatus: result.billingStatus || null,
        entitlementStatus: result.entitlementStatus || null,
        accessReason: result.accessReason || null,
        currentPeriodEnd: result.currentPeriodEnd || null
      });
    }
    response.json({ ok: true, received: true, eventId: event.id, action: result.action, duplicate: result.duplicate === true });
  } catch (error) {
    logger.warn("mcp_miner_stripe_webhook_rejected", {
      privacyClass: "abstract",
      message: error.message || "Stripe webhook failed"
    });
    response.status(400).json({ ok: false, error: error.message || "Stripe webhook failed" });
  }
});

exports.createLinkSession = onCall({ region: "us-central1" }, async (request) => {
  const now = new Date();
  await requireOperationCapacity("createLinkSession", rateLimitSubjectForRequest(request), now.toISOString());
  const linkPolicy = evaluateEntitlement(null, { now: now.toISOString() });
  let nextSession = null;
  let nextDeviceSecret = null;
  let nextLinkUrl = null;
  const dashboardUrl = dashboardUrlFromRequest(request);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { session, deviceSecret, linkUrl } = newLinkSession({
      now,
      dashboardUrl,
      deviceName: request.data && request.data.deviceName
    });
    const sessionRef = db.doc(`linkSessions/${session.sessionId}`);
    const codeRef = db.doc(`linkCodes/${session.code}`);
    const created = await db.runTransaction(async (transaction) => {
      const codeSnap = await transaction.get(codeRef);
      const codeData = codeSnap.exists ? codeSnap.data() : null;
      const activeCollision = codeData &&
        ["pending", "approved"].includes(codeData.status) &&
        new Date(codeData.expiresAt).getTime() > now.getTime();
      if (activeCollision) {
        return false;
      }
      transaction.set(sessionRef, session, { merge: false });
      transaction.set(codeRef, {
        code: session.code,
        sessionId: session.sessionId,
        status: session.status,
        privacyClass: "abstract",
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt
      }, { merge: false });
      return true;
    });
    if (!created) {
      continue;
    }
    nextSession = session;
    nextDeviceSecret = deviceSecret;
    nextLinkUrl = linkUrl;
    break;
  }
  if (!nextSession) {
    throw new HttpsError("resource-exhausted", "Could not create a unique link code. Try again.");
  }
  logger.info("mcp_miner_link_session_created", {
    privacyClass: "abstract",
    sessionId: nextSession.sessionId,
    expiresAt: nextSession.expiresAt
  });

  return {
    ok: true,
    privacyClass: "abstract",
    session: publicLinkSession(nextSession),
    linkUrl: nextLinkUrl,
    linkPolicy: publicEntitlement(linkPolicy),
    deviceSecret: nextDeviceSecret,
    message: "Open the link while signed in to MCP Miner to approve this Codex device."
  };
});

exports.approveLinkSession = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before approving a Codex device.");
  }
  requireVerifiedFirebaseAuth(request);
  await requireOperationCapacity("approveLinkSession", rateLimitSubjectForRequest(request), new Date().toISOString());

  const ref = await resolveLinkSessionRef(request.data || {});
  const uid = request.auth.uid;
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const session = snapshot.exists ? snapshot.data() : null;
    const entitlement = await readEntitlementInTransaction(transaction, uid, now);
    const activeDevices = await readActiveDevicesInTransaction(transaction, uid);
    const validation = requirePendingSession(session);
    if (!validation.ok) {
      throw new HttpsError(validation.reason === "not_found" ? "not-found" : "failed-precondition", `Link session ${validation.reason}.`);
    }
    throwEntitlementDecision(deviceLimitDecision({
      entitlement,
      activeDevices,
      creatingNew: true
    }), entitlement, {
      operation: "approveLinkSession",
      authType: "firebase",
      uidPresent: true
    });

    const approved = {
      ...session,
      status: "approved",
      approvedUid: uid,
      approvedAt: now,
      updatedAt: now
    };
    transaction.set(ref, approved, { merge: true });
    transaction.set(db.doc(`linkCodes/${session.code}`), {
      status: "approved",
      approvedUid: uid,
      updatedAt: now
    }, { merge: true });
    transaction.set(db.doc(`players/${uid}`), {
      ownerUid: uid,
      schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
      privacyClass: "abstract",
      cloudSyncEnabled: true,
      updatedAt: now
    }, { merge: true });
    return { session: approved, entitlement };
  });

  logger.info("mcp_miner_link_session_approved", {
    privacyClass: "abstract",
    uidPresent: true,
    sessionId: result.session.sessionId
  });

  return {
    ok: true,
    privacyClass: "abstract",
    session: publicLinkSession(result.session),
    entitlement: publicEntitlement(result.entitlement),
    message: "Codex device approved. Return to Codex to complete linking."
  };
});

exports.rejectLinkSession = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before rejecting a Codex device.");
  }

  const ref = await resolveLinkSessionRef(request.data || {});
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const session = snapshot.exists ? snapshot.data() : null;
    const validation = requirePendingSession(session);
    if (!validation.ok) {
      throw new HttpsError(validation.reason === "not_found" ? "not-found" : "failed-precondition", `Link session ${validation.reason}.`);
    }
    const rejected = {
      ...session,
      status: "rejected",
      rejectedUid: request.auth.uid,
      rejectedAt: now,
      updatedAt: now
    };
    transaction.set(ref, rejected, { merge: true });
    transaction.set(db.doc(`linkCodes/${session.code}`), {
      status: "rejected",
      rejectedUid: request.auth.uid,
      updatedAt: now
    }, { merge: true });
    return rejected;
  });

  return {
    ok: true,
    privacyClass: "abstract",
    session: publicLinkSession(result)
  };
});

exports.exchangeLinkSession = onCall({ region: "us-central1" }, async (request) => {
  const sessionId = request.data && request.data.sessionId;
  const deviceSecret = request.data && request.data.deviceSecret;
  if (!sessionId || !deviceSecret) {
    throw new HttpsError("invalid-argument", "sessionId and deviceSecret are required.");
  }
  await requireOperationCapacity("exchangeLinkSession", {
    subject: String(sessionId),
    subjectType: "link_session"
  }, new Date().toISOString());

  const ref = db.doc(`linkSessions/${String(sessionId)}`);
  const now = new Date().toISOString();
  const token = newDeviceToken();
  const hash = deviceTokenHash(token);
  const deviceId = `device_${hash.slice(0, 20)}`;

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const session = snapshot.exists ? snapshot.data() : null;
    const validation = validateLinkSession(session);
    if (!validation.ok) {
      throw new HttpsError(validation.reason === "not_found" ? "not-found" : "failed-precondition", `Link session ${validation.reason}.`);
    }
    if (session.status !== "approved" || !session.approvedUid) {
      throw new HttpsError("failed-precondition", "Link session has not been approved yet.");
    }
    if (session.deviceSecretHash !== secretHash(deviceSecret)) {
      throw new HttpsError("permission-denied", "Device secret did not match this link session.");
    }

    const uid = session.approvedUid;
    const entitlement = await readEntitlementInTransaction(transaction, uid, now);
    const activeDevices = await readActiveDevicesInTransaction(transaction, uid);
    throwEntitlementDecision(deviceLimitDecision({
      entitlement,
      activeDevices,
      creatingNew: true
    }), entitlement, {
      operation: "exchangeLinkSession",
      authType: "link_session",
      uidPresent: true
    });

    transaction.set(db.doc(`deviceTokens/${hash}`), {
      uid,
      deviceId,
      status: "active",
      privacyClass: "abstract",
      scopes: ["sync:read", "sync:write"],
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null
    }, { merge: false });
    transaction.set(db.doc(`players/${uid}/syncDevices/${deviceId}`), {
      ownerUid: uid,
      deviceId,
      deviceName: session.deviceName || "Codex",
      status: "active",
      privacyClass: "abstract",
      scopes: ["sync:read", "sync:write"],
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      linkSessionId: session.sessionId
    }, { merge: false });
    transaction.set(ref, {
      status: "exchanged",
      exchangedAt: now,
      updatedAt: now,
      deviceId
    }, { merge: true });
    transaction.set(db.doc(`linkCodes/${session.code}`), {
      status: "exchanged",
      updatedAt: now,
      deviceId
    }, { merge: true });

    return { uid, deviceId, entitlement };
  });

  logger.info("mcp_miner_link_session_exchanged", {
    privacyClass: "abstract",
    uidPresent: true,
    deviceId: result.deviceId
  });

  return {
    ok: true,
    privacyClass: "abstract",
    uid: result.uid,
    deviceId: result.deviceId,
    deviceToken: token,
    tokenType: "mcp_miner_device",
    scopes: ["sync:read", "sync:write"],
    entitlement: publicEntitlement(result.entitlement),
    message: "MCP Miner account linked. Store this device token locally; it will not be shown again."
  };
});

exports.revokeDeviceToken = onCall({ region: "us-central1" }, async (request) => {
  const auth = await resolveSyncAuth(request);
  if (auth.authType !== "device_token") {
    throw new HttpsError("failed-precondition", "Only linked device tokens can revoke themselves through this endpoint.");
  }
  const now = new Date().toISOString();
  await Promise.all([
    db.doc(`deviceTokens/${auth.tokenHash}`).set({ status: "revoked", updatedAt: now, revokedAt: now }, { merge: true }),
    db.doc(`players/${auth.uid}/syncDevices/${auth.deviceId}`).set({ status: "revoked", updatedAt: now, revokedAt: now }, { merge: true })
  ]);
  return {
    ok: true,
    privacyClass: "abstract",
    status: "revoked"
  };
});

exports.revokeSyncDevice = onCall({ region: "us-central1" }, async (request) => {
  const uid = requireSignedInOwner(request, "revoking a Codex device");
  const deviceId = cleanDeviceId(request.data && request.data.deviceId);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const deviceRef = db.doc(`players/${uid}/syncDevices/${deviceId}`);
    const deviceSnap = await transaction.get(deviceRef);
    if (!deviceSnap.exists) {
      throw new HttpsError("not-found", "Linked Codex device not found.");
    }
    const device = deviceSnap.data() || {};
    if (device.ownerUid && device.ownerUid !== uid) {
      throw new HttpsError("permission-denied", "You can only revoke your own Codex devices.");
    }

    const tokenSnap = await transaction.get(db.collection("deviceTokens").where("uid", "==", uid));
    const matchingTokens = tokenSnap.docs.filter((docSnap) => {
      const token = docSnap.data() || {};
      return token.deviceId === deviceId;
    });
    transaction.set(deviceRef, {
      status: "revoked",
      updatedAt: now,
      revokedAt: now,
      revokedBy: "owner"
    }, { merge: true });
    matchingTokens.forEach((docSnap) => {
      transaction.set(docSnap.ref, {
        status: "revoked",
        updatedAt: now,
        revokedAt: now,
        revokedBy: "owner"
      }, { merge: true });
    });
    return {
      deviceName: device.deviceName || "Codex device",
      tokenCount: matchingTokens.length
    };
  });

  logger.info("mcp_miner_sync_device_revoked", {
    privacyClass: "abstract",
    uidPresent: true,
    deviceId,
    tokenCount: result.tokenCount
  });

  return {
    ok: true,
    privacyClass: "abstract",
    deviceId,
    deviceName: result.deviceName,
    status: "revoked",
    revokedTokenCount: result.tokenCount
  };
});

exports.renameSyncDevice = onCall({ region: "us-central1" }, async (request) => {
  const uid = requireSignedInOwner(request, "renaming a Codex device");
  const deviceId = cleanDeviceId(request.data && request.data.deviceId);
  const deviceName = cleanDeviceName(request.data && request.data.name);
  const now = new Date().toISOString();

  await db.runTransaction(async (transaction) => {
    const deviceRef = db.doc(`players/${uid}/syncDevices/${deviceId}`);
    const deviceSnap = await transaction.get(deviceRef);
    if (!deviceSnap.exists) {
      throw new HttpsError("not-found", "Linked Codex device not found.");
    }
    const device = deviceSnap.data() || {};
    if (device.ownerUid && device.ownerUid !== uid) {
      throw new HttpsError("permission-denied", "You can only rename your own Codex devices.");
    }
    transaction.set(deviceRef, {
      deviceName,
      updatedAt: now,
      renamedAt: now,
      renamedBy: "owner"
    }, { merge: true });
  });

  logger.info("mcp_miner_sync_device_renamed", {
    privacyClass: "abstract",
    uidPresent: true,
    deviceId
  });

  return {
    ok: true,
    privacyClass: "abstract",
    deviceId,
    deviceName,
    status: "renamed"
  };
});
