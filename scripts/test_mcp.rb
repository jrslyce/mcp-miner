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
  raise "MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def seed_state(state_path)
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  state = engine.initial_state
  state["space_bucks"] = 44
  state["inventory"] = state["inventory"].merge(
    "mat_chonks" => 125,
    "mat_element_fe" => 5,
    "mat_gem_quartz" => 2
  )
  state["suit_condition"] = 87
  state["asteroid_progress"] = {
    "asteroid_class_id" => "asteroid_starter_rubble",
    "mined" => 275
  }
  state["stats"] = state["stats"].merge(
    "turns_seen" => 4,
    "tool_events_seen" => 3,
    "work_score_total" => 21.5,
    "chonks_mined_total" => 125,
    "materials_found_total" => 7,
    "work_events" => {
      "work_apply_patch" => 2,
      "work_test_pass" => 1
    }
  )
  state["latest_report"] = {
    "text" => "MCP Miner: +12 Chonks, lab alarms stayed polite, suit 87%, orders waiting.",
    "turn_id" => "turn-safe",
    "created_at" => "2026-05-24T00:00:00Z"
  }
  engine.write_state(state)
end

Dir.mktmpdir("mcp-miner-server") do |dir|
  state_path = File.join(dir, "state.json")
  seed_state(state_path)

  responses = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "update_settings", arguments: { report_mode: "every_turn_full", cloud_sync: true } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_settings", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_player_status", arguments: {} } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_inventory", arguments: {} } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_active_orders", arguments: {} } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_latest_report", arguments: {} } },
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_milestone_status", arguments: {} } },
    { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "sync_progress", arguments: {} } },
    { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "claim_milestone", arguments: {} } },
    { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "get_catalog_summary", arguments: {} } },
    { jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "open_dashboard", arguments: {} } },
    { jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "open_store", arguments: {} } }
  ])

  assert("initialize should advertise MCP tools capability") do
    responses[0].dig("result", "capabilities", "tools").is_a?(Hash)
  end

  tool_names = responses[1].dig("result", "tools").map { |tool| tool["name"] }
  expected_tools = %w[
    get_player_status
    get_latest_report
    get_inventory
    get_active_orders
    fulfill_order
    refine_material
    sell_material
    get_settings
    get_milestone_status
    get_catalog_summary
    update_settings
    sync_progress
    claim_milestone
    open_dashboard
    open_store
  ]
  assert("tools/list should expose the full local utility surface") do
    (expected_tools - tool_names).empty?
  end
  assert("tool schemas should reject unexpected arguments") do
    responses[1].dig("result", "tools").all? { |tool| tool.dig("inputSchema", "additionalProperties") == false }
  end

  update_payload = tool_payload(responses[2])
  settings_payload = tool_payload(responses[3])
  status_payload = tool_payload(responses[4])
  inventory_payload = tool_payload(responses[5])
  orders_payload = tool_payload(responses[6])
  report_payload = tool_payload(responses[7])
  milestone_payload = tool_payload(responses[8])
  sync_payload = tool_payload(responses[9])
  claim_payload = tool_payload(responses[10])
  catalog_payload = tool_payload(responses[11])
  dashboard_payload = tool_payload(responses[12])
  store_payload = tool_payload(responses[13])

  assert("update_settings should remain backward compatible") do
    update_payload["ok"] == true &&
      update_payload.dig("settings", "report_mode") == "every_turn_full" &&
      update_payload.dig("settings", "cloud_sync") == true
  end
  assert("get_settings should expose valid report modes and local sync state") do
    settings_payload.dig("settings", "valid_report_modes").include?("milestones_only") &&
      settings_payload.dig("sync", "status") == "local_only" &&
      settings_payload.dig("sync", "cloud_sync_enabled") == true
  end
  assert("get_player_status should keep existing top-level status fields") do
    status_payload.dig("player", "space_bucks") == 44 &&
      status_payload.dig("inventory", "mat_chonks") == 125 &&
      status_payload["latest_report"].start_with?("MCP Miner:")
  end
  assert("get_inventory should enrich inventory with material metadata") do
    quartz = inventory_payload.dig("inventory", "items").find { |item| item["material_id"] == "mat_gem_quartz" }
    inventory_payload.dig("inventory", "total_units") == 132 &&
      inventory_payload.dig("inventory", "categories", "gem", "quantity") == 2 &&
      quartz["display_name"] == "Quartz" &&
      quartz["rarity"] == "uncommon"
  end
  assert("get_active_orders should return generated order payloads") do
    orders_payload["orders"].any? &&
      orders_payload["orders"].first.key?("required_materials") &&
      orders_payload["generated_at"].to_s.length.positive?
  end
  assert("get_latest_report should use the existing hook report") do
    report_payload["source"] == "local_hook_state" &&
      report_payload["report"].include?("lab alarms stayed polite")
  end
  assert("get_milestone_status should expose deterministic asteroid progress") do
    milestone_payload.dig("milestones", "progress", "mined") == 275 &&
      milestone_payload.dig("milestones", "next_milestone", "target_mined") == 500 &&
      milestone_payload.dig("milestones", "claim_status") == "not_supported_in_local_mvp"
  end
  assert("sync_progress should be an explicit local-only stub") do
    sync_payload["ok"] == true &&
      sync_payload.dig("sync", "available") == false &&
      sync_payload.dig("sync", "status") == "local_only" &&
      !sync_payload.dig("sync", "journal").key?("path")
  end
  assert("claim_milestone should be an explicit disabled stub") do
    claim_payload["ok"] == false &&
      claim_payload["status"] == "disabled" &&
      claim_payload.dig("milestones", "claimable") == false
  end
  assert("get_catalog_summary should remain available") do
    catalog_payload["materials"] >= 100 &&
      catalog_payload["asteroid_classes"] >= 1
  end
  assert("open_dashboard should return the reserved dashboard URL") do
    dashboard_payload["dashboard_url"] == "http://localhost:3317/dashboard" &&
      dashboard_payload["available"] == false
  end
  assert("open_store should return the reserved store URL") do
    store_payload["store_url"] == "http://localhost:3317/store" &&
      store_payload["available"] == false
  end

  serialized_payloads = JSON.generate([
    update_payload,
    settings_payload,
    status_payload,
    inventory_payload,
    orders_payload,
    report_payload,
    milestone_payload,
    sync_payload,
    claim_payload,
    dashboard_payload,
    store_payload
  ])
  assert("MCP utility responses should not expose private local details") do
    !serialized_payloads.include?(ROOT) &&
      !serialized_payloads.include?(state_path) &&
      !serialized_payloads.include?(dir) &&
      !serialized_payloads.include?("please implement") &&
      !serialized_payloads.include?("repo-name")
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    tools: tool_names,
    inventory_units: inventory_payload.dig("inventory", "total_units"),
    sync_status: sync_payload.dig("sync", "status"),
    claim_status: claim_payload["status"]
  })
end
