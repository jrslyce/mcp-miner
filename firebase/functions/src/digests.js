"use strict";

const { normalizeEvent } = require("./analytics");

const WEEKLY_DIGEST_SCHEMA_VERSION = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PRIVATE_KEY_TOKENS = [
  "prompt",
  "code",
  "command",
  "terminaloutput",
  "filepath",
  "path",
  "cwd",
  "repo",
  "browsercontent",
  "appcontent",
  "transcript"
];

function parseMillis(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? null : millis;
  }
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (Number.isInteger(value.seconds)) {
    return (value.seconds * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
  }
  return null;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolSetting(settings = {}, key, fallback) {
  return typeof settings[key] === "boolean" ? settings[key] : fallback;
}

function weekWindow(now = new Date().toISOString()) {
  const endMillis = parseMillis(now) || Date.now();
  const startMillis = endMillis - (7 * MS_PER_DAY);
  return {
    startAt: new Date(startMillis).toISOString(),
    endAt: new Date(endMillis).toISOString(),
    label: `${new Date(startMillis).toISOString().slice(0, 10)} to ${new Date(endMillis).toISOString().slice(0, 10)}`
  };
}

function weeklyDigestAccess(entitlement = {}, settings = {}) {
  const pro = entitlement.entitlementStatus === "pro";
  const weeklyAvailable = pro && entitlement.features && entitlement.features.weeklyDigest === true;
  const betaAvailable = pro && entitlement.features && entitlement.features.priorityBetaAccess === true;
  const digestEnabled = boolSetting(settings, "weeklyDigestEnabled", true);
  const betaFeaturesEnabled = boolSetting(settings, "betaFeaturesEnabled", false);
  return {
    eligible: weeklyAvailable,
    digestEnabled,
    betaAvailable,
    betaFeaturesEnabled,
    effectiveBetaAccess: betaAvailable && betaFeaturesEnabled,
    status: !weeklyAvailable ? "locked" : (digestEnabled ? "ready" : "disabled")
  };
}

function recentEvents(events = [], window) {
  const startMillis = parseMillis(window.startAt) || 0;
  const endMillis = parseMillis(window.endAt) || Date.now();
  return (Array.isArray(events) ? events : [])
    .map(normalizeEvent)
    .filter((event) => {
      const millis = parseMillis(event.timestamp) || 0;
      return event.eventId && millis >= startMillis && millis <= endMillis;
    });
}

function inventoryRows(inventory = [], state = {}) {
  const rows = [];
  (Array.isArray(inventory) ? inventory : []).forEach((entry) => {
    if (Array.isArray(entry.items)) {
      entry.items.forEach((item) => rows.push(item));
      return;
    }
    rows.push(entry);
  });
  if (!rows.length && state.inventory && typeof state.inventory === "object") {
    Object.entries(state.inventory).forEach(([materialId, quantity]) => rows.push({
      materialId,
      quantity
    }));
  }
  return rows;
}

function inventoryDigest(inventory = [], state = {}) {
  const rows = inventoryRows(inventory, state);
  let materialTypes = 0;
  let materialUnits = 0;
  let materialValue = 0;
  let chonks = numberValue(state.chonksMined ?? state.chonks_mined ?? state.stats?.chonks_mined_total);
  rows.forEach((item) => {
    const materialId = item.materialId || item.material_id || item.id || "";
    const quantity = numberValue(item.quantity || item.count || item.amount);
    if (quantity > 0 && materialId) {
      materialTypes += 1;
      materialUnits += quantity;
    }
    if (materialId === "mat_chonks") {
      chonks = Math.max(chonks, quantity);
    }
    materialValue += numberValue(item.totalSpaceBucks ?? item.total_space_bucks ?? item.total_raw_space_bucks);
  });
  return {
    chonksMined: Math.round(chonks),
    materialTypes,
    materialUnits: Math.round(materialUnits),
    materialValue: Math.round(materialValue)
  };
}

function orderDigest(orders = []) {
  const rows = Array.isArray(orders) ? orders : [];
  const activeOrders = rows.length;
  const fulfillableOrders = rows.filter((order) => order.canFulfill || order.can_fulfill).length;
  const rewardSpaceBucks = rows.reduce((sum, order) => {
    return sum + numberValue(order.rewardSpaceBucks ?? order.reward_space_bucks ?? order.payout ?? order.space_bucks);
  }, 0);
  return {
    activeOrders,
    fulfillableOrders,
    rewardSpaceBucks: Math.round(rewardSpaceBucks)
  };
}

function syncDigest(syncMetadata = {}, deviceCount = 0) {
  const rejectedCount = numberValue(syncMetadata.rejectedCount ?? syncMetadata.rejected_count);
  return {
    acceptedCount: numberValue(syncMetadata.acceptedCount ?? syncMetadata.accepted_count),
    duplicateCount: numberValue(syncMetadata.duplicateCount ?? syncMetadata.duplicate_count),
    rejectedCount,
    conflictState: syncMetadata.conflictState || syncMetadata.conflict_state || (rejectedCount > 0 ? "needs_review" : "none"),
    activeDevices: deviceCount,
    lastAcceptedBatchAt: syncMetadata.lastAcceptedBatchAt || syncMetadata.last_accepted_batch_at || null
  };
}

function eventDigest(events = []) {
  const categories = new Map();
  let workScore = 0;
  events.forEach((event) => {
    const category = event.category || event.eventType || "unknown";
    const current = categories.get(category) || { category, events: 0, score: 0 };
    current.events += 1;
    current.score = Math.round((current.score + numberValue(event.score)) * 100) / 100;
    workScore = Math.round((workScore + numberValue(event.score)) * 100) / 100;
    categories.set(category, current);
  });
  return {
    eventCount: events.length,
    workScore,
    categories: [...categories.values()].sort((left, right) => right.events - left.events || left.category.localeCompare(right.category)).slice(0, 5)
  };
}

function milestoneDigest({ events = {}, state = {}, inventory = {}, orders = {} } = {}) {
  const eventMilestones = Math.floor(numberValue(events.eventCount) / 25);
  const scoreMilestones = Math.floor(numberValue(events.workScore) / 250);
  const asteroidMined = numberValue(state.asteroidProgress?.mined ?? state.asteroid_progress?.mined);
  const asteroidMilestones = Math.floor(asteroidMined / 250);
  return {
    eventMilestones,
    scoreMilestones,
    asteroidMilestones,
    orderReadyMilestone: numberValue(orders.fulfillableOrders) > 0,
    materialMilestone: numberValue(inventory.materialTypes) >= 3
  };
}

function cosmeticDigest(cosmeticState = {}) {
  const applied = cosmeticState.applied && typeof cosmeticState.applied === "object" ? cosmeticState.applied : {};
  return {
    activeSelections: Object.keys(applied).length,
    categories: Object.keys(applied).sort(),
    updatedAt: cosmeticState.updatedAt || null
  };
}

function baseDigest(base = {}) {
  return {
    moduleCount: numberValue(base.moduleCount ?? base.module_count ?? base.modules),
    droneLevel: numberValue(base.droneLevel ?? base.drone_level),
    updatedAt: base.updatedAt || null
  };
}

function digestHighlights({ events, inventory, orders, sync, base, cosmetics }) {
  const highlights = [];
  if (events.eventCount > 0) {
    highlights.push(`${events.eventCount} abstract work events scored this week.`);
  }
  if (inventory.chonksMined > 0) {
    highlights.push(`${inventory.chonksMined} Chonks are reflected in synced inventory.`);
  }
  if (orders.fulfillableOrders > 0) {
    highlights.push(`${orders.fulfillableOrders} order${orders.fulfillableOrders === 1 ? "" : "s"} ready for fulfillment.`);
  }
  if (sync.conflictState !== "none") {
    highlights.push("Sync needs a quick review.");
  }
  if (base.moduleCount > 0) {
    highlights.push(`${base.moduleCount} base module${base.moduleCount === 1 ? "" : "s"} active.`);
  }
  if (cosmetics.activeSelections > 0) {
    highlights.push(`${cosmetics.activeSelections} cosmetic selection${cosmetics.activeSelections === 1 ? "" : "s"} saved.`);
  }
  return highlights.slice(0, 6);
}

function emptyDigestSummary() {
  return {
    events: {
      eventCount: 0,
      workScore: 0,
      categories: []
    },
    chonks: {
      mined: 0
    },
    spaceBucks: {
      current: 0
    },
    materials: {
      types: 0,
      units: 0,
      valueSpaceBucks: 0
    },
    orders: {
      activeOrders: 0,
      fulfillableOrders: 0,
      rewardSpaceBucks: 0
    },
    sync: {
      acceptedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      conflictState: "none",
      activeDevices: 0,
      lastAcceptedBatchAt: null
    },
    milestones: {
      eventMilestones: 0,
      scoreMilestones: 0,
      asteroidMilestones: 0,
      orderReadyMilestone: false,
      materialMilestone: false
    },
    base: {
      moduleCount: 0,
      droneLevel: 0,
      updatedAt: null
    },
    cosmetics: {
      activeSelections: 0,
      categories: [],
      updatedAt: null
    }
  };
}

function assertNoPrivateDigestFields(value, path = "digest") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateDigestFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (PRIVATE_KEY_TOKENS.some((token) => normalized.includes(token))) {
      throw new Error(`Digest field ${path}.${key} is not allowed.`);
    }
    assertNoPrivateDigestFields(nested, `${path}.${key}`);
  });
}

function buildWeeklyDigest({
  events = [],
  state = {},
  inventory = [],
  orders = [],
  syncMetadata = {},
  deviceCount = 0,
  base = {},
  cosmeticState = {},
  entitlement = {},
  settings = {},
  now = new Date().toISOString()
} = {}) {
  const window = weekWindow(now);
  const access = weeklyDigestAccess(entitlement, settings);
  const safeEvents = recentEvents(events, window);
  const eventsSummary = eventDigest(safeEvents);
  const inventorySummary = inventoryDigest(inventory, state);
  const ordersSummary = orderDigest(orders);
  const syncSummary = syncDigest(syncMetadata, deviceCount);
  const baseSummary = baseDigest(base);
  const cosmeticsSummary = cosmeticDigest(cosmeticState);
  const milestones = milestoneDigest({
    events: eventsSummary,
    state,
    inventory: inventorySummary,
    orders: ordersSummary
  });
  const ready = access.status === "ready";
  const readySummary = {
    events: eventsSummary,
    chonks: {
      mined: inventorySummary.chonksMined
    },
    spaceBucks: {
      current: numberValue(state.spaceBucks ?? state.space_bucks)
    },
    materials: {
      types: inventorySummary.materialTypes,
      units: inventorySummary.materialUnits,
      valueSpaceBucks: inventorySummary.materialValue
    },
    orders: ordersSummary,
    sync: syncSummary,
    milestones,
    base: baseSummary,
    cosmetics: cosmeticsSummary
  };
  const summary = ready ? readySummary : emptyDigestSummary();
  const digest = {
    ok: true,
    schemaVersion: WEEKLY_DIGEST_SCHEMA_VERSION,
    privacyClass: "abstract",
    status: access.status,
    week: window,
    preferences: {
      weeklyDigestEnabled: access.digestEnabled,
      betaFeaturesEnabled: access.betaFeaturesEnabled,
      betaAvailable: access.betaAvailable,
      effectiveBetaAccess: access.effectiveBetaAccess
    },
    summary,
    highlights: ready
      ? digestHighlights({
        events: eventsSummary,
        inventory: inventorySummary,
        orders: ordersSummary,
        sync: syncSummary,
        base: baseSummary,
        cosmetics: cosmeticsSummary
      })
      : [],
    delivery: {
      inPortal: true,
      email: "not_enabled"
    }
  };
  assertNoPrivateDigestFields(digest);
  return digest;
}

module.exports = {
  WEEKLY_DIGEST_SCHEMA_VERSION,
  assertNoPrivateDigestFields,
  buildWeeklyDigest,
  weekWindow,
  weeklyDigestAccess
};
