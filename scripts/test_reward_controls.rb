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
  raise "MCP reward-control test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def add_reward(engine, event_id, turn_id:, suffix:, line_count: 0)
  engine.with_state do |state|
    engine.add_event_reward(
      state,
      event_id,
      turn_id: turn_id,
      hook_event_name: "PostToolUse",
      line_count: line_count,
      event_key_suffix: suffix
    )
  end
end

def journal_entries(state_path)
  journal_path = File.join(File.dirname(state_path), "journal.jsonl")
  return [] unless File.exist?(journal_path)

  File.readlines(journal_path, chomp: true).reject(&:empty?).map { |line| JSON.parse(line) }
end

Dir.mktmpdir("mcp-miner-reward-controls") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  engine.write_state(engine.initial_state)

  add_reward(engine, "work_search", turn_id: "turn-dup", suffix: "tool-dup")
  add_reward(engine, "work_search", turn_id: "turn-dup", suffix: "tool-dup")
  duplicate_state = engine.state
  search_entries = journal_entries(state_path).select { |entry| entry["event_type"] == "work_search" }

  assert("duplicate abstract tool events should append only one reward") do
    search_entries.length == 1 &&
      duplicate_state.dig("stats", "work_events", "work_search") == 1 &&
      duplicate_state.dig("reward_controls", "event_stats", "work_search", "count") == 1
  end

  add_reward(engine, "work_review", turn_id: "turn-cooldown", suffix: "review-a")
  add_reward(engine, "work_review", turn_id: "turn-cooldown", suffix: "review-b")
  cooldown_diag = engine.state.dig("reward_controls", "diagnostics").reverse.find do |diagnostic|
    diagnostic["event_type"] == "work_review" && diagnostic["reasons"].include?("cooldown")
  end

  assert("cooldowns should reduce rapid repeat event rewards") do
    cooldown_diag &&
      cooldown_diag["multiplier"] == 0.25 &&
      cooldown_diag["effective_score"] < cooldown_diag["raw_score"]
  end

  today = Time.now.utc.strftime("%Y-%m-%d")
  engine.with_state do |state|
    controls = state["reward_controls"]
    controls["event_stats"]["work_commit_or_pr"] = {
      "count" => 12,
      "daily" => {
        today => {
          "count" => 12,
          "effective_score" => 216.0
        }
      },
      "last_rewarded_at" => nil
    }
    controls["daily_category_counts"][today] = {
      "research" => 1
    }
  end
  add_reward(engine, "work_commit_or_pr", turn_id: "turn-soft-cap", suffix: "ship-a")
  soft_cap_diag = engine.state.dig("reward_controls", "diagnostics").reverse.find do |diagnostic|
    diagnostic["event_type"] == "work_commit_or_pr" && diagnostic["reasons"].include?("daily_soft_cap")
  end

  assert("daily soft caps should reduce rewards after the configured threshold") do
    soft_cap_diag &&
      soft_cap_diag["multiplier"] == 0.2 &&
      soft_cap_diag["effective_score"] == 3.6
  end

  engine.with_state do |state|
    state["reward_controls"]["daily_category_counts"][today] = {
      "research" => 1,
      "coding" => 1
    }
  end
  add_reward(engine, "work_write_docs", turn_id: "turn-diverse", suffix: "docs-a", line_count: 5)
  diversity_diag = engine.state.dig("reward_controls", "diagnostics").reverse.find do |diagnostic|
    diagnostic["event_type"] == "work_write_docs" && diagnostic["reasons"].include?("diverse_work_bonus")
  end

  assert("diverse work should receive a small category bonus") do
    diversity_diag &&
      diversity_diag["multiplier"] == 1.1 &&
      diversity_diag["effective_score"] > diversity_diag["raw_score"]
  end

  serialized_controls = JSON.generate(engine.state["reward_controls"])
  assert("reward-control diagnostics should remain abstract and privacy-safe") do
    !serialized_controls.include?(ROOT) &&
      !serialized_controls.include?(state_path) &&
      !serialized_controls.include?(dir) &&
      !serialized_controls.include?("tool-dup") &&
      !serialized_controls.include?("turn-dup")
  end

  responses = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_reward_controls", arguments: {} } }
  ])
  tool_names = responses[1].dig("result", "tools").map { |tool| tool["name"] }
  controls_payload = tool_payload(responses[2])

  assert("MCP tools should expose reward-control diagnostics") do
    tool_names.include?("get_reward_controls") &&
      controls_payload["ok"] == true &&
      controls_payload.dig("reward_controls", "recent_diagnostics").any? &&
      controls_payload.dig("reward_controls", "policy", "events", "work_commit_or_pr", "daily_soft_cap") == 12
  end

  assert("MCP reward-control payload should not expose private local details") do
    serialized_payload = JSON.generate(controls_payload)
    !serialized_payload.include?(ROOT) &&
      !serialized_payload.include?(state_path) &&
      !serialized_payload.include?(dir)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    cooldown_multiplier: cooldown_diag["multiplier"],
    soft_cap_multiplier: soft_cap_diag["multiplier"],
    diversity_multiplier: diversity_diag["multiplier"],
    diagnostics_returned: controls_payload.dig("reward_controls", "recent_diagnostics").length
  })
end
