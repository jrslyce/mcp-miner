"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const {
  CURRENT_SYNC_SCHEMA_VERSION,
  prepareSyncBatch,
  reduceCloudState
} = require("./sync");
const {
  evaluateSyncThrottle,
  publicEntitlement,
  resolveEntitlement
} = require("./entitlements");
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
  const syncRef = db.doc(`players/${uid}/syncMetadata/default`);
  const entitlementRef = db.doc(`players/${uid}/entitlements/current`);
  const eventRefs = events.map((event, index) => {
    const eventId = event && typeof event.eventId === "string" && /^evt_[a-zA-Z0-9_-]+$/.test(event.eventId)
      ? event.eventId
      : `_invalid_${index}`;
    return db.doc(`players/${uid}/rewardEvents/${eventId}`);
  });

  try {
    const result = await db.runTransaction(async (transaction) => {
      const stateSnap = await transaction.get(stateRef);
      const syncSnap = await transaction.get(syncRef);
      const entitlementSnap = await transaction.get(entitlementRef);
      const eventSnaps = [];
      for (const ref of eventRefs) {
        eventSnaps.push(await transaction.get(ref));
      }

      const state = stateSnap.exists ? stateSnap.data() : {
        ownerUid: uid,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract",
        eventCount: 0,
        workScoreTotal: 0,
        workEvents: {},
        lastSequence: 0
      };
      const sync = syncSnap.exists ? syncSnap.data() : {};
      const entitlement = resolveEntitlement(entitlementSnap.exists ? entitlementSnap.data() : {});
      const throttle = evaluateSyncThrottle({
        entitlement,
        syncMetadata: sync,
        now: new Date(receivedAt)
      });

      if (throttle.throttled) {
        transaction.set(syncRef, {
          ownerUid: uid,
          schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
          privacyClass: "abstract",
          updatedAt: receivedAt,
          lastThrottleAt: receivedAt,
          nextEligibleSyncAt: throttle.nextEligibleSyncAt,
          syncCadenceSeconds: entitlement.syncCadenceSeconds,
          plan: entitlement.plan,
          billingStatus: entitlement.billingStatus
        }, { merge: true });
        touchDeviceWrites(transaction, auth, receivedAt);

        return {
          ok: false,
          status: "throttled",
          accepted: [],
          duplicates: [],
          rejected: [],
          throttle,
          entitlement: publicEntitlement(entitlement),
          state: {
            eventCount: Number(state.eventCount || 0),
            workScoreTotal: Number(state.workScoreTotal || 0),
            lastEventId: state.lastEventId || null,
            lastSequence: Number(sync.lastSequence || state.lastSequence || 0),
            workEvents: state.workEvents || {}
          }
        };
      }

      const existingEventIds = eventSnaps
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => snapshot.id);
      const batch = prepareSyncBatch({
        uid,
        events,
        existingEventIds,
        lastSequence: Number(sync.lastSequence || state.lastSequence || 0),
        receivedAt
      });

      let reducedState = {
        ...state,
        ownerUid: uid,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract"
      };
      for (const event of batch.accepted) {
        const eventRef = db.doc(`players/${uid}/rewardEvents/${event.eventId}`);
        transaction.set(eventRef, event, { merge: false });
        reducedState = reduceCloudState(reducedState, event, receivedAt);
      }

      transaction.set(playerRef, {
        ownerUid: uid,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract",
        cloudSyncEnabled: true,
        updatedAt: receivedAt
      }, { merge: true });
      transaction.set(stateRef, reducedState, { merge: true });
      transaction.set(syncRef, {
        ownerUid: uid,
        schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
        privacyClass: "abstract",
        updatedAt: receivedAt,
        lastAcceptedBatchAt: batch.accepted.length > 0 ? receivedAt : sync.lastAcceptedBatchAt || null,
        nextEligibleSyncAt: batch.accepted.length > 0
          ? new Date(new Date(receivedAt).getTime() + (entitlement.syncCadenceSeconds * 1000)).toISOString()
          : sync.nextEligibleSyncAt || null,
        syncCadenceSeconds: entitlement.syncCadenceSeconds,
        plan: entitlement.plan,
        billingStatus: entitlement.billingStatus,
        lastCloudEventId: reducedState.lastEventId || sync.lastCloudEventId || null,
        lastSequence: Math.max(Number(sync.lastSequence || 0), Number(reducedState.lastSequence || 0), Number(batch.lastSequence || 0)),
        acceptedCount: admin.firestore.FieldValue.increment(batch.accepted.length),
        duplicateCount: admin.firestore.FieldValue.increment(batch.duplicates.length),
        rejectedCount: admin.firestore.FieldValue.increment(batch.rejected.length)
      }, { merge: true });
      touchDeviceWrites(transaction, auth, receivedAt);

      return {
        ok: true,
        accepted: batch.accepted.map((event) => event.eventId),
        duplicates: batch.duplicates,
        rejected: batch.rejected,
        throttle: {
          throttled: false,
          nextEligibleSyncAt: batch.accepted.length > 0
            ? new Date(new Date(receivedAt).getTime() + (entitlement.syncCadenceSeconds * 1000)).toISOString()
            : sync.nextEligibleSyncAt || receivedAt,
          waitSeconds: 0
        },
        entitlement: publicEntitlement(entitlement),
        state: {
          eventCount: reducedState.eventCount,
          workScoreTotal: reducedState.workScoreTotal,
          lastEventId: reducedState.lastEventId,
          lastSequence: reducedState.lastSequence,
          workEvents: reducedState.workEvents
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
      rejectedCount: result.rejected.length
    });

    return {
      ...result,
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
  const [stateSnap, syncSnap, entitlementSnap] = await Promise.all([
    db.doc(`players/${uid}/gameState/current`).get(),
    db.doc(`players/${uid}/syncMetadata/default`).get(),
    db.doc(`players/${uid}/entitlements/current`).get()
  ]);
  const entitlement = resolveEntitlement(entitlementSnap.exists ? entitlementSnap.data() : {});
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
    entitlement: publicEntitlement(entitlement)
  };
});

exports.createLinkSession = onCall({ region: "us-central1" }, async (request) => {
  const now = new Date();
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
    const validation = requirePendingSession(session);
    if (!validation.ok) {
      throw new HttpsError(validation.reason === "not_found" ? "not-found" : "failed-precondition", `Link session ${validation.reason}.`);
    }

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
    return approved;
  });

  logger.info("mcp_miner_link_session_approved", {
    privacyClass: "abstract",
    uidPresent: true,
    sessionId: result.sessionId
  });

  return {
    ok: true,
    privacyClass: "abstract",
    session: publicLinkSession(result),
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

    return { uid, deviceId };
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
