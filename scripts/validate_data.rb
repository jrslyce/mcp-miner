#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"
require "set"

ROOT = File.expand_path("..", __dir__)
DATA_DIR = File.join(ROOT, "data")

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
    validate_order_generator
    validate_buyers
    validate_asteroids
    validate_work_scoring
    validate_hazards
    validate_player_start
    validate_reports
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
      context = "base module #{mod['id'] || '(missing id)'}"
      require_keys(mod, context, %w[id display_name max_level unlock effects material_costs])
      error("duplicate base module id #{mod['id']}") unless seen.add?(mod["id"])
      error("#{context}.max_level must be positive") unless mod["max_level"].is_a?(Integer) && mod["max_level"].positive?
      Array(mod.dig("unlock", "required_modules")).each do |id|
        ref_exists(id, context, "unlock.required_modules", base_module_ids)
      end
      Array(mod["material_costs"]).each do |cost|
        ref_exists(cost["material_id"], context, "material_costs.material_id", material_ids)
        positive_integer(cost["base_quantity"], "#{context}.material_costs.base_quantity", allow_zero: true)
      end
    end
  end

  def validate_upgrades
    seen = Set.new
    upgrades.each do |upgrade|
      context = "upgrade #{upgrade['id'] || '(missing id)'}"
      require_keys(upgrade, context, %w[id display_name max_level cost effect material_basket])
      error("duplicate upgrade id #{upgrade['id']}") unless seen.add?(upgrade["id"])
      error("#{context}.max_level must be positive") unless upgrade["max_level"].is_a?(Integer) && upgrade["max_level"].positive?
      positive_number(upgrade.dig("cost", "base_space_bucks"), "#{context}.cost.base_space_bucks")
      positive_number(upgrade.dig("cost", "growth_rate"), "#{context}.cost.growth_rate")

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
      context = "machine #{machine['id'] || '(missing id)'}"
      require_keys(machine, context, %w[id display_name progression_tier starts_unlocked unlock throughput quality allowed_material_bands])
      error("duplicate machine id #{machine['id']}") unless seen.add?(machine["id"])
      error("#{context}.progression_tier must be positive") unless machine["progression_tier"].is_a?(Integer) && machine["progression_tier"].positive?
      positive_number(machine.dig("throughput", "base_progress_per_turn"), "#{context}.throughput.base_progress_per_turn")
      positive_integer(machine.dig("throughput", "max_queue_size"), "#{context}.throughput.max_queue_size")
      positive_integer(machine.dig("quality", "max_quality_grade"), "#{context}.quality.max_quality_grade", allow_zero: true)
      Array(machine.dig("unlock", "required_base_modules")).each do |id|
        ref_exists(id, context, "unlock.required_base_modules", base_module_ids)
      end
      Array(machine.dig("unlock", "required_upgrades")).each do |entry|
        id = entry.is_a?(Hash) ? entry.keys.first : entry
        ref_exists(id, context, "unlock.required_upgrades", upgrade_ids)
      end
      Array(machine["allowed_material_bands"]).each do |id|
        ref_exists(id, context, "allowed_material_bands", material_ids)
      end
    end
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
    positive_integer(cfg["active_order_slots"], "order_generation.active_order_slots")
    positive_number(cfg["refresh_cadence_hours"], "order_generation.refresh_cadence_hours")
    chance = cfg.dig("windfall", "chance")
    error("order_generation.windfall.chance must be 0..1") unless chance.is_a?(Numeric) && chance >= 0 && chance <= 1
    if cfg.dig("windfall", "min_multiplier").is_a?(Numeric) && cfg.dig("normal_price_variation", "max").is_a?(Numeric)
      error("windfall min must exceed normal max") unless cfg.dig("windfall", "min_multiplier") > cfg.dig("normal_price_variation", "max")
    end
  end

  def validate_buyers
    seen = Set.new
    buyers.each do |buyer|
      context = "buyer #{buyer['id'] || '(missing id)'}"
      require_keys(buyer, context, %w[id display_name unlock_tier reputation_multiplier preferred_machine_ids preferred_material_ids])
      error("duplicate buyer id #{buyer['id']}") unless seen.add?(buyer["id"])
      positive_number(buyer["reputation_multiplier"], "#{context}.reputation_multiplier")
      Array(buyer["preferred_machine_ids"]).each { |id| ref_exists(id, context, "preferred_machine_ids", machine_ids) }
      Array(buyer["preferred_material_ids"]).each { |id| ref_exists(id, context, "preferred_material_ids", material_ids) }
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
      context = "hazard #{hazard['id'] || '(missing id)'}"
      require_keys(hazard, context, %w[id display_name trigger effects])
      error("duplicate hazard id #{hazard['id']}") unless seen.add?(hazard["id"])
      chance = hazard.dig("trigger", "base_chance")
      error("#{context}.trigger.base_chance must be 0..1") unless chance.is_a?(Numeric) && chance >= 0 && chance <= 1
      resource_loss_id = hazard.dig("effects", "resource_loss", "material_id")
      ref_exists(resource_loss_id, context, "effects.resource_loss.material_id", material_ids) if resource_loss_id
      upgrade_id = hazard.dig("mitigated_by", "upgrade_id")
      ref_exists(upgrade_id, context, "mitigated_by.upgrade_id", upgrade_ids) if upgrade_id
    end
  end

  def validate_player_start
    start = @data["player_start.yaml"]["player_start"] || {}
    error("player_start.space_bucks must be non-negative") unless start["space_bucks"].is_a?(Numeric) && start["space_bucks"] >= 0
    (start["inventory"] || {}).each_key { |id| ref_exists(id, "player_start", "inventory", material_ids) }
    Array(start["unlocked_machine_ids"]).each { |id| ref_exists(id, "player_start", "unlocked_machine_ids", machine_ids) }
    Array(start["unlocked_asteroid_class_ids"]).each { |id| ref_exists(id, "player_start", "unlocked_asteroid_class_ids", asteroid_ids) }
    ref_exists(start["current_asteroid_class_id"], "player_start", "current_asteroid_class_id", asteroid_ids)
    (start["upgrades"] || {}).each do |id, level|
      ref_exists(id, "player_start", "upgrades", upgrade_ids)
      positive_integer(level, "player_start.upgrades.#{id}", allow_zero: true)
    end
    (start["base_modules"] || {}).each do |id, level|
      ref_exists(id, "player_start", "base_modules", base_module_ids)
      positive_integer(level, "player_start.base_modules.#{id}", allow_zero: true)
    end
  end

  def validate_reports
    templates = @data["report_templates.yaml"]["report_templates"] || {}
    %w[compact full no_progress order_progress milestone].each do |mode|
      values = templates[mode]
      error("report_templates.#{mode} must contain at least one template") unless values.is_a?(Array) && !values.empty?
    end
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
  end

  def require_keys(hash, context, keys)
    unless hash.is_a?(Hash)
      error("#{context} must be a hash")
      return
    end
    keys.each { |key| error("#{context} missing #{key}") unless hash.key?(key) }
  end

  def ref_exists(id, context, field, set)
    error("#{context}.#{field} is missing") if id.nil?
    error("#{context}.#{field} references unknown id #{id}") unless id.nil? || set.include?(id)
  end

  def positive_number(value, context)
    error("#{context} must be a positive number") unless value.is_a?(Numeric) && value.positive?
  end

  def positive_integer(value, context, allow_zero: false)
    ok = value.is_a?(Integer) && (allow_zero ? value >= 0 : value.positive?)
    error("#{context} must be #{allow_zero ? 'a non-negative' : 'a positive'} integer") unless ok
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

  def hazards
    @data["hazards.yaml"]["hazards"] || []
  end

  def base_modules
    @data["base_modules.yaml"]["base_modules"] || []
  end

  def base_module_ids
    @base_module_ids ||= Set.new(base_modules.map { |m| m["id"] })
  end

  def work_events
    @data["work_scoring.yaml"]["work_events"] || []
  end
end

Validator.new.run
