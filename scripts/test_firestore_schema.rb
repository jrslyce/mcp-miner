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

rules = read("firestore.rules")
schema = JSON.parse(read("firebase/firestore.schema.json"))
docs = read("docs/firestore-schema.md")
package = JSON.parse(read("package.json"))
smoke = read("scripts/firebase_firestore_rules_smoke.js")

expected_paths = [
  "players/{uid}",
  "players/{uid}/profile/current",
  "players/{uid}/settings/current",
  "players/{uid}/syncMetadata/{clientId}",
  "players/{uid}/syncDevices/{deviceId}",
  "players/{uid}/billing/current",
  "players/{uid}/entitlements/current",
  "players/{uid}/rewardEvents/{eventId}",
  "players/{uid}/gameState/current",
  "players/{uid}/inventory/{bucket}",
  "players/{uid}/upgrades/current",
  "players/{uid}/orders/{orderId}",
  "players/{uid}/base/current",
  "linkSessions/{sessionId}",
  "linkCodes/{code}",
  "deviceTokens/{tokenHash}",
  "billingWebhookEvents/{eventId}"
]

assert("schema should document all V1 Firestore collections") do
  expected_paths.all? { |path| schema.fetch("collections").key?(path) && docs.include?("/#{path}") }
end

assert("rules should isolate player documents by Firebase Auth UID") do
  rules.include?("function isOwner(uid)") &&
    rules.include?("request.auth.uid == uid") &&
    rules.include?("isVerifiedEmailAuth()") &&
    rules.include?("request.auth.token.email_verified == true") &&
    rules.scan("isOwner(uid)").length >= 10
end

assert("client-writeable documents should require ownerUid and abstract privacy class") do
  rules.include?("data.ownerUid == uid") &&
    rules.include?('data.privacyClass == "abstract"') &&
    rules.include?("validRewardEvent(uid, eventId, request.resource.data)")
end

assert("rules should reject practical private field names") do
  schema.fetch("privateFieldDenylist").all? { |field| rules.include?(%("#{field}")) } &&
    rules.include?("noPrivateObservedFields(data)") &&
    docs.include?("Rejected Private Fields")
end

assert("aggregate balances should be server-owned/read-only to clients") do
  %w[gameState inventory upgrades orders base].all? do |collection|
    rules.include?("match /#{collection}/{docId}") && rules.include?("allow write: if false;")
  end &&
    schema.dig("collections", "players/{uid}/gameState/current", "serverOwned") == true
end

assert("billing and entitlement projections should be server-owned/read-only to clients") do
  %w[billing entitlements].all? do |collection|
    rules.include?("match /#{collection}/{docId}") && rules.include?("allow write: if false;")
  end &&
    schema.dig("collections", "players/{uid}/billing/current", "serverOwned") == true &&
    schema.dig("collections", "players/{uid}/billing/current", "sourceOfTruth") == "stripe" &&
    schema.dig("collections", "players/{uid}/entitlements/current", "serverOwned") == true &&
    docs.include?("Stripe is the source of truth") &&
    docs.include?("Functions must evaluate the effective entitlement as Free")
end

assert("linking secrets should stay in server-owned top-level collections") do
  ["linkSessions/{sessionId}", "linkCodes/{code}", "deviceTokens/{tokenHash}", "billingWebhookEvents/{eventId}"].all? do |path|
    schema.dig("collections", path, "serverOwned") == true &&
      schema.dig("collections", path, "clientAccess") == []
  end &&
    docs.include?("default deny rule") &&
    rules.include?("match /{document=**}") &&
    rules.include?("allow read, write: if false;")
end

assert("reward events should be append-only abstract Codex hook summaries") do
  rules.include?("allow create: if isOwner(uid) && validRewardEvent") &&
    rules.include?("allow update, delete: if false") &&
    rules.include?('data.source == "codex_hook"') &&
    schema.dig("collections", "players/{uid}/rewardEvents/{eventId}", "appendOnly") == true
end

assert("emulator rule smoke script should cover allow and deny cases") do
  package.dig("scripts", "firebase:rules:smoke") &&
    smoke.include?("owner_profile_allow") &&
    smoke.include?("cross_user_profile_deny") &&
    smoke.include?("private_reward_event_deny") &&
    smoke.include?("aggregate_game_state_write_deny") &&
    smoke.include?("admin_entitlement_projection_read_allow") &&
    smoke.include?("client_entitlement_write_deny") &&
    smoke.include?("client_billing_write_deny")
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  collections: schema.fetch("collections").length,
  private_fields_denied: schema.fetch("privateFieldDenylist").length
})
