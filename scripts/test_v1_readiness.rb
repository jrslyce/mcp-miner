#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
MCP_SERVER = File.join(ROOT, "plugins", "mcp-miner", "scripts", "mcp_server.rb")
READINESS_DOC = File.join(ROOT, "docs", "v1-launch-readiness.md")
PACKAGE_JSON = File.join(ROOT, "package.json")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def run_mcp(state_path, calls)
  input = calls.map { |payload| JSON.generate(payload) }.join("\n")
  stdout, stderr, status = Open3.capture3({
    "MCP_MINER_STATE_PATH" => state_path
  }, "ruby", MCP_SERVER, stdin_data: "#{input}\n")
  raise "V1 readiness MCP smoke failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def read(path)
  File.read(File.join(ROOT, path))
end

package = JSON.parse(File.read(PACKAGE_JSON))
scripts = package.fetch("scripts")
readiness_doc = File.read(READINESS_DOC)

assert("package scripts should cover V1 readiness verification") do
  %w[
    check
    validate:data
    validate:plugin
    test:plugin-install
    test:v1-readiness
    test:hooks
    test:mcp
    test:dashboard
    test:firebase-integration
    test:firestore-schema
    test:cloud-sync-api
    test:cloud-sync-client
    firebase:emulators:smoke
    firebase:rules:smoke
    firebase:auth:smoke
    firebase:sync:smoke
    firebase:backup:smoke
    firebase:analytics:smoke
    firebase:dashboard:smoke
    firebase:integration:smoke
  ].all? { |name| scripts.key?(name) } &&
    scripts.fetch("check").include?("npm run test:v1-readiness")
end

Dir.mktmpdir("mcp-miner-v1-readiness") do |dir|
  state_path = File.join(dir, "state.json")
  responses = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "update_settings", arguments: { cloud_sync: false, report_mode: "meaningful_turns_only" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_player_status", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_active_orders", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_store_catalog", arguments: {} } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sync_progress", arguments: {} } }
  ])

  settings_payload = tool_payload(responses[1])
  status_payload = tool_payload(responses[2])
  orders_payload = tool_payload(responses[3])
  store_payload = tool_payload(responses[4])
  sync_payload = tool_payload(responses[5])

  assert("local-only flow should work without Firebase auth or network") do
    settings_payload.dig("settings", "cloud_sync") == false &&
      status_payload.dig("player", "space_bucks").is_a?(Integer) &&
      orders_payload.fetch("orders").any? &&
      store_payload.dig("store", "real_money") == false &&
      sync_payload.dig("sync", "cloud_sync_enabled") == false &&
      sync_payload.dig("sync", "available") == false
  end

  serialized = JSON.generate([settings_payload, status_payload, orders_payload, store_payload, sync_payload])
  assert("local-only utility payloads should not expose private local details") do
    !serialized.include?(ROOT) &&
      !serialized.include?(state_path) &&
      !serialized.include?(dir) &&
      !serialized.include?("please implement") &&
      !serialized.include?("repo-name") &&
      !serialized.include?("secret-token")
  end
end

firestore_rules = read("firestore.rules")
firestore_schema = read("firebase/firestore.schema.json")
sync_function = read("firebase/functions/src/sync.js")
cloud_sync_docs = read("docs/cloud-sync-api.md")

assert("Firestore rules and sync API should reject private event data") do
  firestore_rules.include?("isOwner") &&
    firestore_rules.include?("noPrivateTopLevel") &&
    firestore_rules.include?("noPrivateObservedFields") &&
    firestore_schema.include?("privateFieldDenylist") &&
    sync_function.include?("PRIVATE_KEYS") &&
    sync_function.include?("event contains private field names") &&
    cloud_sync_docs.include?("private field names")
end

dashboard_html = read("firebase/hosting/index.html")
dashboard_js = read("firebase/hosting/auth.js")
dashboard_docs = read("docs/firebase-dashboard.md")
store_docs = read("docs/space-bucks-store.md")

assert("dashboard and store surfaces should document and render privacy boundaries") do
  dashboard_html.include?("sync-privacy") &&
    dashboard_html.include?("Space Bucks store") &&
    dashboard_js.include?("escapeHtml") &&
    dashboard_js.include?("privacyItems") &&
    dashboard_js.include?("Store purchases are validated through the local MCP store flow.") &&
    dashboard_docs.include?("does not fetch raw Codex work details") &&
    store_docs.include?("no real-money purchase path")
end

firebase_local_docs = read("docs/firebase-local.md")
integration_docs = read("docs/firebase-integration-tests.md")
auth_docs = read("docs/auth-linking.md")

assert("Firebase emulator and production deployment notes should be present") do
  firebase_local_docs.include?("Secret Manager") &&
    firebase_local_docs.include?("App Check") &&
    firebase_local_docs.include?("Cloud Logging") &&
    integration_docs.include?("requires a Java runtime") &&
    auth_docs.include?("account linking is optional") &&
    readiness_doc.include?("Firebase And GCP Deployment Notes")
end

gdd = read("GAME_DESIGN_DOCUMENT.md")
assert("known V1/V2 scope boundaries should be documented") do
  gdd.include?("## 22. MVP Scope") &&
    gdd.include?("## 23. V1 Scope") &&
    gdd.include?("## 24. V2 And Beyond") &&
    readiness_doc.include?("V2 Non-Goals") &&
    readiness_doc.include?("Real-money purchases are a non-goal for V1")
end

assert("readiness document should cover acceptance criteria") do
  [
    "Local-only play",
    "Optional Firebase linking/sync",
    "Dashboard/store privacy",
    "Security rules and sync API",
    "Plugin packaging",
    "Required Verification",
    "Manual Smoke Notes"
  ].all? { |section| readiness_doc.include?(section) }
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  readiness_doc: "docs/v1-launch-readiness.md",
  local_only: true,
  firebase_emulator_commands: scripts.keys.grep(/\Afirebase:/).sort
})
