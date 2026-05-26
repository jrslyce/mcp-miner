#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "yaml"

ROOT = File.expand_path("..", __dir__)
CATALOG_PATH = File.join(ROOT, "data", "cosmetics.yaml")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def contrast_ratio(background, foreground)
  luminance = lambda do |hex|
    rgb = hex.delete_prefix("#").scan(/../).map { |value| value.to_i(16) / 255.0 }
    linear = rgb.map { |channel| channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055)**2.4 }
    (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
  end
  bg = luminance.call(background)
  fg = luminance.call(foreground)
  lighter, darker = [bg, fg].max, [bg, fg].min
  (lighter + 0.05) / (darker + 0.05)
end

data = YAML.load_file(CATALOG_PATH).fetch("cosmetic_catalog")
items = data.fetch("items")

stdout, stderr, status = Open3.capture3(
  "node",
  "-e",
  "console.log(JSON.stringify(require('./firebase/functions/src/cosmetics').COSMETIC_CATALOG))",
  chdir: ROOT
)
raise "Could not load Functions cosmetic catalog: #{stderr}" unless status.success?

function_items = JSON.parse(stdout)

assert("cosmetic YAML and Functions catalog should contain the same IDs") do
  items.map { |item| item.fetch("id") }.sort == function_items.map { |item| item.fetch("id") }.sort
end

assert("catalog should cover every launch cosmetic category") do
  items.map { |item| item.fetch("category") }.uniq.sort == %w[
    base_skin
    portal_theme
    profile_badge
    seasonal_variant
    suit_trim
  ]
end

assert("catalog should include every entitlement-aware availability state") do
  items.map { |item| item.fetch("availability") }.uniq.sort == %w[
    beta
    free
    pro_included
    retired
    unlockable
  ]
end

assert("every category should have a free default cosmetic") do
  categories = data.fetch("categories")
  categories.all? do |category, config|
    default = items.find { |item| item.fetch("id") == config.fetch("default_item_id") }
    default && default.fetch("category") == category && default.fetch("availability") == "free" && default["default_for_category"] == true
  end
end

assert("premium and beta cosmetics should become inactive after downgrade") do
  items.select { |item| %w[pro_included beta].include?(item.fetch("availability")) }.all? do |item|
    item.fetch("retention") == "inactive_after_downgrade" &&
      %w[premiumCosmetics priorityBetaAccess].include?(item.fetch("requires_entitlement"))
  end
end

assert("retained earned cosmetics should use unlock IDs and never payment power") do
  items.select { |item| item.fetch("availability") == "unlockable" }.all? do |item|
    item.fetch("unlock_id").match?(/\A[a-z0-9_]+\z/) &&
      item.fetch("retention") == "retain_after_downgrade" &&
      item.fetch("effects").empty?
  end
end

assert("all cosmetics should explicitly carry no gameplay effects") do
  items.all? { |item| item.fetch("effects").is_a?(Array) && item.fetch("effects").empty? } &&
    data.fetch("no_progression_effects") == true
end

assert("portal theme contrast snapshots should meet WCAG AA text contrast") do
  items.select { |item| item["contrast_pair"] }.all? do |item|
    pair = item.fetch("contrast_pair")
    contrast_ratio(pair.fetch("background"), pair.fetch("foreground")) >= 4.5
  end
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  cosmetics: items.length
})
