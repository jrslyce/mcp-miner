#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

ROOT = File.expand_path("..", __dir__)
DOC_PATH = File.join(ROOT, "docs", "subscription-qa-matrix.md")
EXPECTED_TICKETS = (192..210).map { |number| "MUX-#{number}" }
REQUIRED_PHASES = [
  "Emulator",
  "Stripe test-mode",
  "Browser",
  "Plugin UX",
  "Crypto sandbox",
  "Production smoke"
].freeze
REQUIRED_DOMAINS = [
  "Stripe",
  "crypto provider",
  "entitlement projection",
  "portal",
  "plugin",
  "sync cadence",
  "device limits",
  "downgrade",
  "cancellation",
  "payment failure",
  "backup",
  "export",
  "cosmetics",
  "privacy"
].freeze
REQUIRED_NEGATIVES = [
  "Forged client writes",
  "Forged webhooks",
  "Revoked device tokens",
  "Cross-user device IDs",
  "Private field injection",
  "Rate-limit abuse"
].freeze

$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

doc = File.read(DOC_PATH)
rows = doc.lines
  .select { |line| line.start_with?("| QA-") }
  .map { |line| line.strip.split("|").map(&:strip).reject(&:empty?) }

assert("subscription QA matrix should define at least 20 scenario rows") do
  rows.length >= 20
end

assert("subscription QA matrix row IDs should be unique") do
  ids = rows.map(&:first)
  ids.uniq.length == ids.length
end

assert("every subscription ticket MUX-192 through MUX-210 should be covered") do
  EXPECTED_TICKETS.all? { |ticket| doc.include?(ticket) }
end

assert("matrix should include emulator, Stripe test-mode, browser, plugin, crypto, and production-smoke phases") do
  REQUIRED_PHASES.all? { |phase| doc.include?(phase) }
end

assert("matrix should cover all subscription launch domains") do
  downcased = doc.downcase
  REQUIRED_DOMAINS.all? { |domain| downcased.include?(domain.downcase) }
end

assert("matrix should include required negative tests") do
  REQUIRED_NEGATIVES.all? { |negative| doc.include?(negative) }
end

assert("high-risk rows should be launch blockers") do
  rows.select { |row| row[2] == "High" }.all? { |row| row[6] == "Launch blocker" }
end

assert("matrix should require evidence links or logs") do
  doc.include?("evidence link or log reference") &&
    doc.include?("Required Evidence") &&
    doc.include?("Linear bug")
end

assert("matrix should define test accounts and cleanup/revocation steps") do
  %w[
    qa-free-1@mcp-miner.local
    qa-pro-monthly@mcp-miner.local
    qa-pro-annual@mcp-miner.local
    qa-pro-downgrade@mcp-miner.local
    revoke
    cleanup
  ].all? { |needle| doc.downcase.include?(needle.downcase) }
end

assert("matrix should confirm required billing and device lifecycle scenarios") do
  required = [
    "Monthly Checkout",
    "Annual Checkout",
    "Annual renewal",
    "Payment failure",
    "Portal cancellation",
    "Downgrade from Pro with five devices",
    "Free second-device rejection"
  ]
  required.all? { |needle| doc.include?(needle) }
end

assert("matrix should name dry-run commands for local validation") do
  %w[
    npm\ run\ check
    firebase:rules:smoke
    firebase:sync:smoke
    firebase:backup:smoke
    firebase:weekly-digest:smoke
    firebase:integration:smoke
  ].all? { |needle| doc.include?(needle.gsub("\\ ", " ")) }
end

puts({
  ok: true,
  checks: $checks,
  rows: rows.length,
  tickets: EXPECTED_TICKETS.length,
  doc: "docs/subscription-qa-matrix.md"
}.to_json)
