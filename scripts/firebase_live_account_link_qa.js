"use strict";

const crypto = require("crypto");
const { eventChecksum } = require("../firebase/functions/src/sync");
const { deviceTokenHash } = require("../firebase/functions/src/linking");

const API_KEY = process.env.MCP_MINER_FIREBASE_API_KEY || "AIzaSyBwLEA9IdoPSeEV_PRY5zFa5WJbE5NSG4o";
const PROJECT_ID = process.env.MCP_MINER_FIREBASE_PROJECT || "mcp-miner";
const FUNCTIONS_ORIGIN = process.env.MCP_MINER_FUNCTIONS_ORIGIN || "https://us-central1-mcp-miner.cloudfunctions.net";
const DASHBOARD_URL = process.env.MCP_MINER_DASHBOARD_URL || "https://mcp-miner.web.app";
const EMAIL_LOCAL = process.env.MCP_MINER_QA_EMAIL_LOCAL || "jsteffes";
const EMAIL_DOMAIN = process.env.MCP_MINER_QA_EMAIL_DOMAIN || "gmail.com";
const RUN_ID = (process.env.MCP_MINER_QA_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)).toLowerCase();
const EXACT_WORD_ADDRESSES = process.env.MCP_MINER_QA_EXACT_WORDS === "1";
const CLEANUP = process.env.MCP_MINER_QA_CLEANUP === "1";
const MARK_EMAIL_VERIFIED = process.env.MCP_MINER_QA_MARK_EMAIL_VERIFIED !== "0";
const LINK_SESSION_WITH_AUTH = process.env.MCP_MINER_QA_LINK_SESSION_AUTH === "1";
const EXPECTED_WORD_COUNT = Number.parseInt(process.env.MCP_MINER_QA_EXPECTED_WORD_COUNT || "8", 10);
const WORDS = (process.env.MCP_MINER_QA_WORDS || "basalt,quartz,cobalt,nickel,orbit,rover,beacon,comet")
  .split(",")
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean);

if (process.env.MCP_MINER_LIVE_QA !== "1") {
  throw new Error("Refusing to run production QA without MCP_MINER_LIVE_QA=1.");
}

async function requestJson(url, options, expectedStatus = 200) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method || "GET"} ${url} expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return body;
}

async function requestForm(url, form, expectedStatus = 200) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(form).toString()
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`POST ${url} expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return body;
}

function firebaseAdmin() {
  const admin = require("../firebase/functions/node_modules/firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin;
}

function authHeaders(token) {
  if (!token) {
    return {};
  }
  return token.startsWith("mcpd_")
    ? { "x-mcp-miner-device-token": token }
    : { authorization: `Bearer ${token}` };
}

function randomPassword() {
  return `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
}

function qaEmail(word) {
  const suffix = EXACT_WORD_ADDRESSES ? word : `${word}-${RUN_ID}`;
  return `${EMAIL_LOCAL}+${suffix}@${EMAIL_DOMAIN}`;
}

async function signUp(email) {
  return requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password: randomPassword(),
      returnSecureToken: true
    })
  });
}

async function refreshIdToken(auth) {
  const refreshed = await requestForm(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken
  });
  return {
    ...auth,
    idToken: refreshed.id_token,
    refreshToken: refreshed.refresh_token || auth.refreshToken
  };
}

async function markEmailVerified(auth) {
  if (!MARK_EMAIL_VERIFIED) {
    return auth;
  }
  const admin = firebaseAdmin();
  await admin.auth().updateUser(auth.localId, { emailVerified: true });
  const refreshed = await refreshIdToken(auth);
  return {
    ...refreshed,
    emailVerifiedByAdmin: true
  };
}

async function callFunction(name, token, data, expectedStatus = 200) {
  return requestJson(`${FUNCTIONS_ORIGIN}/${name}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ data })
  }, expectedStatus);
}

function syncEvent(word, uid, sequence, privateFields = {}) {
  const event = {
    ownerUid: uid,
    eventId: `evt_live_qa_${word}_${Date.now()}_${sequence}`,
    eventType: "work_live_qa",
    schemaVersion: 1,
    sequence,
    timestamp: new Date().toISOString(),
    sessionId: `session_live_qa_${word}`,
    turnId: `turn_live_qa_${word}`,
    observedFields: {
      score: 6.25,
      category: "live_qa",
      cycle: word,
      ...privateFields
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.live-qa"
  };
  event.checksum = eventChecksum(event);
  return event;
}

async function runCycle(word, index) {
  const email = qaEmail(word);
  let auth = await signUp(email);
  auth = await markEmailVerified(auth);
  const link = await callFunction("createLinkSession", LINK_SESSION_WITH_AUTH ? auth.idToken : null, {
    dashboardUrl: DASHBOARD_URL,
    deviceName: `Live QA ${index + 1} ${word}`
  });
  await callFunction("approveLinkSession", auth.idToken, {
    sessionId: link.result.session.sessionId,
    code: link.result.session.code
  });
  const exchanged = await callFunction("exchangeLinkSession", null, {
    sessionId: link.result.session.sessionId,
    deviceSecret: link.result.deviceSecret
  });

  if (!exchanged.result.deviceToken || !exchanged.result.deviceToken.startsWith("mcpd_")) {
    throw new Error(`${email} did not receive an MCP Miner device token`);
  }
  if (exchanged.result.uid !== auth.localId) {
    throw new Error(`${email} exchanged UID did not match Firebase Auth UID`);
  }

  const acceptedEvent = syncEvent(word, auth.localId, 1);
  const privateEvent = syncEvent(word, auth.localId, 2, { prompt: "must be rejected" });
  const sync = await callFunction("syncRewardEvents", exchanged.result.deviceToken, { events: [acceptedEvent, privateEvent] });
  const privateRejection = sync.result && Array.isArray(sync.result.rejected) ? sync.result.rejected[0] : null;
  const state = await callFunction("getSyncState", exchanged.result.deviceToken, {});

  if (!sync.result.accepted || !sync.result.accepted.includes(acceptedEvent.eventId)) {
    throw new Error(`${email} abstract event was not accepted`);
  }
  if (!privateRejection || privateRejection.reason !== "private_fields") {
    throw new Error(`${email} private prompt field was not rejected: ${JSON.stringify({
      privateEventId: privateEvent.eventId,
      privateResponse: sync
    })}`);
  }
  if (!state.result.state || state.result.state.eventCount < 1 || state.result.state.lastSequence < 1) {
    throw new Error(`${email} cloud state was not reduced`);
  }

  return {
    ok: true,
    issueIndex: index + 1,
    word,
    email,
    uid: auth.localId,
    linkCode: link.result.session.code,
    deviceId: exchanged.result.deviceId,
    tokenHash: deviceTokenHash(exchanged.result.deviceToken),
    sessionId: link.result.session.sessionId,
    acceptedEventId: acceptedEvent.eventId,
    rejectedReason: privateRejection.reason,
    eventCount: state.result.state.eventCount,
    lastSequence: state.result.state.lastSequence
  };
}

async function cleanupAccounts(results) {
  const admin = firebaseAdmin();
  const auth = admin.auth();
  const db = admin.firestore();
  const cleaned = [];
  for (const result of results) {
    const cleanupResult = { email: result.email, uid: result.uid, ok: true };
    try {
      await db.recursiveDelete(db.doc(`players/${result.uid}`));
      await db.doc(`deviceTokens/${result.tokenHash}`).delete();
      await db.doc(`linkSessions/${result.sessionId}`).delete();
      await db.doc(`linkCodes/${result.linkCode}`).delete();
      await auth.deleteUser(result.uid);
    } catch (error) {
      cleanupResult.ok = false;
      cleanupResult.error = error.message;
    }
    cleaned.push(cleanupResult);
  }
  return cleaned;
}

async function main() {
  if (!Number.isInteger(EXPECTED_WORD_COUNT) || EXPECTED_WORD_COUNT < 1) {
    throw new Error(`Expected MCP_MINER_QA_EXPECTED_WORD_COUNT to be a positive integer, got ${process.env.MCP_MINER_QA_EXPECTED_WORD_COUNT}.`);
  }
  if (WORDS.length !== EXPECTED_WORD_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_WORD_COUNT} QA words, got ${WORDS.length}.`);
  }

  const results = [];
  for (const [index, word] of WORDS.entries()) {
    results.push(await runCycle(word, index));
  }
  const cleanup = CLEANUP ? await cleanupAccounts(results) : [];

  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    dashboardUrl: DASHBOARD_URL,
    runId: RUN_ID,
    cleanupEnabled: CLEANUP,
    emailVerifiedByAdmin: MARK_EMAIL_VERIFIED,
    linkSessionWithAuth: LINK_SESSION_WITH_AUTH,
    cleanup,
    expectedAccountCount: EXPECTED_WORD_COUNT,
    accountCount: results.length,
    accounts: results.map(({ tokenHash, sessionId, linkCode, ...result }) => result)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
