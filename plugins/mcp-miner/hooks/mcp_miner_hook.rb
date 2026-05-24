#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "time"
require "yaml"

class McpMinerHook
  STATE_DIR = File.join(Dir.home, ".mcp-miner")
  DEFAULT_STATE_PATH = File.join(STATE_DIR, "state.json")
  MAX_DEDUPE_KEYS = 300
  REPORT_PREFIX = "MCP Miner:"
  MEANINGFUL_SCORE = 3.0

  def initialize(mode)
    @mode = mode
    @input = read_input
    @repo_root = locate_repo_root
    @data = load_data
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
      emit_stop_decision
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

  def locate_repo_root
    candidates = [
      ENV["MCP_MINER_REPO_ROOT"],
      File.expand_path("../../..", __dir__),
      ENV["PLUGIN_ROOT"] && File.expand_path("../..", ENV["PLUGIN_ROOT"]),
      Dir.pwd
    ].compact

    root = candidates.find { |candidate| File.exist?(File.join(candidate, "data", "materials.yaml")) }
    raise "could not locate data/materials.yaml" unless root

    root
  end

  def load_data
    {
      materials: load_yaml("materials.yaml").fetch("materials"),
      asteroids: load_yaml("asteroid_classes.yaml").fetch("asteroid_classes"),
      player_start: load_yaml("player_start.yaml").fetch("player_start"),
      reports: load_yaml("report_templates.yaml").fetch("report_templates"),
      work_scoring: load_yaml("work_scoring.yaml").fetch("work_events")
    }
  end

  def load_yaml(filename)
    path = File.join(@repo_root, "data", filename)
    raise "missing gameplay data file: #{path}" unless File.exist?(path)

    YAML.load_file(path)
  end

  def record_session_start
    with_state do |state|
      add_stat_event(state, "work_session_start", 0)
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
    with_state do |state|
      ensure_turn(state)
      add_event_reward(state, "work_user_prompt", line_count: 0, event_key_suffix: "prompt")
      state["last_seen_at"] = Time.now.utc.iso8601
    end

    puts JSON.generate({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "MCP Miner is passively tracking this Codex turn. Do not mention the game unless the user asks or a Stop hook continuation explicitly asks you to append the generated MCP Miner footer."
      }
    })
  end

  def record_tool_use
    classification = classify_tool_use
    return unless classification

    with_state do |state|
      ensure_turn(state)
      add_event_reward(
        state,
        classification[:event_id],
        line_count: classification[:line_count],
        event_key_suffix: safe_string(@input["tool_use_id"] || classification[:event_id])
      )
      add_project_activity(state, classification[:event_id])
      state["last_seen_at"] = Time.now.utc.iso8601
    end
  end

  def record_subagent(counter)
    with_state do |state|
      agent_key = agent_fingerprint
      agent = state["agent_stats"][agent_key] ||= {
        "agent_type" => safe_string(@input["agent_type"] || "unknown"),
        "starts" => 0,
        "stops" => 0,
        "last_seen_at" => nil
      }
      agent["agent_type"] = safe_string(@input["agent_type"] || agent["agent_type"])
      agent[counter] = agent[counter].to_i + 1
      agent["last_seen_at"] = Time.now.utc.iso8601
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

  def emit_stop_decision
    report = nil

    with_state do |state|
      ensure_turn(state)

      if should_emit_report?(state)
        report = build_report(state)
        state["latest_report"] = {
          "text" => report,
          "turn_id" => turn_id,
          "created_at" => Time.now.utc.iso8601
        }
        state["stats"]["reports_emitted"] = state.dig("stats", "reports_emitted").to_i + 1
        state["current_turn"]["report_emitted"] = true
      end

      state["last_seen_at"] = Time.now.utc.iso8601
    end

    if report.nil? || already_reported?(report) || @input["stop_hook_active"]
      puts JSON.generate({ continue: true })
      return
    end

    puts JSON.generate({
      decision: "block",
      reason: "Append this exact MCP Miner report footer as the final paragraph of your response. Do not change any other answer content and do not add explanation about the footer.\n\n#{report}"
    })
  end

  def classify_tool_use
    tool_name = safe_string(@input["tool_name"])
    tool_input = @input["tool_input"].is_a?(Hash) ? @input["tool_input"] : {}
    command = safe_string(tool_input["command"] || tool_input["cmd"] || @input.dig("tool_input", "description"))

    case tool_name
    when "Bash"
      classify_bash(command)
    when "apply_patch"
      classify_patch(command)
    else
      classify_mcp(tool_name)
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

  def add_event_reward(state, event_id, line_count:, event_key_suffix:)
    event_key = [turn_id, @input["hook_event_name"], event_id, event_key_suffix].join(":")
    return if state["dedupe_keys"].include?(event_key)

    state["dedupe_keys"] << event_key
    state["dedupe_keys"] = state["dedupe_keys"].last(MAX_DEDUPE_KEYS)

    score = event_score(event_id, line_count)
    return if score <= 0

    reward = mine_reward(state, event_id, score)
    turn = state["current_turn"]
    turn["score"] = turn["score"].to_f + score
    turn["chonks"] = turn["chonks"].to_i + reward[:chonks]
    turn["events"][event_id] = turn["events"][event_id].to_i + 1
    reward[:materials].each do |material_id, quantity|
      turn["materials"][material_id] = turn["materials"][material_id].to_i + quantity
    end

    add_stat_event(state, event_id, score)
    state["stats"]["chonks_mined_total"] = state["stats"]["chonks_mined_total"].to_i + reward[:chonks]
    state["stats"]["materials_found_total"] = state["stats"]["materials_found_total"].to_i + reward[:materials].values.sum
    state["stats"]["tool_events_seen"] = state["stats"]["tool_events_seen"].to_i + 1 unless event_id == "work_user_prompt"
  end

  def add_stat_event(state, event_id, score)
    state["stats"]["work_score_total"] = state["stats"]["work_score_total"].to_f + score.to_f
    state["stats"]["work_events"][event_id] = state["stats"]["work_events"][event_id].to_i + 1
  end

  def event_score(event_id, line_count)
    event = work_event_by_id.fetch(event_id)
    score = event["base_score"].to_f

    if line_count.positive? && event["score_per_changed_line"]
      score += line_count * event["score_per_changed_line"].to_f
      score = [score, event["max_score_per_event"].to_f].min if event["max_score_per_event"]
    end

    score *= event["verification_bonus"].to_f if event_id == "work_test_pass" && event["verification_bonus"]
    score.round(2)
  end

  def mine_reward(state, event_id, score)
    asteroid = asteroid_for(state)
    multiplier = asteroid["yield_multiplier"].to_f * drill_multiplier(state)
    chonks = [(score * 1.25 * multiplier).floor, 1].max
    materials = weighted_materials(state, asteroid, score)

    inventory = state["inventory"]
    inventory["mat_chonks"] = inventory["mat_chonks"].to_i + chonks
    materials.each do |material_id, quantity|
      inventory[material_id] = inventory[material_id].to_i + quantity
    end

    state["asteroid_progress"]["asteroid_class_id"] = asteroid["id"]
    state["asteroid_progress"]["mined"] = state["asteroid_progress"]["mined"].to_i + chonks + materials.values.sum
    state["suit_condition"] = [state["suit_condition"].to_i - hazard_damage(event_id, asteroid, state), 0].max

    { chonks: chonks, materials: materials }
  end

  def weighted_materials(state, asteroid, score)
    units = [[(score / 4.0).floor, 1].max, 8].min
    weights = asteroid.fetch("composition")
    materials = Hash.new(0)

    units.times do |index|
      material_id = pick_weighted(weights, "#{turn_id}:#{state.dig('stats', 'work_score_total')}:#{index}")
      next if material_id == "mat_chonks"

      materials[material_id] += 1
    end

    materials
  end

  def pick_weighted(weights, seed)
    total = weights.sum { |entry| entry["weight"].to_f }
    point = deterministic_unit(seed) * total
    cursor = 0.0

    weights.each do |entry|
      cursor += entry["weight"].to_f
      return entry["material_id"] if point <= cursor
    end

    weights.last["material_id"]
  end

  def deterministic_unit(seed)
    hex = Digest::SHA256.hexdigest(seed)[0, 12]
    hex.to_i(16) / 0xffffffffffff.to_f
  end

  def should_emit_report?(state)
    mode = state["report_mode"] || "meaningful_turns_only"
    turn = state["current_turn"] || {}
    return false if mode == "off" || mode == "session_summary_only"
    return false if turn["report_emitted"]
    return true if mode == "every_turn_compact" || mode == "every_turn_full"
    return milestone_turn?(state) if mode == "milestones_only"

    concrete_work_turn?(turn) || milestone_turn?(state)
  end

  def build_report(state)
    mode = state["report_mode"] || "meaningful_turns_only"
    turn = state["current_turn"]
    asteroid = asteroid_for(state)
    material_summary = material_summary(turn["materials"])
    order_summary = "orders waiting"
    suit_condition = state["suit_condition"].to_i

    template_key = mode == "every_turn_full" ? "full" : "compact"
    template = @data.dig(:reports, template_key)&.first || "#{REPORT_PREFIX} +{chonks} Chonks, {material_summary}, {order_summary}."
    fill_report_template(template, {
      "chonks" => turn["chonks"].to_i,
      "highlight" => highlight(turn),
      "material_summary" => material_summary,
      "order_summary" => order_summary,
      "suit_condition" => suit_condition,
      "asteroid_name" => asteroid["display_name"],
      "space_bucks" => state["space_bucks"].to_i
    })
  end

  def fill_report_template(template, values)
    values.reduce(template) do |text, (key, value)|
      text.gsub("{#{key}}", value.to_s)
    end
  end

  def highlight(turn)
    events = turn["events"] || {}
    priority = {
      "work_commit_or_pr" => 7,
      "work_test_pass" => 6,
      "work_apply_patch" => 5,
      "work_write_docs" => 5,
      "work_review" => 4,
      "work_fabrication_artifact" => 4,
      "work_test_fail" => 3,
      "work_search" => 2,
      "work_file_read" => 1
    }
    dominant_event = events.reject { |event_id, _count| event_id == "work_user_prompt" }
                           .max_by { |event_id, count| [count.to_i, priority[event_id].to_i] }&.first
    case dominant_event
    when "work_apply_patch" then "fabricator sparks approved"
    when "work_write_docs" then "manuals polished for the crew"
    when "work_test_pass" then "lab alarms stayed polite"
    when "work_test_fail" then "lab alarms got theatrical"
    when "work_search" then "scanner swept fresh veins"
    when "work_review" then "inspection visor found leverage"
    when "work_commit_or_pr" then "cargo manifest shipped"
    else "asteroid dust behaved itself"
    end
  end

  def material_summary(materials)
    found = (materials || {}).select { |_id, quantity| quantity.to_i.positive? }
    return "no bonus materials" if found.empty?

    found.sort_by { |_id, quantity| -quantity.to_i }.first(3).map do |material_id, quantity|
      "#{quantity} #{material_name(material_id)}"
    end.join(", ")
  end

  def already_reported?(report)
    message = safe_string(@input["last_assistant_message"])
    message.include?(REPORT_PREFIX) || message.include?(report)
  end

  def concrete_work_turn?(turn)
    events = turn["events"] || {}
    concrete_count = events.reject { |event_id, _count| event_id == "work_user_prompt" }
                           .values
                           .sum(&:to_i)
    concrete_count.positive? && turn["score"].to_f >= MEANINGFUL_SCORE
  end

  def ensure_turn(state)
    current = state["current_turn"]
    return if current && current["turn_id"] == turn_id

    state["stats"]["turns_seen"] = state["stats"]["turns_seen"].to_i + 1
    state["current_turn"] = {
      "turn_id" => turn_id,
      "score" => 0.0,
      "chonks" => 0,
      "materials" => {},
      "events" => {},
      "report_emitted" => false,
      "started_at" => Time.now.utc.iso8601
    }
  end

  def with_state
    FileUtils.mkdir_p(File.dirname(state_path))
    File.open("#{state_path}.lock", "w") do |lock|
      lock.flock(File::LOCK_EX)
      state = load_state
      normalize_state(state)
      yield state
      write_state(state)
    end
  end

  def load_state
    return initial_state unless File.exist?(state_path)

    JSON.parse(File.read(state_path))
  rescue JSON::ParserError
    initial_state
  end

  def write_state(state)
    tmp_path = "#{state_path}.tmp"
    File.write(tmp_path, JSON.pretty_generate(state))
    File.rename(tmp_path, state_path)
  end

  def initial_state
    start = @data.fetch(:player_start)
    {
      "space_bucks" => start.fetch("space_bucks"),
      "inventory" => start.fetch("inventory").dup,
      "unlocked_machine_ids" => start.fetch("unlocked_machine_ids").dup,
      "unlocked_asteroid_class_ids" => start.fetch("unlocked_asteroid_class_ids").dup,
      "current_asteroid_class_id" => start.fetch("current_asteroid_class_id"),
      "upgrades" => start.fetch("upgrades").dup,
      "base_modules" => start.fetch("base_modules").dup,
      "report_mode" => start.fetch("report_mode"),
      "cloud_sync" => false,
      "orders" => [],
      "suit_condition" => 100,
      "asteroid_progress" => {
        "asteroid_class_id" => start.fetch("current_asteroid_class_id"),
        "mined" => 0
      },
      "stats" => default_stats,
      "project_stats" => {},
      "agent_stats" => {},
      "dedupe_keys" => [],
      "current_turn" => nil,
      "latest_report" => nil,
      "created_at" => Time.now.utc.iso8601
    }
  end

  def normalize_state(state)
    start = @data.fetch(:player_start)
    state["inventory"] ||= start.fetch("inventory").dup
    state["upgrades"] ||= start.fetch("upgrades").dup
    state["report_mode"] ||= start.fetch("report_mode")
    state["cloud_sync"] = false unless state.key?("cloud_sync")
    state["suit_condition"] ||= 100
    state["asteroid_progress"] ||= {
      "asteroid_class_id" => state["current_asteroid_class_id"] || start.fetch("current_asteroid_class_id"),
      "mined" => 0
    }
    state["stats"] = default_stats.merge(state["stats"] || {})
    state["stats"]["work_events"] ||= {}
    state["project_stats"] ||= {}
    state["agent_stats"] ||= {}
    state["dedupe_keys"] ||= []
    state["current_turn"] = nil unless state["current_turn"].is_a?(Hash)
    state["orders"] ||= []
  end

  def default_stats
    {
      "turns_seen" => 0,
      "tool_events_seen" => 0,
      "work_score_total" => 0.0,
      "chonks_mined_total" => 0,
      "materials_found_total" => 0,
      "reports_emitted" => 0,
      "work_events" => {}
    }
  end

  def state_path
    ENV["MCP_MINER_STATE_PATH"] || DEFAULT_STATE_PATH
  end

  def turn_id
    safe_string(@input["turn_id"] || @input["session_id"] || "local-turn")
  end

  def add_project_activity(state, event_id)
    project = state["project_stats"][project_fingerprint] ||= {
      "turns" => {},
      "work_events" => {},
      "last_seen_at" => nil
    }
    project["turns"][turn_id] = true
    project["work_events"][event_id] = project["work_events"][event_id].to_i + 1
    project["last_seen_at"] = Time.now.utc.iso8601
  end

  def project_fingerprint
    digest = Digest::SHA256.hexdigest(safe_string(@input["cwd"]))
    "project_#{digest[0, 12]}"
  end

  def agent_fingerprint
    raw = safe_string(@input["agent_id"] || @input["agent_type"] || "unknown-agent")
    "agent_#{Digest::SHA256.hexdigest(raw)[0, 12]}"
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

  def asteroid_for(state)
    asteroid_id = state["current_asteroid_class_id"] || state.dig("asteroid_progress", "asteroid_class_id")
    asteroid_by_id[asteroid_id] || @data.fetch(:asteroids).first
  end

  def drill_multiplier(state)
    level = state.dig("upgrades", "upgrade_drill_power").to_i
    1 + (2.6 * (1 - Math.exp(-0.045 * level))) + (0.05 * (level / 10).floor)
  end

  def hazard_damage(event_id, asteroid, state)
    return 0 unless event_id == "work_test_fail"

    plating = state.dig("upgrades", "upgrade_suit_plating").to_i
    reduction = 0.72 * (1 - Math.exp(-0.045 * plating))
    damage = 2.0 * asteroid["hazard_multiplier"].to_f * (1 - reduction)
    damage.ceil
  end

  def milestone_turn?(state)
    mined = state.dig("asteroid_progress", "mined").to_i
    size = asteroid_for(state)["depletion_size"].to_i
    mined.positive? && size.positive? && (mined % 250) < [state.dig("current_turn", "chonks").to_i, 1].max
  end

  def material_name(material_id)
    material_by_id.dig(material_id, "display_name") || material_id
  end

  def material_by_id
    @material_by_id ||= @data.fetch(:materials).to_h { |material| [material.fetch("id"), material] }
  end

  def asteroid_by_id
    @asteroid_by_id ||= @data.fetch(:asteroids).to_h { |asteroid| [asteroid.fetch("id"), asteroid] }
  end

  def work_event_by_id
    @work_event_by_id ||= @data.fetch(:work_scoring).to_h { |event| [event.fetch("id"), event] }
  end

  def safe_string(value)
    value.to_s
  end
end

McpMinerHook.new(ARGV.fetch(0, "")).run
