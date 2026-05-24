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
    DEFAULT_JOURNAL_FILENAME = "journal.jsonl"
    CURRENT_STATE_SCHEMA_VERSION = 1
    MAX_DEDUPE_KEYS = 300
    REPORT_PREFIX = "MCP Miner:"
    MEANINGFUL_SCORE = 3.0
    MILESTONE_INTERVAL = 250
    PRIVACY_NOTICE = "No prompts, code, file paths, repo names, terminal output, browser content, app content, or raw transcripts included."
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

    attr_reader :root, :state_path, :journal_path

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

    def initialize(root: self.class.locate_repo_root, state_path: ENV["MCP_MINER_STATE_PATH"], journal_path: ENV["MCP_MINER_JOURNAL_PATH"])
      @root = root
      @data_dir = File.join(root, "data")
      @state_path = state_path || DEFAULT_STATE_PATH
      @journal_path = journal_path || File.join(File.dirname(@state_path), DEFAULT_JOURNAL_FILENAME)
      @data = load_data
      FileUtils.mkdir_p(File.dirname(@state_path))
      FileUtils.mkdir_p(File.dirname(@journal_path))
    end

    def state
      FileUtils.mkdir_p(File.dirname(state_path))
      File.open("#{state_path}.lock", "w") do |lock|
        lock.flock(File::LOCK_EX)
        load_materialized_state
      end
    end

    def with_state
      FileUtils.mkdir_p(File.dirname(state_path))
      File.open("#{state_path}.lock", "w") do |lock|
        lock.flock(File::LOCK_EX)
        current_state = load_materialized_state
        result = yield current_state
        sync_journal_metadata(current_state)
        atomic_write_state(current_state)
        result
      end
    end

    def write_state(next_state)
      FileUtils.mkdir_p(File.dirname(state_path))
      File.open("#{state_path}.lock", "w") do |lock|
        lock.flock(File::LOCK_EX)
        normalize_state(next_state)
        sync_journal_metadata(next_state)
        atomic_write_state(next_state)
      end
      next_state
    end

    def replay_journal_state(entries = read_journal_entries)
      current_state = initial_state
      entries.each { |entry| apply_journal_entry(current_state, entry) }
      sync_journal_metadata(current_state, entries)
      current_state
    end

    def initial_state
      start = @data.fetch(:player_start)
      {
        "state_schema_version" => CURRENT_STATE_SCHEMA_VERSION,
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
        "completed_orders" => [],
        "order_generation_index" => 0,
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
        "journal" => {
          "path" => journal_path,
          "applied_event_count" => 0,
          "last_event_id" => nil
        },
        "last_migration" => nil,
        "last_recovery" => nil,
        "created_at" => Time.now.utc.iso8601
      }
    end

    def normalize_state(state)
      start = @data.fetch(:player_start)
      state["state_schema_version"] = CURRENT_STATE_SCHEMA_VERSION unless state["state_schema_version"].to_i.positive?
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
      state["completed_orders"] ||= []
      state["order_generation_index"] = state["order_generation_index"].to_i
      state["journal"] = default_journal_metadata.merge(state["journal"] || {})
      state["last_migration"] = nil unless state["last_migration"].nil? || state["last_migration"].is_a?(Hash)
      state["last_recovery"] = nil unless state["last_recovery"].nil? || state["last_recovery"].is_a?(Hash)
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

    def add_event_reward(state, event_id, turn_id:, hook_event_name:, line_count:, event_key_suffix:, session_id: nil, project_id: nil, agent_id: nil)
      event_key = [turn_id, hook_event_name, event_id, event_key_suffix].join(":")
      journal_event_id = reward_journal_event_id(event_key)
      return if state["dedupe_keys"].include?(event_key) || state["dedupe_keys"].include?(journal_event_id)

      score = event_score(event_id, line_count)
      return if score <= 0

      reward = calculate_reward(state, event_id, score, turn_id: turn_id)
      journal_entry = reward_journal_entry(
        journal_event_id,
        event_id,
        score,
        reward,
        turn_id: turn_id,
        session_id: session_id,
        project_id: project_id,
        agent_id: agent_id
      )
      append_journal_entry(journal_entry)
      apply_journal_entry(state, journal_entry)
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

    def calculate_reward(state, event_id, score, turn_id:)
      asteroid = asteroid_for(state)
      multiplier = asteroid["yield_multiplier"].to_f * drill_multiplier(state)
      chonks = [(score * 1.25 * multiplier).floor, 1].max
      materials = weighted_materials(state, asteroid, score, turn_id: turn_id)
      suit_damage = hazard_damage(event_id, asteroid, state)

      {
        chonks: chonks,
        materials: materials,
        asteroid_class_id: asteroid["id"],
        asteroid_mined_delta: chonks + materials.values.sum,
        suit_damage: suit_damage
      }
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
      return false if mode == "off"
      return false if turn["report_emitted"]
      return true if mode == "every_turn_compact" || mode == "every_turn_full"
      return milestone_turn?(state) if mode == "milestones_only"

      concrete_work_turn?(turn) || milestone_turn?(state)
    end

    def build_report(state)
      mode = state["report_mode"] || "meaningful_turns_only"
      turn = state["current_turn"] || {}
      template_key = report_template_key(state, mode)
      fill_report_template(report_template(template_key), report_values(state, turn))
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
          privacy: PRIVACY_NOTICE
        }
      end

      chonks = current_state.dig("inventory", "mat_chonks") || 0
      asteroid = asteroid_summary(current_state["current_asteroid_class_id"])
      {
        report: "MCP Miner: #{chonks} Chonks banked, #{asteroid[:display_name]} selected, orders ready.",
        source: "local_state",
        privacy: PRIVACY_NOTICE
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
        latest_report: latest_report_payload(current_state)[:report],
        settings: settings_payload(current_state)[:settings],
        sync: sync_progress_payload(current_state)[:sync],
        milestones: milestone_status_payload(current_state)[:milestones],
        privacy: PRIVACY_NOTICE
      }
    end

    def inventory_payload(current_state = state)
      items = inventory_items(current_state)
      {
        inventory: {
          total_units: items.sum { |item| item[:quantity].to_i },
          total_raw_space_bucks: items.sum { |item| item[:total_raw_space_bucks].to_i },
          categories: inventory_category_totals(items),
          items: items,
          gems: items.select { |item| item[:category] == "gem" }
        },
        privacy: PRIVACY_NOTICE
      }
    end

    def settings_payload(current_state = state)
      {
        settings: {
          report_mode: current_state["report_mode"],
          cloud_sync: current_state["cloud_sync"],
          valid_report_modes: VALID_REPORT_MODES
        },
        sync: sync_progress_payload(current_state)[:sync],
        privacy: PRIVACY_NOTICE
      }
    end

    def milestone_status_payload(current_state = state)
      asteroid = asteroid_for(current_state)
      mined = current_state.dig("asteroid_progress", "mined").to_i
      depletion_size = asteroid["depletion_size"].to_i
      percent_complete = depletion_size.positive? ? ((mined.to_f / depletion_size) * 100).round(2) : 0.0
      next_target = next_milestone_target(mined, depletion_size)

      {
        milestones: {
          status: mined >= depletion_size && depletion_size.positive? ? "asteroid_depleted" : "in_progress",
          current_asteroid: asteroid_summary(asteroid["id"]),
          progress: {
            mined: mined,
            depletion_size: depletion_size,
            remaining: [depletion_size - mined, 0].max,
            percent_complete: percent_complete
          },
          milestone_interval: MILESTONE_INTERVAL,
          reached_count: mined / MILESTONE_INTERVAL,
          next_milestone: next_target && {
            target_mined: next_target,
            remaining: [next_target - mined, 0].max,
            percent_of_asteroid: depletion_size.positive? ? ((next_target.to_f / depletion_size) * 100).round(2) : 0.0
          },
          claimable: false,
          claim_status: "not_supported_in_local_mvp"
        },
        privacy: PRIVACY_NOTICE
      }
    end

    def sync_progress_payload(current_state = state)
      {
        ok: true,
        sync: {
          status: "local_only",
          available: false,
          cloud_sync_enabled: current_state["cloud_sync"],
          materialized_state: "available",
          journal: {
            applied_event_count: current_state.dig("journal", "applied_event_count").to_i,
            last_event_id: current_state.dig("journal", "last_event_id")
          },
          state_schema_version: current_state["state_schema_version"].to_i,
          latest_state_schema_version: CURRENT_STATE_SCHEMA_VERSION,
          last_migration: current_state["last_migration"],
          last_recovery: current_state["last_recovery"],
          note: "Cloud sync is not implemented in the local MVP; progress remains in local state and journal."
        },
        privacy: PRIVACY_NOTICE
      }
    end

    def claim_milestone_payload(_args = {})
      {
        ok: false,
        status: "disabled",
        reason: "Milestone claiming is not implemented in the local MVP because milestone rewards are not yet defined.",
        milestones: milestone_status_payload[:milestones],
        privacy: PRIVACY_NOTICE
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
          },
          sync: sync_progress_payload(current_state)[:sync],
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def active_orders_payload
      with_state do |current_state|
        refresh_orders!(current_state)
        {
          orders: current_state["orders"].map { |order| order_payload(order, current_state) },
          generated_at: current_state["orders_generated_at"],
          refresh_due_at: current_state["orders_refresh_due_at"],
          refresh_cadence_hours: order_generator.fetch("refresh_cadence_hours"),
          missed_order_penalty: order_generator.fetch("missed_order_penalty"),
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def fulfill_order_payload(args)
      order_id = safe_string(args["order_id"])
      raise "order_id is required" if order_id.empty?

      with_state do |current_state|
        refresh_orders!(current_state)
        order = current_state["orders"].find { |candidate| candidate["order_id"] == order_id }
        unless order
          next {
            ok: false,
            status: "not_found",
            order_id: order_id,
            orders: current_state["orders"].map { |candidate| order_payload(candidate, current_state) },
            privacy: PRIVACY_NOTICE
          }
        end

        missing = missing_materials(order, current_state)
        unless missing.empty?
          next {
            ok: false,
            status: "missing_materials",
            order: order_payload(order, current_state),
            missing_materials: missing,
            privacy: PRIVACY_NOTICE
          }
        end

        required = order["required_materials"] || {}
        required.each do |material_id, quantity|
          current_state["inventory"][material_id] = current_state["inventory"][material_id].to_i - quantity.to_i
        end
        current_state["space_bucks"] = current_state["space_bucks"].to_i + order["payout_space_bucks"].to_i

        fulfilled_at = Time.now.utc.iso8601
        completed_order = order.merge(
          "status" => "fulfilled",
          "fulfilled_at" => fulfilled_at
        )
        current_state["completed_orders"] << completed_order
        current_state["completed_orders"] = current_state["completed_orders"].last(50)
        current_state["orders"].delete_if { |candidate| candidate["order_id"] == order_id }
        replacement = replace_order_for_slot!(current_state, order["slot"].to_i)

        {
          ok: true,
          status: "fulfilled",
          order: completed_order,
          consumed_materials: required,
          payout_space_bucks: order["payout_space_bucks"].to_i,
          space_bucks: current_state["space_bucks"].to_i,
          replacement_order: order_payload(replacement, current_state),
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def generate_orders(state = initial_state, generated_at: Time.now.utc)
      slots = order_generator.fetch("active_order_slots").to_i
      slots.times.map do |slot|
        generate_order_for_slot(state, slot, generated_at: generated_at)
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

    def order_payout(required, recipe, variant, buyer, windfall: false, price_multiplier: nil)
      raw_value = required.sum do |material_id, quantity|
        lookup_id = material_id.sub(/^refined:/, "")
        material = material_by_id.fetch(lookup_id)
        value = material_id.start_with?("refined:") ? material["refined_space_bucks"] : material["raw_space_bucks"]
        value.to_i * quantity.to_i
      end
      complexity = 1 + (0.08 * required.keys.length) + (0.18 * recipe["progression_tier"].to_i) + (0.10 * recipe["progression_tier"].to_i)
      multiplier = price_multiplier || (windfall ? order_generator.dig("windfall", "min_multiplier").to_f : 1.0)
      nice_round(raw_value * complexity * buyer["reputation_multiplier"].to_f * variant["payout_multiplier"].to_f * multiplier)
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

    def order_generator
      @data.fetch(:order_generator)
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

    def inventory_items(current_state)
      items = (current_state["inventory"] || {}).each_with_object([]) do |(material_id, quantity), payload|
        quantity = quantity.to_i
        next unless quantity.positive?

        material = material_by_id[material_id] || {}
        raw_space_bucks = material["raw_space_bucks"].to_i
        payload << {
          material_id: material_id,
          display_name: material["display_name"] || material_id,
          category: material["category"] || "unknown",
          rarity: material["rarity"] || "unknown",
          state_group: material["state_group"] || "unknown",
          quantity: quantity,
          raw_space_bucks_each: raw_space_bucks,
          total_raw_space_bucks: raw_space_bucks * quantity,
          can_refine: !!material["can_refine"]
        }
      end

      items.sort_by { |item| [item[:material_id] == "mat_chonks" ? 0 : 1, item[:display_name]] }
    end

    def inventory_category_totals(items)
      items.each_with_object({}) do |item, totals|
        category = item[:category]
        totals[category] ||= {
          items: 0,
          quantity: 0,
          total_raw_space_bucks: 0
        }
        totals[category][:items] += 1
        totals[category][:quantity] += item[:quantity].to_i
        totals[category][:total_raw_space_bucks] += item[:total_raw_space_bucks].to_i
      end
    end

    def refresh_orders!(state)
      now = Time.now.utc
      state["order_generation_index"] = state["order_generation_index"].to_i
      state["orders"] = [] unless state["orders"].is_a?(Array)
      refresh_due = parse_time(state["orders_refresh_due_at"])

      if state["orders"].empty? || (refresh_due && refresh_due <= now)
        state["order_generation_index"] += 1 unless state["orders"].empty?
        state["orders"] = generate_orders(state, generated_at: now)
        stamp_order_generation!(state, now)
        return
      end

      expired_slots = state["orders"].select { |order| order_expired?(order, now) }.map { |order| order["slot"].to_i }
      return if expired_slots.empty?

      state["orders"].reject! { |order| expired_slots.include?(order["slot"].to_i) }
      expired_slots.each { |slot| replace_order_for_slot!(state, slot, generated_at: now) }
      stamp_order_generation!(state, now)
    end

    def replace_order_for_slot!(state, slot, generated_at: Time.now.utc)
      state["order_generation_index"] = state["order_generation_index"].to_i + 1
      replacement = generate_order_for_slot(state, slot, generated_at: generated_at)
      state["orders"] << replacement
      state["orders"].sort_by! { |order| order["slot"].to_i }
      stamp_order_generation!(state, generated_at) unless state["orders_generated_at"]
      replacement
    end

    def stamp_order_generation!(state, generated_at)
      state["orders_generated_at"] = generated_at.iso8601
      state["orders_refresh_due_at"] = (generated_at + (order_generator.fetch("refresh_cadence_hours").to_i * 3600)).iso8601
    end

    def generate_order_for_slot(state, slot, generated_at:)
      tier = player_tier(state)
      recipes = recipe_list.select { |recipe| recipe["progression_tier"].to_i <= tier && state["unlocked_machine_ids"].include?(recipe["machine_id"]) }
      recipes = recipe_list.select { |recipe| recipe["progression_tier"].to_i <= tier } if recipes.empty?
      raise "No valid recipes for player tier #{tier}" if recipes.empty?

      buyers = buyer_list.select { |buyer| buyer["unlock_tier"].to_i <= tier }
      buyers = [buyer_list.first].compact if buyers.empty?
      raise "No valid buyers for player tier #{tier}" if buyers.empty?

      generation = state["order_generation_index"].to_i
      seed = "order:#{generation}:#{slot}"
      recipe = deterministic_pick(recipes, "#{seed}:recipe")
      variant = deterministic_pick(variant_list, "#{seed}:variant")
      buyer = deterministic_pick(buyers, "#{seed}:buyer")
      quantity = deterministic_range(order_generator.fetch("quantity_by_tier").fetch(recipe["progression_tier"].to_i), "#{seed}:quantity")
      deadline_days = order_deadline_days(recipe, variant, "#{seed}:deadline")
      required = required_materials(recipe, variant, quantity)
      windfall = deterministic_unit("#{seed}:windfall") < order_generator.dig("windfall", "chance").to_f
      price_multiplier = windfall ? windfall_multiplier("#{seed}:windfall_multiplier") : normal_price_multiplier("#{seed}:normal_price")
      payout = order_payout(required, recipe, variant, buyer, price_multiplier: price_multiplier)
      digest = Digest::SHA256.hexdigest("#{seed}:#{recipe['id']}:#{variant['id']}:#{buyer['id']}")[0, 10]

      {
        "order_id" => "order_#{generation}_#{slot + 1}_#{digest}",
        "slot" => slot,
        "status" => "active",
        "recipe_id" => recipe["id"],
        "product" => "#{variant['display_name']} #{recipe['display_name']}",
        "variant_id" => variant["id"],
        "buyer_id" => buyer["id"],
        "buyer" => buyer["display_name"],
        "quantity" => quantity,
        "required_materials" => required,
        "payout_space_bucks" => payout,
        "price_multiplier" => price_multiplier.round(4),
        "is_windfall" => windfall,
        "windfall_label" => windfall ? deterministic_pick(order_generator.fetch("windfall_labels"), "#{seed}:windfall_label") : nil,
        "deadline_days" => deadline_days,
        "expires_in_days" => deadline_days,
        "created_at" => generated_at.iso8601,
        "expires_at" => (generated_at + (deadline_days * 86_400)).iso8601
      }.compact
    end

    def order_payload(order, state)
      missing = missing_materials(order, state)
      order.merge(
        "can_fulfill" => missing.empty?,
        "missing_materials" => missing
      )
    end

    def missing_materials(order, state)
      inventory = state["inventory"] || {}
      (order["required_materials"] || {}).each_with_object({}) do |(material_id, quantity), missing|
        available = inventory[material_id].to_i
        needed = quantity.to_i
        missing[material_id] = needed - available if available < needed
      end
    end

    def order_expired?(order, now)
      expires_at = parse_time(order["expires_at"])
      expires_at && expires_at <= now
    end

    def order_deadline_days(recipe, variant, seed)
      config = order_generator.fetch("deadline_days_by_tier").fetch(recipe["progression_tier"].to_i)
      base_days = deterministic_range(config, seed)
      [(base_days * variant["deadline_multiplier"].to_f).ceil, 1].max
    end

    def normal_price_multiplier(seed)
      config = order_generator.fetch("normal_price_variation")
      low = config.fetch("min").to_f
      mode = config.fetch("mode").to_f
      high = config.fetch("max").to_f
      first = low + ((mode - low) * deterministic_unit("#{seed}:a"))
      second = mode + ((high - mode) * deterministic_unit("#{seed}:b"))
      (first + second) / 2.0
    end

    def windfall_multiplier(seed)
      config = order_generator.fetch("windfall")
      min = config.fetch("min_multiplier").to_f
      max = config.fetch("max_multiplier").to_f
      min + ((max - min) * deterministic_unit(seed))
    end

    def deterministic_pick(items, seed)
      items[(deterministic_unit(seed) * items.length).floor.clamp(0, items.length - 1)]
    end

    def deterministic_range(config, seed)
      min = config.fetch("min").to_i
      max = config.fetch("max").to_i
      return min if min >= max

      min + (deterministic_unit(seed) * (max - min + 1)).floor
    end

    def player_tier(state)
      asteroid_tiers = (state["unlocked_asteroid_class_ids"] || []).map do |asteroid_id|
        asteroid_by_id.dig(asteroid_id, "unlock_tier").to_i
      end
      [asteroid_tiers.max.to_i, 1].max
    end

    def parse_time(value)
      return nil if value.to_s.empty?

      Time.parse(value.to_s)
    rescue ArgumentError
      nil
    end

    def next_milestone_target(mined, depletion_size)
      return nil unless depletion_size.positive?
      return nil if mined >= depletion_size

      next_target = ((mined / MILESTONE_INTERVAL) + 1) * MILESTONE_INTERVAL
      [next_target, depletion_size].min
    end

    def load_materialized_state
      state_payload, state_existed, state_was_corrupt = read_state_file
      had_journal_metadata = state_payload.is_a?(Hash) && state_payload["journal"].is_a?(Hash)
      migrated_state_payload, state_was_migrated = state_payload ? migrate_state_payload(state_payload) : [nil, false]
      current_state = migrated_state_payload ? normalize_state(migrated_state_payload) : initial_state
      entries = read_journal_entries
      materialized_changed = state_was_corrupt || state_was_migrated || (state_existed && !had_journal_metadata)

      if state_existed && entries.empty? && (!had_journal_metadata || !File.exist?(journal_path))
        snapshot = migration_snapshot_entry(current_state)
        append_journal_entry(snapshot)
        entries = [snapshot]
        materialized_changed = true
      end

      if !state_existed
        if entries.any?
          current_state = replay_journal_state(entries)
          materialized_changed = true
        end
      elsif entries.any? && had_journal_metadata
        applied_count = current_state.dig("journal", "applied_event_count").to_i
        applied_count = entries.length if applied_count > entries.length
        if applied_count < entries.length
          entries.drop(applied_count).each { |entry| apply_journal_entry(current_state, entry) }
          materialized_changed = true
        end
      end

      if @last_recovery
        current_state["last_recovery"] = @last_recovery
        materialized_changed = true
      end

      sync_journal_metadata(current_state, entries)
      atomic_write_state(current_state) if materialized_changed
      current_state
    end

    def migrate_state_payload(state_payload)
      from_version = state_payload["state_schema_version"].to_i
      return [state_payload, false] if from_version >= CURRENT_STATE_SCHEMA_VERSION

      backup_path = backup_state_for_migration(from_version)
      migrated = deep_copy(state_payload)
      migrated["state_schema_version"] = CURRENT_STATE_SCHEMA_VERSION
      migrated["last_migration"] = {
        "from_state_schema_version" => from_version,
        "to_state_schema_version" => CURRENT_STATE_SCHEMA_VERSION,
        "backup_file" => backup_path && File.basename(backup_path),
        "created_at" => Time.now.utc.iso8601
      }
      [migrated, true]
    end

    def backup_state_for_migration(from_version)
      return nil unless File.exist?(state_path)

      backup_path = "#{state_path}.backup-v#{from_version}-to-v#{CURRENT_STATE_SCHEMA_VERSION}-#{Time.now.utc.strftime('%Y%m%d%H%M%S')}-#{Process.pid}"
      FileUtils.cp(state_path, backup_path)
      warn "MCP Miner state file backed up before migration to schema #{CURRENT_STATE_SCHEMA_VERSION}: #{backup_path}"
      backup_path
    end

    def read_state_file
      return [nil, false, false] unless File.exist?(state_path)

      payload = JSON.parse(File.read(state_path))
      raise JSON::ParserError, "state root is not an object" unless payload.is_a?(Hash)

      [payload, true, false]
    rescue JSON::ParserError => e
      backup_corrupt_file(state_path, "state", e)
      [nil, false, true]
    end

    def read_journal_entries
      return [] unless File.exist?(journal_path)

      entries = []
      File.foreach(journal_path).with_index do |line, index|
        next if line.strip.empty?

        entry = JSON.parse(line)
        raise JSON::ParserError, "journal line #{index + 1} is not an object" unless entry.is_a?(Hash)

        entries << entry
      end
      entries
    rescue JSON::ParserError => e
      backup_corrupt_file(journal_path, "journal", e)
      []
    end

    def append_journal_entry(entry)
      FileUtils.mkdir_p(File.dirname(journal_path))
      File.open(journal_path, File::WRONLY | File::APPEND | File::CREAT, 0o600) do |file|
        file.flock(File::LOCK_EX)
        file.write(JSON.generate(entry))
        file.write("\n")
        file.flush
        file.fsync
      end
    end

    def reward_journal_event_id(dedupe_key)
      "evt_#{Digest::SHA256.hexdigest(dedupe_key)[0, 16]}"
    end

    def reward_journal_entry(event_id, event_type, score, reward, turn_id:, session_id:, project_id:, agent_id:)
      {
        "event_id" => event_id,
        "event_type" => event_type,
        "timestamp" => Time.now.utc.iso8601,
        "session_id" => optional_string(session_id),
        "turn_id" => safe_string(turn_id),
        "privacy_class" => "abstract",
        "score" => score.to_f,
        "rewards" => {
          "chonks" => reward.fetch(:chonks).to_i,
          "materials" => reward.fetch(:materials).transform_values(&:to_i),
          "asteroid_class_id" => reward.fetch(:asteroid_class_id),
          "asteroid_mined_delta" => reward.fetch(:asteroid_mined_delta).to_i,
          "suit_damage" => reward.fetch(:suit_damage).to_i
        },
        "project_id" => optional_string(project_id),
        "agent_id" => optional_string(agent_id)
      }.compact
    end

    def apply_journal_entry(state, entry)
      normalize_state(state)
      if entry["event_type"] == "state_snapshot"
        apply_snapshot_journal_entry(state, entry)
      elsif work_event_by_id.key?(safe_string(entry["event_type"]))
        apply_reward_journal_entry(state, entry)
      end
      state
    end

    def apply_reward_journal_entry(state, entry)
      dedupe_key = safe_string(entry["event_id"])
      event_type = safe_string(entry["event_type"])
      return if dedupe_key.empty? || state["dedupe_keys"].include?(dedupe_key)
      return unless work_event_by_id.key?(event_type)

      score = entry["score"].to_f
      rewards = entry["rewards"].is_a?(Hash) ? entry["rewards"] : {}
      materials = rewards["materials"].is_a?(Hash) ? rewards["materials"] : {}
      chonks = rewards["chonks"].to_i
      mined_delta = rewards["asteroid_mined_delta"].to_i
      suit_damage = rewards["suit_damage"].to_i
      timestamp = safe_string(entry["timestamp"])

      ensure_turn(state, safe_string(entry["turn_id"]))
      state["dedupe_keys"] << dedupe_key
      state["dedupe_keys"] = state["dedupe_keys"].last(MAX_DEDUPE_KEYS)

      state["inventory"]["mat_chonks"] = state["inventory"]["mat_chonks"].to_i + chonks
      materials.each do |material_id, quantity|
        next unless material_by_id.key?(material_id)

        state["inventory"][material_id] = state["inventory"][material_id].to_i + quantity.to_i
      end

      state["asteroid_progress"]["asteroid_class_id"] = safe_string(rewards["asteroid_class_id"]) unless rewards["asteroid_class_id"].to_s.empty?
      state["asteroid_progress"]["mined"] = state["asteroid_progress"]["mined"].to_i + mined_delta
      state["suit_condition"] = [state["suit_condition"].to_i - suit_damage, 0].max

      turn = state["current_turn"]
      turn["score"] = (turn["score"].to_f + score).round(2)
      turn["chonks"] = turn["chonks"].to_i + chonks
      materials.each do |material_id, quantity|
        next unless material_by_id.key?(material_id)

        turn["materials"][material_id] = turn["materials"][material_id].to_i + quantity.to_i
      end
      turn["events"][event_type] = turn["events"][event_type].to_i + 1

      add_stat_event(state, event_type, score)
      unless event_type == "work_user_prompt"
        state["stats"]["tool_events_seen"] = state["stats"]["tool_events_seen"].to_i + 1
      end
      state["stats"]["chonks_mined_total"] = state["stats"]["chonks_mined_total"].to_i + chonks
      state["stats"]["materials_found_total"] = state["stats"]["materials_found_total"].to_i + materials.values.sum(&:to_i)

      apply_project_journal_activity(state, entry["project_id"], event_type, safe_string(entry["turn_id"]), timestamp)
      apply_agent_journal_activity(state, entry["agent_id"], event_type, timestamp)
    end

    def apply_project_journal_activity(state, project_id, event_type, turn_id, timestamp)
      project_key = optional_string(project_id)
      return unless project_key&.start_with?("project_")

      project = state["project_stats"][project_key] ||= {
        "turns" => {},
        "work_events" => {},
        "last_seen_at" => nil
      }
      project["turns"][turn_id] = true
      project["work_events"][event_type] = project["work_events"][event_type].to_i + 1
      project["last_seen_at"] = timestamp unless timestamp.empty?
    end

    def apply_agent_journal_activity(state, agent_id, event_type, timestamp)
      agent_key = optional_string(agent_id)
      return unless agent_key&.start_with?("agent_")

      agent = state["agent_stats"][agent_key] ||= {
        "agent_type" => "unknown",
        "starts" => 0,
        "stops" => 0,
        "work_events" => {},
        "last_seen_at" => nil
      }
      agent["work_events"][event_type] = agent["work_events"][event_type].to_i + 1
      agent["last_seen_at"] = timestamp unless timestamp.empty?
    end

    def apply_snapshot_journal_entry(state, entry)
      snapshot = entry["state"].is_a?(Hash) ? entry["state"] : {}
      snapshot.each do |key, value|
        next if key == "journal"

        state[key] = deep_copy(value)
      end
      normalize_state(state)
    end

    def migration_snapshot_entry(state)
      {
        "event_id" => "evt_snapshot_#{Digest::SHA256.hexdigest(JSON.generate(snapshot_state(state)))[0, 16]}",
        "event_type" => "state_snapshot",
        "timestamp" => Time.now.utc.iso8601,
        "privacy_class" => "abstract",
        "score" => 0.0,
        "rewards" => {},
        "state" => snapshot_state(state)
      }
    end

    def snapshot_state(state)
      keys = %w[
        state_schema_version
        space_bucks
        inventory
        unlocked_machine_ids
        unlocked_asteroid_class_ids
        current_asteroid_class_id
        upgrades
        base_modules
        report_mode
        cloud_sync
        orders
        completed_orders
        orders_generated_at
        orders_refresh_due_at
        order_generation_index
        suit_condition
        asteroid_progress
        stats
        project_stats
        agent_stats
        dedupe_keys
        current_turn
        latest_report
        last_migration
        last_recovery
        last_session_id
        last_seen_at
        created_at
      ]
      keys.each_with_object({}) do |key, payload|
        payload[key] = deep_copy(state[key]) if state.key?(key)
      end
    end

    def sync_journal_metadata(state, entries = nil)
      entries ||= read_journal_entries
      last_event_id = entries.reverse_each.find { |entry| entry["event_id"] }&.fetch("event_id", nil)
      state["journal"] = default_journal_metadata.merge(state["journal"] || {})
      state["journal"]["path"] = journal_path
      state["journal"]["applied_event_count"] = entries.length
      state["journal"]["last_event_id"] = last_event_id
    end

    def default_journal_metadata
      {
        "path" => journal_path,
        "applied_event_count" => 0,
        "last_event_id" => nil
      }
    end

    def backup_corrupt_file(path, label, error)
      return unless File.exist?(path)

      timestamp = Time.now.utc.iso8601
      backup_path = "#{path}.corrupt-#{Time.now.utc.strftime('%Y%m%d%H%M%S')}-#{Process.pid}"
      FileUtils.mv(path, backup_path)
      @last_recovery = {
        "type" => "#{label}_corrupt_backup",
        "backup_file" => File.basename(backup_path),
        "message" => "MCP Miner #{label} file was corrupt; a backup was written and local state was recovered or reset.",
        "created_at" => timestamp
      }
      warn "MCP Miner #{label} file was corrupt; backed up to #{backup_path}: #{error.message}"
      backup_path
    end

    def optional_string(value)
      text = safe_string(value)
      text.empty? ? nil : text
    end

    def deep_copy(value)
      JSON.parse(JSON.generate(value))
    end

    def atomic_write_state(next_state)
      tmp_path = "#{state_path}.tmp"
      File.open(tmp_path, "w", 0o600) do |file|
        file.write(JSON.pretty_generate(next_state))
        file.flush
        file.fsync
      end
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

    def report_template_key(state, mode)
      return "milestone" if milestone_turn?(state) && %w[meaningful_turns_only milestones_only].include?(mode)
      return "full" if mode == "every_turn_full" || mode == "session_summary_only"
      return "no_progress" unless turn_progress?(state["current_turn"] || {})
      return "order_progress" if has_active_orders?(state) && order_progress_percent(state).positive?

      "compact"
    end

    def report_template(key)
      @data.dig(:reports, key)&.first ||
        @data.dig(:reports, "compact")&.first ||
        "#{REPORT_PREFIX} +{chonks} Chonks, {material_summary}, {order_summary}."
    end

    def report_values(state, turn)
      asteroid = asteroid_for(state)
      {
        "chonks" => turn["chonks"].to_i,
        "highlight" => highlight(turn),
        "material_summary" => material_summary(turn["materials"]),
        "order_summary" => order_summary(state),
        "suit_condition" => state["suit_condition"].to_i,
        "asteroid_name" => asteroid["display_name"],
        "space_bucks" => state["space_bucks"].to_i,
        "order_percent" => order_progress_percent(state),
        "time_remaining" => order_time_remaining(state),
        "milestone_summary" => milestone_summary(state)
      }
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

    def turn_progress?(turn)
      turn["score"].to_f.positive? ||
        turn["chonks"].to_i.positive? ||
        (turn["materials"] || {}).values.sum(&:to_i).positive?
    end

    def order_summary(state)
      order = first_active_order(state)
      return "orders waiting" unless order

      "#{order_progress_percent(state)}% toward #{order['product'] || order['order_id']}"
    end

    def order_progress_percent(state)
      order = first_active_order(state)
      return 0 unless order

      required = order["required_materials"] || {}
      total_required = required.values.sum(&:to_i)
      return 0 unless total_required.positive?

      inventory = state["inventory"] || {}
      filled = required.sum do |material_id, quantity|
        [inventory[material_id].to_i, quantity.to_i].min
      end
      [((filled.to_f / total_required) * 100).floor, 100].min
    end

    def order_time_remaining(state)
      order = first_active_order(state)
      return "time unknown" unless order

      days = order["expires_in_days"].to_i
      days.positive? ? "#{days} days" : "time unknown"
    end

    def has_active_orders?(state)
      !!first_active_order(state)
    end

    def first_active_order(state)
      orders = state["orders"].is_a?(Array) ? state["orders"] : []
      orders.first
    end

    def milestone_summary(state)
      milestones = milestone_status_payload(state).fetch(:milestones)
      progress = milestones.fetch(:progress)
      "#{milestones.dig(:current_asteroid, :display_name)} #{progress[:mined]}/#{progress[:depletion_size]} mined (#{progress[:percent_complete]}%)"
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
      turn = state["current_turn"] || {}
      turn_mined = turn["chonks"].to_i + (turn["materials"] || {}).values.sum(&:to_i)
      previous_mined = [mined - turn_mined, 0].max
      mined.positive? &&
        turn_mined.positive? &&
        (mined / MILESTONE_INTERVAL) > (previous_mined / MILESTONE_INTERVAL)
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
