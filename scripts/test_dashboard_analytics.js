"use strict";

const assert = require("assert");
const {
  analyticsRetentionWindow,
  assertNoPrivateExportFields,
  buildDashboardAnalytics,
  exportDashboardAnalytics
} = require("../firebase/functions/src/analytics");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

const now = "2026-05-26T00:00:00.000Z";
const freeEntitlement = {
  plan: "free",
  entitlementStatus: "free",
  historyRetentionDays: 7,
  features: {
    advancedDashboard: false,
    exports: false
  }
};
const proEntitlement = {
  plan: "pro_monthly",
  entitlementStatus: "pro",
  historyRetentionDays: 365,
  features: {
    advancedDashboard: true,
    exports: true
  }
};
const events = [
  {
    eventId: "evt_recent_patch",
    eventType: "work_apply_patch",
    timestamp: "2026-05-25T12:00:00.000Z",
    sequence: 3,
    observedFields: {
      score: 12.25,
      category: "implementation"
    }
  },
  {
    eventId: "evt_recent_test",
    eventType: "work_test_pass",
    timestamp: "2026-05-24T12:00:00.000Z",
    sequence: 2,
    observedFields: {
      score: 6.5,
      category: "validation"
    }
  },
  {
    eventId: "evt_old_research",
    eventType: "work_search",
    timestamp: "2026-05-01T12:00:00.000Z",
    sequence: 1,
    observedFields: {
      score: 3,
      category: "research"
    }
  }
];

check("retention window should keep Free short and Pro long", () => {
  const freeWindow = analyticsRetentionWindow(freeEntitlement, now);
  const proWindow = analyticsRetentionWindow(proEntitlement, now);
  return freeWindow.days === 7 &&
    freeWindow.limited === true &&
    freeWindow.queryLimit === 100 &&
    proWindow.days === 365 &&
    proWindow.limited === false &&
    proWindow.queryLimit === 2000;
});

const freeAnalytics = buildDashboardAnalytics({
  events,
  state: {
    spaceBucks: 88,
    inventory: {
      mat_chonks: 4
    }
  },
  syncMetadata: {
    acceptedCount: 3,
    rejectedCount: 1
  },
  inventory: [
    {
      materialId: "mat_iron",
      totalSpaceBucks: 22
    }
  ],
  orders: [
    {
      orderId: "order_ready",
      rewardSpaceBucks: 50,
      canFulfill: true
    },
    {
      orderId: "order_waiting",
      rewardSpaceBucks: 100,
      canFulfill: false
    }
  ],
  entitlement: freeEntitlement,
  now
});

check("free analytics should include only recent abstract history and current aggregate trends", () => {
  return freeAnalytics.history.length === 2 &&
    freeAnalytics.retention.limited === true &&
    freeAnalytics.trends.workScoreOverTime.length === 2 &&
    freeAnalytics.trends.eventsByCategory.some((row) => row.category === "implementation" && row.events === 1) &&
    freeAnalytics.current.spaceBucks === 88 &&
    freeAnalytics.current.materialValue === 22 &&
    freeAnalytics.current.orderEfficiency.readyPercent === 50 &&
    freeAnalytics.syncHealth.conflictState === "needs_review";
});

const proAnalytics = buildDashboardAnalytics({
  events,
  state: {
    space_bucks: 144
  },
  syncMetadata: {
    accepted_count: 3
  },
  entitlement: proEntitlement,
  now
});

check("pro analytics should return longer history", () => {
  return proAnalytics.history.length === 3 &&
    proAnalytics.retention.limited === false;
});

check("analytics should cap large-account history for predictable dashboard read costs", () => {
  const manyEvents = Array.from({ length: 250 }, (_, index) => ({
    eventId: `evt_many_${index}`,
    eventType: "work_apply_patch",
    timestamp: `2026-05-25T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
    sequence: index + 1,
    observedFields: {
      score: 1,
      category: "implementation"
    }
  }));
  const capped = buildDashboardAnalytics({
    events: manyEvents,
    entitlement: freeEntitlement,
    now
  });
  return capped.history.length === 100 &&
    capped.retention.queryLimit === 100;
});

check("json export should include abstract analytics only", () => {
  const exported = exportDashboardAnalytics(proAnalytics, "json");
  const parsed = JSON.parse(exported.content);
  return exported.mimeType === "application/json" &&
    parsed.privacyClass === "abstract" &&
    parsed.history.length === 3 &&
    !exported.content.includes("prompt") &&
    !exported.content.includes("terminalOutput");
});

check("csv export should include fixed abstract columns", () => {
  const exported = exportDashboardAnalytics(proAnalytics, "csv");
  return exported.mimeType === "text/csv" &&
    exported.content.split("\n")[0] === "eventId,eventType,timestamp,sequence,score,category,privacyClass" &&
    exported.content.includes("evt_recent_patch");
});

check("export privacy guard should reject private field names recursively", () => {
  try {
    assertNoPrivateExportFields({
      history: [
        {
          eventId: "evt_private",
          filePath: "/Users/jared/private"
        }
      ]
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
