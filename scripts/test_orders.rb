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
  raise "Order MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

Dir.mktmpdir("mcp-miner-orders") do |dir|
  state_path = File.join(dir, "state.json")

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_active_orders", arguments: {} } }
  ])
  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  orders_payload = tool_payload(first_response[2])
  first_orders = orders_payload["orders"]

  assert("tools/list should expose fulfill_order") do
    tool_names.include?("fulfill_order")
  end
  assert("order engine should generate active order slots from data") do
    first_orders.length == 3 &&
      first_orders.all? { |order| order["status"] == "active" && order["required_materials"].is_a?(Hash) }
  end
  assert("orders should include computed lifecycle and payout fields") do
    first_orders.all? do |order|
      order["order_id"].start_with?("order_") &&
        order["deadline_days"].to_i.positive? &&
        order["expires_at"].to_s > order["created_at"].to_s &&
        order["payout_space_bucks"].to_i.positive? &&
        order["price_multiplier"].to_f.positive?
    end
  end
  assert("order generation should expose refresh metadata") do
    orders_payload["refresh_cadence_hours"] == 24 &&
      orders_payload["missed_order_penalty"] == "lost_opportunity_only" &&
      orders_payload["refresh_due_at"].to_s.length.positive?
  end

  missing_fulfillment = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fulfill_order", arguments: { order_id: first_orders.first["order_id"] } } }
  ]).first)
  assert("fulfill_order should report missing materials without consuming inventory") do
    missing_fulfillment["ok"] == false &&
      missing_fulfillment["status"] == "missing_materials" &&
      missing_fulfillment["missing_materials"].any?
  end

  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  target_order = first_orders.first
  engine.with_state do |current_state|
    target_order["required_materials"].each do |material_id, quantity|
      current_state["inventory"][material_id] = quantity.to_i
    end
    current_state["space_bucks"] = 5
  end

  fulfilled_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "fulfill_order", arguments: { order_id: target_order["order_id"] } } }
  ]).first)
  after_fulfillment = state(state_path)
  assert("fulfill_order should consume materials and add Space Bucks") do
    fulfilled_payload["ok"] == true &&
      fulfilled_payload["status"] == "fulfilled" &&
      after_fulfillment["space_bucks"] == 5 + target_order["payout_space_bucks"].to_i &&
      target_order["required_materials"].all? { |material_id, _quantity| after_fulfillment.dig("inventory", material_id).to_i.zero? }
  end
  assert("fulfilled orders should be archived and replaced in the same slot") do
    after_fulfillment["completed_orders"].any? { |order| order["order_id"] == target_order["order_id"] } &&
      after_fulfillment["orders"].length == 3 &&
      after_fulfillment["orders"].none? { |order| order["order_id"] == target_order["order_id"] } &&
      fulfilled_payload.dig("replacement_order", "slot") == target_order["slot"]
  end

  before_expiration_ids = after_fulfillment["orders"].map { |order| order["order_id"] }
  engine.with_state do |current_state|
    current_state["orders"].each { |order| order["expires_at"] = "2000-01-01T00:00:00Z" }
  end
  refreshed_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_active_orders", arguments: {} } }
  ]).first)
  refreshed_ids = refreshed_payload["orders"].map { |order| order["order_id"] }
  assert("expired active orders should be replaced by refresh logic") do
    refreshed_payload["orders"].length == 3 &&
      (before_expiration_ids & refreshed_ids).empty?
  end
  assert("order payloads should not expose local filesystem details") do
    serialized = JSON.generate([orders_payload, fulfilled_payload, refreshed_payload])
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    initial_orders: first_orders.map { |order| order["order_id"] },
    fulfilled_order: target_order["order_id"],
    refreshed_orders: refreshed_ids,
    space_bucks: after_fulfillment["space_bucks"]
  })
end
