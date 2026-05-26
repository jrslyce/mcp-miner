#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require_relative "../lib/mcp_miner/game_engine"

class McpMinerHook
  REPORT_PREFIX = McpMiner::GameEngine::REPORT_PREFIX

  def initialize(mode)
    @mode = mode
    @input = read_input
    @engine = McpMiner::GameEngine.new(root: repo_root)
  end

  def run
    case @mode
    when "session_start"
      record_session_start
    when "user_prompt_submit"
      record_user_prompt
    when "subagent_start"
      record_subagent("starts")
    when "subagent_stop"
      record_subagent("stops")
    when "post_tool_use"
      record_tool_use
    when "stop"
      emit_stop_report
    else
      warn "Unknown MCP Miner hook mode: #{@mode}"
      puts JSON.generate({ continue: true })
    end
  rescue StandardError => e
    warn "MCP Miner hook error: #{e.class}: #{e.message}"
    puts JSON.generate({
      systemMessage: "MCP Miner hook skipped: #{e.message}",
      continue: true
    })
  end

  private

  def read_input
    raw = STDIN.read
    return {} if raw.strip.empty?

    JSON.parse(raw)
  rescue JSON::ParserError
    {}
  end

  def repo_root
    McpMiner::GameEngine.locate_repo_root([
      ENV["MCP_MINER_REPO_ROOT"],
      File.expand_path("../../..", __dir__),
      ENV["PLUGIN_ROOT"] && File.expand_path("../..", ENV["PLUGIN_ROOT"]),
      Dir.pwd
    ])
  end

  def record_session_start
    @engine.with_state do |state|
      @engine.add_stat_event(state, "work_session_start", 0)
      state["last_session_id"] = safe_string(@input["session_id"])
      state["last_seen_at"] = Time.now.utc.iso8601
    end

    puts JSON.generate({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "MCP Miner passive hooks are active. Track only abstract work-event rewards; do not expose prompts, code, file paths, repo names, or terminal output in game reports."
      }
    })
  end

  def record_user_prompt
    @engine.with_state do |state|
      @engine.ensure_turn(state, turn_id)
      @engine.add_event_reward(
        state,
        "work_user_prompt",
        turn_id: turn_id,
        hook_event_name: hook_event_name,
        line_count: 0,
        event_key_suffix: "prompt",
        session_id: @input["session_id"]
      )
      state["last_seen_at"] = Time.now.utc.iso8601
    end

    puts JSON.generate({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "MCP Miner is passively tracking this Codex turn. Do not mention the game unless the user asks."
      }
    })
  end

  def record_tool_use
    classification = classify_tool_use
    return unless classification
    project_id = @engine.project_fingerprint(@input["cwd"])

    @engine.with_state do |state|
      @engine.ensure_turn(state, turn_id)
      @engine.add_event_reward(
        state,
        classification[:event_id],
        turn_id: turn_id,
        hook_event_name: hook_event_name,
        line_count: classification[:line_count],
        event_key_suffix: safe_string(@input["tool_use_id"] || classification[:event_id]),
        session_id: @input["session_id"],
        project_id: project_id
      )
      state["last_seen_at"] = Time.now.utc.iso8601
    end
  end

  def record_subagent(counter)
    @engine.with_state do |state|
      @engine.record_subagent(
        state,
        agent_id: @input["agent_id"],
        agent_type: @input["agent_type"] || "unknown",
        counter: counter
      )
      state["last_seen_at"] = Time.now.utc.iso8601
    end

    if @mode == "subagent_start"
      puts JSON.generate({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "SubagentStart",
          additionalContext: "MCP Miner is tracking this subagent only by anonymous agent id and type; do not include raw transcript content in game reports."
        }
      })
    else
      puts JSON.generate({ continue: true })
    end
  end

  def emit_stop_report
    report = nil

    @engine.with_state do |state|
      @engine.ensure_turn(state, turn_id)

      if @engine.should_emit_report?(state)
        report = @engine.build_report(state)
        @engine.record_report(state, report, turn_id: turn_id)
      end

      state["last_seen_at"] = Time.now.utc.iso8601
    end

    if report.nil? || already_reported?(report) || @input["stop_hook_active"]
      puts JSON.generate({ continue: true })
      return
    end

    puts JSON.generate({
      continue: true,
      systemMessage: @engine.display_report(report)
    })
  end

  def classify_tool_use
    tool_name = safe_string(@input["tool_name"])
    tool_input = normalized_tool_input(@input["tool_input"])

    classify_named_tool(tool_name, tool_input)
  end

  def classify_named_tool(tool_name, tool_input)
    tool_input = normalized_tool_input(tool_input)
    command = safe_string(tool_input["command"] || tool_input["cmd"] || tool_input["patch"] || tool_input["input"] || tool_input["description"])

    case canonical_tool_name(tool_name)
    when "Bash", "exec_command"
      classify_bash(command)
    when "apply_patch"
      classify_patch(command)
    when "parallel"
      classify_parallel(tool_input)
    when "tool_search_tool", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"
      { event_id: "work_search", line_count: 0 }
    else
      classify_mcp(tool_name)
    end
  end

  def normalized_tool_input(tool_input)
    case tool_input
    when Hash
      tool_input
    when String
      { "command" => tool_input }
    else
      {}
    end
  end

  def canonical_tool_name(tool_name)
    safe_string(tool_name).split(".").last
  end

  def classify_parallel(tool_input)
    tool_uses = tool_input["tool_uses"]
    return nil unless tool_uses.is_a?(Array)

    classifications = tool_uses.map do |tool_use|
      next unless tool_use.is_a?(Hash)

      child_name = safe_string(tool_use["recipient_name"] || tool_use["tool_name"] || tool_use["name"])
      classify_named_tool(child_name, tool_use["parameters"])
    end.compact
    classifications.max_by { |classification| event_priority(classification[:event_id]) }
  end

  def event_priority(event_id)
    case event_id
    when "work_test_pass", "work_test_fail"
      6
    when "work_apply_patch", "work_write_docs"
      5
    when "work_commit_or_pr"
      4
    when "work_review"
      3
    when "work_search", "work_file_read"
      2
    else
      1
    end
  end

  def classify_bash(command)
    return nil if command.empty?

    if test_command?(command)
      { event_id: successful_tool_response? ? "work_test_pass" : "work_test_fail", line_count: 0 }
    elsif command.match?(/\A\s*(git\s+commit|git\s+push|gh\s+pr\s+create|gh\s+release)\b/)
      { event_id: "work_commit_or_pr", line_count: 0 }
    elsif command.match?(/\A\s*(rg|grep|find|fd|git\s+grep)\b/)
      { event_id: "work_search", line_count: 0 }
    elsif command.match?(/\A\s*(ls|sed|awk|cat|head|tail|wc|git\s+(show|diff|status|log))\b/)
      { event_id: "work_file_read", line_count: 0 }
    elsif command.match?(/\b(review|audit|inspect)\b/i)
      { event_id: "work_review", line_count: 0 }
    end
  end

  def classify_patch(command)
    line_count = changed_line_count(command)
    return nil if line_count <= 0

    event_id = command.match?(/\.(md|markdown|txt|rst|adoc)\b/i) ? "work_write_docs" : "work_apply_patch"
    { event_id: event_id, line_count: line_count }
  end

  def classify_mcp(tool_name)
    return nil unless tool_name.start_with?("mcp__")
    return nil if tool_name.include?("mcp-miner") || tool_name.include?("mcp_miner")

    if tool_name.match?(/github|linear|pull|review|issue/)
      { event_id: "work_review", line_count: 0 }
    elsif tool_name.match?(/search|read|fetch|get|list/)
      { event_id: "work_search", line_count: 0 }
    else
      { event_id: "work_fabrication_artifact", line_count: 0 }
    end
  end

  def already_reported?(report)
    message = safe_string(@input["last_assistant_message"])
    message.include?(REPORT_PREFIX) || message.include?(report)
  end

  def test_command?(command)
    command.match?(/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|lint)\b/) ||
      command.match?(/\b(pytest|rspec|go\s+test|cargo\s+test|swift\s+test|xcodebuild\s+test|gradle\s+test|mvn\s+test|phpunit)\b/)
  end

  def successful_tool_response?
    response = @input["tool_response"]
    return true if response.nil?
    return response.zero? if response.is_a?(Integer)
    return !response.match?(/exit\s+(code\s+)?[1-9]|failed|error/i) if response.is_a?(String)
    return true unless response.is_a?(Hash)

    code = response["exit_code"] || response["exitCode"] || response["status_code"] || response["code"]
    return code.to_i.zero? if code

    status = safe_string(response["status"] || response["outcome"])
    return false if status.match?(/fail|error|nonzero/i)

    true
  end

  def changed_line_count(command)
    command.each_line.count do |line|
      (line.start_with?("+") && !line.start_with?("+++")) ||
        (line.start_with?("-") && !line.start_with?("---"))
    end
  end

  def turn_id
    safe_string(@input["turn_id"] || @input["session_id"] || "local-turn")
  end

  def hook_event_name
    safe_string(@input["hook_event_name"])
  end

  def safe_string(value)
    value.to_s
  end
end

McpMinerHook.new(ARGV.fetch(0, "")).run
