#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

ROOT = File.expand_path("..", __dir__)
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

doc = File.read(File.join(ROOT, "docs/crypto-subscriptions-evaluation.md"))

assert("crypto evaluation should make a clear MVP decision") do
  doc.include?("Crypto wallet subscriptions are **not MVP**") &&
    doc.include?("Stripe card subscriptions remain") &&
    doc.include?("only launch billing path")
end

assert("crypto evaluation should compare recurring providers") do
  ["Stripe Stablecoin Payments", "Loop Crypto", "OrcaRail", "RecurCrypto", "Acta", "Coinflow", "Coinbase"].all? do |name|
    doc.include?(name)
  end
end

assert("crypto evaluation should account for current provider availability") do
  doc.include?("approval-gated/private-preview") &&
    doc.include?("Loop is folding into Lead") &&
    doc.include?("Do not select now")
end

assert("crypto evaluation should require normalized entitlement projection") do
  doc.include?("No crypto provider may write entitlements directly.") &&
    doc.include?("/players/{uid}/billing/current") &&
    doc.include?("/players/{uid}/entitlements/current")
end

assert("crypto evaluation should cover cancellation failure and tax risks") do
  %w[Refunds KYC/AML tax failed renewal].all? { |needle| doc.include?(needle) }
end

assert("crypto evaluation should estimate implementation effort") do
  doc.include?("Implementation Estimate") &&
    doc.include?("Stripe stablecoin subscription pilot") &&
    doc.include?("Production launch hardening")
end

puts({
  ok: true,
  checks: $checks
}.to_json)
