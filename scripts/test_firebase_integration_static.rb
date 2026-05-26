#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

ROOT = File.expand_path("..", __dir__)
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def read(path)
  File.read(File.join(ROOT, path))
end

integration = read("scripts/firebase_integration_smoke.js")
live_account_qa = read("scripts/firebase_live_account_link_qa.js")
package = JSON.parse(read("package.json"))
docs = read("docs/firebase-local.md") + "\n" + read("docs/firebase-integration-tests.md")

assert("integration smoke should target only local Firebase emulators") do
  %w[
    FIREBASE_AUTH_EMULATOR_HOST
    FIRESTORE_EMULATOR_HOST
    FUNCTIONS_EMULATOR_HOST
    FIREBASE_HOSTING_EMULATOR_HOST
    demo-mcp-miner
  ].all? { |needle| integration.include?(needle) } &&
    !integration.match?(/serviceAccount|GOOGLE_APPLICATION_CREDENTIALS|prod/i)
end

assert("integration smoke should cover auth, profile creation, and rule denials") do
  %w[
    identitytoolkit.googleapis.com
    owner_profile_created
    signed_out_profile_write_denied
    cross_user_profile_read_denied
  ].all? { |needle| integration.include?(needle) }
end

assert("integration smoke should cover functions sync and private field rejection") do
  %w[
    syncRewardEvents
    getSyncState
    createLinkSession
    approveLinkSession
    exchangeLinkSession
    valid_sync_accepted
    duplicate_sync_idempotent
    private_sync_rejected
    private_fields
  ].all? { |needle| integration.include?(needle) }
end

assert("live account-link QA should report malformed private-field rejection responses") do
  live_account_qa.include?("const privateRejection = sync.result && Array.isArray(sync.result.rejected) ? sync.result.rejected[0] : null;") &&
    live_account_qa.include?("{ events: [acceptedEvent, privateEvent] }") &&
    live_account_qa.include?("private prompt field was not rejected:") &&
    live_account_qa.include?("privateEventId: privateEvent.eventId") &&
    live_account_qa.include?("privateResponse: sync") &&
    live_account_qa.include?("rejectedReason: privateRejection.reason")
end

assert("integration smoke should cover dashboard hosting and no-auth/offline posture") do
  %w[
    HOSTING_HOST
    DEMO_DASHBOARD
    getWeeklyDigest
    getCosmeticCatalog
    applyCosmeticSelection
    device-link
    connectFunctionsEmulator
    no_auth_sync_state_denied
  ].all? { |needle| integration.include?(needle) } &&
    integration.include?('"store"')
end

assert("package scripts should expose Java-backed emulator integration separately from static check") do
  package.dig("scripts", "firebase:integration:smoke")&.include?("scripts/firebase_integration_smoke.js") &&
    package.dig("scripts", "test:firebase-integration") == "ruby scripts/test_firebase_integration_static.rb" &&
    package.dig("scripts", "test:firebase-js").include?("scripts/firebase_integration_smoke.js") &&
    package.dig("scripts", "check").include?("npm run test:firebase-integration") &&
    !package.dig("scripts", "check").include?("firebase:integration:smoke")
end

assert("docs should explain how to run the integration smoke without production credentials") do
  docs.include?("npm run firebase:integration:smoke") &&
    docs.include?("demo-mcp-miner") &&
    docs.include?("does not require production Firebase credentials") &&
    docs.include?("Java runtime")
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  script: "scripts/firebase_integration_smoke.js"
})
