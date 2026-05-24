"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const {
  CURRENT_SYNC_SCHEMA_VERSION,
  prepareSyncBatch,
  reduceCloudState
} = require("./sync");

admin.initializeApp();
const db = admin.firestore();

exports.ping = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "MCP Miner sync endpoints require Firebase Auth.");
  }

  logger.info("mcp_miner_ping", {
    privacyClass: "abstract",
    uidPresent: true,
    emulator: process.env.FUNCTIONS_EMULATOR === "true"
  });

  return {
    ok: true,
    service: "mcp-miner",
    privacyClass: "abstract",
    uid: request.auth.uid
  };
});

exports.syncRewardEvents = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "MCP Miner sync requires Firebase Auth.");
  }

  const uid = request.auth.uid;
  const events = Array.isArray(request.data && request.data.events) ? request.data.events : [];
  const receivedAt = new Date().toISOString();
  const playerRef = db.doc(`players/${uid}`);
  const stateRef = db.doc(`players/${uid}/gameState/current`);
  const syncRef = db.doc(`players/${uid}/syncMetadata/default`);
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
        lastCloudEventId: reducedState.lastEventId || sync.lastCloudEventId || null,
        lastSequence: Math.max(Number(sync.lastSequence || 0), Number(reducedState.lastSequence || 0), Number(batch.lastSequence || 0)),
        acceptedCount: admin.firestore.FieldValue.increment(batch.accepted.length),
        duplicateCount: admin.firestore.FieldValue.increment(batch.duplicates.length),
        rejectedCount: admin.firestore.FieldValue.increment(batch.rejected.length)
      }, { merge: true });

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
        }
      };
    });

    logger.info("mcp_miner_sync_reward_events", {
      privacyClass: "abstract",
      uidPresent: true,
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
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "MCP Miner sync state requires Firebase Auth.");
  }

  const uid = request.auth.uid;
  const [stateSnap, syncSnap] = await Promise.all([
    db.doc(`players/${uid}/gameState/current`).get(),
    db.doc(`players/${uid}/syncMetadata/default`).get()
  ]);

  logger.info("mcp_miner_get_sync_state", {
    privacyClass: "abstract",
    uidPresent: true,
    hasState: stateSnap.exists
  });

  return {
    ok: true,
    privacyClass: "abstract",
    state: stateSnap.exists ? stateSnap.data() : null,
    syncMetadata: syncSnap.exists ? syncSnap.data() : null
  };
});
