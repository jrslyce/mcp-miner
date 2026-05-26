"use strict";

const assert = require("assert");
const {
  evaluateEntitlement
} = require("../firebase/functions/src/entitlements");
const {
  accessDecision,
  publicCosmeticCatalog,
  resolvedAppliedCosmetics,
  validateCosmeticSelection
} = require("../firebase/functions/src/cosmetics");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

const NOW = "2026-05-26T00:00:00.000Z";
const FUTURE = "2026-06-26T00:00:00.000Z";
const free = evaluateEntitlement(null, { now: NOW });
const pro = evaluateEntitlement({
  ownerUid: "uid_cosmetics",
  schemaVersion: 1,
  privacyClass: "abstract",
  plan: "pro_monthly",
  billingStatus: "active",
  provider: "stripe",
  providerCustomerId: "cus_cosmetics",
  providerSubscriptionId: "sub_cosmetics",
  currentPeriodEnd: FUTURE,
  updatedAt: NOW
}, { now: NOW });

function expectReason(reason, fn) {
  try {
    fn();
    return false;
  } catch (error) {
    return error.reason === reason;
  }
}

check("free catalog should expose free cosmetics and lock Pro included cosmetics", () => {
  const catalog = publicCosmeticCatalog({ entitlement: free });
  const freeTrim = catalog.items.find((item) => item.id === "suit_trim_basic");
  const proTrim = catalog.items.find((item) => item.id === "suit_trim_aurora");
  return freeTrim.canApply === true &&
    freeTrim.state === "owned" &&
    proTrim.canApply === false &&
    proTrim.lockedReason === "plan_limit_premium_cosmetic";
});

check("active Pro should unlock Pro included and beta cosmetics", () => {
  const catalog = publicCosmeticCatalog({ entitlement: pro });
  return catalog.items.find((item) => item.id === "portal_theme_nebula").canApply === true &&
    catalog.items.find((item) => item.id === "portal_theme_prism_beta").canApply === true;
});

check("downgraded Pro selections should fall back to category defaults without deleting the request", () => {
  const applied = resolvedAppliedCosmetics({
    entitlement: free,
    cosmeticState: {
      applied: {
        suit_trim: "suit_trim_aurora",
        portal_theme: "portal_theme_nebula"
      }
    }
  });
  return applied.requested.suit_trim === "suit_trim_aurora" &&
    applied.active.suit_trim === "suit_trim_basic" &&
    applied.inactive.portal_theme === "portal_theme_nebula";
});

check("earned unlockable cosmetics should stay usable after downgrade", () => {
  const catalog = publicCosmeticCatalog({
    entitlement: free,
    profile: {
      customizationUnlocks: ["suit_trim_teal", "survey_badge_gold"]
    }
  });
  return catalog.items.find((item) => item.id === "suit_trim_teal").canApply === true &&
    catalog.items.find((item) => item.id === "profile_badge_survey_gold").state === "owned";
});

check("retired cosmetics should apply only when server ownership exists", () => {
  const locked = accessDecision({ id: "profile_badge_founder_legacy", category: "profile_badge", availability: "retired" }, free, {}, {});
  const retained = publicCosmeticCatalog({
    entitlement: free,
    cosmeticState: {
      retainedCosmeticIds: ["profile_badge_founder_legacy"]
    }
  }).items.find((item) => item.id === "profile_badge_founder_legacy");
  return locked.canApply === false &&
    locked.reason === "retired" &&
    retained.canApply === true;
});

check("forged client ownership should not unlock paid cosmetics", () => {
  return expectReason("plan_limit_premium_cosmetic", () => validateCosmeticSelection({
    selection: {
      category: "portal_theme",
      cosmeticId: "portal_theme_nebula",
      ownedCosmeticIds: ["portal_theme_nebula"]
    },
    entitlement: free,
    profile: {},
    cosmeticState: {}
  }));
});

check("valid Pro selection should produce an applied server state", () => {
  const selection = validateCosmeticSelection({
    selection: {
      category: "portal_theme",
      cosmeticId: "portal_theme_nebula"
    },
    entitlement: pro,
    profile: {},
    cosmeticState: {}
  });
  return selection.applied.portal_theme === "portal_theme_nebula" &&
    selection.changedCategories.includes("portal_theme");
});

console.log(JSON.stringify({
  ok: true,
  checks
}, null, 2));
