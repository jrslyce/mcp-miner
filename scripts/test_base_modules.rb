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
  raise "Base module MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

def base_module(payload, module_id)
  payload.fetch("modules").find { |mod| mod["module_id"] == module_id }
end

Dir.mktmpdir("mcp-miner-base") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  seeded = engine.initial_state
  seeded["space_bucks"] = 1_000
  seeded["inventory"] = {
    "mat_chonks" => 300,
    "mat_element_fe" => 30,
    "mat_element_si" => 12,
    "mat_element_cu" => 8
  }
  engine.write_state(seeded)

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_base_status", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "purchase_base_module", arguments: { module_id: "base_fabrication_bay" } } }
  ])
  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  status_payload = tool_payload(first_response[2])
  missing_prereq = tool_payload(first_response[3])
  command_center = base_module(status_payload, "base_command_center")
  workshop = base_module(status_payload, "base_workshop")

  assert("tools/list should expose base actions") do
    %w[get_base_status purchase_base_module].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("get_base_status should expose module levels, effects, and drone state") do
    command_center["level"] == 1 &&
      workshop.dig("cost_to_next", "space_bucks") == 150 &&
      status_payload.dig("effects", "expedition_log_slots") == 2.0 &&
      status_payload.dig("drone_automation", "passive_support_multiplier") == 1.0
  end
  assert("purchase_base_module should reject missing prerequisites") do
    missing_prereq["ok"] == false &&
      missing_prereq["status"] == "missing_prerequisites" &&
      missing_prereq["missing_required_modules"].include?("base_workshop")
  end

  workshop_purchase = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "purchase_base_module", arguments: { module_id: "base_workshop" } } }
  ]).first)
  after_workshop = state(state_path)
  assert("purchase_base_module should consume costs and increment module level") do
    workshop_purchase["ok"] == true &&
      workshop_purchase["new_level"] == 1 &&
      workshop_purchase.dig("spent", "space_bucks") == 150 &&
      after_workshop["space_bucks"] == 850 &&
      after_workshop.dig("inventory", "mat_chonks") == 220 &&
      after_workshop.dig("inventory", "mat_element_fe") == 20 &&
      after_workshop.dig("base_modules", "base_workshop") == 1
  end

  terminal_purchase = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "purchase_base_module", arguments: { module_id: "base_order_terminal" } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_active_orders", arguments: {} } }
  ]).first)
  orders_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_active_orders", arguments: {} } }
  ]).first)
  assert("base_order_terminal effect should increase active order slots") do
    terminal_purchase["ok"] == true &&
      terminal_purchase.dig("effects", "active_order_slots") == 4.0 &&
      orders_payload["active_order_slots"] == 4 &&
      orders_payload["orders"].length == 4
  end

  engine.with_state do |current_state|
    current_state["upgrades"]["upgrade_drone_automation"] = 10
  end
  drone_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_base_status", arguments: {} } },
    { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "get_player_status", arguments: {} } }
  ]).first)
  player_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "get_player_status", arguments: {} } }
  ]).first)
  assert("drone automation should expose bounded passive support in base and player status") do
    drone_payload.dig("drone_automation", "passive_support_multiplier") > 1.7 &&
      drone_payload.dig("drone_automation", "bounded") == true &&
      player_payload.dig("base", "drone_automation", "passive_support_multiplier") > 1.7
  end

  engine.with_state do |current_state|
    current_state["base_modules"]["base_order_terminal"] = 5
  end
  max_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "purchase_base_module", arguments: { module_id: "base_order_terminal" } } }
  ]).first)
  assert("purchase_base_module should reject max-level modules") do
    max_payload["ok"] == false &&
      max_payload["status"] == "max_level" &&
      max_payload.dig("module", "is_maxed") == true
  end

  serialized = JSON.generate([status_payload, workshop_purchase, terminal_purchase, drone_payload, player_payload])
  assert("base module payloads should not expose local filesystem details") do
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    workshop_level: after_workshop.dig("base_modules", "base_workshop"),
    active_order_slots: orders_payload["active_order_slots"],
    drone_support: drone_payload.dig("drone_automation", "passive_support_multiplier")
  })
end
