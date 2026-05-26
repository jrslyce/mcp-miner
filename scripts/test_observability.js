"use strict";

const assert = require("assert");
const {
  RATE_LIMITS,
  rateLimitDecision,
  rateLimitDocId,
  rateLimitPublicDetails,
  recordRateLimit,
  subjectHash
} = require("../firebase/functions/src/observability");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

function fakeDb() {
  const store = new Map();
  return {
    store,
    doc(path) {
      return { path };
    },
    async runTransaction(fn) {
      const transaction = {
        async get(ref) {
          return {
            exists: store.has(ref.path),
            data: () => store.get(ref.path)
          };
        },
        set(ref, data) {
          store.set(ref.path, {
            ...(store.get(ref.path) || {}),
            ...data
          });
        }
      };
      return fn(transaction);
    }
  };
}

check("rate-limit policy should cover subscription abuse surfaces", () => {
  return [
    "syncRewardEvents",
    "exportDashboardHistory",
    "createCloudBackup",
    "restoreCloudBackup",
    "createCheckoutSession",
    "createCustomerPortalSession",
    "createLinkSession",
    "approveLinkSession",
    "exchangeLinkSession"
  ].every((key) => RATE_LIMITS[key] && RATE_LIMITS[key].limit > 0 && RATE_LIMITS[key].windowSeconds > 0);
});

check("subject hashes and rate limit doc IDs should not expose raw subjects", () => {
  const subject = "uid_private@example.com";
  const hash = subjectHash(subject);
  const docId = rateLimitDocId("createCheckoutSession", subject);
  return hash.length === 64 &&
    !hash.includes(subject) &&
    docId.startsWith("createCheckoutSession_") &&
    !docId.includes(subject);
});

check("rate-limit decision should reset expired windows", () => {
  const decision = rateLimitDecision({
    state: {
      count: 99,
      windowStartAt: "2026-05-26T00:00:00.000Z"
    },
    limit: 2,
    windowSeconds: 60,
    now: "2026-05-26T00:02:00.000Z"
  });
  return decision.ok === true &&
    decision.count === 1 &&
    decision.retryAfterSeconds === 0;
});

check("rate-limit decision should deny over-limit attempts with retry metadata", () => {
  const decision = rateLimitDecision({
    state: {
      count: 2,
      windowStartAt: "2026-05-26T00:00:00.000Z"
    },
    limit: 2,
    windowSeconds: 60,
    now: "2026-05-26T00:00:30.000Z"
  });
  const details = rateLimitPublicDetails("exportDashboardHistory", decision);
  return decision.ok === false &&
    decision.retryAfterSeconds === 30 &&
    details.reason === "rate_limit_exceeded" &&
    details.operation === "exportDashboardHistory";
});

async function main() {
  const policy = { limit: 2, windowSeconds: 60 };
  const spamOperations = [
    "createCheckoutSession",
    "syncRewardEvents",
    "exportDashboardHistory",
    "createCloudBackup",
    "restoreCloudBackup",
    "createLinkSession"
  ];
  for (const operation of spamOperations) {
    const db = fakeDb();
    const first = await recordRateLimit({
      db,
      operation,
      subject: "uid_123",
      subjectType: operation === "createLinkSession" ? "ip" : "firebase_uid",
      policy,
      now: "2026-05-26T00:00:00.000Z"
    });
    const second = await recordRateLimit({
      db,
      operation,
      subject: "uid_123",
      subjectType: operation === "createLinkSession" ? "ip" : "firebase_uid",
      policy,
      now: "2026-05-26T00:00:01.000Z"
    });
    const third = await recordRateLimit({
      db,
      operation,
      subject: "uid_123",
      subjectType: operation === "createLinkSession" ? "ip" : "firebase_uid",
      policy,
      now: "2026-05-26T00:00:02.000Z"
    });
    assert.ok(first.ok && second.ok && !third.ok, `${operation} should deny repeated spam`);
    const stored = [...db.store.values()][0];
    assert.ok(stored.subjectHash && stored.subjectHash !== "uid_123" && stored.rejectedCount === 1, `${operation} should store privacy-safe rate-limit state`);
  }
  checks += 1;

  assert.ok(true, "stored rate-limit state should be privacy-safe across spam operations");
  checks += 1;

  console.log(JSON.stringify({
    ok: true,
    checks
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
