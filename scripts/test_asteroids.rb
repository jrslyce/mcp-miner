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
  raise "Asteroid MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

def asteroid(payload, asteroid_id)
  payload.fetch("asteroids").find { |candidate| candidate["asteroid_class_id"] == asteroid_id }
end

def mine(engine, event_id, turn_id:, line_count: 0)
  engine.with_state do |current_state|
    engine.ensure_turn(current_state, turn_id)
    engine.add_event_reward(
      current_state,
      event_id,
      turn_id: turn_id,
      hook_event_name: "PostToolUse",
      line_count: line_count,
      event_key_suffix: event_id
    )
  end
end

Dir.mktmpdir("mcp-miner-asteroids") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  engine.write_state(engine.initial_state)

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_asteroid_status", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "select_asteroid", arguments: { asteroid_id: "asteroid_quartz_belt" } } }
  ])
  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  asteroid_status = tool_payload(first_response[2])
  locked_select = tool_payload(first_response[3])
  starter = asteroid(asteroid_status, "asteroid_starter_rubble")
  quartz = asteroid(asteroid_status, "asteroid_quartz_belt")

  assert("tools/list should expose asteroid actions") do
    %w[get_asteroid_status select_asteroid].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("get_asteroid_status should expose unlocked, selected, depletion, and composition data") do
    starter["unlocked"] == true &&
      starter["selected"] == true &&
      starter.dig("depletion", "depletion_size") == 1000 &&
      starter["composition"].any? { |entry| entry["material_id"] == "mat_element_fe" } &&
      quartz["unlocked"] == false
  end
  assert("select_asteroid should reject locked asteroid classes") do
    locked_select["ok"] == false &&
      locked_select["status"] == "locked"
  end

  engine.with_state do |current_state|
    current_state["unlocked_asteroid_class_ids"] << "asteroid_quartz_belt"
  end
  selected = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "select_asteroid", arguments: { asteroid_id: "asteroid_quartz_belt" } } }
  ]).first)
  assert("select_asteroid should switch to unlocked asteroid classes") do
    selected["ok"] == true &&
      selected.dig("current_asteroid", "asteroid_class_id") == "asteroid_quartz_belt" &&
      state(state_path)["current_asteroid_class_id"] == "asteroid_quartz_belt"
  end

  before_mining = state(state_path)
  mine(engine, "work_search", turn_id: "turn-search")
  after_mining = state(state_path)
  quartz_material_ids = quartz["composition"].map { |entry| entry["material_id"] }
  mined_material_ids = after_mining["inventory"].select { |_material_id, quantity| quantity.to_i.positive? }.keys
  assert("mining should advance depletion and use selected asteroid composition") do
    after_mining.dig("asteroid_progress", "mined") > before_mining.dig("asteroid_progress", "mined").to_i &&
      (mined_material_ids & quartz_material_ids).any?
  end

  engine.with_state do |current_state|
    current_state["suit_condition"] = 100
    current_state["upgrades"]["upgrade_suit_plating"] = 10
  end
  mine(engine, "work_test_fail", turn_id: "turn-hazard")
  hazard_state = state(state_path)
  last_hazard = hazard_state["hazard_log"].last
  assert("failed-command hazards should use hazard data and mitigation") do
    hazard_state["suit_condition"] < 100 &&
      last_hazard["hazard_id"] == "hazard_micro_meteor_shove" &&
      last_hazard["mitigation"].to_f.positive? &&
      last_hazard["suit_damage"].to_i.positive?
  end

  engine.with_state do |current_state|
    current_state["rare_find_pity_score"] = 99
  end
  pity_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_asteroid_status", arguments: {} } }
  ]).first)
  pity_current = pity_payload.fetch("current_asteroid")
  assert("rare-find pity should increase chance without exceeding cap") do
    pity_current["rare_find_chance"] > pity_current["base_rare_rate"] &&
      pity_current["rare_find_chance"] <= pity_payload.dig("rare_find_pity", "config", "max_final_rare_chance")
  end

  engine.with_state do |current_state|
    current_state["current_asteroid_class_id"] = "asteroid_starter_rubble"
    current_state["unlocked_asteroid_class_ids"] = ["asteroid_starter_rubble"]
    current_state["asteroid_progress"] = {
      "asteroid_class_id" => "asteroid_starter_rubble",
      "mined" => 999
    }
    current_state["asteroid_progress_by_id"] = {
      "asteroid_starter_rubble" => current_state["asteroid_progress"].dup
    }
  end
  mine(engine, "work_apply_patch", turn_id: "turn-deplete", line_count: 40)
  depleted_state = state(state_path)
  assert("depleted asteroids should unlock and roll forward to the next class") do
    depleted_state["current_asteroid_class_id"] == "asteroid_quartz_belt" &&
      depleted_state["unlocked_asteroid_class_ids"].include?("asteroid_quartz_belt") &&
      depleted_state.dig("asteroid_progress_by_id", "asteroid_starter_rubble", "mined") == 1000 &&
      depleted_state["asteroid_depletions"].last["unlocked_asteroid_class_id"] == "asteroid_quartz_belt" &&
      depleted_state.dig("asteroid_progress", "mined").positive?
  end

  serialized = JSON.generate([asteroid_status, selected, pity_payload, depleted_state["asteroid_depletions"], depleted_state["hazard_log"]])
  assert("asteroid payloads should not expose local filesystem details") do
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    selected_asteroid: selected.dig("current_asteroid", "asteroid_class_id"),
    hazard: last_hazard["hazard_id"],
    unlocked_after_depletion: depleted_state["asteroid_depletions"].last["unlocked_asteroid_class_id"],
    pity_chance: pity_current["rare_find_chance"]
  })
end
