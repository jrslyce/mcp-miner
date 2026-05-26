#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"
require "set"

ROOT = File.expand_path("..", __dir__)
DATA_DIR = ENV.fetch("MCP_MINER_DATA_DIR", File.join(ROOT, "data"))

REQUIRED_FILES = %w[
  schema_version.yaml
  ids.yaml
  rarity_tiers.yaml
  materials.yaml
  material_aliases.yaml
  fabrication_machines.yaml
  recipes.yaml
  order_variants.yaml
  order_generator.yaml
  buyers.yaml
  asteroid_classes.yaml
  upgrades.yaml
  work_scoring.yaml
  hazards.yaml
  base_modules.yaml
  player_start.yaml
  report_templates.yaml
  balance_constants.yaml
  subscription_plans.yaml
].freeze

WORK_CATEGORIES = %w[
  research
  coding
  testing
  review
  writing
  shipping
  fabrication
].freeze

FORMULA_IDS = Set.new(%w[
  phase_multiplier
  rarity_pressure
  suit_damage_reduction
  drone_support_reduction
  scanner_stability_reduction
  drill_reliability_reduction
]).freeze

UPGRADE_EFFECT_TYPES = Set.new(%w[
  multiplier
  reduction
]).freeze

UPGRADE_EFFECT_TARGETS = Set.new(%w[
  chonk_output
  discovery_output
  rare_find_weighting
  hazard_damage
  refined_yield
  product_progress
  storage_capacity
  passive_support
]).freeze

BASE_MODULE_EFFECT_TARGETS = Set.new(%w[
  expedition_log_slots
  upgrade_discount_percent
  refining_queue_slots
  fabrication_queue_slots
  active_order_slots
  weird_matter_quality_cap
]).freeze

HAZARD_TRIGGER_SOURCES = Set.new(%w[
  failed_commands
  long_session_without_completion
  abandoned_failed_work
  rare_find_roll
  repetitive_activity_pattern
]).freeze

HAZARD_EFFECT_TARGETS = Set.new(%w[
  energy_reserve
  rare_material
  chonk_output
]).freeze

REPORT_PLACEHOLDERS = Set.new(%w[
  chonks
  highlight
  material_summary
  order_summary
  suit_condition
  asteroid_name
  order_percent
  time_remaining
  milestone_summary
  space_bucks
]).freeze

REPORT_MODES = Set.new(%w[
  off
  every_turn_compact
  every_turn_full
  meaningful_turns_only
  session_summary_only
  milestones_only
]).freeze

PRIVATE_REPORT_TOKENS = %w[
  prompt
  source_code
  terminal_output
  file_path
  repo_name
  browser_content
  transcript
].freeze

class Validator
  def initialize
    @errors = []
    @data = {}
  end

  def run
    load_files
    validate_schema_version
    validate_rarities
    validate_materials
    validate_aliases
    validate_base_modules
    validate_upgrades
    validate_machines
    validate_recipes
    validate_order_variants
    validate_balance_constants
    validate_order_generator
    validate_buyers
    validate_order_formula_coverage
    validate_asteroids
    validate_work_scoring
    validate_hazards
    validate_player_start
    validate_reports
    validate_subscription_plans
    finish
  end

  private

  def load_files
    REQUIRED_FILES.each do |file|
      path = File.join(DATA_DIR, file)
      error("missing required file #{path}") unless File.exist?(path)
      @data[file] = YAML.load_file(path)
    rescue Psych::SyntaxError => e
      error("YAML syntax error in #{file}: #{e.message}")
    end
  end

  def validate_schema_version
    version = @data.dig("schema_version.yaml", "schema_version")
    game_version = @data.dig("schema_version.yaml", "game_version")
    revision = @data.dig("schema_version.yaml", "data_revision")
    error("schema_version must be an integer") unless version.is_a?(Integer)
    error("game_version must be semver-ish") unless game_version.to_s.match?(/^\d+\.\d+\.\d+$/)
    error("data_revision must be an integer") unless revision.is_a?(Integer)
  end

  def validate_rarities
    rarity_map.each do |id, rarity|
      require_keys(rarity, "rarity #{id}", %w[display_name value_multiplier drop_weight_multiplier])
      positive_number(rarity["value_multiplier"], "rarity #{id}.value_multiplier")
      positive_number(rarity["drop_weight_multiplier"], "rarity #{id}.drop_weight_multiplier")
    end
  end

  def validate_materials
    ids = Set.new
    atomic_numbers = Set.new
    symbols = Set.new

    materials.each do |mat|
      context = "material #{mat['id'] || '(missing id)'}"
      require_keys(mat, context, %w[id display_name category rarity state_group raw_space_bucks can_refine unlock_tier])
      id = mat["id"]
      error("duplicate material id #{id}") unless ids.add?(id)
      error("#{context} references unknown rarity #{mat['rarity']}") unless rarity_map.key?(mat["rarity"])
      positive_number(mat["raw_space_bucks"], "#{context}.raw_space_bucks")
      error("#{context}.unlock_tier must be positive") unless mat["unlock_tier"].is_a?(Integer) && mat["unlock_tier"].positive?

      if mat["can_refine"]
        positive_number(mat["refined_space_bucks"], "#{context}.refined_space_bucks")
        if mat["refined_space_bucks"].is_a?(Numeric) && mat["raw_space_bucks"].is_a?(Numeric)
          error("#{context}.refined_space_bucks must exceed raw_space_bucks") unless mat["refined_space_bucks"] > mat["raw_space_bucks"]
        end
      elsif !mat["refined_space_bucks"].nil?
        error("#{context}.refined_space_bucks must be null when can_refine is false")
      end

      next unless mat["category"] == "element"

      error("#{context}.atomic_number missing") unless mat["atomic_number"].is_a?(Integer)
      error("#{context}.symbol missing") unless mat["symbol"].is_a?(String) && !mat["symbol"].empty?
      error("duplicate atomic number #{mat['atomic_number']}") unless atomic_numbers.add?(mat["atomic_number"])
      error("duplicate element symbol #{mat['symbol']}") unless symbols.add?(mat["symbol"])
    end

    error("expected 118 element materials") unless materials.count { |m| m["category"] == "element" } == 118

    materials.each do |mat|
      base_id = mat["base_material_id"]
      next unless base_id

      error("material #{mat['id']} base_material_id #{base_id} does not exist") unless material_ids.include?(base_id)
    end
  end

  def validate_aliases
    aliases.each do |key, value|
      context = "alias #{key}"
      require_keys(value, context, %w[display_name material_id canonical_material_id price_multiplier])
      ref_exists(value["material_id"], context, "material_id", material_ids)
      ref_exists(value["canonical_material_id"], context, "canonical_material_id", material_ids)
      positive_number(value["price_multiplier"], "#{context}.price_multiplier")
    end
  end

  def validate_base_modules
    seen = Set.new
    base_modules.each do |mod|
      context = file_context("base_modules.yaml", "base module #{mod['id'] || '(missing id)'}")
      require_keys(mod, context, %w[id display_name max_level unlock effects material_costs])
      error("duplicate base module id #{mod['id']}") unless seen.add?(mod["id"])
      error("#{context}.max_level must be positive") unless mod["max_level"].is_a?(Integer) && mod["max_level"].positive?
      error("#{context}.unlock.space_bucks must be non-negative") unless mod.dig("unlock", "space_bucks").is_a?(Numeric) && mod.dig("unlock", "space_bucks") >= 0
      Array(mod.dig("unlock", "required_modules")).each do |id|
        ref_exists(id, context, "unlock.required_modules", base_module_ids)
      end
      validate_effects(Array(mod["effects"]), context, BASE_MODULE_EFFECT_TARGETS)
      Array(mod["material_costs"]).each do |cost|
        ref_exists(cost["material_id"], context, "material_costs.material_id", material_ids)
        positive_integer(cost["base_quantity"], "#{context}.material_costs.base_quantity", allow_zero: true)
      end
    end
    validate_base_module_cycles
  end

  def validate_upgrades
    seen = Set.new
    upgrades.each do |upgrade|
      context = file_context("upgrades.yaml", "upgrade #{upgrade['id'] || '(missing id)'}")
      require_keys(upgrade, context, %w[id display_name max_level cost effect material_basket])
      error("duplicate upgrade id #{upgrade['id']}") unless seen.add?(upgrade["id"])
      error("#{context}.max_level must be positive") unless upgrade["max_level"].is_a?(Integer) && upgrade["max_level"].positive?
      positive_number(upgrade.dig("cost", "base_space_bucks"), "#{context}.cost.base_space_bucks")
      positive_number(upgrade.dig("cost", "growth_rate"), "#{context}.cost.growth_rate")
      ref_exists(upgrade.dig("cost", "phase_formula"), context, "cost.phase_formula", FORMULA_IDS, noun: "formula id")
      ref_exists(upgrade.dig("cost", "rarity_pressure_formula"), context, "cost.rarity_pressure_formula", FORMULA_IDS, noun: "formula id")
      validate_upgrade_effect(upgrade["effect"], context)

      Array(upgrade.dig("material_basket", "base_quantities")).each do |item|
        ref_exists(item["material_id"], context, "material_basket.base_quantities.material_id", material_ids)
        positive_integer(item["quantity"], "#{context}.material_basket.base_quantities.quantity")
      end
      Array(upgrade.dig("material_basket", "gates")).each do |gate|
        ref_exists(gate["add_material_id"], context, "material_basket.gates.add_material_id", material_ids)
        positive_integer(gate["base_quantity"], "#{context}.material_basket.gates.base_quantity")
        if gate["min_level"].is_a?(Integer) && upgrade["max_level"].is_a?(Integer)
          error("#{context}.gate min_level exceeds max_level") if gate["min_level"] > upgrade["max_level"]
        else
          error("#{context}.gate min_level must be integer")
        end
      end
    end
  end

  def validate_machines
    seen = Set.new
    machines.each do |machine|
      context = file_context("fabrication_machines.yaml", "machine #{machine['id'] || '(missing id)'}")
      require_keys(machine, context, %w[id display_name progression_tier starts_unlocked unlock throughput quality allowed_material_bands])
      error("duplicate machine id #{machine['id']}") unless seen.add?(machine["id"])
      error("#{context}.progression_tier must be positive") unless machine["progression_tier"].is_a?(Integer) && machine["progression_tier"].positive?
      error("#{context}.starts_unlocked must be boolean") unless boolean?(machine["starts_unlocked"])
      error("#{context}.unlock.space_bucks must be non-negative") unless machine.dig("unlock", "space_bucks").is_a?(Numeric) && machine.dig("unlock", "space_bucks") >= 0
      positive_number(machine.dig("throughput", "base_progress_per_turn"), "#{context}.throughput.base_progress_per_turn")
      positive_integer(machine.dig("throughput", "max_queue_size"), "#{context}.throughput.max_queue_size")
      positive_integer(machine.dig("quality", "max_quality_grade"), "#{context}.quality.max_quality_grade", allow_zero: true)
      Array(machine.dig("unlock", "required_base_modules")).each do |id|
        ref_exists(id, context, "unlock.required_base_modules", base_module_ids)
      end
      Array(machine.dig("unlock", "required_upgrades")).each do |entry|
        id = entry.is_a?(Hash) ? entry.keys.first : entry
        ref_exists(id, context, "unlock.required_upgrades", upgrade_ids)
        next unless entry.is_a?(Hash)

        required_level = entry.values.first
        positive_integer(required_level, "#{context}.unlock.required_upgrades.#{id}")
        max_level = upgrade_by_id.dig(id, "max_level")
        if required_level.is_a?(Integer) && max_level.is_a?(Integer)
          error("#{context}.unlock.required_upgrades.#{id} exceeds max_level #{max_level}") if required_level > max_level
        end
      end
      Array(machine["allowed_material_bands"]).each do |id|
        ref_exists(id, context, "allowed_material_bands", material_ids)
      end
    end
    error("data/fabrication_machines.yaml must include at least one starts_unlocked machine") unless machines.any? { |machine| machine["starts_unlocked"] == true }
  end

  def validate_recipes
    seen = Set.new
    recipes.each do |recipe|
      context = "recipe #{recipe['id'] || '(missing id)'}"
      require_keys(recipe, context, %w[id display_name machine_id progression_tier output_quantity base_craft_progress quality_allowed primary_material_id inputs collector_accent])
      error("duplicate recipe id #{recipe['id']}") unless seen.add?(recipe["id"])
      ref_exists(recipe["machine_id"], context, "machine_id", machine_ids)
      ref_exists(recipe["primary_material_id"], context, "primary_material_id", material_ids)
      positive_integer(recipe["output_quantity"], "#{context}.output_quantity")
      positive_number(recipe["base_craft_progress"], "#{context}.base_craft_progress")
      machine = machine_by_id[recipe["machine_id"]]
      allowed = Set.new(machine ? machine["allowed_material_bands"] : [])
      input_ids = Set.new
      Array(recipe["inputs"]).each do |input|
        id = input["material_id"]
        ref_exists(id, context, "inputs.material_id", material_ids)
        positive_integer(input["quantity"], "#{context}.inputs.quantity")
        input_ids.add(id)
        error("#{context} uses #{id}, which is not allowed by #{recipe['machine_id']}") if machine && !allowed.include?(id)
      end
      error("#{context}.primary_material_id must appear in inputs") unless input_ids.include?(recipe["primary_material_id"])
      accent = recipe["collector_accent"] || {}
      ref_exists(accent["material_id"], context, "collector_accent.material_id", material_ids)
      positive_integer(accent["quantity"], "#{context}.collector_accent.quantity")
      error("#{context} collector accent #{accent['material_id']} is not allowed by #{recipe['machine_id']}") if machine && !allowed.include?(accent["material_id"])
    end

    expected_recipe_count = 125
    error("expected #{expected_recipe_count} recipes") unless recipes.length == expected_recipe_count
  end

  def validate_order_variants
    seen = Set.new
    order_variants.each do |variant|
      context = "order variant #{variant['id'] || '(missing id)'}"
      require_keys(variant, context, %w[id display_name recipe_quantity_multiplier payout_multiplier quality_grade_required adds_refined_primary adds_collector_accent deadline_multiplier])
      error("duplicate order variant id #{variant['id']}") unless seen.add?(variant["id"])
      positive_number(variant["recipe_quantity_multiplier"], "#{context}.recipe_quantity_multiplier")
      positive_number(variant["payout_multiplier"], "#{context}.payout_multiplier")
      positive_number(variant["deadline_multiplier"], "#{context}.deadline_multiplier")
      positive_integer(variant["quality_grade_required"], "#{context}.quality_grade_required", allow_zero: true)
    end
    error("expected 4 order variants") unless order_variants.length == 4
  end

  def validate_order_generator
    cfg = @data["order_generator.yaml"]["order_generation"] || {}
    context = file_context("order_generator.yaml", "order_generation")
    positive_integer(cfg["active_order_slots"], "#{context}.active_order_slots")
    positive_number(cfg["refresh_cadence_hours"], "#{context}.refresh_cadence_hours")
    error("#{context}.manual_accept must be boolean") unless boolean?(cfg["manual_accept"])
    error("#{context}.direct_market_sales_enabled must be boolean") unless boolean?(cfg["direct_market_sales_enabled"])
    error("#{context}.missed_order_penalty must be lost_opportunity_only") unless cfg["missed_order_penalty"] == "lost_opportunity_only"
    validate_tier_ranges(cfg["quantity_by_tier"], "#{context}.quantity_by_tier", integer: true)
    validate_tier_ranges(cfg["deadline_days_by_tier"], "#{context}.deadline_days_by_tier", integer: true)
    chance = cfg.dig("windfall", "chance")
    error("#{context}.windfall.chance must be 0..1") unless chance.is_a?(Numeric) && chance >= 0 && chance <= 1
    validate_min_max({
      "min" => cfg.dig("windfall", "min_multiplier"),
      "max" => cfg.dig("windfall", "max_multiplier")
    }, "#{context}.windfall", positive: true)
    validate_min_mode_max(cfg["normal_price_variation"], "#{context}.normal_price_variation")
    if cfg.dig("windfall", "min_multiplier").is_a?(Numeric) && cfg.dig("normal_price_variation", "max").is_a?(Numeric)
      error("#{context}.windfall.min_multiplier must exceed normal_price_variation.max") unless cfg.dig("windfall", "min_multiplier") > cfg.dig("normal_price_variation", "max")
    end
    error("#{context}.windfall_labels must contain at least one label") unless cfg["windfall_labels"].is_a?(Array) && cfg["windfall_labels"].any? { |label| label.is_a?(String) && !label.empty? }
    tier_one_recipes = recipes.count { |recipe| recipe["progression_tier"] == 1 }
    if cfg["active_order_slots"].is_a?(Integer)
      error("#{context}.active_order_slots exceeds tier 1 recipe pool") if cfg["active_order_slots"] > tier_one_recipes
    end
  end

  def validate_balance_constants
    balance = @data["balance_constants.yaml"]["balance"] || {}
    context = file_context("balance_constants.yaml", "balance")

    refinement = balance["refinement_multiplier"] || {}
    %w[raw refined high_purity].each { |key| positive_number(refinement[key], "#{context}.refinement_multiplier.#{key}") }
    if %w[raw refined high_purity].all? { |key| refinement[key].is_a?(Numeric) }
      error("#{context}.refinement_multiplier.raw must be <= refined") unless refinement["raw"] <= refinement["refined"]
      error("#{context}.refinement_multiplier.refined must be <= high_purity") unless refinement["refined"] <= refinement["high_purity"]
    end

    positive_integer(balance.dig("upgrade_phase", "interval"), "#{context}.upgrade_phase.interval")
    positive_number(balance.dig("upgrade_phase", "multiplier_per_phase_squared"), "#{context}.upgrade_phase.multiplier_per_phase_squared")
    positive_number(balance.dig("pity", "max_score"), "#{context}.pity.max_score")
    positive_number(balance.dig("pity", "bonus_per_score"), "#{context}.pity.bonus_per_score")
    validate_chance(balance.dig("pity", "max_final_rare_chance"), "#{context}.pity.max_final_rare_chance")
    validate_min_max({
      "min" => balance.dig("direct_market", "min_multiplier"),
      "max" => balance.dig("direct_market", "max_multiplier")
    }, "#{context}.direct_market", positive: true)
    order_variation = balance["order_price_variation"] || {}
    validate_chance(order_variation["windfall_chance"], "#{context}.order_price_variation.windfall_chance")
    validate_min_mode_max({
      "min" => order_variation["normal_min_multiplier"],
      "mode" => order_variation["normal_mode_multiplier"],
      "max" => order_variation["normal_max_multiplier"]
    }, "#{context}.order_price_variation.normal")
    validate_min_max({
      "min" => order_variation["windfall_min_multiplier"],
      "max" => order_variation["windfall_max_multiplier"]
    }, "#{context}.order_price_variation.windfall", positive: true)
    if order_variation["windfall_min_multiplier"].is_a?(Numeric) && order_variation["normal_max_multiplier"].is_a?(Numeric)
      error("#{context}.order_price_variation.windfall_min_multiplier must exceed normal_max_multiplier") unless order_variation["windfall_min_multiplier"] > order_variation["normal_max_multiplier"]
    end
  end

  def validate_buyers
    seen = Set.new
    buyers.each do |buyer|
      context = file_context("buyers.yaml", "buyer #{buyer['id'] || '(missing id)'}")
      require_keys(buyer, context, %w[id display_name unlock_tier reputation_multiplier preferred_machine_ids preferred_material_ids])
      error("duplicate buyer id #{buyer['id']}") unless seen.add?(buyer["id"])
      positive_integer(buyer["unlock_tier"], "#{context}.unlock_tier")
      positive_number(buyer["reputation_multiplier"], "#{context}.reputation_multiplier")
      error("#{context}.preferred_machine_ids must not be empty") if Array(buyer["preferred_machine_ids"]).empty?
      error("#{context}.preferred_material_ids must not be empty") if Array(buyer["preferred_material_ids"]).empty?
      Array(buyer["preferred_machine_ids"]).each { |id| ref_exists(id, context, "preferred_machine_ids", machine_ids) }
      Array(buyer["preferred_material_ids"]).each { |id| ref_exists(id, context, "preferred_material_ids", material_ids) }
    end
    machines.each do |machine|
      next if buyers.any? { |buyer| Array(buyer["preferred_machine_ids"]).include?(machine["id"]) }

      error("data/buyers.yaml has no buyer pool for machine #{machine['id']}")
    end
    recipes.map { |recipe| recipe["progression_tier"] }.compact.uniq.each do |tier|
      next if buyers.any? { |buyer| buyer["unlock_tier"].is_a?(Integer) && buyer["unlock_tier"] <= tier }

      error("data/buyers.yaml has no buyer available for recipe tier #{tier}")
    end
  end

  def validate_order_formula_coverage
    buyer = buyers.min_by { |candidate| candidate["unlock_tier"].to_i }
    error("data/buyers.yaml must define at least one buyer before order payout validation") unless buyer
    return unless buyer

    recipes.each do |recipe|
      order_variants.each do |variant|
        context = file_context("recipes.yaml", "recipe #{recipe['id'] || '(missing id)'} with order variant #{variant['id'] || '(missing id)'}")
        required = required_materials_for(recipe, variant, 1, context)
        error("#{context} produced no required materials") if required.empty?
        raw_value = required.sum do |material_id, quantity|
          material_value(material_id, quantity, context)
        end
        if raw_value.is_a?(Numeric) && raw_value.positive?
          payout = raw_value *
            (1 + (0.08 * required.keys.length) + (0.18 * recipe["progression_tier"].to_i) + (0.10 * recipe["progression_tier"].to_i)) *
            buyer["reputation_multiplier"].to_f *
            variant["payout_multiplier"].to_f
          error("#{context} computed non-positive Space Bucks payout") unless payout.positive?
        else
          error("#{context} computed non-positive raw material value")
        end
      end
    end
  end

  def validate_asteroids
    seen = Set.new
    asteroid_classes.each do |asteroid|
      context = "asteroid #{asteroid['id'] || '(missing id)'}"
      require_keys(asteroid, context, %w[id display_name unlock_tier depletion_size yield_multiplier hazard_multiplier base_rare_rate composition])
      error("duplicate asteroid class id #{asteroid['id']}") unless seen.add?(asteroid["id"])
      positive_integer(asteroid["unlock_tier"], "#{context}.unlock_tier")
      positive_number(asteroid["depletion_size"], "#{context}.depletion_size")
      positive_number(asteroid["yield_multiplier"], "#{context}.yield_multiplier")
      positive_number(asteroid["hazard_multiplier"], "#{context}.hazard_multiplier")
      chance = asteroid["base_rare_rate"]
      error("#{context}.base_rare_rate must be 0..1") unless chance.is_a?(Numeric) && chance >= 0 && chance <= 1
      total_weight = 0.0
      Array(asteroid["composition"]).each do |entry|
        ref_exists(entry["material_id"], context, "composition.material_id", material_ids)
        positive_number(entry["weight"], "#{context}.composition.weight")
        total_weight += entry["weight"].to_f if entry["weight"].is_a?(Numeric)
      end
      error("#{context}.composition weight total must be positive") unless total_weight.positive?
    end
  end

  def validate_work_scoring
    seen = Set.new
    work_events.each do |event|
      context = "work event #{event['id'] || '(missing id)'}"
      require_keys(event, context, %w[id category base_score])
      error("duplicate work event id #{event['id']}") unless seen.add?(event["id"])
      error("#{context}.category unknown: #{event['category']}") unless WORK_CATEGORIES.include?(event["category"])
      error("#{context}.base_score must be non-negative") unless event["base_score"].is_a?(Numeric) && event["base_score"] >= 0
      %w[cooldown_seconds daily_soft_cap max_score_per_event].each do |key|
        next unless event.key?(key)
        error("#{context}.#{key} must be non-negative") unless event[key].is_a?(Numeric) && event[key] >= 0
      end
    end
  end

  def validate_hazards
    seen = Set.new
    hazards.each do |hazard|
      context = file_context("hazards.yaml", "hazard #{hazard['id'] || '(missing id)'}")
      require_keys(hazard, context, %w[id display_name trigger effects])
      error("duplicate hazard id #{hazard['id']}") unless seen.add?(hazard["id"])
      ref_exists(hazard.dig("trigger", "source"), context, "trigger.source", HAZARD_TRIGGER_SOURCES, noun: "trigger source")
      chance = hazard.dig("trigger", "base_chance")
      error("#{context}.trigger.base_chance must be 0..1") unless chance.is_a?(Numeric) && chance >= 0 && chance <= 1
      validate_min_max(hazard.dig("effects", "suit_damage"), "#{context}.effects.suit_damage", integer: true, positive: true) if hazard.dig("effects", "suit_damage")
      resource_loss_id = hazard.dig("effects", "resource_loss", "material_id")
      ref_exists(resource_loss_id, context, "effects.resource_loss.material_id", material_ids) if resource_loss_id
      validate_percent_range(hazard.dig("effects", "resource_loss"), "#{context}.effects.resource_loss") if hazard.dig("effects", "resource_loss")
      validate_effect_target(hazard.dig("effects", "stat_penalty", "target"), context, "effects.stat_penalty.target", HAZARD_EFFECT_TARGETS) if hazard.dig("effects", "stat_penalty")
      validate_percent_range(hazard.dig("effects", "stat_penalty"), "#{context}.effects.stat_penalty") if hazard.dig("effects", "stat_penalty")
      validate_effect_target(hazard.dig("effects", "bonus_roll", "target"), context, "effects.bonus_roll.target", HAZARD_EFFECT_TARGETS) if hazard.dig("effects", "bonus_roll")
      chance = hazard.dig("effects", "bonus_roll", "chance")
      error("#{context}.effects.bonus_roll.chance must be 0..1") if hazard.dig("effects", "bonus_roll") && !(chance.is_a?(Numeric) && chance >= 0 && chance <= 1)
      validate_effect_target(hazard.dig("effects", "production_penalty", "target"), context, "effects.production_penalty.target", HAZARD_EFFECT_TARGETS) if hazard.dig("effects", "production_penalty")
      validate_percent_range(hazard.dig("effects", "production_penalty"), "#{context}.effects.production_penalty") if hazard.dig("effects", "production_penalty")
      upgrade_id = hazard.dig("mitigated_by", "upgrade_id")
      ref_exists(upgrade_id, context, "mitigated_by.upgrade_id", upgrade_ids) if upgrade_id
      formula_id = hazard.dig("mitigated_by", "mitigation_formula")
      ref_exists(formula_id, context, "mitigated_by.mitigation_formula", FORMULA_IDS, noun: "formula id") if formula_id
    end
  end

  def validate_player_start
    start = @data["player_start.yaml"]["player_start"] || {}
    context = file_context("player_start.yaml", "player_start")
    error("#{context}.space_bucks must be non-negative") unless start["space_bucks"].is_a?(Numeric) && start["space_bucks"] >= 0
    (start["inventory"] || {}).each do |id, quantity|
      ref_exists(id, context, "inventory", material_ids)
      positive_integer(quantity, "#{context}.inventory.#{id}", allow_zero: true)
    end
    Array(start["unlocked_machine_ids"]).each { |id| ref_exists(id, context, "unlocked_machine_ids", machine_ids) }
    Array(start["unlocked_asteroid_class_ids"]).each { |id| ref_exists(id, context, "unlocked_asteroid_class_ids", asteroid_ids) }
    ref_exists(start["current_asteroid_class_id"], context, "current_asteroid_class_id", asteroid_ids)
    unless Array(start["unlocked_asteroid_class_ids"]).include?(start["current_asteroid_class_id"])
      error("#{context}.current_asteroid_class_id must be included in unlocked_asteroid_class_ids")
    end
    Array(start["unlocked_machine_ids"]).each do |id|
      machine = machine_by_id[id]
      error("#{context}.unlocked_machine_ids includes locked machine #{id}") if machine && machine["starts_unlocked"] != true
    end
    (start["upgrades"] || {}).each do |id, level|
      ref_exists(id, context, "upgrades", upgrade_ids)
      positive_integer(level, "#{context}.upgrades.#{id}", allow_zero: true)
      max_level = upgrade_by_id.dig(id, "max_level")
      error("#{context}.upgrades.#{id} exceeds max_level #{max_level}") if level.is_a?(Integer) && max_level.is_a?(Integer) && level > max_level
    end
    (start["base_modules"] || {}).each do |id, level|
      ref_exists(id, context, "base_modules", base_module_ids)
      positive_integer(level, "#{context}.base_modules.#{id}", allow_zero: true)
      max_level = base_module_by_id.dig(id, "max_level")
      error("#{context}.base_modules.#{id} exceeds max_level #{max_level}") if level.is_a?(Integer) && max_level.is_a?(Integer) && level > max_level
    end
    ref_exists(start["report_mode"], context, "report_mode", REPORT_MODES, noun: "report mode")
  end

  def validate_reports
    templates = @data["report_templates.yaml"]["report_templates"] || {}
    %w[compact full no_progress order_progress milestone].each do |mode|
      values = templates[mode]
      error("report_templates.#{mode} must contain at least one template") unless values.is_a?(Array) && !values.empty?
      Array(values).each_with_index do |template, index|
        context = file_context("report_templates.yaml", "report_templates.#{mode}[#{index}]")
        unless template.is_a?(String) && !template.empty?
          error("#{context} must be a non-empty string")
          next
        end
        validate_report_placeholders(template, context)
        PRIVATE_REPORT_TOKENS.each do |token|
          error("#{context} contains private work token #{token}") if template.include?("{#{token}}")
        end
      end
    end
  end

  def validate_subscription_plans
    pricing = subscription_pricing
    context = file_context("subscription_plans.yaml", "subscription_pricing")
    require_keys(pricing, context, %w[currency supported_currencies trial_eligibility grace_period_days annual_months_charged provider_price_ids])
    supported = Array(pricing["supported_currencies"])
    error("#{context}.currency must be supported") unless supported.include?(pricing["currency"])
    error("#{context}.currency must be usd") unless pricing["currency"] == "usd"
    positive_integer(pricing["grace_period_days"], "#{context}.grace_period_days", allow_zero: true)
    positive_integer(pricing["annual_months_charged"], "#{context}.annual_months_charged")
    error("#{context}.annual_months_charged must be 11") unless pricing["annual_months_charged"] == 11

    trial = pricing["trial_eligibility"] || {}
    require_keys(trial, "#{context}.trial_eligibility", %w[enabled days one_trial_per_account])
    error("#{context}.trial_eligibility.enabled must be boolean") unless boolean?(trial["enabled"])
    positive_integer(trial["days"], "#{context}.trial_eligibility.days", allow_zero: true)
    error("#{context}.trial_eligibility.one_trial_per_account must be boolean") unless boolean?(trial["one_trial_per_account"])

    validate_provider_price_ids(pricing["provider_price_ids"], context)
    validate_subscription_plan_entries(pricing)
    validate_downgrade_policy
  end

  def finish
    if @errors.any?
      warn "Data validation failed:"
      @errors.each { |err| warn "  - #{err}" }
      exit 1
    end

    puts "Data validation passed"
    puts "  materials: #{materials.length} (elements: #{materials.count { |m| m['category'] == 'element' }})"
    puts "  machines: #{machines.length}"
    puts "  recipes: #{recipes.length}"
    puts "  order variants: #{order_variants.length}"
    puts "  asteroid classes: #{asteroid_classes.length}"
    puts "  upgrades: #{upgrades.length}"
    puts "  hazards: #{hazards.length}"
    puts "  subscription plans: #{subscription_plans.length}"
  end

  def validate_provider_price_ids(provider_price_ids, context)
    unless provider_price_ids.is_a?(Hash)
      error("#{context}.provider_price_ids must be a hash")
      return
    end

    %w[stripe crypto_wallet].each do |provider|
      %w[test live].each do |environment|
        %w[pro_monthly pro_annual].each do |plan_id|
          value = provider_price_ids.dig(provider, environment, plan_id)
          unless value.is_a?(String) && !value.empty?
            error("#{context}.provider_price_ids.#{provider}.#{environment}.#{plan_id} must be configured")
          end
        end
      end
    end
  end

  def validate_subscription_plan_entries(pricing)
    ids = Set.new
    subscription_plans.each do |plan|
      context = file_context("subscription_plans.yaml", "plan #{plan['id'] || '(missing id)'}")
      require_keys(plan, context, %w[id public_name internal_name billing_interval monthly_price_cents annual_price_cents short_copy privacy_copy progression_copy entitlements])
      error("duplicate subscription plan id #{plan['id']}") unless ids.add?(plan["id"])
      error("#{context}.public_name must be present") unless plan["public_name"].is_a?(String) && !plan["public_name"].empty?
      error("#{context}.short_copy must be present") unless plan["short_copy"].is_a?(String) && !plan["short_copy"].empty?
      error("#{context}.privacy_copy must mention privacy-safe sync boundaries") unless plan["privacy_copy"].to_s.match?(/not prompts, code, files, terminal output, or transcripts/)
      error("#{context}.progression_copy must reject pay-to-win progression") unless plan["progression_copy"].to_s.match?(/Does not boost mining output/)
      validate_subscription_entitlements(plan["entitlements"], context)
    end

    expected_ids = %w[free pro_monthly pro_annual]
    error("data/subscription_plans.yaml must define exactly #{expected_ids.join(', ')} plans") unless ids == Set.new(expected_ids)

    plan_map = subscription_plans.each_with_object({}) { |plan, acc| acc[plan["id"]] = plan }
    free = plan_map["free"] || {}
    pro_monthly = plan_map["pro_monthly"] || {}
    pro_annual = plan_map["pro_annual"] || {}

    validate_free_plan(free)
    validate_pro_plan(pro_monthly, "pro_monthly")
    validate_pro_plan(pro_annual, "pro_annual")

    monthly_price = pro_monthly["monthly_price_cents"]
    annual_price = pro_annual["annual_price_cents"]
    months_charged = pricing["annual_months_charged"]
    if [monthly_price, annual_price, months_charged].all? { |value| value.is_a?(Integer) }
      unless annual_price == monthly_price * months_charged
        error("data/subscription_plans.yaml pro_annual annual_price_cents must equal pro_monthly monthly_price_cents * annual_months_charged")
      end
    end
    if pro_annual["monthly_price_cents"].is_a?(Integer) && monthly_price.is_a?(Integer)
      error("data/subscription_plans.yaml pro_annual monthly_price_cents must match pro_monthly monthly_price_cents") unless pro_annual["monthly_price_cents"] == monthly_price
    end
    unless pro_monthly["entitlements"] == pro_annual["entitlements"]
      error("data/subscription_plans.yaml pro_annual entitlements must match pro_monthly entitlements")
    end
  end

  def validate_subscription_entitlements(entitlements, context)
    require_keys(
      entitlements,
      "#{context}.entitlements",
      %w[
        max_codex_devices
        sync_cadence_seconds
        near_real_time_sync
        manual_refresh
        device_management
        backup_restore
        history_retention_days
        advanced_dashboard
        premium_cosmetics
        weekly_digest
        exports
        priority_beta_access
      ]
    )
    return unless entitlements.is_a?(Hash)

    positive_integer(entitlements["max_codex_devices"], "#{context}.entitlements.max_codex_devices")
    positive_integer(entitlements["sync_cadence_seconds"], "#{context}.entitlements.sync_cadence_seconds")
    positive_integer(entitlements["history_retention_days"], "#{context}.entitlements.history_retention_days")
    %w[
      near_real_time_sync
      manual_refresh
      device_management
      backup_restore
      advanced_dashboard
      premium_cosmetics
      weekly_digest
      exports
      priority_beta_access
    ].each do |key|
      error("#{context}.entitlements.#{key} must be boolean") unless boolean?(entitlements[key])
    end
  end

  def validate_free_plan(plan)
    context = file_context("subscription_plans.yaml", "free")
    error("#{context}.billing_interval must be none") unless plan["billing_interval"] == "none"
    error("#{context}.monthly_price_cents must be 0") unless plan["monthly_price_cents"] == 0
    error("#{context}.annual_price_cents must be 0") unless plan["annual_price_cents"] == 0
    error("#{context} entitlements.max_codex_devices must be 1") unless plan.dig("entitlements", "max_codex_devices") == 1
    error("#{context} entitlements.sync_cadence_seconds must be 60") unless plan.dig("entitlements", "sync_cadence_seconds") == 60
    error("#{context} entitlements.near_real_time_sync must be false") unless plan.dig("entitlements", "near_real_time_sync") == false
  end

  def validate_pro_plan(plan, id)
    context = file_context("subscription_plans.yaml", id)
    expected_interval = id == "pro_annual" ? "annual" : "monthly"
    error("#{context}.billing_interval must be #{expected_interval}") unless plan["billing_interval"] == expected_interval
    positive_integer(plan["monthly_price_cents"], "#{context}.monthly_price_cents")
    if id == "pro_monthly"
      error("#{context}.annual_price_cents must be null") unless plan["annual_price_cents"].nil?
    else
      positive_integer(plan["annual_price_cents"], "#{context}.annual_price_cents")
    end
    error("#{context} entitlements.max_codex_devices must be 5") unless plan.dig("entitlements", "max_codex_devices") == 5
    error("#{context} entitlements.sync_cadence_seconds must be less than 60") unless plan.dig("entitlements", "sync_cadence_seconds").is_a?(Integer) && plan.dig("entitlements", "sync_cadence_seconds") < 60
    error("#{context} entitlements.near_real_time_sync must be true") unless plan.dig("entitlements", "near_real_time_sync") == true
  end

  def validate_downgrade_policy
    policy = @data["subscription_plans.yaml"]["downgrade_policy"] || {}
    context = file_context("subscription_plans.yaml", "downgrade_policy")
    require_keys(policy, context, %w[effective_at entitlement_after_cancellation failed_payment_grace_period_days max_active_devices_after_downgrade extra_devices_after_downgrade history_after_downgrade backup_restore_after_downgrade support_summary])
    error("#{context}.effective_at must be subscription_period_end") unless policy["effective_at"] == "subscription_period_end"
    error("#{context}.entitlement_after_cancellation must be free") unless policy["entitlement_after_cancellation"] == "free"
    positive_integer(policy["failed_payment_grace_period_days"], "#{context}.failed_payment_grace_period_days", allow_zero: true)
    error("#{context}.failed_payment_grace_period_days must match subscription_pricing.grace_period_days") unless policy["failed_payment_grace_period_days"] == subscription_pricing["grace_period_days"]
    error("#{context}.max_active_devices_after_downgrade must be 1") unless policy["max_active_devices_after_downgrade"] == 1
    %w[extra_devices_after_downgrade history_after_downgrade backup_restore_after_downgrade support_summary].each do |key|
      error("#{context}.#{key} must be clear user/support copy") unless policy[key].is_a?(String) && policy[key].length >= 24
    end
  end

  def validate_upgrade_effect(effect, context)
    require_keys(effect, "#{context}.effect", %w[type target formula])
    return unless effect.is_a?(Hash)

    ref_exists(effect["type"], context, "effect.type", UPGRADE_EFFECT_TYPES, noun: "effect type")
    validate_effect_target(effect["target"], context, "effect.target", UPGRADE_EFFECT_TARGETS)
    error("#{context}.effect.formula must be a non-empty formula string") unless effect["formula"].is_a?(String) && !effect["formula"].empty?
  end

  def validate_effects(effects, context, allowed_targets)
    error("#{context}.effects must contain at least one effect") if effects.empty?
    effects.each_with_index do |effect, index|
      effect_context = "#{context}.effects[#{index}]"
      require_keys(effect, effect_context, %w[target formula])
      next unless effect.is_a?(Hash)

      validate_effect_target(effect["target"], effect_context, "target", allowed_targets)
      error("#{effect_context}.formula must be a non-empty formula string") unless effect["formula"].is_a?(String) && !effect["formula"].empty?
    end
  end

  def validate_effect_target(target, context, field, allowed_targets)
    ref_exists(target, context, field, allowed_targets, noun: "target")
  end

  def validate_base_module_cycles
    visiting = Set.new
    visited = Set.new

    walk = lambda do |id, stack|
      return if visited.include?(id)

      if visiting.include?(id)
        cycle = (stack + [id]).join(" -> ")
        error("data/base_modules.yaml base module dependency cycle: #{cycle}")
        return
      end

      visiting.add(id)
      Array(base_module_by_id.dig(id, "unlock", "required_modules")).each do |required_id|
        walk.call(required_id, stack + [id]) if base_module_ids.include?(required_id)
      end
      visiting.delete(id)
      visited.add(id)
    end

    base_module_ids.each { |id| walk.call(id, []) }
  end

  def validate_tier_ranges(ranges, context, integer:)
    unless ranges.is_a?(Hash) && !ranges.empty?
      error("#{context} must be a non-empty tier range map")
      return
    end

    ranges.each do |tier, range|
      tier_context = "#{context}.#{tier}"
      positive_integer(tier, "#{tier_context}.tier") unless tier.is_a?(Integer) && tier.positive?
      validate_min_max(range, tier_context, integer: integer, positive: true)
    end
  end

  def validate_min_max(range, context, integer: false, positive: false)
    unless range.is_a?(Hash)
      error("#{context} must be a hash with min and max")
      return
    end

    min = range["min"]
    max = range["max"]
    if integer
      positive_integer(min, "#{context}.min", allow_zero: !positive)
      positive_integer(max, "#{context}.max", allow_zero: !positive)
    else
      positive ? positive_number(min, "#{context}.min") : numeric(min, "#{context}.min")
      positive ? positive_number(max, "#{context}.max") : numeric(max, "#{context}.max")
    end
    error("#{context} min must be <= max") if min.is_a?(Numeric) && max.is_a?(Numeric) && min > max
  end

  def validate_min_mode_max(range, context)
    unless range.is_a?(Hash)
      error("#{context} must be a hash with min, mode, and max")
      return
    end

    min = range["min"]
    mode = range["mode"]
    max = range["max"]
    positive_number(min, "#{context}.min")
    positive_number(mode, "#{context}.mode")
    positive_number(max, "#{context}.max")
    if [min, mode, max].all? { |value| value.is_a?(Numeric) }
      error("#{context}.min must be <= mode") unless min <= mode
      error("#{context}.mode must be <= max") unless mode <= max
    end
  end

  def validate_percent_range(range, context)
    min = range["percent_min"]
    max = range["percent_max"]
    validate_chance(min, "#{context}.percent_min")
    validate_chance(max, "#{context}.percent_max")
    error("#{context}.percent_min must be <= percent_max") if min.is_a?(Numeric) && max.is_a?(Numeric) && min > max
  end

  def validate_chance(value, context)
    error("#{context} must be 0..1") unless value.is_a?(Numeric) && value >= 0 && value <= 1
  end

  def validate_report_placeholders(template, context)
    template.scan(/\{([^{}]+)\}/).flatten.each do |placeholder|
      error("#{context} references unknown placeholder #{placeholder}") unless REPORT_PLACEHOLDERS.include?(placeholder)
    end
  end

  def required_materials_for(recipe, variant, quantity, context)
    multiplier = variant["recipe_quantity_multiplier"].to_f
    required = Hash.new(0)
    Array(recipe["inputs"]).each do |input|
      next unless input.is_a?(Hash)

      required[input["material_id"]] += (input["quantity"].to_i * multiplier).ceil * quantity
    end

    if variant["adds_refined_primary"]
      primary_id = recipe["primary_material_id"]
      material = material_by_id[primary_id]
      if material && material["can_refine"] != true
        error("#{context} requires refined primary material #{primary_id}, but it cannot refine")
      end
      required["refined:#{primary_id}"] += variant["refined_primary_quantity"].to_i * quantity
    end

    if variant["adds_collector_accent"]
      accent = recipe["collector_accent"] || {}
      required[accent["material_id"]] += accent["quantity"].to_i * variant["collector_accent_quantity"].to_i * quantity
    end

    required
  end

  def material_value(material_id, quantity, context)
    lookup_id = material_id.to_s.sub(/^refined:/, "")
    material = material_by_id[lookup_id]
    unless material
      error("#{context} required material #{material_id} references unknown material #{lookup_id}")
      return 0
    end

    value = if material_id.to_s.start_with?("refined:")
      material["refined_space_bucks"]
    else
      material["raw_space_bucks"]
    end
    unless value.is_a?(Numeric) && value.positive?
      error("#{context} required material #{material_id} has no positive Space Bucks value")
      return 0
    end

    value * quantity.to_i
  end

  def require_keys(hash, context, keys)
    unless hash.is_a?(Hash)
      error("#{context} must be a hash")
      return
    end
    keys.each { |key| error("#{context} missing #{key}") unless hash.key?(key) }
  end

  def ref_exists(id, context, field, set, noun: "id")
    error("#{context}.#{field} is missing") if id.nil?
    error("#{context}.#{field} references unknown #{noun} #{id}") unless id.nil? || set.include?(id)
  end

  def positive_number(value, context)
    error("#{context} must be a positive number") unless value.is_a?(Numeric) && value.positive?
  end

  def numeric(value, context)
    error("#{context} must be numeric") unless value.is_a?(Numeric)
  end

  def positive_integer(value, context, allow_zero: false)
    ok = value.is_a?(Integer) && (allow_zero ? value >= 0 : value.positive?)
    error("#{context} must be #{allow_zero ? 'a non-negative' : 'a positive'} integer") unless ok
  end

  def boolean?(value)
    value == true || value == false
  end

  def file_context(file, context)
    "data/#{file} #{context}"
  end

  def error(message)
    @errors << message
  end

  def rarity_map
    @data["rarity_tiers.yaml"]["rarities"] || {}
  end

  def materials
    @data["materials.yaml"]["materials"] || []
  end

  def material_ids
    @material_ids ||= Set.new(materials.map { |m| m["id"] })
  end

  def material_by_id
    @material_by_id ||= materials.each_with_object({}) { |mat, acc| acc[mat["id"]] = mat }
  end

  def aliases
    @data["material_aliases.yaml"]["aliases"] || {}
  end

  def machines
    @data["fabrication_machines.yaml"]["machines"] || []
  end

  def machine_ids
    @machine_ids ||= Set.new(machines.map { |m| m["id"] })
  end

  def machine_by_id
    @machine_by_id ||= machines.each_with_object({}) { |m, acc| acc[m["id"]] = m }
  end

  def recipes
    @data["recipes.yaml"]["recipes"] || []
  end

  def order_variants
    @data["order_variants.yaml"]["order_variants"] || []
  end

  def buyers
    @data["buyers.yaml"]["buyers"] || []
  end

  def asteroid_classes
    @data["asteroid_classes.yaml"]["asteroid_classes"] || []
  end

  def asteroid_ids
    @asteroid_ids ||= Set.new(asteroid_classes.map { |a| a["id"] })
  end

  def upgrades
    @data["upgrades.yaml"]["upgrades"] || []
  end

  def upgrade_ids
    @upgrade_ids ||= Set.new(upgrades.map { |u| u["id"] })
  end

  def upgrade_by_id
    @upgrade_by_id ||= upgrades.each_with_object({}) { |upgrade, acc| acc[upgrade["id"]] = upgrade }
  end

  def hazards
    @data["hazards.yaml"]["hazards"] || []
  end

  def base_modules
    @data["base_modules.yaml"]["base_modules"] || []
  end

  def base_module_ids
    @base_module_ids ||= Set.new(base_modules.map { |m| m["id"] })
  end

  def base_module_by_id
    @base_module_by_id ||= base_modules.each_with_object({}) { |mod, acc| acc[mod["id"]] = mod }
  end

  def work_events
    @data["work_scoring.yaml"]["work_events"] || []
  end

  def subscription_pricing
    @data["subscription_plans.yaml"]["subscription_pricing"] || {}
  end

  def subscription_plans
    @data["subscription_plans.yaml"]["plans"] || []
  end
end

Validator.new.run
