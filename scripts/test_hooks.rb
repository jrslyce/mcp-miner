#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
PLUGIN_ROOT = File.join(ROOT, "plugins", "mcp-miner")
HOOK = File.join(PLUGIN_ROOT, "hooks", "mcp_miner_hook.rb")
MCP_SERVER = File.join(PLUGIN_ROOT, "scripts", "mcp_server.rb")

def assert(message)
  raise message unless yield
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

def user_prompt(turn_id, state_path, cwd: ROOT)
  run_hook("user_prompt_submit", {
    "session_id" => "session-smoke",
    "turn_id" => turn_id,
    "hook_event_name" => "UserPromptSubmit",
    "cwd" => cwd,
    "prompt" => "please implement the thing"
  }, state_path)
end

def post_tool(turn_id, state_path, tool_name:, tool_use_id:, command: nil, response: { "status" => "success" }, cwd: ROOT)
  tool_input = command.nil? ? {} : { "command" => command }
  run_hook("post_tool_use", {
    "session_id" => "session-smoke",
    "turn_id" => turn_id,
    "hook_event_name" => "PostToolUse",
    "cwd" => cwd,
    "tool_name" => tool_name,
    "tool_use_id" => tool_use_id,
    "tool_input" => tool_input,
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
  assert("every_turn_compact should emit for prompt-only turns") do
    every_stop["decision"] == "block" && every_stop["reason"].include?("MCP Miner:")
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
  assert("meaningful concrete work should request an MCP Miner footer") do
    work_stop["decision"] == "block" && work_stop["reason"].include?("fabricator sparks approved")
  end

  after_work = state(state_path)
  assert("duplicate PostToolUse should be ignored") do
    after_work.dig("current_turn", "events", "work_apply_patch") == 1
  end
  assert("hook smoke test did not mine Chonks") do
    after_work.dig("inventory", "mat_chonks").to_i.positive?
  end
  assert("hook smoke test did not persist latest report") do
    after_work.dig("latest_report", "text").to_s.start_with?("MCP Miner:")
  end

  stats_before_self_mcp = after_work.dig("stats", "tool_events_seen")
  post_tool("turn-self-mcp", state_path,
            tool_name: "mcp__mcp-miner__get_player_status",
            tool_use_id: "tool-self-mcp")
  assert("MCP Miner self tools should not mine rewards") do
    state(state_path).dig("stats", "tool_events_seen") == stats_before_self_mcp
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
  assert("MCP status should expose player stats") do
    status_payload.dig("stats", "work_events", "work_apply_patch").to_i >= concurrent_ids.length
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: 14,
    chonks: concurrent_state.dig("inventory", "mat_chonks"),
    suit_condition: concurrent_state["suit_condition"],
    projects_seen: concurrent_state["project_stats"].length,
    agents_seen: concurrent_state["agent_stats"].length,
    latest_report: concurrent_state.dig("latest_report", "text")
  })
end
