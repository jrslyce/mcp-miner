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

admin.initializeApp();
const db = admin.firestore();

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

function throwEntitlementDecision(decision, entitlement) {
  if (decision.ok) {
    return;
  }
  throw new HttpsError("resource-exhausted", entitlementLimitMessage(decision, entitlement), {
    reason: decision.reason,
    entitlement: publicEntitlement(entitlement),
    maxDevices: decision.maxDevices || null,
    activeDevices: decision.activeDevices || null,
    cadenceSeconds: decision.cadenceSeconds || null,
    retryAfterSeconds: decision.retryAfterSeconds || null
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

function enforceActiveDeviceAccess({ entitlement, activeDevices, auth }) {
  if (!auth || auth.authType !== "device_token") {
    return;
  }
  throwEntitlementDecision(deviceLimitDecision({
    entitlement,
    activeDevices,
    deviceId: auth.deviceId
  }), entitlement);
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
      enforceActiveDeviceAccess({ entitlement, activeDevices, auth });

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
      }), entitlement);

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
        }
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
      requestedCount: events.length,
      code: error.code || "invalid-argument"
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
    auth
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

  return {
    ok: true,
    privacyClass: "abstract",
    state: stateSnap.exists ? stateSnap.data() : null,
    syncMetadata: syncSnap.exists ? syncSnap.data() : null,
    deviceSyncMetadata: cursorSnap.exists ? cursorSnap.data() : legacyCursorFromDefault(syncCursorId(auth), syncSnap.exists ? syncSnap.data() : {}),
    entitlement
  };
});

exports.createCheckoutSession = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before starting MCP Miner Pro checkout.");
  }
  requireVerifiedFirebaseAuth(request);
  const uid = request.auth.uid;
  const data = request.data || {};

  try {
    assertUidMatchesRequest(data, uid);
    const dashboardUrl = dashboardUrlFromRequest(request);
    const now = new Date().toISOString();
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

  try {
    assertUidMatchesRequest(data, uid);
    const dashboardUrl = dashboardUrlFromRequest(request);
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
    }), entitlement);

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
    }), entitlement);

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
