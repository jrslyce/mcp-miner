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
  raise "Upgrade MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

def find_upgrade(payload, upgrade_id)
  payload.fetch("upgrades").find { |upgrade| upgrade["upgrade_id"] == upgrade_id }
end

Dir.mktmpdir("mcp-miner-upgrades") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  seeded = engine.initial_state
  seeded["space_bucks"] = 100
  seeded["inventory"] = {}
  engine.write_state(seeded)

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_upgrade_status", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "purchase_upgrade", arguments: { upgrade_id: "upgrade_drill_power" } } }
  ])

  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  status_payload = tool_payload(first_response[2])
  drill = find_upgrade(status_payload, "upgrade_drill_power")
  failed_purchase = tool_payload(first_response[3])

  assert("tools/list should expose upgrade actions") do
    %w[get_upgrade_status purchase_upgrade].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("get_upgrade_status should expose next cost and level-zero effects") do
    drill["level"] == 0 &&
      drill.dig("cost_to_next", "space_bucks") == 120 &&
      drill.dig("cost_to_next", "materials", "mat_element_fe") == 4 &&
      drill.dig("cost_to_next", "materials", "mat_element_ni") == 2 &&
      drill.dig("effect", "value") == 1.0 &&
      drill.dig("next_effect", "value") > 1.0
  end
  assert("purchase_upgrade should report missing Space Bucks and materials") do
    failed_purchase["ok"] == false &&
      failed_purchase["status"] == "insufficient_resources" &&
      failed_purchase["missing_space_bucks"] == 20 &&
      failed_purchase["missing_materials"]["mat_element_fe"] == 4
  end

  engine.with_state do |current_state|
    current_state["space_bucks"] = 1_000
    current_state["inventory"]["mat_element_fe"] = 4
    current_state["inventory"]["mat_element_ni"] = 2
  end
  purchase_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "purchase_upgrade", arguments: { upgrade_id: "upgrade_drill_power" } } }
  ]).first)
  after_purchase = state(state_path)
  assert("purchase_upgrade should spend resources and increment one level") do
    purchase_payload["ok"] == true &&
      purchase_payload["status"] == "purchased" &&
      purchase_payload["previous_level"] == 0 &&
      purchase_payload["new_level"] == 1 &&
      purchase_payload.dig("spent", "space_bucks") == 120 &&
      after_purchase["space_bucks"] == 880 &&
      after_purchase.dig("inventory", "mat_element_fe") == 0 &&
      after_purchase.dig("upgrades", "upgrade_drill_power") == 1
  end
  assert("purchase response should expose the next upgrade cost") do
    purchase_payload.dig("upgrade", "cost_to_next", "space_bucks") == 150
  end

  engine.with_state do |current_state|
    current_state["upgrades"]["upgrade_drill_power"] = 5
  end
  level_five_status = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_upgrade_status", arguments: {} } }
  ]).first)
  drill_level_five = find_upgrade(level_five_status, "upgrade_drill_power")
  assert("upgrade material baskets should include unlocked gate materials") do
    drill_level_five.dig("cost_to_next", "materials").key?("mat_element_ti")
  end

  engine.with_state do |current_state|
    current_state["upgrades"]["upgrade_drill_power"] = 10
    current_state["upgrades"]["upgrade_suit_plating"] = 10
    current_state["upgrades"]["upgrade_drone_automation"] = 10
  end
  formula_status = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_upgrade_status", arguments: {} } }
  ]).first)
  drill_ten = find_upgrade(formula_status, "upgrade_drill_power")
  suit_ten = find_upgrade(formula_status, "upgrade_suit_plating")
  drone_ten = find_upgrade(formula_status, "upgrade_drone_automation")
  assert("representative upgrade effect formulas should match the GDD table") do
    (drill_ten.dig("effect", "value") - 1.99).abs <= 0.01 &&
      (suit_ten.dig("effect", "value") - 0.26).abs <= 0.01 &&
      (drone_ten.dig("effect", "value") - 1.71).abs <= 0.01
  end

  engine.with_state do |current_state|
    current_state["upgrades"]["upgrade_drill_power"] = 50
  end
  max_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "purchase_upgrade", arguments: { upgrade_id: "upgrade_drill_power" } } }
  ]).first)
  assert("purchase_upgrade should reject max-level tracks") do
    max_payload["ok"] == false &&
      max_payload["status"] == "max_level" &&
      max_payload.dig("upgrade", "is_maxed") == true
  end

  engine.with_state do |current_state|
    current_state["upgrades"]["upgrade_refinery_purity"] = 25
    current_state["inventory"]["mat_ore"] = 10
  end
  refine_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "refine_material", arguments: { material_id: "mat_ore", quantity: 5 } } }
  ]).first)
  assert("refinery purity upgrade should increase refined output") do
    refine_payload["ok"] == true &&
      refine_payload["refinery_multiplier"] > 1.0 &&
      refine_payload.dig("produced", "refined:mat_ore") > 5
  end

  serialized = JSON.generate([status_payload, purchase_payload, formula_status, refine_payload])
  assert("upgrade payloads should not expose local filesystem details") do
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    purchased_upgrade: purchase_payload["upgrade_id"],
    drill_level: after_purchase.dig("upgrades", "upgrade_drill_power"),
    drill_level_10_effect: drill_ten.dig("effect", "value"),
    refinery_multiplier: refine_payload["refinery_multiplier"]
  })
end
