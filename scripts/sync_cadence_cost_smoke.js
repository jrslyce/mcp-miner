"use strict";

const assert = require("assert");
const { PLAN_ENTITLEMENTS } = require("../firebase/functions/src/entitlements");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

function estimateUsage({ plan, users, activeHours, eventsPerMinute }) {
  const entitlement = PLAN_ENTITLEMENTS[plan];
  const cadenceSeconds = entitlement.syncCadenceSeconds;
  const activeSeconds = activeHours * 60 * 60;
  const eventsPerUser = activeHours * 60 * eventsPerMinute;
  const eventsPerBatch = Math.max(1, Math.ceil(eventsPerMinute * (cadenceSeconds / 60)));
  const cadenceLimitedBatches = Math.ceil(activeSeconds / cadenceSeconds);
  const eventLimitedBatches = Math.ceil(eventsPerUser / eventsPerBatch);
  const batchesPerUser = Math.min(cadenceLimitedBatches, eventLimitedBatches);
  const invocations = users * batchesPerUser;
  const acceptedEvents = users * eventsPerUser;

  return {
    plan,
    users,
    cadenceSeconds,
    batchesPerUser,
    invocations,
    acceptedEvents,
    firestoreReads: invocations * 4 + acceptedEvents,
    firestoreWrites: invocations * 4 + acceptedEvents
  };
}

const freeDay = estimateUsage({
  plan: "free",
  users: 100,
  activeHours: 8,
  eventsPerMinute: 1
});
const proDay = estimateUsage({
  plan: "pro_monthly",
  users: 25,
  activeHours: 8,
  eventsPerMinute: 1
});
const proAnnualDay = estimateUsage({
  plan: "pro_annual",
  users: 25,
  activeHours: 8,
  eventsPerMinute: 1
});
const freeBurst = estimateUsage({
  plan: "free",
  users: 10,
  activeHours: 1,
  eventsPerMinute: 12
});
const proBurst = estimateUsage({
  plan: "pro_monthly",
  users: 10,
  activeHours: 1,
  eventsPerMinute: 12
});

check("Free sync cadence should come from entitlement config", () => freeDay.cadenceSeconds === 60);
check("Pro monthly sync cadence should come from entitlement config", () => proDay.cadenceSeconds === 10);
check("Pro annual sync cadence should match monthly Pro cadence", () => proAnnualDay.cadenceSeconds === proDay.cadenceSeconds);
check("Free batches should be bounded to one accepted batch per minute", () => freeDay.batchesPerUser <= 8 * 60);
check("Pro batches should be bounded to configured near-real-time cadence", () => proDay.batchesPerUser <= Math.ceil((8 * 60 * 60) / 10));
check("Pro burst usage should surface faster portal freshness than Free while remaining cadence bounded", () => {
  return proBurst.batchesPerUser > freeBurst.batchesPerUser &&
    proBurst.batchesPerUser <= Math.ceil((60 * 60) / proBurst.cadenceSeconds);
});
check("Cost smoke should count Firestore operations and function invocations", () => {
  return freeDay.invocations > 0 &&
    freeDay.firestoreReads > freeDay.invocations &&
    freeDay.firestoreWrites > freeDay.invocations &&
    proDay.invocations > 0 &&
    proDay.firestoreReads > proDay.invocations &&
    proDay.firestoreWrites > proDay.invocations;
});

console.log(JSON.stringify({
  ok: true,
  checks,
  scenarios: {
    freeDay,
    proDay,
    proAnnualDay,
    freeBurst,
    proBurst
  }
}, null, 2));
