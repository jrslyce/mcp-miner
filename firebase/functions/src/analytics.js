"use strict";

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

function isoDay(value) {
  const millis = parseMillis(value);
  return new Date(millis || 0).toISOString().slice(0, 10);
}

function analyticsRetentionWindow(entitlement = {}, now = new Date().toISOString()) {
  const nowMillis = parseMillis(now) || Date.now();
  const days = Math.max(1, numberValue(entitlement.historyRetentionDays, 7));
  const pro = entitlement.entitlementStatus === "pro" || entitlement.features?.advancedDashboard === true;
  return {
    days,
    cutoffAt: new Date(nowMillis - (days * MS_PER_DAY)).toISOString(),
    queryLimit: pro ? 2000 : 100,
    exportLimit: pro ? 2000 : 0,
    limited: !pro
  };
}

function normalizeEvent(event = {}) {
  const observed = event.observedFields && typeof event.observedFields === "object" ? event.observedFields : {};
  const category = String(observed.category || event.eventType || "unknown");
  return {
    eventId: String(event.eventId || ""),
    eventType: String(event.eventType || "unknown"),
    timestamp: event.timestamp || event.receivedAt || event.reducedAt || null,
    sequence: numberValue(event.sequence),
    score: Math.round(numberValue(observed.score) * 100) / 100,
    category,
    privacyClass: "abstract"
  };
}

function aggregateByDay(events) {
  const byDay = new Map();
  events.forEach((event) => {
    const day = isoDay(event.timestamp);
    const current = byDay.get(day) || { day, score: 0, events: 0 };
    current.score = Math.round((current.score + numberValue(event.score)) * 100) / 100;
    current.events += 1;
    byDay.set(day, current);
  });
  return [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day));
}

function aggregateByCategory(events) {
  const byCategory = new Map();
  events.forEach((event) => {
    const category = event.category || "unknown";
    const current = byCategory.get(category) || { category, events: 0, score: 0 };
    current.events += 1;
    current.score = Math.round((current.score + numberValue(event.score)) * 100) / 100;
    byCategory.set(category, current);
  });
  return [...byCategory.values()].sort((left, right) => right.events - left.events || left.category.localeCompare(right.category));
}

function materialValue(inventory = [], state = {}) {
  const rows = Array.isArray(inventory) ? inventory : [];
  const fromRows = rows.reduce((sum, item) => {
    return sum + numberValue(item.totalSpaceBucks ?? item.total_space_bucks ?? item.total_raw_space_bucks);
  }, 0);
  if (fromRows > 0) {
    return Math.round(fromRows);
  }
  const stateInventory = state.inventory && typeof state.inventory === "object" ? state.inventory : {};
  return Object.values(stateInventory).reduce((sum, quantity) => sum + numberValue(quantity), 0);
}

function orderEfficiency(orders = []) {
  const rows = Array.isArray(orders) ? orders : [];
  const total = rows.length;
  const ready = rows.filter((order) => order.canFulfill || order.can_fulfill).length;
  const rewardSpaceBucks = rows.reduce((sum, order) => {
    return sum + numberValue(order.rewardSpaceBucks ?? order.reward_space_bucks ?? order.payout ?? order.space_bucks);
  }, 0);
  return {
    activeOrders: total,
    fulfillableOrders: ready,
    readyPercent: total ? Math.round((ready / total) * 1000) / 10 : 0,
    rewardSpaceBucks
  };
}

function trendPoint(day, value) {
  return {
    day,
    value: Math.round(numberValue(value) * 100) / 100
  };
}

function buildDashboardAnalytics({ events = [], syncMetadata = {}, deviceCount = 0, state = {}, inventory = [], orders = [], entitlement = {}, now = new Date().toISOString() } = {}) {
  const retention = analyticsRetentionWindow(entitlement, now);
  const cutoffMillis = parseMillis(retention.cutoffAt) || 0;
  const filteredEvents = events
    .map(normalizeEvent)
    .filter((event) => event.eventId && (parseMillis(event.timestamp) || 0) >= cutoffMillis)
    .sort((left, right) => (parseMillis(right.timestamp) || 0) - (parseMillis(left.timestamp) || 0))
    .slice(0, retention.queryLimit);
  const currentDay = isoDay(now);
  const spaceBucks = numberValue(state.spaceBucks ?? state.space_bucks);
  const materialTotal = materialValue(inventory, state);
  const efficiency = orderEfficiency(orders);
  const rejectedCount = numberValue(syncMetadata.rejectedCount ?? syncMetadata.rejected_count);
  const duplicateCount = numberValue(syncMetadata.duplicateCount ?? syncMetadata.duplicate_count);
  const acceptedCount = numberValue(syncMetadata.acceptedCount ?? syncMetadata.accepted_count ?? state.eventCount ?? state.event_count);

  return {
    ok: true,
    privacyClass: "abstract",
    retention: {
      days: retention.days,
      cutoffAt: retention.cutoffAt,
      limited: retention.limited,
      returnedEvents: filteredEvents.length,
      queryLimit: retention.queryLimit
    },
    trends: {
      workScoreOverTime: aggregateByDay(filteredEvents),
      eventsByCategory: aggregateByCategory(filteredEvents),
      spaceBucksTrend: [trendPoint(currentDay, spaceBucks)],
      materialValueTrend: [trendPoint(currentDay, materialTotal)],
      orderEfficiency: [trendPoint(currentDay, efficiency.readyPercent)]
    },
    syncHealth: {
      acceptedCount,
      duplicateCount,
      rejectedCount,
      conflictState: syncMetadata.conflictState || syncMetadata.conflict_state || (rejectedCount > 0 ? "needs_review" : "none"),
      lastAcceptedBatchAt: syncMetadata.lastAcceptedBatchAt || syncMetadata.last_accepted_batch_at || null,
      activeDevices: deviceCount
    },
    current: {
      spaceBucks,
      materialValue: materialTotal,
      orderEfficiency: efficiency
    },
    history: filteredEvents
  };
}

function assertNoPrivateExportFields(value, path = "export") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateExportFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (PRIVATE_KEY_TOKENS.some((token) => normalized.includes(token))) {
      throw new Error(`Export field ${path}.${key} is not allowed.`);
    }
    assertNoPrivateExportFields(nested, `${path}.${key}`);
  });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function exportDashboardAnalytics(analytics, format = "json") {
  const rows = (analytics.history || []).map((event) => ({
    eventId: event.eventId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    sequence: event.sequence,
    score: event.score,
    category: event.category,
    privacyClass: "abstract"
  }));
  assertNoPrivateExportFields(rows);
  if (format === "csv") {
    const headers = ["eventId", "eventType", "timestamp", "sequence", "score", "category", "privacyClass"];
    return {
      format: "csv",
      mimeType: "text/csv",
      content: [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
      ].join("\n")
    };
  }
  const payload = {
    privacyClass: "abstract",
    retention: analytics.retention,
    trends: analytics.trends,
    syncHealth: analytics.syncHealth,
    current: analytics.current,
    history: rows
  };
  assertNoPrivateExportFields(payload);
  return {
    format: "json",
    mimeType: "application/json",
    content: JSON.stringify(payload, null, 2)
  };
}

module.exports = {
  analyticsRetentionWindow,
  assertNoPrivateExportFields,
  buildDashboardAnalytics,
  exportDashboardAnalytics,
  normalizeEvent
};
