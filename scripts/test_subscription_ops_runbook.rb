#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

ROOT = File.expand_path("..", __dir__)
DOC_PATH = File.join(ROOT, "docs", "subscription-ops-runbook.md")
INDEX_PATH = File.join(ROOT, "firebase", "functions", "src", "index.js")
OBSERVABILITY_PATH = File.join(ROOT, "firebase", "functions", "src", "observability.js")

$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

doc = File.read(DOC_PATH)
index_js = File.read(INDEX_PATH)
observability = File.read(OBSERVABILITY_PATH)

required_logs = %w[
  mcp_miner_stripe_checkout_start
  mcp_miner_stripe_checkout_session
  mcp_miner_billing_error
  mcp_miner_stripe_webhook_processed
  mcp_miner_stripe_webhook_rejected
  mcp_miner_entitlement_projection_changed
  mcp_miner_sync_reward_events
  mcp_miner_sync_reward_events_rejected
  mcp_miner_entitlement_operation_rejected
  mcp_miner_rate_limit_rejected
  mcp_miner_dashboard_history_exported
  mcp_miner_cloud_backup_created
  mcp_miner_cloud_backup_restore_requested
  mcp_miner_link_session_created
  mcp_miner_link_session_approved
  mcp_miner_link_session_exchanged
  mcp_miner_sync_device_revoked
]

assert("runbook should document every structured log emitted for subscription operations") do
  required_logs.all? { |log| doc.include?(log) && index_js.include?(log) }
end

assert("runbook should document budget and Stripe alert requirements") do
  [
    "50%, 80%, 100%, and 125%",
    "failed webhook deliveries",
    "abnormal Checkout Session volume",
    "Functions error rate",
    "QA-024"
  ].all? { |needle| doc.include?(needle) }
end

assert("runbook should document rate-limited abuse surfaces") do
  %w[
    syncRewardEvents
    exportDashboardHistory
    createCloudBackup
    restoreCloudBackup
    createCheckoutSession
    createCustomerPortalSession
    createLinkSession
    approveLinkSession
    exchangeLinkSession
  ].all? { |operation| doc.include?(operation) && observability.include?(operation) }
end

assert("runbook should document deploy order and rollback steps") do
  doc.include?("## Deploy Order") &&
    doc.include?("## Rollback") &&
    doc.include?("Deploy Firestore rules") &&
    doc.include?("Deploy Functions") &&
    doc.include?("Deploy Hosting") &&
    doc.include?("Stripe rollback")
end

assert("runbook should document incident response and support contacts") do
  doc.include?("## Incident Response") &&
    doc.include?("## Support Contacts") &&
    doc.include?("privacy incident") &&
    doc.include?("local play continues")
end

assert("runbook should document support tooling and audit requirements") do
  doc.include?("## Support Tooling") &&
    doc.include?("scripts/subscription_support_admin.js") &&
    doc.include?("/supportAuditLogs/{auditId}") &&
    doc.include?("MCP_MINER_SUPPORT_ACTOR") &&
    doc.include?("Unknown Price IDs")
end

assert("runbook should document usage assumptions and cost guardrails") do
  doc.include?("100 Free users and 25 Pro users") &&
    doc.include?("sync_cadence_cost_smoke.js") &&
    doc.include?("2x the modeled daily reads/writes")
end

assert("runbook should document test-mode to production checklist") do
  doc.include?("## Test-Mode To Production Checklist") &&
    doc.include?("STRIPE_WEBHOOK_SECRET") &&
    doc.include?("MCP_MINER_DASHBOARD_URL") &&
    doc.include?("Budget and webhook alert screenshots")
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  doc: "docs/subscription-ops-runbook.md"
})
