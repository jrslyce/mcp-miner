"use strict";

const COSMETIC_SCHEMA_VERSION = 1;
const COSMETIC_CATEGORIES = Object.freeze([
  "suit_trim",
  "portal_theme",
  "base_skin",
  "profile_badge",
  "seasonal_variant"
]);
const COSMETIC_AVAILABILITY = Object.freeze([
  "free",
  "pro_included",
  "unlockable",
  "retired",
  "beta"
]);

const CATEGORY_DEFAULTS = Object.freeze({
  suit_trim: "suit_trim_basic",
  portal_theme: "portal_theme_standard",
  base_skin: "base_skin_cabin_warm",
  profile_badge: "profile_badge_rookie",
  seasonal_variant: "seasonal_variant_none"
});

const COSMETIC_RETENTION_RULES = Object.freeze({
  free: "Always available and retained.",
  unlockable: "Retained after downgrade once earned or granted.",
  pro_included: "Active only while the effective entitlement is Pro, including paid-period cancellation or grace access.",
  retired: "Not newly unlockable; retained only for accounts that already own the cosmetic.",
  beta: "Active only while Pro priority beta access is present."
});

const COSMETIC_CATALOG = Object.freeze([
  {
    id: "suit_trim_basic",
    category: "suit_trim",
    displayName: "Standard Suit Trim",
    description: "The default pressure-suit trim for every miner.",
    availability: "free",
    retention: "retain_after_downgrade",
    defaultForCategory: true,
    swatch: "#1f7a5a",
    effects: []
  },
  {
    id: "suit_trim_teal",
    category: "suit_trim",
    displayName: "Teal Survey Trim",
    description: "Earned Space Bucks trim from the local store.",
    availability: "unlockable",
    unlockId: "suit_trim_teal",
    retention: "retain_after_downgrade",
    swatch: "#0f9f8f",
    effects: []
  },
  {
    id: "suit_trim_aurora",
    category: "suit_trim",
    displayName: "Aurora Suit Trim",
    description: "Pro included trim with a soft polar-light edge.",
    availability: "pro_included",
    requiresEntitlement: "premiumCosmetics",
    retention: "inactive_after_downgrade",
    swatch: "#58c79b",
    effects: []
  },
  {
    id: "portal_theme_standard",
    category: "portal_theme",
    displayName: "Standard Portal",
    description: "The default high-contrast portal theme.",
    availability: "free",
    retention: "retain_after_downgrade",
    defaultForCategory: true,
    swatch: "#17201b",
    themeKey: "standard",
    contrastPair: {
      background: "#f4f6f2",
      foreground: "#17201b"
    },
    effects: []
  },
  {
    id: "portal_theme_nebula",
    category: "portal_theme",
    displayName: "Nebula Console",
    description: "Pro included portal colors for late-shift mining.",
    availability: "pro_included",
    requiresEntitlement: "premiumCosmetics",
    retention: "inactive_after_downgrade",
    swatch: "#2d5b91",
    themeKey: "nebula",
    contrastPair: {
      background: "#101413",
      foreground: "#eef5ef"
    },
    effects: []
  },
  {
    id: "portal_theme_prism_beta",
    category: "portal_theme",
    displayName: "Prism Beta Console",
    description: "Priority beta portal colors with extra visual polish.",
    availability: "beta",
    requiresEntitlement: "priorityBetaAccess",
    retention: "inactive_after_downgrade",
    swatch: "#7c3aed",
    themeKey: "prism",
    contrastPair: {
      background: "#fbfcfb",
      foreground: "#17201b"
    },
    effects: []
  },
  {
    id: "base_skin_cabin_warm",
    category: "base_skin",
    displayName: "Warm Cabin",
    description: "The standard cozy base-room skin.",
    availability: "free",
    retention: "retain_after_downgrade",
    defaultForCategory: true,
    swatch: "#92400e",
    effects: []
  },
  {
    id: "base_skin_foundry_glass",
    category: "base_skin",
    displayName: "Foundry Glass",
    description: "Pro included base-room skin with clean refinery windows.",
    availability: "pro_included",
    requiresEntitlement: "premiumCosmetics",
    retention: "inactive_after_downgrade",
    swatch: "#3b82f6",
    effects: []
  },
  {
    id: "profile_badge_rookie",
    category: "profile_badge",
    displayName: "Rookie Miner Badge",
    description: "Starter profile badge for every account.",
    availability: "free",
    retention: "retain_after_downgrade",
    defaultForCategory: true,
    swatch: "#15583f",
    effects: []
  },
  {
    id: "profile_badge_survey_gold",
    category: "profile_badge",
    displayName: "Gold Survey Badge",
    description: "Earned badge from the local Space Bucks store.",
    availability: "unlockable",
    unlockId: "survey_badge_gold",
    retention: "retain_after_downgrade",
    swatch: "#b45309",
    effects: []
  },
  {
    id: "profile_badge_founder_legacy",
    category: "profile_badge",
    displayName: "Founder Legacy Badge",
    description: "Retired badge retained only by existing owners.",
    availability: "retired",
    retention: "retain_after_downgrade",
    swatch: "#334155",
    effects: []
  },
  {
    id: "seasonal_variant_none",
    category: "seasonal_variant",
    displayName: "Standard Season",
    description: "No seasonal overlay.",
    availability: "free",
    retention: "retain_after_downgrade",
    defaultForCategory: true,
    swatch: "#66766d",
    effects: []
  },
  {
    id: "seasonal_variant_solstice",
    category: "seasonal_variant",
    displayName: "Solstice Sparkline",
    description: "Pro included seasonal sparkline treatment.",
    availability: "pro_included",
    requiresEntitlement: "premiumCosmetics",
    retention: "inactive_after_downgrade",
    swatch: "#dc2626",
    effects: []
  }
]);

const CATALOG_BY_ID = new Map(COSMETIC_CATALOG.map((item) => [item.id, item]));

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function normalizedCosmeticState(cosmeticState = {}) {
  const state = cosmeticState && typeof cosmeticState === "object" ? cosmeticState : {};
  return {
    applied: state.applied && typeof state.applied === "object" ? { ...state.applied } : {},
    ownedCosmeticIds: stringArray(state.ownedCosmeticIds || state.owned_cosmetic_ids),
    retainedCosmeticIds: stringArray(state.retainedCosmeticIds || state.retained_cosmetic_ids)
  };
}

function profileUnlocks(profile = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  return [
    ...stringArray(source.customizationUnlocks || source.customization_unlocks),
    ...stringArray(source.ownedCosmeticIds || source.owned_cosmetic_ids),
    ...stringArray(source.retainedCosmeticIds || source.retained_cosmetic_ids)
  ];
}

function proAccess(entitlement = {}) {
  return entitlement && entitlement.entitlementStatus === "pro";
}

function hasFeature(entitlement = {}, feature) {
  return Boolean(entitlement && entitlement.features && entitlement.features[feature] === true);
}

function ownsCosmetic(item, profile = {}, cosmeticState = {}) {
  if (!item) {
    return false;
  }
  if (item.availability === "free") {
    return true;
  }
  const state = normalizedCosmeticState(cosmeticState);
  const unlocks = profileUnlocks(profile);
  return state.ownedCosmeticIds.includes(item.id) ||
    state.retainedCosmeticIds.includes(item.id) ||
    unlocks.includes(item.id) ||
    (item.unlockId ? unlocks.includes(item.unlockId) : false);
}

function accessDecision(item, entitlement = {}, profile = {}, cosmeticState = {}) {
  if (!item) {
    return {
      canApply: false,
      state: "locked",
      reason: "unknown_cosmetic",
      owned: false
    };
  }

  const owned = ownsCosmetic(item, profile, cosmeticState);
  if (item.availability === "free") {
    return { canApply: true, state: "owned", reason: "free", owned: true };
  }
  if (item.availability === "unlockable") {
    return owned
      ? { canApply: true, state: "owned", reason: "retained_unlock", owned: true }
      : { canApply: false, state: "locked", reason: "not_unlocked", owned: false };
  }
  if (item.availability === "retired") {
    return owned
      ? { canApply: true, state: "owned", reason: "retired_retained", owned: true }
      : { canApply: false, state: "locked", reason: "retired", owned: false };
  }
  if (item.availability === "beta") {
    return proAccess(entitlement) && hasFeature(entitlement, "priorityBetaAccess")
      ? { canApply: true, state: "available", reason: "priority_beta_access", owned: false }
      : { canApply: false, state: "locked", reason: "plan_limit_beta_cosmetic", owned: false };
  }
  if (item.availability === "pro_included") {
    return proAccess(entitlement) && hasFeature(entitlement, "premiumCosmetics")
      ? { canApply: true, state: "available", reason: "pro_included", owned: false }
      : { canApply: false, state: "locked", reason: "plan_limit_premium_cosmetic", owned: false };
  }
  return { canApply: false, state: "locked", reason: "unsupported_availability", owned: false };
}

function defaultItemForCategory(category) {
  return CATALOG_BY_ID.get(CATEGORY_DEFAULTS[category]);
}

function resolvedAppliedCosmetics({ entitlement = {}, profile = {}, cosmeticState = {} } = {}) {
  const state = normalizedCosmeticState(cosmeticState);
  return COSMETIC_CATEGORIES.reduce((result, category) => {
    const requestedId = state.applied[category] || CATEGORY_DEFAULTS[category];
    const requested = CATALOG_BY_ID.get(requestedId);
    const requestedDecision = accessDecision(requested, entitlement, profile, cosmeticState);
    const active = requestedDecision.canApply ? requested : defaultItemForCategory(category);
    result.requested[category] = requested ? requested.id : CATEGORY_DEFAULTS[category];
    result.active[category] = active ? active.id : CATEGORY_DEFAULTS[category];
    result.inactive[category] = requested && active && requested.id !== active.id ? requested.id : null;
    return result;
  }, { requested: {}, active: {}, inactive: {} });
}

function publicCosmeticItem(item, entitlement, profile, cosmeticState, applied) {
  const decision = accessDecision(item, entitlement, profile, cosmeticState);
  const active = applied.active[item.category] === item.id;
  const requested = applied.requested[item.category] === item.id;
  const inactive = applied.inactive[item.category] === item.id;
  return {
    id: item.id,
    category: item.category,
    displayName: item.displayName,
    description: item.description,
    availability: item.availability,
    requiresEntitlement: item.requiresEntitlement || null,
    retention: item.retention,
    swatch: item.swatch || null,
    themeKey: item.themeKey || null,
    contrastPair: item.contrastPair || null,
    state: inactive ? "locked" : decision.state,
    owned: decision.owned,
    locked: decision.canApply !== true,
    lockedReason: decision.canApply ? null : decision.reason,
    canPreview: true,
    canApply: decision.canApply,
    active,
    requested,
    inactive,
    noProgressionEffects: true
  };
}

function publicCosmeticCatalog({ entitlement = {}, profile = {}, cosmeticState = {} } = {}) {
  const applied = resolvedAppliedCosmetics({ entitlement, profile, cosmeticState });
  const items = COSMETIC_CATALOG.map((item) => publicCosmeticItem(item, entitlement, profile, cosmeticState, applied));
  const categories = COSMETIC_CATEGORIES.reduce((result, category) => {
    result[category] = items.filter((item) => item.category === category);
    return result;
  }, {});
  return {
    schemaVersion: COSMETIC_SCHEMA_VERSION,
    privacyClass: "abstract",
    noProgressionEffects: true,
    categories,
    items,
    applied,
    retentionRules: COSMETIC_RETENTION_RULES
  };
}

function normalizeSelection(selection = {}) {
  const raw = selection && typeof selection === "object" ? selection : {};
  if (raw.category && raw.cosmeticId) {
    return { [String(raw.category)]: String(raw.cosmeticId) };
  }
  const applied = raw.applied && typeof raw.applied === "object" ? raw.applied : raw;
  return COSMETIC_CATEGORIES.reduce((result, category) => {
    if (typeof applied[category] === "string") {
      result[category] = applied[category];
    }
    return result;
  }, {});
}

function validateCosmeticSelection({ selection = {}, entitlement = {}, profile = {}, cosmeticState = {} } = {}) {
  const normalized = normalizeSelection(selection);
  const nextApplied = {
    ...normalizedCosmeticState(cosmeticState).applied
  };

  Object.entries(normalized).forEach(([category, cosmeticId]) => {
    if (!COSMETIC_CATEGORIES.includes(category)) {
      const error = new Error(`Unknown cosmetic category ${category}.`);
      error.reason = "unknown_category";
      throw error;
    }
    const item = CATALOG_BY_ID.get(cosmeticId);
    if (!item || item.category !== category) {
      const error = new Error("Cosmetic is not in the requested category.");
      error.reason = "unknown_cosmetic";
      throw error;
    }
    const decision = accessDecision(item, entitlement, profile, cosmeticState);
    if (!decision.canApply) {
      const error = new Error("Cosmetic is locked for the current entitlement or ownership state.");
      error.reason = decision.reason;
      throw error;
    }
    nextApplied[category] = item.id;
  });

  return {
    applied: nextApplied,
    changedCategories: Object.keys(normalized)
  };
}

module.exports = {
  COSMETIC_SCHEMA_VERSION,
  CATEGORY_DEFAULTS,
  COSMETIC_AVAILABILITY,
  COSMETIC_CATALOG,
  COSMETIC_CATEGORIES,
  COSMETIC_RETENTION_RULES,
  accessDecision,
  normalizedCosmeticState,
  publicCosmeticCatalog,
  resolvedAppliedCosmetics,
  validateCosmeticSelection
};
