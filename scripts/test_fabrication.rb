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
  raise "Fabrication MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

def mine(engine, event_id, turn_id:)
  engine.with_state do |current_state|
    engine.ensure_turn(current_state, turn_id)
    engine.add_event_reward(
      current_state,
      event_id,
      turn_id: turn_id,
      hook_event_name: "PostToolUse",
      line_count: 0,
      event_key_suffix: event_id
    )
  end
end

Dir.mktmpdir("mcp-miner-fabrication") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  seeded = engine.initial_state
  seeded["inventory"] = {
    "mat_chonks" => 30,
    "mat_element_fe" => 10,
    "mat_element_ni" => 4
  }
  engine.write_state(seeded)

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_fabrication_status", arguments: {} } }
  ])
  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  status_payload = tool_payload(first_response[2])
  basic_machine = status_payload.fetch("machines").find { |machine| machine["machine_id"] == "machine_basic_3d_printer" }
  locked_machine = status_payload.fetch("machines").find { |machine| machine["machine_id"] == "machine_circuit_loom" }

  assert("tools/list should expose fabrication actions") do
    %w[get_fabrication_status queue_fabrication].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("get_fabrication_status should expose unlocked and locked machine queue limits") do
    basic_machine["unlocked"] == true &&
      basic_machine.dig("throughput", "max_queue_size") == 2 &&
      locked_machine["unlocked"] == false
  end

  locked_queue = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "queue_fabrication", arguments: { recipe_id: "recipe_ram_stick_packs", variant_id: "order_variant_standard_batch", quantity: 1 } } }
  ]).first)
  assert("queue_fabrication should reject locked machines") do
    locked_queue["ok"] == false &&
      locked_queue["status"] == "machine_locked"
  end

  quality_queue = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "queue_fabrication", arguments: { recipe_id: "recipe_hull_patch_clips", variant_id: "order_variant_collector_grade", quantity: 1 } } }
  ]).first)
  assert("queue_fabrication should enforce variant quality requirements") do
    quality_queue["ok"] == false &&
      quality_queue["status"] == "quality_exceeds_machine"
  end

  queued_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "queue_fabrication", arguments: { recipe_id: "recipe_hull_patch_clips", variant_id: "order_variant_standard_batch", quantity: 1 } } }
  ]).first)
  after_queue = state(state_path)
  assert("queue_fabrication should consume recipe materials and create a queue item") do
    queued_payload["ok"] == true &&
      queued_payload["status"] == "queued" &&
      after_queue.dig("inventory", "mat_chonks") == 12 &&
      after_queue.dig("inventory", "mat_element_fe") == 4 &&
      after_queue.dig("inventory", "mat_element_ni") == 2 &&
      after_queue["fabrication_queue"].length == 1
  end

  mine(engine, "work_fabrication_artifact", turn_id: "turn-fabricate")
  after_progress = state(state_path)
  completed_product = after_progress["completed_products"].find { |product| product["recipe_id"] == "recipe_hull_patch_clips" }
  assert("fabrication work events should advance progress and complete ready products") do
    after_progress["fabrication_queue"].empty? &&
      completed_product &&
      completed_product["variant_id"] == "order_variant_standard_batch" &&
      completed_product["quantity"] == 1
  end

  engine.with_state do |current_state|
    current_state["orders"] = [
      {
        "order_id" => "order_product_test",
        "slot" => 0,
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
        "payout_space_bucks" => 100,
        "price_multiplier" => 1.0,
        "is_windfall" => false,
        "deadline_days" => 3,
        "expires_in_days" => 3,
        "created_at" => Time.now.utc.iso8601,
        "expires_at" => (Time.now.utc + 86_400).iso8601
      }
    ]
  end
  fulfilled = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "fulfill_order", arguments: { order_id: "order_product_test" } } }
  ]).first)
  after_fulfill = state(state_path)
  assert("completed products should satisfy matching fabricated product orders") do
    fulfilled["ok"] == true &&
      fulfilled["status"] == "fulfilled" &&
      fulfilled["consumed_product"] == "product:recipe_hull_patch_clips:order_variant_standard_batch:q0" &&
      after_fulfill["completed_products"].none? { |product| product["recipe_id"] == "recipe_hull_patch_clips" } &&
      after_fulfill["space_bucks"] == 100
  end

  serialized = JSON.generate([status_payload, queued_payload, fulfilled])
  assert("fabrication payloads should not expose local filesystem details") do
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    queued: queued_payload.dig("item", "fabrication_id"),
    completed_product: completed_product["product_key"],
    fulfilled_order: fulfilled.dig("order", "order_id")
  })
end
