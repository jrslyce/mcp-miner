# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "time"
require "yaml"

module McpMiner
  class GameEngine
    STATE_DIR = File.join(Dir.home, ".mcp-miner")
    DEFAULT_STATE_PATH = File.join(STATE_DIR, "state.json")
    MAX_DEDUPE_KEYS = 300
    REPORT_PREFIX = "MCP Miner:"
    MEANINGFUL_SCORE = 3.0
    VALID_REPORT_MODES = %w[
      off
      every_turn_compact
      every_turn_full
      meaningful_turns_only
      session_summary_only
      milestones_only
    ].freeze

    DATA_FILES = {
      materials: ["materials.yaml", "materials"],
      machines: ["fabrication_machines.yaml", "machines"],
      recipes: ["recipes.yaml", "recipes"],
      variants: ["order_variants.yaml", "order_variants"],
      order_generator: ["order_generator.yaml", "order_generation"],
      buyers: ["buyers.yaml", "buyers"],
      asteroids: ["asteroid_classes.yaml", "asteroid_classes"],
      upgrades: ["upgrades.yaml", "upgrades"],
      hazards: ["hazards.yaml", "hazards"],
      player_start: ["player_start.yaml", "player_start"],
      reports: ["report_templates.yaml", "report_templates"],
      work_scoring: ["work_scoring.yaml", "work_events"]
    }.freeze

    attr_reader :root, :state_path

    def self.locate_repo_root(candidates = [])
      all_candidates = [
        *candidates,
        ENV["MCP_MINER_REPO_ROOT"],
        ENV["PLUGIN_ROOT"] && File.expand_path("../..", ENV["PLUGIN_ROOT"]),
        File.expand_path("../../../../", __dir__),
        Dir.pwd
      ].compact

      root = all_candidates.find { |candidate| File.exist?(File.join(candidate, "data", "materials.yaml")) }
      raise "could not locate data/materials.yaml" unless root

      root
    end

    def initialize(root: self.class.locate_repo_root, state_path: ENV["MCP_MINER_STATE_PATH"])
      @root = root
      @data_dir = File.join(root, "data")
      @state_path = state_path || DEFAULT_STATE_PATH
      @data = load_data
      FileUtils.mkdir_p(File.dirname(@state_path))
    end

    def state
      current_state = read_state
      normalize_state(current_state)
      current_state
    end

    def with_state
      FileUtils.mkdir_p(File.dirname(state_path))
      File.open("#{state_path}.lock", "w") do |lock|
        lock.flock(File::LOCK_EX)
        current_state = read_state
        normalize_state(current_state)
        result = yield current_state
        atomic_write_state(current_state)
        result
      end
    end

    def write_state(next_state)
      FileUtils.mkdir_p(File.dirname(state_path))
      File.open("#{state_path}.lock", "w") do |lock|
        lock.flock(File::LOCK_EX)
        normalize_state(next_state)
        atomic_write_state(next_state)
      end
      next_state
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
      state["space_bucks"] = start.fetch("space_bucks") unless state.key?("space_bucks")
      state["inventory"] ||= start.fetch("inventory").dup
      state["unlocked_machine_ids"] ||= start.fetch("unlocked_machine_ids").dup
      state["unlocked_asteroid_class_ids"] ||= start.fetch("unlocked_asteroid_class_ids").dup
      state["current_asteroid_class_id"] ||= start.fetch("current_asteroid_class_id")
      state["upgrades"] ||= start.fetch("upgrades").dup
      state["base_modules"] ||= start.fetch("base_modules").dup
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
      state
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

    def ensure_turn(state, turn_id)
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

    def add_event_reward(state, event_id, turn_id:, hook_event_name:, line_count:, event_key_suffix:)
      event_key = [turn_id, hook_event_name, event_id, event_key_suffix].join(":")
      return if state["dedupe_keys"].include?(event_key)

      state["dedupe_keys"] << event_key
      state["dedupe_keys"] = state["dedupe_keys"].last(MAX_DEDUPE_KEYS)

      score = event_score(event_id, line_count)
      return if score <= 0

      reward = mine_reward(state, event_id, score, turn_id: turn_id)
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

    def add_project_activity(state, event_id, turn_id:, cwd:)
      project = state["project_stats"][project_fingerprint(cwd)] ||= {
        "turns" => {},
        "work_events" => {},
        "last_seen_at" => nil
      }
      project["turns"][turn_id] = true
      project["work_events"][event_id] = project["work_events"][event_id].to_i + 1
      project["last_seen_at"] = Time.now.utc.iso8601
    end

    def record_subagent(state, agent_id:, agent_type:, counter:)
      agent = state["agent_stats"][agent_fingerprint(agent_id: agent_id, agent_type: agent_type)] ||= {
        "agent_type" => safe_string(agent_type || "unknown"),
        "starts" => 0,
        "stops" => 0,
        "last_seen_at" => nil
      }
      agent["agent_type"] = safe_string(agent_type || agent["agent_type"])
      agent[counter] = agent[counter].to_i + 1
      agent["last_seen_at"] = Time.now.utc.iso8601
    end

    def project_fingerprint(cwd)
      "project_#{Digest::SHA256.hexdigest(safe_string(cwd))[0, 12]}"
    end

    def agent_fingerprint(agent_id:, agent_type:)
      raw = safe_string(agent_id || agent_type || "unknown-agent")
      "agent_#{Digest::SHA256.hexdigest(raw)[0, 12]}"
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

    def mine_reward(state, event_id, score, turn_id:)
      asteroid = asteroid_for(state)
      multiplier = asteroid["yield_multiplier"].to_f * drill_multiplier(state)
      chonks = [(score * 1.25 * multiplier).floor, 1].max
      materials = weighted_materials(state, asteroid, score, turn_id: turn_id)

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

    def weighted_materials(state, asteroid, score, turn_id:)
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
      summary = material_summary(turn["materials"])
      order_summary = "orders waiting"
      suit_condition = state["suit_condition"].to_i

      template_key = mode == "every_turn_full" ? "full" : "compact"
      template = @data.dig(:reports, template_key)&.first || "#{REPORT_PREFIX} +{chonks} Chonks, {material_summary}, {order_summary}."
      fill_report_template(template, {
        "chonks" => turn["chonks"].to_i,
        "highlight" => highlight(turn),
        "material_summary" => summary,
        "order_summary" => order_summary,
        "suit_condition" => suit_condition,
        "asteroid_name" => asteroid["display_name"],
        "space_bucks" => state["space_bucks"].to_i
      })
    end

    def record_report(state, report, turn_id:)
      state["latest_report"] = {
        "text" => report,
        "turn_id" => turn_id,
        "created_at" => Time.now.utc.iso8601
      }
      state["stats"]["reports_emitted"] = state.dig("stats", "reports_emitted").to_i + 1
      state["current_turn"]["report_emitted"] = true if state["current_turn"]
    end

    def latest_report_payload(current_state = state)
      existing_report = current_state.dig("latest_report", "text")
      if existing_report && !existing_report.empty?
        return {
          report: existing_report,
          source: "local_hook_state",
          privacy: "No prompts, code, file paths, repo names, or terminal output included."
        }
      end

      chonks = current_state.dig("inventory", "mat_chonks") || 0
      asteroid = asteroid_summary(current_state["current_asteroid_class_id"])
      {
        report: "MCP Miner: #{chonks} Chonks banked, #{asteroid[:display_name]} selected, orders ready.",
        source: "local_state",
        privacy: "No prompts, code, file paths, repo names, or terminal output included."
      }
    end

    def player_status
      current_state = state
      {
        player: {
          space_bucks: current_state["space_bucks"],
          report_mode: current_state["report_mode"],
          cloud_sync: current_state["cloud_sync"],
          suit_condition: current_state["suit_condition"] || 100
        },
        inventory: current_state["inventory"],
        current_asteroid: asteroid_summary(current_state["current_asteroid_class_id"]),
        asteroid_progress: current_state["asteroid_progress"] || {},
        unlocked_machines: current_state["unlocked_machine_ids"].map { |machine_id| machine_name(machine_id) },
        upgrades: current_state["upgrades"],
        stats: current_state["stats"] || {},
        project_stats: current_state["project_stats"] || {},
        agent_stats: current_state["agent_stats"] || {},
        latest_report: latest_report_payload(current_state)[:report]
      }
    end

    def catalog_summary
      {
        materials: material_list.length,
        elements: material_list.count { |m| m["category"] == "element" },
        machines: machine_list.length,
        recipes: recipe_list.length,
        fabricated_order_types: recipe_list.length * variant_list.length,
        order_variants: variant_list.length,
        asteroid_classes: asteroid_list.length,
        upgrades: upgrade_list.length,
        hazards: hazard_list.length
      }
    end

    def update_settings(args)
      with_state do |current_state|
        if args.key?("report_mode")
          mode = args["report_mode"]
          raise "Invalid report_mode #{mode.inspect}; expected one of #{VALID_REPORT_MODES.join(', ')}" unless VALID_REPORT_MODES.include?(mode)

          current_state["report_mode"] = mode
        end
        current_state["cloud_sync"] = !!args["cloud_sync"] if args.key?("cloud_sync")
        {
          ok: true,
          settings: {
            report_mode: current_state["report_mode"],
            cloud_sync: current_state["cloud_sync"]
          }
        }
      end
    end

    def active_orders_payload
      with_state do |current_state|
        if current_state["orders"].nil? || current_state["orders"].empty?
          current_state["orders"] = generate_orders
          current_state["orders_generated_at"] = Time.now.utc.iso8601
        end
        { orders: current_state["orders"], generated_at: current_state["orders_generated_at"] }
      end
    end

    def generate_orders
      slots = @data.fetch(:order_generator).fetch("active_order_slots")
      recipes = recipe_list.select { |recipe| recipe["progression_tier"] <= 1 }
      variants = variant_list
      buyer = buyer_list.find { |b| b["unlock_tier"] == 1 } || buyer_list.first

      recipes.first(slots).each_with_index.map do |recipe, index|
        variant = variants[index % variants.length]
        quantity = 1
        required = required_materials(recipe, variant, quantity)
        payout = order_payout(required, recipe, variant, buyer, windfall: false)
        {
          order_id: "order_seed_#{index + 1}",
          recipe_id: recipe["id"],
          product: "#{variant['display_name']} #{recipe['display_name']}",
          variant_id: variant["id"],
          buyer_id: buyer["id"],
          buyer: buyer["display_name"],
          quantity: quantity,
          required_materials: required,
          payout_space_bucks: payout,
          is_windfall: false,
          expires_in_days: 3
        }
      end
    end

    def required_materials(recipe, variant, quantity)
      multiplier = variant["recipe_quantity_multiplier"].to_f
      required = Hash.new(0)
      recipe["inputs"].each do |input|
        required[input["material_id"]] += (input["quantity"] * multiplier).ceil * quantity
      end

      if variant["adds_refined_primary"]
        required["refined:#{recipe['primary_material_id']}"] += variant["refined_primary_quantity"].to_i * quantity
      end

      if variant["adds_collector_accent"]
        accent = recipe["collector_accent"]
        required[accent["material_id"]] += accent["quantity"].to_i * variant["collector_accent_quantity"].to_i * quantity
      end

      required
    end

    def order_payout(required, recipe, variant, buyer, windfall:)
      raw_value = required.sum do |material_id, quantity|
        lookup_id = material_id.sub(/^refined:/, "")
        material = material_by_id.fetch(lookup_id)
        value = material_id.start_with?("refined:") ? material["refined_space_bucks"] : material["raw_space_bucks"]
        value.to_i * quantity.to_i
      end
      complexity = 1 + (0.08 * required.keys.length) + (0.18 * recipe["progression_tier"].to_i) + (0.10 * recipe["progression_tier"].to_i)
      variation = windfall ? 2.25 : 1.0
      nice_round(raw_value * complexity * buyer["reputation_multiplier"].to_f * variant["payout_multiplier"].to_f * variation)
    end

    def asteroid_summary(id)
      asteroid = asteroid_by_id[id] || asteroid_list.first
      {
        id: asteroid["id"],
        display_name: asteroid["display_name"],
        unlock_tier: asteroid["unlock_tier"],
        depletion_size: asteroid["depletion_size"]
      }
    end

    def machine_name(id)
      machine = machine_by_id[id]
      machine ? machine["display_name"] : id
    end

    def material_list
      @data.fetch(:materials)
    end

    def machine_list
      @data.fetch(:machines)
    end

    def recipe_list
      @data.fetch(:recipes)
    end

    def variant_list
      @data.fetch(:variants)
    end

    def buyer_list
      @data.fetch(:buyers)
    end

    def asteroid_list
      @data.fetch(:asteroids)
    end

    def upgrade_list
      @data.fetch(:upgrades)
    end

    def hazard_list
      @data.fetch(:hazards)
    end

    def safe_string(value)
      value.to_s
    end

    private

    def load_data
      DATA_FILES.transform_values do |(file, root_key)|
        path = File.join(@data_dir, file)
        raise "Missing gameplay data file: #{path}" unless File.exist?(path)

        YAML.load_file(path).fetch(root_key)
      end
    end

    def read_state
      return initial_state unless File.exist?(state_path)

      JSON.parse(File.read(state_path))
    rescue JSON::ParserError
      initial_state
    end

    def atomic_write_state(next_state)
      tmp_path = "#{state_path}.tmp"
      File.write(tmp_path, JSON.pretty_generate(next_state))
      File.rename(tmp_path, state_path)
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

    def concrete_work_turn?(turn)
      events = turn["events"] || {}
      concrete_count = events.reject { |event_id, _count| event_id == "work_user_prompt" }
                             .values
                             .sum(&:to_i)
      concrete_count.positive? && turn["score"].to_f >= MEANINGFUL_SCORE
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

    def nice_round(value)
      return 0 if value <= 0

      pow = 10**(Math.log10(value).floor - 1)
      (value / pow).ceil * pow
    end

    def material_by_id
      @material_by_id ||= material_list.to_h { |material| [material.fetch("id"), material] }
    end

    def machine_by_id
      @machine_by_id ||= machine_list.to_h { |machine| [machine["id"], machine] }
    end

    def asteroid_by_id
      @asteroid_by_id ||= asteroid_list.to_h { |asteroid| [asteroid.fetch("id"), asteroid] }
    end

    def work_event_by_id
      @work_event_by_id ||= @data.fetch(:work_scoring).to_h { |event| [event.fetch("id"), event] }
    end
  end
end
