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
  raise "Market MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

Dir.mktmpdir("mcp-miner-market") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  seeded = engine.initial_state
  seeded["space_bucks"] = 10
  seeded["inventory"] = {
    "mat_ore" => 5,
    "mat_chonks" => 5
  }
  engine.write_state(seeded)

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "refine_material", arguments: { material_id: "mat_ore", quantity: 2 } } }
  ])
  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  refined_payload = tool_payload(first_response[2])
  after_refine = state(state_path)

  assert("tools/list should expose market actions") do
    %w[refine_material sell_material].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("refine_material should consume raw inventory and add refined inventory") do
    refined_payload["ok"] == true &&
      refined_payload["status"] == "refined" &&
      after_refine.dig("inventory", "mat_ore") == 3 &&
      after_refine.dig("inventory", "refined:mat_ore") == 2
  end

  non_refinable_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "refine_material", arguments: { material_id: "mat_chonks", quantity: 1 } } }
  ]).first)
  assert("refine_material should reject non-refinable materials") do
    non_refinable_payload["ok"] == false &&
      non_refinable_payload["status"] == "not_refinable"
  end

  insufficient_refine_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "refine_material", arguments: { material_id: "mat_gem_quartz", quantity: 1 } } }
  ]).first)
  assert("refine_material should report insufficient inventory") do
    insufficient_refine_payload["ok"] == false &&
      insufficient_refine_payload["status"] == "insufficient_inventory" &&
      insufficient_refine_payload["missing"] == 1
  end

  raw_sale_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sell_material", arguments: { material_id: "mat_ore", quantity: 2 } } }
  ]).first)
  raw_multiplier = raw_sale_payload.dig("sale", "market_multiplier").to_f
  raw_payout = raw_sale_payload.dig("sale", "payout_space_bucks").to_i
  market_config = raw_sale_payload.fetch("direct_market")
  after_raw_sale = state(state_path)
  assert("sell_material should apply the direct market range to raw sales") do
    raw_sale_payload["ok"] == true &&
      raw_multiplier >= market_config.fetch("min_multiplier").to_f &&
      raw_multiplier <= market_config.fetch("max_multiplier").to_f &&
      raw_payout.positive? &&
      after_raw_sale.dig("inventory", "mat_ore") == 1 &&
      after_raw_sale["space_bucks"] == 10 + raw_payout
  end

  refined_sale_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "sell_material", arguments: { material_id: "refined:mat_ore", quantity: 1 } } }
  ]).first)
  refined_multiplier = refined_sale_payload.dig("sale", "market_multiplier").to_f
  refined_payout = refined_sale_payload.dig("sale", "payout_space_bucks").to_i
  after_refined_sale = state(state_path)
  assert("sell_material should sell refined inventory with refined value") do
    refined_sale_payload["ok"] == true &&
      refined_sale_payload.dig("sale", "space_bucks_each") == 7 &&
      refined_multiplier >= market_config.fetch("min_multiplier").to_f &&
      refined_multiplier <= market_config.fetch("max_multiplier").to_f &&
      refined_payout.positive? &&
      after_refined_sale.dig("inventory", "refined:mat_ore") == 1 &&
      after_refined_sale["space_bucks"] == 10 + raw_payout + refined_payout
  end

  insufficient_sale_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "sell_material", arguments: { material_id: "refined:mat_ore", quantity: 99 } } }
  ]).first)
  assert("sell_material should reject sales above available inventory") do
    insufficient_sale_payload["ok"] == false &&
      insufficient_sale_payload["status"] == "insufficient_inventory" &&
      insufficient_sale_payload["available"] == 1
  end

  inventory_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_inventory", arguments: {} } }
  ]).first)
  refined_item = inventory_payload.dig("inventory", "items").find { |item| item["material_id"] == "refined:mat_ore" }
  assert("get_inventory should describe refined inventory keys") do
    refined_item["display_name"] == "Refined Ore" &&
      refined_item["refinement_state"] == "refined" &&
      refined_item["space_bucks_each"] == 7
  end

  serialized = JSON.generate([refined_payload, raw_sale_payload, refined_sale_payload, inventory_payload])
  assert("market payloads should not expose local filesystem details") do
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    raw_sale_payout: raw_payout,
    refined_sale_payout: refined_payout,
    space_bucks: after_refined_sale["space_bucks"],
    refined_inventory: after_refined_sale.dig("inventory", "refined:mat_ore")
  })
end
