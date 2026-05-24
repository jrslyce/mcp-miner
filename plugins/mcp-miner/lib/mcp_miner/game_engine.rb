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
      base_modules: ["base_modules.yaml", "base_modules"],
      player_start: ["player_start.yaml", "player_start"],
      balance: ["balance_constants.yaml", "balance"],
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
        "profile" => default_profile,
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
        "market_sale_index" => 0,
        "market_transactions" => [],
        "fabrication_queue" => [],
        "completed_products" => [],
        "fabrication_sequence" => 0,
        "suit_condition" => 100,
        "asteroid_progress" => {
          "asteroid_class_id" => start.fetch("current_asteroid_class_id"),
          "mined" => 0
        },
        "asteroid_progress_by_id" => {
          start.fetch("current_asteroid_class_id") => {
            "asteroid_class_id" => start.fetch("current_asteroid_class_id"),
            "mined" => 0
          }
        },
        "rare_find_pity_score" => 0.0,
        "asteroid_depletions" => [],
        "hazard_log" => [],
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
      state["profile"] = default_profile.merge(state["profile"].is_a?(Hash) ? state["profile"] : {})
      state["profile"]["customization_unlocks"] ||= []
      state["profile"]["generated_assets"] ||= []
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
      state["asteroid_progress_by_id"] ||= {}
      progress_id = state["asteroid_progress"]["asteroid_class_id"] || state["current_asteroid_class_id"] || start.fetch("current_asteroid_class_id")
      state["asteroid_progress_by_id"][progress_id] ||= {
        "asteroid_class_id" => progress_id,
        "mined" => state["asteroid_progress"]["mined"].to_i
      }
      state["rare_find_pity_score"] = state["rare_find_pity_score"].to_f
      state["asteroid_depletions"] ||= []
      state["hazard_log"] ||= []
      state["stats"] = default_stats.merge(state["stats"] || {})
      state["stats"]["work_events"] ||= {}
      state["project_stats"] ||= {}
      state["agent_stats"] ||= {}
      state["dedupe_keys"] ||= []
      state["current_turn"] = nil unless state["current_turn"].is_a?(Hash)
      state["orders"] ||= []
      state["completed_orders"] ||= []
      state["order_generation_index"] = state["order_generation_index"].to_i
      state["market_sale_index"] = state["market_sale_index"].to_i
      state["market_transactions"] ||= []
      state["fabrication_queue"] ||= []
      state["completed_products"] ||= []
      state["fabrication_sequence"] = state["fabrication_sequence"].to_i
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

    def default_profile
      {
        "display_name" => "Local Prospector",
        "miner_name" => "Prospector",
        "pronouns" => nil,
        "suit_style" => "cozy sci-fi asteroid miner",
        "avatar_concept_prompt" => "A cozy sci-fi asteroid miner in a practical patched pressure suit, warm helmet lights, compact tool harness, friendly dashboard portrait style.",
        "generated_assets" => [],
        "customization_unlocks" => ["suit_patch_basic", "helmet_lamp_warm"],
        "cloud_sync" => false
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
      materials_result = weighted_materials(state, asteroid, score, turn_id: turn_id, event_id: event_id)
      hazard = hazard_result(event_id, asteroid, state, seed: "#{turn_id}:#{event_id}:hazard")

      {
        chonks: chonks,
        materials: materials_result.fetch(:materials),
        asteroid_class_id: asteroid["id"],
        asteroid_mined_delta: chonks + materials_result.fetch(:materials).values.sum,
        suit_damage: hazard.fetch(:suit_damage),
        rare_find: materials_result.fetch(:rare_find),
        rare_find_chance: materials_result.fetch(:rare_find_chance),
        hazard: hazard.fetch(:hazard)
      }
    end

    def weighted_materials(state, asteroid, score, turn_id:, event_id:)
      units = [[(score / 4.0).floor, 1].max, 8].min
      weights = asteroid.fetch("composition")
      materials = Hash.new(0)
      rare_found = false
      chance = rare_find_chance(state, asteroid, event_id: event_id)

      units.times do |index|
        seed = "#{turn_id}:#{state.dig('stats', 'work_score_total')}:#{event_id}:#{index}"
        material_id = if deterministic_unit("#{seed}:rare") < chance
                        rare_found = true
                        pick_weighted(rare_composition(weights), "#{seed}:rare_pick")
                      else
                        pick_weighted(weights, seed)
                      end
        next if material_id == "mat_chonks"

        materials[material_id] += 1
      end

      {
        materials: materials,
        rare_find: rare_found,
        rare_find_chance: chance.round(4)
      }
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
        profile: profile_payload(current_state)[:profile],
        inventory: current_state["inventory"],
        current_asteroid: asteroid_summary(current_state["current_asteroid_class_id"]),
        asteroid_progress: current_state["asteroid_progress"] || {},
        unlocked_machines: current_state["unlocked_machine_ids"].map { |machine_id| machine_name(machine_id) },
        upgrades: current_state["upgrades"],
        base: {
          modules: base_module_list.map { |mod| base_module_status(mod, current_state) },
          effects: base_effects_payload(current_state),
          drone_automation: drone_automation_payload(current_state)
        },
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

    def asteroid_status_payload(current_state = state)
      current_id = asteroid_for(current_state)["id"]
      {
        current_asteroid: asteroid_status_for(asteroid_by_id.fetch(current_id), current_state),
        asteroids: asteroid_list.map { |asteroid| asteroid_status_for(asteroid, current_state) },
        rare_find_pity: {
          score: current_state["rare_find_pity_score"].to_f.round(2),
          config: balance_config.fetch("pity")
        },
        recent_depletions: current_state["asteroid_depletions"] || [],
        recent_hazards: current_state["hazard_log"] || [],
        privacy: PRIVACY_NOTICE
      }
    end

    def select_asteroid_payload(args)
      asteroid_id = safe_string(args["asteroid_id"])
      asteroid = asteroid_by_id[asteroid_id]
      return unknown_asteroid_payload(asteroid_id) unless asteroid

      with_state do |current_state|
        unless (current_state["unlocked_asteroid_class_ids"] || []).include?(asteroid_id)
          next {
            ok: false,
            status: "locked",
            asteroid: asteroid_summary(asteroid_id),
            required_unlock_tier: asteroid["unlock_tier"],
            unlocked_asteroid_class_ids: current_state["unlocked_asteroid_class_ids"],
            privacy: PRIVACY_NOTICE
          }
        end

        persist_current_asteroid_progress!(current_state)
        progress = current_state["asteroid_progress_by_id"][asteroid_id] ||= {
          "asteroid_class_id" => asteroid_id,
          "mined" => 0
        }
        current_state["current_asteroid_class_id"] = asteroid_id
        current_state["asteroid_progress"] = progress.dup

        {
          ok: true,
          status: "selected",
          current_asteroid: asteroid_status_for(asteroid, current_state),
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def fabrication_status_payload(current_state = state)
      {
        machines: machine_list.map { |machine| machine_status(machine, current_state) },
        queue: (current_state["fabrication_queue"] || []).map { |item| fabrication_item_payload(item) },
        completed_products: current_state["completed_products"] || [],
        throughput_multiplier: upgrade_effect_by_id("upgrade_fabricator_throughput", current_state.dig("upgrades", "upgrade_fabricator_throughput").to_i),
        privacy: PRIVACY_NOTICE
      }
    end

    def base_status_payload(current_state = state)
      {
        modules: base_module_list.map { |mod| base_module_status(mod, current_state) },
        effects: base_effects_payload(current_state),
        drone_automation: drone_automation_payload(current_state),
        privacy: PRIVACY_NOTICE
      }
    end

    def purchase_base_module_payload(args)
      module_id = safe_string(args["module_id"])
      mod = base_module_by_id[module_id]
      return unknown_base_module_payload(module_id) unless mod

      with_state do |current_state|
        status = base_module_status(mod, current_state)
        if status[:is_maxed]
          next {
            ok: false,
            status: "max_level",
            module: status,
            privacy: PRIVACY_NOTICE
          }
        end
        unless status[:prerequisites_met]
          next {
            ok: false,
            status: "missing_prerequisites",
            missing_required_modules: status[:missing_required_modules],
            module: status,
            privacy: PRIVACY_NOTICE
          }
        end

        missing_space_bucks = status[:missing_space_bucks].to_i
        missing_materials = status[:missing_materials] || {}
        if missing_space_bucks.positive? || !missing_materials.empty?
          next {
            ok: false,
            status: missing_space_bucks.positive? && !missing_materials.empty? ? "insufficient_resources" : (missing_space_bucks.positive? ? "insufficient_space_bucks" : "insufficient_materials"),
            missing_space_bucks: missing_space_bucks,
            missing_materials: missing_materials,
            module: status,
            privacy: PRIVACY_NOTICE
          }
        end

        cost = status.fetch(:cost_to_next)
        current_state["space_bucks"] = current_state["space_bucks"].to_i - cost.fetch(:space_bucks).to_i
        cost.fetch(:materials).each do |material_id, quantity|
          current_state["inventory"][material_id] = current_state["inventory"][material_id].to_i - quantity.to_i
        end
        current_state["base_modules"][module_id] = status.fetch(:level).to_i + 1

        {
          ok: true,
          status: "purchased",
          module_id: module_id,
          display_name: mod["display_name"],
          previous_level: status.fetch(:level),
          new_level: current_state["base_modules"][module_id],
          spent: cost,
          space_bucks: current_state["space_bucks"].to_i,
          module: base_module_status(mod, current_state),
          effects: base_effects_payload(current_state),
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def profile_payload(current_state = state)
      {
        profile: current_state["profile"] || default_profile,
        avatar_workflow: {
          image_generation_required: false,
          prompt_ready: true,
          default_style: "cozy sci-fi asteroid miner",
          privacy: "Local profile fields only; no cloud sync is required."
        },
        privacy: PRIVACY_NOTICE
      }
    end

    def update_profile_payload(args)
      with_state do |current_state|
        profile = default_profile.merge(current_state["profile"] || {})
        updatable_profile_fields.each do |field|
          next unless args.key?(field)

          profile[field] = normalize_profile_value(field, args[field])
        end
        if args.key?("add_customization_unlock")
          unlock = safe_string(args["add_customization_unlock"])
          profile["customization_unlocks"] << unlock unless unlock.empty? || profile["customization_unlocks"].include?(unlock)
        end
        if args.key?("generated_asset_ref")
          asset_ref = safe_string(args["generated_asset_ref"])
          unless asset_ref.empty?
            profile["generated_assets"] << {
              "asset_ref" => asset_ref,
              "created_at" => Time.now.utc.iso8601
            }
            profile["generated_assets"] = profile["generated_assets"].last(20)
          end
        end
        current_state["profile"] = profile

        {
          ok: true,
          status: "updated",
          profile: profile,
          avatar_workflow: profile_payload(current_state)[:avatar_workflow],
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def queue_fabrication_payload(args)
      recipe_id = safe_string(args["recipe_id"])
      variant_id = safe_string(args["variant_id"])
      variant_id = "order_variant_standard_batch" if variant_id.empty?
      quantity = args["quantity"].to_i
      quantity = 1 if quantity <= 0

      recipe = recipe_by_id[recipe_id]
      return unknown_recipe_payload(recipe_id) unless recipe
      variant = variant_by_id[variant_id]
      return unknown_variant_payload(variant_id) unless variant
      machine = machine_by_id.fetch(recipe.fetch("machine_id"))

      with_state do |current_state|
        unless machine_unlocked?(machine, current_state)
          next {
            ok: false,
            status: "machine_locked",
            machine: machine_status(machine, current_state),
            privacy: PRIVACY_NOTICE
          }
        end

        queued_for_machine = current_state["fabrication_queue"].count { |item| item["machine_id"] == machine["id"] }
        if queued_for_machine >= machine_queue_size(machine, current_state)
          next {
            ok: false,
            status: "queue_full",
            machine: machine_status(machine, current_state),
            privacy: PRIVACY_NOTICE
          }
        end

        quality_grade = variant["quality_grade_required"].to_i
        if quality_grade.positive? && !recipe["quality_allowed"]
          next fabrication_quality_error("recipe_quality_locked", recipe, variant, machine)
        end
        if quality_grade > machine.dig("quality", "max_quality_grade").to_i
          next fabrication_quality_error("quality_exceeds_machine", recipe, variant, machine)
        end

        required = required_materials(recipe, variant, quantity)
        missing = missing_materials({ "required_materials" => required }, current_state)
        unless missing.empty?
          next {
            ok: false,
            status: "insufficient_materials",
            missing_materials: missing,
            required_materials: required,
            privacy: PRIVACY_NOTICE
          }
        end

        required.each do |material_id, needed|
          current_state["inventory"][material_id] = current_state["inventory"][material_id].to_i - needed.to_i
        end
        current_state["fabrication_sequence"] = current_state["fabrication_sequence"].to_i + 1
        item = build_fabrication_item(
          current_state["fabrication_sequence"],
          recipe,
          variant,
          machine,
          quantity,
          required
        )
        current_state["fabrication_queue"] << item

        {
          ok: true,
          status: "queued",
          item: fabrication_item_payload(item),
          consumed_materials: required,
          machine: machine_status(machine, current_state),
          privacy: PRIVACY_NOTICE
        }
      end
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
        base_modules: base_module_list.length,
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
          active_order_slots: active_order_slots_for(current_state),
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

        completed_product = completed_product_for_order(order, current_state)
        if completed_product
          consume_completed_product!(current_state, completed_product, order["quantity"].to_i)
          current_state["space_bucks"] = current_state["space_bucks"].to_i + order["payout_space_bucks"].to_i
          fulfilled_at = Time.now.utc.iso8601
          completed_order = order.merge(
            "status" => "fulfilled",
            "fulfilled_at" => fulfilled_at,
            "fulfilled_by" => "completed_product"
          )
          current_state["completed_orders"] << completed_order
          current_state["completed_orders"] = current_state["completed_orders"].last(50)
          current_state["orders"].delete_if { |candidate| candidate["order_id"] == order_id }
          replacement = replace_order_for_slot!(current_state, order["slot"].to_i)

          next {
            ok: true,
            status: "fulfilled",
            order: completed_order,
            consumed_product: completed_product_key(order["recipe_id"], order["variant_id"], completed_product["quality_grade"].to_i),
            payout_space_bucks: order["payout_space_bucks"].to_i,
            space_bucks: current_state["space_bucks"].to_i,
            replacement_order: order_payload(replacement, current_state),
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

    def refine_material_payload(args)
      material_id = safe_string(args["material_id"])
      quantity = args["quantity"].to_i
      return invalid_quantity_payload(quantity) if quantity <= 0

      material = material_by_id[material_id]
      return unknown_material_payload(material_id) unless material

      unless material["can_refine"] && material["refined_space_bucks"].to_i.positive?
        return {
          ok: false,
          status: "not_refinable",
          material_id: material_id,
          material: material_payload(material_id),
          reason: "#{material['display_name']} cannot be refined.",
          privacy: PRIVACY_NOTICE
        }
      end

      refined_id = refined_material_id(material_id)
      with_state do |current_state|
        available = current_state["inventory"][material_id].to_i
        if available < quantity
          next insufficient_inventory_payload(material_id, quantity, available)
        end

        refinery_multiplier = upgrade_effect_by_id("upgrade_refinery_purity", current_state.dig("upgrades", "upgrade_refinery_purity").to_i)
        produced_quantity = [(quantity * refinery_multiplier).floor, quantity].max
        current_state["inventory"][material_id] = available - quantity
        current_state["inventory"][refined_id] = current_state["inventory"][refined_id].to_i + produced_quantity

        {
          ok: true,
          status: "refined",
          material: material_payload(material_id),
          raw_material_id: material_id,
          refined_material_id: refined_id,
          quantity: quantity,
          consumed: {
            material_id => quantity
          },
          produced: {
            refined_id => produced_quantity
          },
          inventory: {
            material_id => current_state["inventory"][material_id].to_i,
            refined_id => current_state["inventory"][refined_id].to_i
          },
          refinery_multiplier: refinery_multiplier,
          raw_space_bucks_each: material["raw_space_bucks"].to_i,
          refined_space_bucks_each: material["refined_space_bucks"].to_i,
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def sell_material_payload(args)
      material_id = safe_string(args["material_id"])
      quantity = args["quantity"].to_i
      return invalid_quantity_payload(quantity) if quantity <= 0

      inventory_material = inventory_material_info(material_id)
      return unknown_material_payload(material_id) unless inventory_material[:material]
      unless inventory_material[:space_bucks_each].positive?
        return {
          ok: false,
          status: "not_sellable",
          material_id: material_id,
          reason: "#{inventory_material[:display_name]} has no market value.",
          privacy: PRIVACY_NOTICE
        }
      end

      with_state do |current_state|
        available = current_state["inventory"][material_id].to_i
        if available < quantity
          next insufficient_inventory_payload(material_id, quantity, available)
        end

        sale_index = current_state["market_sale_index"].to_i
        multiplier = direct_market_multiplier("market:#{sale_index}:#{material_id}:#{quantity}")
        payout = direct_market_payout(inventory_material[:space_bucks_each], quantity, multiplier)
        sold_at = Time.now.utc.iso8601

        current_state["inventory"][material_id] = available - quantity
        current_state["space_bucks"] = current_state["space_bucks"].to_i + payout
        current_state["market_sale_index"] = sale_index + 1
        transaction = {
          "type" => "direct_market_sale",
          "material_id" => material_id,
          "quantity" => quantity,
          "space_bucks_each" => inventory_material[:space_bucks_each],
          "market_multiplier" => multiplier.round(4),
          "payout_space_bucks" => payout,
          "sold_at" => sold_at
        }
        current_state["market_transactions"] << transaction
        current_state["market_transactions"] = current_state["market_transactions"].last(50)

        {
          ok: true,
          status: "sold",
          sale: transaction,
          material: material_payload(inventory_material[:base_material_id], refined: inventory_material[:refined]),
          consumed: {
            material_id => quantity
          },
          inventory: {
            material_id => current_state["inventory"][material_id].to_i
          },
          space_bucks: current_state["space_bucks"].to_i,
          direct_market: direct_market_config,
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def upgrade_status_payload(current_state = state)
      {
        upgrades: upgrade_list.map { |upgrade| upgrade_status(upgrade, current_state) },
        balance: {
          upgrade_phase: balance_config.fetch("upgrade_phase")
        },
        privacy: PRIVACY_NOTICE
      }
    end

    def purchase_upgrade_payload(args)
      upgrade_id = safe_string(args["upgrade_id"])
      upgrade = upgrade_by_id[upgrade_id]
      return unknown_upgrade_payload(upgrade_id) unless upgrade

      with_state do |current_state|
        before = upgrade_status(upgrade, current_state)
        if before[:is_maxed]
          next {
            ok: false,
            status: "max_level",
            upgrade: before,
            privacy: PRIVACY_NOTICE
          }
        end

        missing_space_bucks = before[:missing_space_bucks].to_i
        missing_materials = before[:missing_materials] || {}
        if missing_space_bucks.positive? || !missing_materials.empty?
          next {
            ok: false,
            status: missing_space_bucks.positive? && !missing_materials.empty? ? "insufficient_resources" : (missing_space_bucks.positive? ? "insufficient_space_bucks" : "insufficient_materials"),
            missing_space_bucks: missing_space_bucks,
            missing_materials: missing_materials,
            upgrade: before,
            privacy: PRIVACY_NOTICE
          }
        end

        cost = before.fetch(:cost_to_next)
        current_state["space_bucks"] = current_state["space_bucks"].to_i - cost.fetch(:space_bucks).to_i
        cost.fetch(:materials).each do |material_id, quantity|
          current_state["inventory"][material_id] = current_state["inventory"][material_id].to_i - quantity.to_i
        end
        current_state["upgrades"][upgrade_id] = before.fetch(:level).to_i + 1
        after = upgrade_status(upgrade, current_state)

        {
          ok: true,
          status: "purchased",
          upgrade_id: upgrade_id,
          display_name: upgrade["display_name"],
          previous_level: before.fetch(:level),
          new_level: after.fetch(:level),
          spent: cost,
          space_bucks: current_state["space_bucks"].to_i,
          upgrade: after,
          privacy: PRIVACY_NOTICE
        }
      end
    end

    def generate_orders(state = initial_state, generated_at: Time.now.utc)
      slots = active_order_slots_for(state)
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

    def balance_config
      @data.fetch(:balance)
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

    def base_module_list
      @data.fetch(:base_modules)
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

        inventory_material = inventory_material_info(material_id)
        material = inventory_material[:material] || {}
        space_bucks_each = inventory_material[:space_bucks_each].to_i
        payload << {
          material_id: material_id,
          base_material_id: inventory_material[:base_material_id],
          display_name: inventory_material[:display_name],
          category: material["category"] || "unknown",
          rarity: material["rarity"] || "unknown",
          state_group: material["state_group"] || "unknown",
          refinement_state: inventory_material[:refined] ? "refined" : "raw",
          quantity: quantity,
          raw_space_bucks_each: material["raw_space_bucks"].to_i,
          refined_space_bucks_each: material["refined_space_bucks"]&.to_i,
          space_bucks_each: space_bucks_each,
          total_raw_space_bucks: space_bucks_each * quantity,
          total_space_bucks: space_bucks_each * quantity,
          can_refine: !inventory_material[:refined] && !!material["can_refine"]
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

    def inventory_material_info(material_id)
      refined = material_id.start_with?("refined:")
      base_material_id = refined ? material_id.sub(/^refined:/, "") : material_id
      material = material_by_id[base_material_id]
      space_bucks_each = if refined
                           material && material["refined_space_bucks"].to_i
                         else
                           material && material["raw_space_bucks"].to_i
                         end
      {
        material: material,
        base_material_id: base_material_id,
        refined: refined,
        display_name: material_display_name(base_material_id, refined: refined),
        space_bucks_each: space_bucks_each.to_i
      }
    end

    def material_payload(material_id, refined: false)
      material = material_by_id[material_id]
      return nil unless material

      {
        material_id: refined ? refined_material_id(material_id) : material_id,
        base_material_id: material_id,
        display_name: material_display_name(material_id, refined: refined),
        category: material["category"],
        rarity: material["rarity"],
        can_refine: !refined && !!material["can_refine"],
        raw_space_bucks_each: material["raw_space_bucks"].to_i,
        refined_space_bucks_each: material["refined_space_bucks"]&.to_i,
        space_bucks_each: refined ? material["refined_space_bucks"].to_i : material["raw_space_bucks"].to_i,
        refinement_state: refined ? "refined" : "raw"
      }
    end

    def material_display_name(material_id, refined:)
      material = material_by_id[material_id]
      name = material ? material["display_name"] : material_id
      refined ? "Refined #{name}" : name
    end

    def refined_material_id(material_id)
      "refined:#{material_id}"
    end

    def direct_market_config
      balance_config.fetch("direct_market")
    end

    def direct_market_multiplier(seed)
      config = direct_market_config
      min = config.fetch("min_multiplier").to_f
      max = config.fetch("max_multiplier").to_f
      min + ((max - min) * deterministic_unit(seed))
    end

    def direct_market_payout(space_bucks_each, quantity, multiplier)
      gross = space_bucks_each.to_i * quantity.to_i * multiplier.to_f
      [nice_round(gross).ceil, 1].max
    end

    def invalid_quantity_payload(quantity)
      {
        ok: false,
        status: "invalid_quantity",
        quantity: quantity,
        reason: "Quantity must be a positive integer.",
        privacy: PRIVACY_NOTICE
      }
    end

    def unknown_material_payload(material_id)
      {
        ok: false,
        status: "unknown_material",
        material_id: material_id,
        reason: "Material is not defined in materials.yaml.",
        privacy: PRIVACY_NOTICE
      }
    end

    def insufficient_inventory_payload(material_id, needed, available)
      {
        ok: false,
        status: "insufficient_inventory",
        material_id: material_id,
        needed: needed.to_i,
        available: available.to_i,
        missing: [needed.to_i - available.to_i, 0].max,
        privacy: PRIVACY_NOTICE
      }
    end

    def asteroid_status_for(asteroid, state)
      progress = asteroid_progress_for(asteroid["id"], state)
      mined = progress["mined"].to_i
      depletion_size = asteroid["depletion_size"].to_i
      {
        asteroid_class_id: asteroid["id"],
        display_name: asteroid["display_name"],
        unlock_tier: asteroid["unlock_tier"],
        unlocked: (state["unlocked_asteroid_class_ids"] || []).include?(asteroid["id"]),
        selected: state["current_asteroid_class_id"] == asteroid["id"],
        depletion: {
          mined: mined,
          depletion_size: depletion_size,
          remaining: [depletion_size - mined, 0].max,
          percent_complete: depletion_size.positive? ? ((mined.to_f / depletion_size) * 100).round(2) : 0.0
        },
        yield_multiplier: asteroid["yield_multiplier"].to_f,
        hazard_multiplier: asteroid["hazard_multiplier"].to_f,
        base_rare_rate: asteroid["base_rare_rate"].to_f,
        rare_find_chance: rare_find_chance(state, asteroid).round(4),
        composition: asteroid.fetch("composition").map do |entry|
          material = material_by_id.fetch(entry.fetch("material_id"))
          {
            material_id: material["id"],
            display_name: material["display_name"],
            rarity: material["rarity"],
            weight: entry["weight"].to_f
          }
        end
      }
    end

    def asteroid_progress_for(asteroid_id, state)
      if state["current_asteroid_class_id"] == asteroid_id
        state["asteroid_progress"] || { "asteroid_class_id" => asteroid_id, "mined" => 0 }
      else
        state.dig("asteroid_progress_by_id", asteroid_id) || { "asteroid_class_id" => asteroid_id, "mined" => 0 }
      end
    end

    def persist_current_asteroid_progress!(state)
      asteroid_id = state["current_asteroid_class_id"] || state.dig("asteroid_progress", "asteroid_class_id")
      return if asteroid_id.to_s.empty?

      state["asteroid_progress_by_id"][asteroid_id] = {
        "asteroid_class_id" => asteroid_id,
        "mined" => state.dig("asteroid_progress", "mined").to_i
      }
    end

    def rare_find_chance(state, asteroid, event_id: nil)
      pity = balance_config.fetch("pity")
      base = asteroid["base_rare_rate"].to_f
      pity_bonus = [state["rare_find_pity_score"].to_f, pity.fetch("max_score").to_f].min * pity.fetch("bonus_per_score").to_f
      scanner_bonus = [(upgrade_effect_by_id("upgrade_scanner_precision", state.dig("upgrades", "upgrade_scanner_precision").to_i) - 1.0) * 0.02, 0.05].min
      category_bonus = work_category_rare_bonus(event_id)
      [base + pity_bonus + scanner_bonus + category_bonus, pity.fetch("max_final_rare_chance").to_f].min
    end

    def work_category_rare_bonus(event_id)
      category = work_event_by_id.dig(event_id.to_s, "category")
      case category
      when "testing" then 0.01
      when "research" then 0.005
      when "review" then 0.004
      else 0.0
      end
    end

    def rare_composition(weights)
      rare_weights = weights.select do |entry|
        rare_upgrade_material?(material_by_id.fetch(entry.fetch("material_id")))
      end
      rare_weights.empty? ? weights : rare_weights
    end

    def hazard_result(event_id, asteroid, state, seed:)
      hazard = hazard_for_event(event_id, seed)
      return { suit_damage: 0, hazard: nil } unless hazard

      trigger_chance = [hazard.dig("trigger", "base_chance").to_f * asteroid["hazard_multiplier"].to_f, 1.0].min
      return { suit_damage: 0, hazard: nil } if event_id != "work_test_fail" && deterministic_unit("#{seed}:trigger") >= trigger_chance

      reduction = hazard_mitigation(hazard, state)
      damage_config = hazard.dig("effects", "suit_damage")
      suit_damage = 0
      if damage_config
        raw_damage = deterministic_range(damage_config, "#{seed}:damage") * asteroid["hazard_multiplier"].to_f
        suit_damage = [(raw_damage * (1 - reduction)).ceil, 0].max
      end

      {
        suit_damage: suit_damage,
        hazard: {
          "hazard_id" => hazard["id"],
          "display_name" => hazard["display_name"],
          "trigger_source" => hazard.dig("trigger", "source"),
          "trigger_chance" => trigger_chance.round(4),
          "mitigation" => reduction.round(4),
          "suit_damage" => suit_damage,
          "flavor" => Array(hazard["flavor"]).first
        }
      }
    end

    def hazard_for_event(event_id, seed)
      source = hazard_source_for_event(event_id)
      return nil unless source

      candidates = hazard_list.select { |hazard| hazard.dig("trigger", "source") == source }
      return nil if candidates.empty?

      deterministic_pick(candidates, "#{seed}:hazard")
    end

    def hazard_source_for_event(event_id)
      case event_id
      when "work_test_fail" then "failed_commands"
      when "work_session_start" then "long_session_without_completion"
      when "work_search" then "rare_find_roll"
      when "work_file_read" then "repetitive_activity_pattern"
      else nil
      end
    end

    def hazard_mitigation(hazard, state)
      upgrade_id = hazard.dig("mitigated_by", "upgrade_id")
      return 0.0 if upgrade_id.to_s.empty?

      level = state.dig("upgrades", upgrade_id).to_i
      effect = upgrade_effect_by_id(upgrade_id, level)
      upgrade = upgrade_by_id.fetch(upgrade_id)
      reduction = upgrade.dig("effect", "type") == "reduction" ? effect : [(effect - 1.0) * 0.2, 0.65].min
      reduction.clamp(0.0, 0.9)
    end

    def record_hazard!(state, hazard, timestamp)
      state["hazard_log"] << hazard.merge("created_at" => timestamp)
      state["hazard_log"] = state["hazard_log"].last(20)
    end

    def handle_asteroid_depletion!(state, timestamp)
      loop_guard = 0
      loop do
        loop_guard += 1
        break if loop_guard > asteroid_list.length

        asteroid = asteroid_for(state)
        mined = state.dig("asteroid_progress", "mined").to_i
        depletion_size = asteroid["depletion_size"].to_i
        break unless depletion_size.positive? && mined >= depletion_size

        overflow = mined - depletion_size
        state["asteroid_progress_by_id"][asteroid["id"]] = {
          "asteroid_class_id" => asteroid["id"],
          "mined" => depletion_size
        }
        next_asteroid = next_asteroid_unlock(state, asteroid)
        state["asteroid_depletions"] << {
          "asteroid_class_id" => asteroid["id"],
          "depleted_at" => timestamp,
          "overflow_mined" => overflow,
          "unlocked_asteroid_class_id" => next_asteroid && next_asteroid["id"]
        }.compact
        state["asteroid_depletions"] = state["asteroid_depletions"].last(20)

        unless next_asteroid
          state["asteroid_progress"]["mined"] = depletion_size
          break
        end

        state["unlocked_asteroid_class_ids"] << next_asteroid["id"] unless state["unlocked_asteroid_class_ids"].include?(next_asteroid["id"])
        state["current_asteroid_class_id"] = next_asteroid["id"]
        state["asteroid_progress"] = {
          "asteroid_class_id" => next_asteroid["id"],
          "mined" => overflow
        }
        state["asteroid_progress_by_id"][next_asteroid["id"]] = state["asteroid_progress"].dup
      end
    end

    def next_asteroid_unlock(state, depleted_asteroid)
      unlocked = state["unlocked_asteroid_class_ids"] || []
      asteroid_list.find do |candidate|
        !unlocked.include?(candidate["id"]) &&
          candidate["unlock_tier"].to_i <= depleted_asteroid["unlock_tier"].to_i + 1
      end
    end

    def unknown_asteroid_payload(asteroid_id)
      {
        ok: false,
        status: "unknown_asteroid",
        asteroid_id: asteroid_id,
        reason: "Asteroid class is not defined in asteroid_classes.yaml.",
        privacy: PRIVACY_NOTICE
      }
    end

    def machine_status(machine, state)
      unlocked = machine_unlocked?(machine, state)
      queue_items = (state["fabrication_queue"] || []).select { |item| item["machine_id"] == machine["id"] }
      {
        machine_id: machine["id"],
        display_name: machine["display_name"],
        progression_tier: machine["progression_tier"],
        unlocked: unlocked,
        unlock: machine["unlock"],
        throughput: {
          base_progress_per_turn: machine.dig("throughput", "base_progress_per_turn").to_i,
          effective_progress_per_turn: (machine.dig("throughput", "base_progress_per_turn").to_f * upgrade_effect_by_id("upgrade_fabricator_throughput", state.dig("upgrades", "upgrade_fabricator_throughput").to_i)).round(2),
          max_queue_size: machine_queue_size(machine, state),
          base_max_queue_size: machine.dig("throughput", "max_queue_size").to_i,
          queued: queue_items.length
        },
        quality: machine["quality"],
        recipes_available: recipe_list.count { |recipe| recipe["machine_id"] == machine["id"] },
        queue: queue_items.map { |item| fabrication_item_payload(item) }
      }
    end

    def machine_unlocked?(machine, state)
      return true if machine["starts_unlocked"]
      return true if (state["unlocked_machine_ids"] || []).include?(machine["id"])

      unlock = machine["unlock"] || {}
      modules_met = Array(unlock["required_base_modules"]).all? { |module_id| state.dig("base_modules", module_id).to_i.positive? }
      upgrades_met = Array(unlock["required_upgrades"]).all? do |requirement|
        requirement.all? { |upgrade_id, level| state.dig("upgrades", upgrade_id).to_i >= level.to_i }
      end
      modules_met && upgrades_met && state["space_bucks"].to_i >= unlock["space_bucks"].to_i
    end

    def build_fabrication_item(sequence, recipe, variant, machine, quantity, required)
      progress_required = (recipe["base_craft_progress"].to_f * variant["recipe_quantity_multiplier"].to_f * quantity.to_i).ceil
      digest = Digest::SHA256.hexdigest("#{sequence}:#{recipe['id']}:#{variant['id']}")[0, 10]
      {
        "fabrication_id" => "fab_#{sequence}_#{digest}",
        "recipe_id" => recipe["id"],
        "variant_id" => variant["id"],
        "machine_id" => machine["id"],
        "product" => "#{variant['display_name']} #{recipe['display_name']}",
        "quantity" => quantity.to_i,
        "quality_grade" => variant["quality_grade_required"].to_i,
        "required_materials" => required,
        "progress" => 0.0,
        "progress_required" => progress_required,
        "status" => "queued",
        "queued_at" => Time.now.utc.iso8601
      }
    end

    def fabrication_item_payload(item)
      progress_required = item["progress_required"].to_f
      progress = item["progress"].to_f
      item.merge(
        "progress" => progress.round(2),
        "progress_percent" => progress_required.positive? ? ((progress / progress_required) * 100).round(2) : 100.0,
        "remaining_progress" => [progress_required - progress, 0].max.round(2)
      )
    end

    def advance_fabrication!(state, event_type, score, timestamp)
      return if (state["fabrication_queue"] || []).empty?

      throughput_multiplier = upgrade_effect_by_id("upgrade_fabricator_throughput", state.dig("upgrades", "upgrade_fabricator_throughput").to_i)
      grouped = state["fabrication_queue"].group_by { |item| item["machine_id"] }
      grouped.each_value do |items|
        item = items.first
        machine = machine_by_id.fetch(item["machine_id"])
        progress = machine.dig("throughput", "base_progress_per_turn").to_f *
                   throughput_multiplier *
                   fabrication_event_multiplier(event_type) *
                   (1 + (score.to_f / 20.0))
        item["progress"] = item["progress"].to_f + progress
        item["last_progress_at"] = timestamp
      end

      complete_ready_fabrication!(state, timestamp)
    end

    def fabrication_event_multiplier(event_type)
      category = work_event_by_id.dig(event_type.to_s, "category")
      case category
      when "fabrication" then 1.5
      when "shipping" then 1.2
      when "testing" then 1.1
      when "research" then 0.6
      else 1.0
      end
    end

    def complete_ready_fabrication!(state, timestamp)
      completed, remaining = state["fabrication_queue"].partition do |item|
        item["progress"].to_f >= item["progress_required"].to_f
      end
      state["fabrication_queue"] = remaining
      completed.each do |item|
        key = completed_product_key(item["recipe_id"], item["variant_id"], item["quality_grade"].to_i)
        product = state["completed_products"].find { |candidate| candidate["product_key"] == key }
        unless product
          product = {
            "product_key" => key,
            "recipe_id" => item["recipe_id"],
            "variant_id" => item["variant_id"],
            "product" => item["product"],
            "quality_grade" => item["quality_grade"].to_i,
            "quantity" => 0,
            "completed_at" => timestamp
          }
          state["completed_products"] << product
        end
        product["quantity"] = product["quantity"].to_i + item["quantity"].to_i
        product["completed_at"] = timestamp
      end
    end

    def completed_product_for_order(order, state)
      required_quality = variant_by_id.fetch(order["variant_id"])["quality_grade_required"].to_i
      needed_quantity = order["quantity"].to_i
      (state["completed_products"] || []).find do |product|
        product["recipe_id"] == order["recipe_id"] &&
          product["variant_id"] == order["variant_id"] &&
          product["quality_grade"].to_i >= required_quality &&
          product["quantity"].to_i >= needed_quantity
      end
    end

    def consume_completed_product!(state, product, quantity)
      product["quantity"] = product["quantity"].to_i - quantity.to_i
      state["completed_products"].reject! { |candidate| candidate["quantity"].to_i <= 0 }
    end

    def completed_product_key(recipe_id, variant_id, quality_grade)
      "product:#{recipe_id}:#{variant_id}:q#{quality_grade}"
    end

    def fabrication_quality_error(status, recipe, variant, machine)
      {
        ok: false,
        status: status,
        recipe_id: recipe["id"],
        variant_id: variant["id"],
        machine_id: machine["id"],
        required_quality_grade: variant["quality_grade_required"].to_i,
        machine_max_quality_grade: machine.dig("quality", "max_quality_grade").to_i,
        privacy: PRIVACY_NOTICE
      }
    end

    def unknown_recipe_payload(recipe_id)
      {
        ok: false,
        status: "unknown_recipe",
        recipe_id: recipe_id,
        reason: "Recipe is not defined in recipes.yaml.",
        privacy: PRIVACY_NOTICE
      }
    end

    def unknown_variant_payload(variant_id)
      {
        ok: false,
        status: "unknown_variant",
        variant_id: variant_id,
        reason: "Order variant is not defined in order_variants.yaml.",
        privacy: PRIVACY_NOTICE
      }
    end

    def base_module_status(mod, state)
      level = state.dig("base_modules", mod.fetch("id")).to_i
      max_level = mod.fetch("max_level").to_i
      cost = level >= max_level ? nil : base_module_next_cost(mod, level)
      missing_space_bucks = cost ? [cost[:space_bucks].to_i - state["space_bucks"].to_i, 0].max : 0
      missing_materials = cost ? missing_materials_for_cost(cost[:materials], state) : {}
      missing_required_modules = Array(mod.dig("unlock", "required_modules")).reject do |module_id|
        state.dig("base_modules", module_id).to_i.positive?
      end

      {
        module_id: mod.fetch("id"),
        display_name: mod.fetch("display_name"),
        level: level,
        max_level: max_level,
        is_maxed: level >= max_level,
        prerequisites_met: missing_required_modules.empty?,
        missing_required_modules: missing_required_modules,
        cost_to_next: cost,
        can_purchase: cost && missing_space_bucks.zero? && missing_materials.empty? && missing_required_modules.empty?,
        missing_space_bucks: missing_space_bucks,
        missing_materials: missing_materials,
        effects: Array(mod["effects"]).map { |effect| base_module_effect_payload(effect, level) },
        next_effects: level >= max_level ? [] : Array(mod["effects"]).map { |effect| base_module_effect_payload(effect, level + 1) }
      }
    end

    def base_module_next_cost(mod, level)
      multiplier = level.to_i + 1
      {
        space_bucks: mod.dig("unlock", "space_bucks").to_i * multiplier,
        materials: Array(mod["material_costs"]).each_with_object({}) do |cost, materials|
          quantity = cost.fetch("base_quantity").to_i * multiplier
          materials[cost.fetch("material_id")] = quantity if quantity.positive?
        end
      }
    end

    def base_module_effect_payload(effect, level)
      value = evaluate_base_module_formula(effect.fetch("formula"), level)
      {
        target: effect.fetch("target"),
        formula: effect.fetch("formula"),
        value: value.round(4)
      }
    end

    def base_effects_payload(state)
      targets = base_module_list.flat_map { |mod| Array(mod["effects"]).map { |effect| effect["target"] } }.uniq
      targets.to_h { |target| [target, base_module_effect_value(target, state).round(4)] }
    end

    def base_module_effect_value(target, state)
      base_module_list.sum do |mod|
        level = state.dig("base_modules", mod["id"]).to_i
        next 0.0 if level <= 0

        Array(mod["effects"]).select { |effect| effect["target"] == target }.sum do |effect|
          evaluate_base_module_formula(effect.fetch("formula"), level)
        end
      end
    end

    def evaluate_base_module_formula(formula, level)
      l = level.to_f
      case formula
      when "1 + L"
        1 + l
      when "0.02 * L"
        0.02 * l
      when "3 + L"
        3 + l
      when "L"
        l
      else
        raise "Unsupported base module effect formula: #{formula}"
      end
    end

    def active_order_slots_for(state)
      [order_generator.fetch("active_order_slots").to_i, base_module_effect_value("active_order_slots", state).to_i].max
    end

    def machine_queue_size(machine, state)
      base = machine.dig("throughput", "max_queue_size").to_i
      bonus = [base_module_effect_value("fabrication_queue_slots", state).to_i - 1, 0].max
      base + bonus
    end

    def drone_automation_payload(state)
      level = state.dig("upgrades", "upgrade_drone_automation").to_i
      upgrade = upgrade_by_id.fetch("upgrade_drone_automation")
      max_level = upgrade.fetch("max_level").to_i
      {
        upgrade_id: "upgrade_drone_automation",
        level: level,
        max_level: max_level,
        passive_support_multiplier: upgrade_effect_by_id("upgrade_drone_automation", level),
        max_passive_support_multiplier: upgrade_effect_by_id("upgrade_drone_automation", max_level),
        bounded: true
      }
    end

    def unknown_base_module_payload(module_id)
      {
        ok: false,
        status: "unknown_base_module",
        module_id: module_id,
        reason: "Base module is not defined in base_modules.yaml.",
        privacy: PRIVACY_NOTICE
      }
    end

    def updatable_profile_fields
      %w[
        display_name
        miner_name
        pronouns
        suit_style
        avatar_concept_prompt
      ]
    end

    def normalize_profile_value(field, value)
      text = safe_string(value).strip
      return nil if field == "pronouns" && text.empty?

      text
    end

    def upgrade_status(upgrade, state)
      level = state.dig("upgrades", upgrade.fetch("id")).to_i
      max_level = upgrade.fetch("max_level").to_i
      cost = level >= max_level ? nil : upgrade_next_cost(upgrade, level, state)
      missing_space_bucks = cost ? [cost[:space_bucks].to_i - state["space_bucks"].to_i, 0].max : 0
      missing_materials = cost ? missing_materials_for_cost(cost[:materials], state) : {}
      current_effect = upgrade_effect(upgrade, level)
      next_effect = level >= max_level ? current_effect : upgrade_effect(upgrade, level + 1)

      {
        upgrade_id: upgrade.fetch("id"),
        display_name: upgrade.fetch("display_name"),
        level: level,
        max_level: max_level,
        is_maxed: level >= max_level,
        cost_to_next: cost,
        can_purchase: cost && missing_space_bucks.zero? && missing_materials.empty?,
        missing_space_bucks: missing_space_bucks,
        missing_materials: missing_materials,
        effect: current_effect,
        next_effect: next_effect,
        effect_delta: effect_delta(current_effect, next_effect),
        formula: upgrade.dig("effect", "formula"),
        target: upgrade.dig("effect", "target"),
        effect_type: upgrade.dig("effect", "type")
      }
    end

    def upgrade_next_cost(upgrade, level, state = nil)
      {
        space_bucks: upgrade_space_bucks_cost(upgrade, level, state),
        materials: upgrade_material_costs(upgrade, level)
      }
    end

    def upgrade_space_bucks_cost(upgrade, level, state = nil)
      cost = upgrade.fetch("cost")
      raw = cost.fetch("base_space_bucks").to_f *
            (cost.fetch("growth_rate").to_f**level.to_i) *
            upgrade_phase_multiplier(level) *
            upgrade_rarity_pressure(upgrade, level)
      if state
        discount = [base_module_effect_value("upgrade_discount_percent", state), 0.5].min
        raw *= (1 - discount)
      end
      nice_round(raw).ceil
    end

    def upgrade_material_costs(upgrade, level)
      entries = Array(upgrade.dig("material_basket", "base_quantities")).map do |entry|
        [entry.fetch("material_id"), entry.fetch("quantity").to_i]
      end
      Array(upgrade.dig("material_basket", "gates")).each do |gate|
        next if level.to_i < gate.fetch("min_level").to_i

        entries << [gate.fetch("add_material_id"), gate.fetch("base_quantity").to_i]
      end

      entries.each_with_object({}) do |(material_id, base_quantity), costs|
        material = material_by_id.fetch(material_id)
        scaled = base_quantity *
                 rarity_multiplier(material["rarity"]) *
                 ((1 + (level.to_i / 10.0))**1.30) *
                 upgrade_phase_multiplier(level)
        costs[material_id] = scaled.ceil
      end
    end

    def upgrade_effect(upgrade, level)
      value = evaluate_upgrade_formula(upgrade.dig("effect", "formula"), level)
      {
        value: value.round(4),
        display: upgrade_effect_display(upgrade, value)
      }
    end

    def upgrade_effect_by_id(upgrade_id, level)
      upgrade = upgrade_by_id.fetch(upgrade_id)
      upgrade_effect(upgrade, level).fetch(:value).to_f
    end

    def evaluate_upgrade_formula(formula, level)
      l = level.to_f
      case formula
      when "1 + 2.6*(1-e^(-0.045L)) + 0.05*floor(L/10)"
        1 + 2.6 * (1 - Math.exp(-0.045 * l)) + (0.05 * (level.to_i / 10).floor)
      when "1 + 1.8*(1-e^(-0.05L))"
        1 + 1.8 * (1 - Math.exp(-0.05 * l))
      when "1 + 1.2*(1-e^(-0.04L))"
        1 + 1.2 * (1 - Math.exp(-0.04 * l))
      when "0.72*(1-e^(-0.045L))"
        0.72 * (1 - Math.exp(-0.045 * l))
      when "1 + 1.6*(1-e^(-0.04L))"
        1 + 1.6 * (1 - Math.exp(-0.04 * l))
      when "1 + 1.4*(1-e^(-0.06L))"
        1 + 1.4 * (1 - Math.exp(-0.06 * l))
      when "base_storage * 1.08^L"
        1.08**l
      when "1 + 0.06L + 0.005*L^1.35"
        1 + (0.06 * l) + (0.005 * (l**1.35))
      else
        raise "Unsupported upgrade effect formula: #{formula}"
      end
    end

    def upgrade_effect_display(upgrade, value)
      if upgrade.dig("effect", "type") == "reduction"
        "#{(value * 100).round}% reduction"
      elsif upgrade.dig("effect", "target") == "storage_capacity"
        "#{value.round(2)}x storage"
      else
        "#{value.round(2)}x"
      end
    end

    def effect_delta(current_effect, next_effect)
      (next_effect.fetch(:value).to_f - current_effect.fetch(:value).to_f).round(4)
    end

    def missing_materials_for_cost(materials, state)
      materials.each_with_object({}) do |(material_id, quantity), missing|
        available = state.dig("inventory", material_id).to_i
        needed = quantity.to_i
        missing[material_id] = needed - available if available < needed
      end
    end

    def upgrade_phase_multiplier(level)
      config = balance_config.fetch("upgrade_phase")
      phase = level.to_i / config.fetch("interval").to_i
      1 + (config.fetch("multiplier_per_phase_squared").to_f * (phase**2))
    end

    def upgrade_rarity_pressure(upgrade, level)
      rare_gate_count = Array(upgrade.dig("material_basket", "gates")).count do |gate|
        next false if level.to_i < gate.fetch("min_level").to_i

        rare_upgrade_material?(material_by_id.fetch(gate.fetch("add_material_id")))
      end
      1 + (0.04 * rare_gate_count)
    end

    def rare_upgrade_material?(material)
      %w[rare dangerous fictional_rare legendary].include?(material["rarity"])
    end

    def rarity_multiplier(rarity)
      {
        "common" => 1.0,
        "uncommon" => 1.6,
        "rare" => 2.4,
        "dangerous" => 2.8,
        "fictional_rare" => 3.2,
        "legendary" => 5.0
      }.fetch(rarity, 1.0)
    end

    def unknown_upgrade_payload(upgrade_id)
      {
        ok: false,
        status: "unknown_upgrade",
        upgrade_id: upgrade_id,
        reason: "Upgrade is not defined in upgrades.yaml.",
        privacy: PRIVACY_NOTICE
      }
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
      product = completed_product_for_order(order, state)
      order.merge(
        "can_fulfill" => missing.empty? || !!product,
        "missing_materials" => missing,
        "completed_product_available" => !!product
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
          "suit_damage" => reward.fetch(:suit_damage).to_i,
          "rare_find" => reward[:rare_find],
          "rare_find_chance" => reward[:rare_find_chance],
          "hazard" => reward[:hazard]
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
      rare_find = !!rewards["rare_find"]
      hazard = rewards["hazard"].is_a?(Hash) ? rewards["hazard"] : nil
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
      current_asteroid_id = state["asteroid_progress"]["asteroid_class_id"]
      state["asteroid_progress_by_id"][current_asteroid_id] ||= {
        "asteroid_class_id" => current_asteroid_id,
        "mined" => 0
      }
      state["asteroid_progress_by_id"][current_asteroid_id]["mined"] = state["asteroid_progress"]["mined"].to_i
      state["rare_find_pity_score"] = rare_find ? 0.0 : [state["rare_find_pity_score"].to_f + 1.0, balance_config.dig("pity", "max_score").to_f].min
      state["suit_condition"] = [state["suit_condition"].to_i - suit_damage, 0].max
      record_hazard!(state, hazard, timestamp) if hazard
      handle_asteroid_depletion!(state, timestamp)
      advance_fabrication!(state, event_type, score, timestamp)

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
        profile
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
        market_sale_index
        market_transactions
        fabrication_queue
        completed_products
        fabrication_sequence
        suit_condition
        asteroid_progress
        asteroid_progress_by_id
        rare_find_pity_score
        asteroid_depletions
        hazard_log
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
      upgrade_effect_by_id("upgrade_drill_power", level)
    end

    def hazard_damage(event_id, asteroid, state)
      return 0 unless event_id == "work_test_fail"

      plating = state.dig("upgrades", "upgrade_suit_plating").to_i
      reduction = upgrade_effect_by_id("upgrade_suit_plating", plating)
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

    def recipe_by_id
      @recipe_by_id ||= recipe_list.to_h { |recipe| [recipe.fetch("id"), recipe] }
    end

    def variant_by_id
      @variant_by_id ||= variant_list.to_h { |variant| [variant.fetch("id"), variant] }
    end

    def asteroid_by_id
      @asteroid_by_id ||= asteroid_list.to_h { |asteroid| [asteroid.fetch("id"), asteroid] }
    end

    def upgrade_by_id
      @upgrade_by_id ||= upgrade_list.to_h { |upgrade| [upgrade.fetch("id"), upgrade] }
    end

    def base_module_by_id
      @base_module_by_id ||= base_module_list.to_h { |mod| [mod.fetch("id"), mod] }
    end

    def work_event_by_id
      @work_event_by_id ||= @data.fetch(:work_scoring).to_h { |event| [event.fetch("id"), event] }
    end
  end
end
