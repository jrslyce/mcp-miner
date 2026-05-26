#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "tmpdir"
require_relative "../plugins/mcp-miner/lib/mcp_miner/game_engine"

ROOT = File.expand_path("..", __dir__)
PLUGIN_ROOT = File.join(ROOT, "plugins", "mcp-miner")
HOOK = File.join(PLUGIN_ROOT, "hooks", "mcp_miner_hook.rb")
MCP_SERVER = File.join(PLUGIN_ROOT, "scripts", "mcp_server.rb")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def run_hook(mode, payload, state_path)
  env = {
    "PLUGIN_ROOT" => PLUGIN_ROOT,
    "MCP_MINER_REPO_ROOT" => ROOT,
    "MCP_MINER_STATE_PATH" => state_path
  }
  stdout, stderr, status = Open3.capture3(env, "ruby", HOOK, mode, stdin_data: JSON.generate(payload))
  raise "hook #{mode} failed: #{stderr}" unless status.success?

  stdout.empty? ? {} : JSON.parse(stdout)
end

def run_mcp(state_path, calls)
  input = calls.map { |payload| JSON.generate(payload) }.join("\n")
  stdout, stderr, status = Open3.capture3({
    "MCP_MINER_STATE_PATH" => state_path
  }, "ruby", MCP_SERVER, stdin_data: "#{input}\n")
  raise "MCP smoke failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def state(state_path)
  JSON.parse(File.read(state_path))
end

def journal_path(state_path)
  File.join(File.dirname(state_path), "journal.jsonl")
end

def journal_entries(state_path)
  File.readlines(journal_path(state_path), chomp: true).reject(&:empty?).map { |line| JSON.parse(line) }
end

def user_prompt(turn_id, state_path, cwd: ROOT)
  run_hook("user_prompt_submit", {
    "session_id" => "session-smoke",
    "turn_id" => turn_id,
    "hook_event_name" => "UserPromptSubmit",
    "cwd" => cwd,
    "prompt" => "please implement the thing"
  }, state_path)
end

def post_tool(turn_id, state_path, tool_name:, tool_use_id:, command: nil, tool_input: nil, response: { "status" => "success" }, cwd: ROOT)
  resolved_tool_input = tool_input || (command.nil? ? {} : { "command" => command })
  run_hook("post_tool_use", {
    "session_id" => "session-smoke",
    "turn_id" => turn_id,
    "hook_event_name" => "PostToolUse",
    "cwd" => cwd,
    "tool_name" => tool_name,
    "tool_use_id" => tool_use_id,
    "tool_input" => resolved_tool_input,
    "tool_response" => response
  }, state_path)
end

def stop_turn(turn_id, state_path, last_message: "Implemented and tested.")
  run_hook("stop", {
    "session_id" => "session-smoke",
    "turn_id" => turn_id,
    "hook_event_name" => "Stop",
    "cwd" => ROOT,
    "stop_hook_active" => false,
    "last_assistant_message" => last_message
  }, state_path)
end

def update_report_mode(state_path, mode)
  run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "update_settings", arguments: { report_mode: mode } } }
  ])
end

def patch_command(path: "example.rb", from: "old", to: "new")
  "*** Begin Patch\n*** Update File: #{path}\n@@\n-#{from}\n+#{to}\n*** End Patch\n"
end

Dir.mktmpdir("mcp-miner-hooks") do |dir|
  state_path = File.join(dir, "state.json")

  prompt_output = user_prompt("turn-prompt-only", state_path)
  assert("UserPromptSubmit output shape is invalid") do
    prompt_output.dig("hookSpecificOutput", "hookEventName") == "UserPromptSubmit"
  end

  prompt_stop = stop_turn("turn-prompt-only", state_path)
  assert("meaningful_turns_only should not emit for prompt-only turns") do
    prompt_stop["continue"] == true && !prompt_stop.key?("decision")
  end

  mcp_update = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "update_settings", arguments: { report_mode: "every_turn_compact" } } }
  ])
  assert("MCP update_settings did not return ok") do
    payload = JSON.parse(mcp_update.last.dig("result", "content", 0, "text"))
    payload["ok"] == true
  end

  user_prompt("turn-every", state_path)
  every_stop = stop_turn("turn-every", state_path)
  assert("every_turn_compact should emit a non-blocking report for prompt-only turns") do
    every_stop["continue"] == true &&
      !every_stop.key?("decision") &&
      every_stop["systemMessage"].start_with?("![MCP Miner](data:image/svg+xml;base64,") &&
      every_stop["systemMessage"].include?(") MCP Miner:")
  end
  duplicate_stop = stop_turn("turn-every", state_path)
  assert("Stop hook should not duplicate an existing MCP Miner report") do
    duplicate_stop["continue"] == true &&
      !duplicate_stop.key?("decision") &&
      !duplicate_stop.key?("systemMessage")
  end

  run_mcp(state_path, [
    { jsonrpc: "2.0", id: 3, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "update_settings", arguments: { report_mode: "meaningful_turns_only" } } }
  ])

  user_prompt("turn-work", state_path)
  post_tool("turn-work", state_path,
            tool_name: "Bash",
            tool_use_id: "tool-search",
            command: "rg -n MCP Miner .",
            response: { "exit_code" => 0 })
  post_tool("turn-work", state_path,
            tool_name: "functions.exec_command",
            tool_use_id: "tool-modern-search",
            tool_input: { "cmd" => "rg -n MCP Miner ." },
            response: { "exit_code" => 0 })
  post_tool("turn-work", state_path,
            tool_name: "apply_patch",
            tool_use_id: "tool-patch",
            command: patch_command,
            response: { "status" => "success" })
  post_tool("turn-work", state_path,
            tool_name: "apply_patch",
            tool_use_id: "tool-patch",
            command: patch_command,
            response: { "status" => "success" })

  work_stop = stop_turn("turn-work", state_path)
  assert("meaningful concrete work should emit a non-blocking MCP Miner report") do
    work_stop["continue"] == true &&
      !work_stop.key?("decision") &&
      work_stop["systemMessage"].start_with?("![MCP Miner](data:image/svg+xml;base64,") &&
      work_stop["systemMessage"].include?("MCP Miner:")
  end

  after_work = state(state_path)
  assert("duplicate PostToolUse should be ignored") do
    after_work.dig("current_turn", "events", "work_apply_patch") == 1
  end
  assert("modern exec_command tools should be classified") do
    after_work.dig("current_turn", "events", "work_search") == 2
  end
  assert("hook smoke test did not mine Chonks") do
    after_work.dig("inventory", "mat_chonks").to_i.positive?
  end
  assert("hook smoke test did not persist latest report") do
    after_work.dig("latest_report", "text").to_s.start_with?("MCP Miner:")
  end

  entries_after_work = journal_entries(state_path)
  reward_entries_after_work = entries_after_work.select { |entry| entry["event_type"].to_s.start_with?("work_") }
  patch_entries_after_work = reward_entries_after_work.select { |entry| entry["event_type"] == "work_apply_patch" }
  assert("journal should track applied event metadata") do
    File.exist?(journal_path(state_path)) &&
      after_work.dig("journal", "applied_event_count") == entries_after_work.length &&
      after_work.dig("journal", "last_event_id") == entries_after_work.last["event_id"]
  end
  assert("duplicate PostToolUse should append only one reward event") do
    patch_entries_after_work.length == 1
  end
  assert("journal reward events should use the privacy-safe abstract shape") do
    reward_entries_after_work.all? do |entry|
      entry["event_id"].to_s.start_with?("evt_") &&
        entry["event_type"].to_s.start_with?("work_") &&
        !entry["timestamp"].to_s.empty? &&
        !entry["turn_id"].to_s.empty? &&
        entry["privacy_class"] == "abstract" &&
        entry["score"].is_a?(Numeric) &&
        entry["rewards"].is_a?(Hash) &&
        !entry.key?("journal_type") &&
        !entry.key?("source") &&
        !entry.key?("dedupe_key") &&
        !entry.key?("cwd") &&
        !entry.key?("prompt") &&
        !entry.key?("command")
    end
  end
  assert("journal should not persist raw prompts, commands, project paths, or patch paths") do
    serialized_journal = File.read(journal_path(state_path))
    !serialized_journal.include?("please implement the thing") &&
      !serialized_journal.include?("rg -n MCP Miner") &&
      !serialized_journal.include?("example.rb") &&
      !serialized_journal.include?(ROOT)
  end

  stats_before_self_mcp = after_work.dig("stats", "tool_events_seen")
  post_tool("turn-self-mcp", state_path,
            tool_name: "mcp__mcp-miner__get_player_status",
            tool_use_id: "tool-self-mcp")
  assert("MCP Miner self tools should not mine rewards") do
    state(state_path).dig("stats", "tool_events_seen") == stats_before_self_mcp
  end

  post_tool("turn-modern-patch", state_path,
            tool_name: "functions.apply_patch",
            tool_use_id: "tool-modern-patch",
            tool_input: patch_command(path: "modern.rb"),
            response: { "status" => "success" })
  assert("modern apply_patch tools should accept string patch payloads") do
    state(state_path).dig("current_turn", "events", "work_apply_patch") == 1
  end

  post_tool("turn-modern-parallel", state_path,
            tool_name: "multi_tool_use.parallel",
            tool_use_id: "tool-modern-parallel",
            tool_input: {
              "tool_uses" => [
                {
                  "recipient_name" => "functions.exec_command",
                  "parameters" => { "cmd" => "npm test" }
                },
                {
                  "recipient_name" => "functions.exec_command",
                  "parameters" => { "cmd" => "rg -n MCP Miner ." }
                }
              ]
            },
            response: { "status" => "success" })
  assert("parallel wrapper tools should classify their highest-value child work") do
    state(state_path).dig("current_turn", "events", "work_test_pass") == 1
  end

  post_tool("turn-test-fail", state_path,
            tool_name: "Bash",
            tool_use_id: "tool-test-fail",
            command: "npm test",
            response: { "exit_code" => 1 })
  failed_state = state(state_path)
  assert("failed tests should damage suit condition") do
    failed_state["suit_condition"].to_i < 100
  end

  post_tool("turn-test-pass", state_path,
            tool_name: "Bash",
            tool_use_id: "tool-test-pass",
            command: "npm run check",
            response: { "exit_code" => 0 })
  stop_turn("turn-test-pass", state_path)
  assert("passing tests should use test highlight") do
    state(state_path).dig("latest_report", "text").include?("lab alarms stayed polite")
  end

  Dir.mktmpdir("mcp-miner-report-modes") do |report_dir|
    report_state_path = File.join(report_dir, "state.json")

    update_report_mode(report_state_path, "off")
    user_prompt("turn-off", report_state_path)
    post_tool("turn-off", report_state_path,
              tool_name: "apply_patch",
              tool_use_id: "tool-off",
              command: patch_command(path: "off.rb"),
              response: { "status" => "success" })
    off_stop = stop_turn("turn-off", report_state_path)
    assert("off report mode should never emit") do
      off_stop["continue"] == true && !off_stop.key?("decision")
    end

    update_report_mode(report_state_path, "every_turn_full")
    user_prompt("turn-full", report_state_path)
    full_stop = stop_turn("turn-full", report_state_path)
    assert("every_turn_full should use the full expedition template") do
      full_stop["continue"] == true &&
        !full_stop.key?("decision") &&
        full_stop["systemMessage"].include?("MCP Miner Expedition Report") &&
        full_stop["systemMessage"].include?("Space Bucks:")
    end

    update_report_mode(report_state_path, "session_summary_only")
    user_prompt("turn-session", report_state_path)
    post_tool("turn-session", report_state_path,
              tool_name: "apply_patch",
              tool_use_id: "tool-session",
              command: patch_command(path: "session.rb"),
              response: { "status" => "success" })
    session_stop = stop_turn("turn-session", report_state_path)
    assert("session_summary_only should emit detailed summaries for concrete work") do
      session_stop["continue"] == true &&
        !session_stop.key?("decision") &&
        session_stop["systemMessage"].include?("MCP Miner Expedition Report") &&
        session_stop["systemMessage"].include?("Asteroid:")
    end

    update_report_mode(report_state_path, "milestones_only")
    McpMiner::GameEngine.new(root: ROOT, state_path: report_state_path).with_state do |mode_state|
      mode_state["asteroid_progress"]["mined"] = McpMiner::GameEngine::MILESTONE_INTERVAL - 1
      mode_state["current_turn"] = nil
    end
    post_tool("turn-milestone", report_state_path,
              tool_name: "apply_patch",
              tool_use_id: "tool-milestone",
              command: patch_command(path: "milestone.rb"),
              response: { "status" => "success" })
    milestone_stop = stop_turn("turn-milestone", report_state_path)
    assert("milestones_only should emit deterministic milestone reports") do
      milestone_stop["continue"] == true &&
        !milestone_stop.key?("decision") &&
        milestone_stop["systemMessage"].include?("MCP Miner milestone:") &&
        milestone_stop["systemMessage"].include?("Space Bucks balance")
    end

    update_report_mode(report_state_path, "every_turn_compact")
    orders_response = run_mcp(report_state_path, [
      { jsonrpc: "2.0", id: 3, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_active_orders", arguments: {} } }
    ])
    target_order = JSON.parse(orders_response.last.dig("result", "content", 0, "text")).fetch("orders").first
    McpMiner::GameEngine.new(root: ROOT, state_path: report_state_path).with_state do |mode_state|
      target_order.fetch("required_materials").each do |material_id, quantity|
        mode_state["inventory"][material_id] = quantity.to_i
      end
      mode_state["current_turn"] = nil
    end
    post_tool("turn-order", report_state_path,
              tool_name: "apply_patch",
              tool_use_id: "tool-order",
              command: patch_command(path: "order.rb"),
              response: { "status" => "success" })
    order_stop = stop_turn("turn-order", report_state_path)
    assert("compact reports should use order progress templates when orders are active") do
      order_stop["continue"] == true &&
        !order_stop.key?("decision") &&
        order_stop["systemMessage"].include?("order +100%") &&
        order_stop["systemMessage"].include?("#{target_order.fetch('expires_in_days')} days left")
    end
  end

  run_hook("subagent_start", {
    "session_id" => "session-smoke",
    "turn_id" => "turn-agent",
    "hook_event_name" => "SubagentStart",
    "cwd" => ROOT,
    "agent_id" => "agent-1",
    "agent_type" => "research"
  }, state_path)
  run_hook("subagent_stop", {
    "session_id" => "session-smoke",
    "turn_id" => "turn-agent",
    "hook_event_name" => "SubagentStop",
    "cwd" => ROOT,
    "agent_id" => "agent-1",
    "agent_type" => "research"
  }, state_path)
  agent = state(state_path)["agent_stats"].values.first
  assert("subagent stats should count starts and stops") do
    agent["starts"] == 1 && agent["stops"] == 1
  end

  project_two = File.join(ROOT, "other-project")
  post_tool("turn-project-a", state_path,
            tool_name: "Bash",
            tool_use_id: "tool-project-a",
            command: "rg -n foo .",
            cwd: ROOT)
  post_tool("turn-project-b", state_path,
            tool_name: "Bash",
            tool_use_id: "tool-project-b",
            command: "rg -n bar .",
            cwd: project_two)
  assert("project stats should aggregate anonymous per-project activity") do
    state(state_path)["project_stats"].length >= 2
  end
  assert("state should not persist raw prompts or project paths") do
    serialized_state = JSON.generate(state(state_path))
    !serialized_state.include?("please implement the thing") && !serialized_state.include?(ROOT)
  end

  concurrent_ids = Array.new(12) { |index| "tool-concurrent-#{index}" }
  concurrent_ids.map do |tool_id|
    Thread.new do
      post_tool("turn-concurrent", state_path,
                tool_name: "apply_patch",
                tool_use_id: tool_id,
                command: patch_command(path: "#{tool_id}.rb"),
                response: { "status" => "success" })
    end
  end.each(&:join)
  concurrent_state = state(state_path)
  assert("concurrent writes should keep every unique tool event") do
    concurrent_state.dig("current_turn", "events", "work_apply_patch") == concurrent_ids.length
  end
  replayed_state = McpMiner::GameEngine.new(root: ROOT, state_path: state_path).replay_journal_state(journal_entries(state_path))
  assert("journal replay should rebuild mined Chonks") do
    replayed_state.dig("inventory", "mat_chonks") == concurrent_state.dig("inventory", "mat_chonks")
  end
  assert("journal replay should rebuild current turn work events") do
    replayed_state.dig("current_turn", "events", "work_apply_patch") == concurrent_ids.length
  end
  assert("journal replay should rebuild supported aggregate stats") do
    replayed_state.dig("stats", "tool_events_seen") == concurrent_state.dig("stats", "tool_events_seen") &&
      replayed_state.dig("stats", "chonks_mined_total") == concurrent_state.dig("stats", "chonks_mined_total")
  end

  latest_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_latest_report", arguments: {} } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_player_status", arguments: {} } }
  ])
  latest_payload = JSON.parse(latest_response[1].dig("result", "content", 0, "text"))
  status_payload = JSON.parse(latest_response[2].dig("result", "content", 0, "text"))
  assert("MCP server did not expose hook latest_report") do
    latest_payload["report"] == concurrent_state.dig("latest_report", "text")
  end
  assert("MCP latest report should identify hook state as source") do
    latest_payload["source"] == "local_hook_state"
  end
  assert("MCP status should expose player stats") do
    status_payload.dig("stats", "work_events", "work_apply_patch").to_i >= concurrent_ids.length
  end
  assert("MCP status should use the same hook-produced latest report") do
    status_payload["latest_report"] == concurrent_state.dig("latest_report", "text")
  end

  File.write(state_path, "{not-json")
  recovered_state = McpMiner::GameEngine.new(root: ROOT, state_path: state_path).state
  assert("corrupt state should be backed up") do
    Dir.glob("#{state_path}.corrupt-*").any?
  end
  assert("corrupt state should recover from journal replay") do
    recovered_state.dig("inventory", "mat_chonks") == replayed_state.dig("inventory", "mat_chonks") &&
      recovered_state.dig("current_turn", "events", "work_apply_patch") == concurrent_ids.length
  end

  Dir.mktmpdir("mcp-miner-stale-state") do |stale_dir|
    stale_state_path = File.join(stale_dir, "state.json")
    user_prompt("turn-stale", stale_state_path)
    post_tool("turn-stale", stale_state_path,
              tool_name: "apply_patch",
              tool_use_id: "tool-stale",
              command: patch_command(path: "stale.rb"),
              response: { "status" => "success" })
    latest_state = state(stale_state_path)
    stale_state = latest_state.dup
    stale_state["inventory"] = latest_state["inventory"].merge("mat_chonks" => 0)
    stale_state["stats"] = latest_state["stats"].merge(
      "tool_events_seen" => 0,
      "work_score_total" => 0.0,
      "chonks_mined_total" => 0,
      "materials_found_total" => 0,
      "work_events" => {}
    )
    stale_state["dedupe_keys"] = []
    stale_state["current_turn"] = nil
    stale_state["asteroid_progress"] = latest_state["asteroid_progress"].merge("mined" => 0)
    stale_state["journal"] = latest_state["journal"].merge("applied_event_count" => 0, "last_event_id" => nil)
    File.write(stale_state_path, JSON.pretty_generate(stale_state))

    caught_up_state = McpMiner::GameEngine.new(root: ROOT, state_path: stale_state_path).state
    assert("pending journal entries should replay after a stale state write") do
      caught_up_state.dig("inventory", "mat_chonks") == latest_state.dig("inventory", "mat_chonks") &&
        caught_up_state.dig("current_turn", "events", "work_apply_patch") == 1
    end
  end

  Dir.mktmpdir("mcp-miner-legacy-state") do |legacy_dir|
    legacy_state_path = File.join(legacy_dir, "state.json")
    legacy_engine = McpMiner::GameEngine.new(root: ROOT, state_path: legacy_state_path)
    legacy_state = legacy_engine.initial_state
    legacy_state.delete("journal")
    legacy_state["inventory"]["mat_chonks"] = 42
    legacy_state["dedupe_keys"] = ["legacy-turn:PostToolUse:work_search:tool_legacy"]
    File.write(legacy_state_path, JSON.pretty_generate(legacy_state))

    migrated_state = McpMiner::GameEngine.new(root: ROOT, state_path: legacy_state_path).state
    migrated_entries = journal_entries(legacy_state_path)
    assert("legacy state should migrate to an abstract journal snapshot on first load") do
      migrated_state.dig("inventory", "mat_chonks") == 42 &&
        migrated_state.dig("journal", "applied_event_count") == 1 &&
        migrated_entries.first["event_type"] == "state_snapshot"
    end
    assert("legacy migration snapshot should preserve supported abstract fields") do
      migrated_entries.first.dig("state", "inventory", "mat_chonks") == 42 &&
        migrated_entries.first.dig("state", "dedupe_keys").include?("legacy-turn:PostToolUse:work_search:tool_legacy")
    end
  end

  Dir.mktmpdir("mcp-miner-corrupt-journal") do |journal_dir|
    corrupt_state_path = File.join(journal_dir, "state.json")
    user_prompt("turn-journal", corrupt_state_path)
    post_tool("turn-journal", corrupt_state_path,
              tool_name: "apply_patch",
              tool_use_id: "tool-journal",
              command: patch_command(path: "journal.rb"),
              response: { "status" => "success" })
    state_before_corruption = state(corrupt_state_path)
    File.write(journal_path(corrupt_state_path), "{not-json")

    recovered_from_corrupt_journal = McpMiner::GameEngine.new(root: ROOT, state_path: corrupt_state_path).state
    new_journal_entries = journal_entries(corrupt_state_path)
    assert("corrupt journal should be backed up") do
      Dir.glob("#{journal_path(corrupt_state_path)}.corrupt-*").any?
    end
    assert("corrupt journal should preserve materialized state with an abstract migration snapshot") do
      recovered_from_corrupt_journal.dig("inventory", "mat_chonks") == state_before_corruption.dig("inventory", "mat_chonks") &&
        new_journal_entries.first["event_type"] == "state_snapshot" &&
        new_journal_entries.first["privacy_class"] == "abstract"
    end
    assert("migration snapshots should not write local file paths into the journal") do
      !JSON.generate(new_journal_entries.first).include?(corrupt_state_path)
    end
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    chonks: concurrent_state.dig("inventory", "mat_chonks"),
    suit_condition: concurrent_state["suit_condition"],
    projects_seen: concurrent_state["project_stats"].length,
    agents_seen: concurrent_state["agent_stats"].length,
    latest_report: concurrent_state.dig("latest_report", "text")
  })
end
