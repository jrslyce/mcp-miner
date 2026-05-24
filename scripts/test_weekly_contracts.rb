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
  raise "Weekly contract MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

Dir.mktmpdir("mcp-miner-weekly") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  engine.write_state(engine.initial_state)

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_active_orders", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_weekly_contracts", arguments: {} } }
  ])
  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  orders_payload = tool_payload(first_response[2])
  weekly_payload = tool_payload(first_response[3])
  contract = weekly_payload.fetch("contracts").first

  assert("tools/list should expose weekly contract actions") do
    %w[get_weekly_contracts complete_weekly_contract].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("weekly contracts should be generated separately from active orders") do
    orders_payload["orders"].length == 3 &&
      weekly_payload["contracts"].length == 1 &&
      contract["contract_id"].start_with?("weekly_") &&
      contract["deadline_days"] == 7 &&
      weekly_payload["missed_contract_penalty"] == "lost_opportunity_only"
  end

  starter_materials = engine.send(:asteroid_by_id).fetch("asteroid_starter_rubble").fetch("composition").map { |entry| entry["material_id"] }
  assert("weekly contract requirements should respect unlocked asteroid material access") do
    contract.fetch("required_materials").keys.all? do |material_id|
      starter_materials.include?(material_id.sub(/^refined:/, ""))
    end
  end

  missing_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "complete_weekly_contract", arguments: { contract_id: contract["contract_id"] } } }
  ]).first)
  assert("complete_weekly_contract should report missing materials") do
    missing_payload["ok"] == false &&
      missing_payload["status"] == "missing_materials" &&
      missing_payload["missing_materials"].any?
  end

  engine.with_state do |current_state|
    contract.fetch("required_materials").each do |material_id, quantity|
      current_state["inventory"][material_id] = quantity.to_i
    end
    current_state["space_bucks"] = 25
  end
  completed_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "complete_weekly_contract", arguments: { contract_id: contract["contract_id"] } } }
  ]).first)
  after_completion = state(state_path)
  assert("complete_weekly_contract should consume materials, pay rewards, archive, and replace") do
    completed_payload["ok"] == true &&
      completed_payload["status"] == "fulfilled" &&
      after_completion["space_bucks"] == 25 + contract["payout_space_bucks"].to_i &&
      after_completion["completed_weekly_contracts"].any? { |item| item["contract_id"] == contract["contract_id"] } &&
      after_completion["weekly_contracts"].none? { |item| item["contract_id"] == contract["contract_id"] } &&
      completed_payload.dig("replacement_contract", "contract_id").start_with?("weekly_")
  end

  engine.with_state do |current_state|
    current_state["weekly_contracts"] = [
      {
        "contract_id" => "weekly_product_test",
        "slot" => 0,
        "kind" => "weekly_contract",
        "status" => "active",
        "recipe_id" => "recipe_hull_patch_clips",
        "product" => "Standard Batch Hull Patch Clips",
        "variant_id" => "order_variant_standard_batch",
        "buyer_id" => "buyer_patchy_freighter_union",
        "buyer" => "Patchy Freighter Union",
        "quantity" => 1,
        "required_materials" => {
          "mat_chonks" => 999
        },
        "payout_space_bucks" => 250,
        "price_multiplier" => 1.0,
        "is_windfall" => false,
        "deadline_days" => 7,
        "expires_in_days" => 7,
        "missed_contract_penalty" => "lost_opportunity_only",
        "created_at" => Time.now.utc.iso8601,
        "expires_at" => (Time.now.utc + 86_400).iso8601
      }
    ]
    current_state["completed_products"] = [
      {
        "product_key" => "product:recipe_hull_patch_clips:order_variant_standard_batch:q0",
        "recipe_id" => "recipe_hull_patch_clips",
        "variant_id" => "order_variant_standard_batch",
        "product" => "Standard Batch Hull Patch Clips",
        "quality_grade" => 0,
        "quantity" => 1,
        "completed_at" => Time.now.utc.iso8601
      }
    ]
  end
  product_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "complete_weekly_contract", arguments: { contract_id: "weekly_product_test" } } }
  ]).first)
  assert("weekly contracts should complete from matching product stock") do
    product_payload["ok"] == true &&
      product_payload["consumed_product"] == "product:recipe_hull_patch_clips:order_variant_standard_batch:q0" &&
      state(state_path)["completed_products"].empty?
  end

  before_expiration_id = state(state_path)["weekly_contracts"].first["contract_id"]
  engine.with_state do |current_state|
    current_state["weekly_contracts"].each { |item| item["expires_at"] = "2000-01-01T00:00:00Z" }
  end
  refreshed_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_weekly_contracts", arguments: {} } }
  ]).first)
  assert("expired weekly contracts should refresh without inventory loss") do
    refreshed_payload["contracts"].length == 1 &&
      refreshed_payload["contracts"].first["contract_id"] != before_expiration_id
  end

  serialized = JSON.generate([weekly_payload, completed_payload, product_payload, refreshed_payload])
  assert("weekly contract payloads should not expose local filesystem details") do
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    initial_contract: contract["contract_id"],
    completed_contract: completed_payload.dig("contract", "contract_id"),
    product_contract: product_payload.dig("contract", "contract_id"),
    refreshed_contract: refreshed_payload["contracts"].first["contract_id"]
  })
end
