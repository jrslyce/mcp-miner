"use strict";

const assert = require("assert");
const {
  assertNoPrivateDigestFields,
  buildWeeklyDigest,
  weeklyDigestAccess
} = require("../firebase/functions/src/digests");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

const NOW = "2026-05-26T00:00:00.000Z";
const freeEntitlement = {
  plan: "free",
  entitlementStatus: "free",
  features: {
    weeklyDigest: false,
    priorityBetaAccess: false
  }
};
const proEntitlement = {
  plan: "pro_monthly",
  entitlementStatus: "pro",
  features: {
    weeklyDigest: true,
    priorityBetaAccess: true
  }
};

check("weekly digest access should distinguish Free, Pro, disabled digest, and beta opt-in", () => {
  return weeklyDigestAccess(freeEntitlement, {}).status === "locked" &&
    weeklyDigestAccess(proEntitlement, {}).status === "ready" &&
    weeklyDigestAccess(proEntitlement, { weeklyDigestEnabled: false }).status === "disabled" &&
    weeklyDigestAccess(proEntitlement, { betaFeaturesEnabled: true }).effectiveBetaAccess === true;
});

check("empty Pro week should return a ready abstract digest with zero highlights", () => {
  const digest = buildWeeklyDigest({
    entitlement: proEntitlement,
    settings: {},
    now: NOW
  });
  return digest.status === "ready" &&
    digest.summary.events.eventCount === 0 &&
    digest.summary.chonks.mined === 0 &&
    digest.highlights.length === 0 &&
    digest.delivery.email === "not_enabled";
});

check("active Pro week should aggregate abstract game stats", () => {
  const digest = buildWeeklyDigest({
    events: [
      {
        eventId: "evt_digest_recent",
        eventType: "work_apply_patch",
        timestamp: "2026-05-25T00:00:00.000Z",
        sequence: 2,
        observedFields: {
          score: 12,
          category: "implementation",
          prompt: "must not appear"
        }
      },
      {
        eventId: "evt_digest_old",
        eventType: "work_search",
        timestamp: "2026-05-01T00:00:00.000Z",
        sequence: 1,
        observedFields: {
          score: 99,
          category: "research"
        }
      }
    ],
    state: {
      spaceBucks: 440,
      asteroidProgress: {
        mined: 520
      }
    },
    inventory: [
      { materialId: "mat_chonks", quantity: 140 },
      { materialId: "mat_iron", quantity: 12, totalSpaceBucks: 24 },
      { materialId: "mat_quartz", quantity: 3, totalSpaceBucks: 75 }
    ],
    orders: [
      { orderId: "order_ready", canFulfill: true, rewardSpaceBucks: 200 },
      { orderId: "order_wait", canFulfill: false, rewardSpaceBucks: 100 }
    ],
    syncMetadata: {
      acceptedCount: 2,
      rejectedCount: 1
    },
    deviceCount: 2,
    base: {
      moduleCount: 3,
      droneLevel: 1
    },
    cosmeticState: {
      applied: {
        portal_theme: "portal_theme_nebula",
        suit_trim: "suit_trim_aurora"
      }
    },
    entitlement: proEntitlement,
    settings: {
      betaFeaturesEnabled: true
    },
    now: NOW
  });
  return digest.status === "ready" &&
    digest.summary.events.eventCount === 1 &&
    digest.summary.events.workScore === 12 &&
    digest.summary.chonks.mined === 140 &&
    digest.summary.spaceBucks.current === 440 &&
    digest.summary.materials.types === 3 &&
    digest.summary.materials.valueSpaceBucks === 99 &&
    digest.summary.orders.fulfillableOrders === 1 &&
    digest.summary.sync.conflictState === "needs_review" &&
    digest.summary.milestones.asteroidMilestones === 2 &&
    digest.summary.cosmetics.activeSelections === 2 &&
    digest.preferences.effectiveBetaAccess === true &&
    !JSON.stringify(digest).includes("prompt");
});

check("partial sync week should fall back to available abstract state", () => {
  const digest = buildWeeklyDigest({
    state: {
      inventory: {
        mat_chonks: 22,
        mat_iron: 4
      },
      space_bucks: 12
    },
    entitlement: proEntitlement,
    settings: {
      betaFeaturesEnabled: false
    },
    now: NOW
  });
  return digest.status === "ready" &&
    digest.summary.chonks.mined === 22 &&
    digest.summary.materials.types === 2 &&
    digest.summary.spaceBucks.current === 12 &&
    digest.preferences.effectiveBetaAccess === false;
});

check("disabled digest should keep preferences but suppress generated content", () => {
  const digest = buildWeeklyDigest({
    events: [
      {
        eventId: "evt_digest_disabled",
        eventType: "work_apply_patch",
        timestamp: "2026-05-25T00:00:00.000Z",
        sequence: 3,
        observedFields: {
          score: 50,
          category: "implementation"
        }
      }
    ],
    state: {
      spaceBucks: 800,
      inventory: {
        mat_chonks: 80
      }
    },
    entitlement: proEntitlement,
    settings: {
      weeklyDigestEnabled: false,
      betaFeaturesEnabled: true
    },
    now: NOW
  });
  return digest.status === "disabled" &&
    digest.summary.events.eventCount === 0 &&
    digest.summary.chonks.mined === 0 &&
    digest.highlights.length === 0 &&
    digest.preferences.weeklyDigestEnabled === false &&
    digest.preferences.effectiveBetaAccess === true;
});

check("digest privacy guard should reject private key names recursively", () => {
  try {
    assertNoPrivateDigestFields({
      summary: {
        browserContent: "private"
      }
    });
    return false;
  } catch (error) {
    return error.message.includes("not allowed");
  }
});

console.log(JSON.stringify({
  ok: true,
  checks
}, null, 2));
