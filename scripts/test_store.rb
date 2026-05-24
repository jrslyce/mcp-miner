#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "tmpdir"
require_relative "../plugins/mcp-miner/lib/mcp_miner/game_engine"

ROOT = File.expand_path("..", __dir__)
MCP_SERVER = File.join(ROOT, "plugins", "mcp-miner", "scripts", "mcp_server.rb")
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
  raise "Store MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

Dir.mktmpdir("mcp-miner-store") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  seeded = engine.initial_state
  seeded["space_bucks"] = 1_500
  seeded["inventory"] = {
    "mat_chonks" => 500,
    "mat_element_fe" => 60,
    "mat_element_ni" => 20,
    "mat_element_si" => 30,
    "mat_element_cu" => 20,
    "mat_gem_quartz" => 8
  }
  engine.write_state(seeded)

  first = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_store_catalog", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "upgrade:upgrade_drill_power" } } }
  ])

  tool_names = first[1].dig("result", "tools").map { |tool| tool["name"] }
  catalog = tool_payload(first[2])
  upgrade_purchase = tool_payload(first[3])
  after_upgrade = state(state_path)

  assert("tools/list should expose store catalog and purchase actions") do
    %w[get_store_catalog purchase_store_item].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("store catalog should list earned-currency categories with no payment integration") do
    catalog.dig("store", "currency") == "Space Bucks" &&
      catalog.dig("store", "real_money") == false &&
      catalog.dig("store", "payment_integration") == false &&
      %w[upgrades machines recipes base_modules cosmetics].all? { |key| catalog.dig("store", "categories", key).is_a?(Array) }
  end
  assert("purchase_store_item should buy an affordable upgrade through local validation") do
    upgrade_purchase["ok"] == true &&
      upgrade_purchase["status"] == "purchased" &&
      upgrade_purchase["store_item_id"] == "upgrade:upgrade_drill_power" &&
      after_upgrade.dig("upgrades", "upgrade_drill_power") == 1 &&
      after_upgrade["space_bucks"] == 1_380 &&
      after_upgrade.dig("store_transactions").last["kind"] == "upgrade" &&
      upgrade_purchase.dig("dashboard", "space_bucks") == 1_380
  end

  engine.with_state do |current_state|
    current_state["space_bucks"] = 0
    current_state["inventory"]["mat_element_fe"] = 20
    current_state["inventory"]["mat_element_ni"] = 20
  end
  insufficient_space = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "upgrade:upgrade_drill_power" } } }
  ]).first)
  assert("store purchase should reject insufficient Space Bucks") do
    insufficient_space["ok"] == false &&
      %w[insufficient_space_bucks insufficient_resources].include?(insufficient_space["status"]) &&
      insufficient_space["missing_space_bucks"].to_i.positive?
  end

  engine.with_state do |current_state|
    current_state["space_bucks"] = 5_000
    current_state["inventory"] = {}
  end
  missing_materials = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "upgrade:upgrade_scanner_range" } } }
  ]).first)
  assert("store purchase should reject missing materials") do
    missing_materials["ok"] == false &&
      missing_materials["status"] == "insufficient_materials" &&
      missing_materials["missing_materials"]["mat_element_si"].to_i.positive?
  end

  locked_machine = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "machine:machine_circuit_loom" } } }
  ]).first)
  assert("store purchase should reject locked machine prerequisites") do
    locked_machine["ok"] == false &&
      locked_machine["status"] == "locked_prerequisites" &&
      locked_machine["missing_required_base_modules"].include?("base_fabrication_bay") &&
      locked_machine["missing_required_upgrades"].any? { |item| item["upgrade_id"] == "upgrade_scanner_range" }
  end

  engine.with_state do |current_state|
    current_state["upgrades"]["upgrade_drill_power"] = 50
  end
  max_level = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "upgrade:upgrade_drill_power" } } }
  ]).first)
  assert("store purchase should reject max-level upgrade tracks") do
    max_level["ok"] == false &&
      max_level["status"] == "max_level" &&
      max_level.dig("store", "summary", "maxed").to_i.positive?
  end

  engine.with_state do |current_state|
    current_state["space_bucks"] = 2_000
    current_state["base_modules"]["base_fabrication_bay"] = 1
    current_state["upgrades"]["upgrade_scanner_range"] = 3
  end
  machine_purchase = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "machine:machine_circuit_loom" } } },
    { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "get_fabrication_status", arguments: {} } }
  ]).first)
  after_machine = state(state_path)
  assert("store purchase should unlock a fabrication machine after prerequisites") do
    machine_purchase["ok"] == true &&
      machine_purchase["status"] == "purchased" &&
      after_machine["unlocked_machine_ids"].include?("machine_circuit_loom") &&
      after_machine["space_bucks"] == 1_250
  end

  cosmetic_purchase = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "cosmetic:cosmetic_suit_trim_teal" } } }
  ]).first)
  duplicate_cosmetic = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "purchase_store_item", arguments: { store_item_id: "cosmetic:cosmetic_suit_trim_teal" } } }
  ]).first)
  assert("store purchase should unlock cosmetics once without payment rails") do
    cosmetic_purchase["ok"] == true &&
      cosmetic_purchase.dig("profile", "customization_unlocks").include?("suit_trim_teal") &&
      duplicate_cosmetic["ok"] == false &&
      duplicate_cosmetic["status"] == "already_owned"
  end

  serialized = JSON.generate([catalog, upgrade_purchase, locked_machine, machine_purchase, cosmetic_purchase])
  assert("store payloads should not expose local filesystem or private work details") do
      !serialized.include?(ROOT) &&
      !serialized.include?(dir) &&
      !serialized.include?(state_path) &&
      !serialized.match?(/terminalOutput|sourceCode|filePath|rawTranscript/)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    purchased_upgrade: upgrade_purchase["upgrade_id"],
    unlocked_machine: machine_purchase["machine_id"],
    cosmetic_unlock: cosmetic_purchase["unlock_id"]
  })
end
