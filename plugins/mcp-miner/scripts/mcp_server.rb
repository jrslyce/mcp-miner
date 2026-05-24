#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "yaml"
require "fileutils"
require "time"

class McpMinerServer
  PROTOCOL_VERSION = "2024-11-05"
  ROOT = File.expand_path("../../..", __dir__)
  DATA_DIR = File.join(ROOT, "data")
  STATE_DIR = File.join(Dir.home, ".mcp-miner")
  DEFAULT_STATE_PATH = File.join(STATE_DIR, "state.json")

  def initialize
    @data = load_data
    FileUtils.mkdir_p(STATE_DIR)
  end

  def run
    $stdout.sync = true
    $stderr.sync = true

    STDIN.each_line do |line|
      next if line.strip.empty?

      request = JSON.parse(line)
      response = handle(request)
      $stdout.puts(JSON.generate(response)) if response
    rescue JSON::ParserError => e
      warn "MCP Miner JSON parse error: #{e.message}"
    rescue StandardError => e
      warn "MCP Miner server error: #{e.class}: #{e.message}"
      if request && request["id"]
        $stdout.puts(JSON.generate(error_response(request["id"], -32_603, e.message)))
      end
    end
  end

  private

  def load_data
    files = {
      materials: "materials.yaml",
      machines: "fabrication_machines.yaml",
      recipes: "recipes.yaml",
      variants: "order_variants.yaml",
      order_generator: "order_generator.yaml",
      buyers: "buyers.yaml",
      asteroids: "asteroid_classes.yaml",
      upgrades: "upgrades.yaml",
      hazards: "hazards.yaml",
      player_start: "player_start.yaml",
      reports: "report_templates.yaml"
    }

    files.transform_values do |file|
      path = File.join(DATA_DIR, file)
      raise "Missing gameplay data file: #{path}" unless File.exist?(path)

      YAML.load_file(path)
    end
  end

  def handle(request)
    method = request["method"]
    id = request["id"]

    case method
    when "initialize"
      result(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: {
          name: "mcp-miner",
          version: "0.1.0"
        },
        capabilities: {
          tools: {}
        }
      })
    when "notifications/initialized", "initialized"
      nil
    when "tools/list"
      result(id, { tools: tools })
    when "tools/call"
      call_tool(id, request.dig("params", "name"), request.dig("params", "arguments") || {})
    else
      id ? error_response(id, -32_601, "Unknown method: #{method}") : nil
    end
  end

  def tools
    [
      {
        name: "get_player_status",
        description: "Return the local MCP Miner player status, inventory summary, settings, and current asteroid.",
        inputSchema: object_schema({})
      },
      {
        name: "get_latest_report",
        description: "Return the latest compact MCP Miner report.",
        inputSchema: object_schema({})
      },
      {
        name: "get_active_orders",
        description: "Return currently generated MCP Miner orders with required materials and Space Bucks payouts.",
        inputSchema: object_schema({})
      },
      {
        name: "get_catalog_summary",
        description: "Return counts and loaded gameplay-data summary for the MCP Miner catalog.",
        inputSchema: object_schema({})
      },
      {
        name: "update_settings",
        description: "Update local MCP Miner settings such as report mode or cloud sync preference.",
        inputSchema: object_schema({
          report_mode: {
            type: "string",
            enum: %w[off every_turn_compact every_turn_full meaningful_turns_only session_summary_only milestones_only]
          },
          cloud_sync: {
            type: "boolean"
          }
        })
      },
      {
        name: "open_dashboard",
        description: "Return the MCP Miner dashboard URL.",
        inputSchema: object_schema({})
      },
      {
        name: "open_store",
        description: "Return the MCP Miner in-game store URL.",
        inputSchema: object_schema({})
      }
    ]
  end

  def object_schema(properties)
    {
      type: "object",
      properties: properties,
      additionalProperties: false
    }
  end

  def call_tool(id, name, args)
    payload =
      case name
      when "get_player_status"
        player_status
      when "get_latest_report"
        latest_report
      when "get_active_orders"
        { orders: active_orders, generated_at: state["orders_generated_at"] }
      when "get_catalog_summary"
        catalog_summary
      when "update_settings"
        update_settings(args)
      when "open_dashboard"
        { dashboard_url: "http://localhost:3317/dashboard", note: "Dashboard server is not implemented yet; this is the reserved MVP URL." }
      when "open_store"
        { store_url: "http://localhost:3317/store", note: "Store UI is not implemented yet; this is the reserved in-game store URL." }
      else
        return error_response(id, -32_602, "Unknown tool: #{name}")
      end

    result(id, {
      content: [
        {
          type: "text",
          text: JSON.pretty_generate(payload)
        }
      ]
    })
  end

  def player_status
    s = state
    {
      player: {
        space_bucks: s["space_bucks"],
        report_mode: s["report_mode"],
        cloud_sync: s["cloud_sync"],
        suit_condition: s["suit_condition"] || 100
      },
      inventory: s["inventory"],
      current_asteroid: asteroid_summary(s["current_asteroid_class_id"]),
      asteroid_progress: s["asteroid_progress"] || {},
      unlocked_machines: s["unlocked_machine_ids"].map { |machine_id| machine_name(machine_id) },
      upgrades: s["upgrades"],
      stats: s["stats"] || {},
      project_stats: s["project_stats"] || {},
      agent_stats: s["agent_stats"] || {},
      latest_report: latest_report[:report]
    }
  end

  def latest_report
    existing_report = state.dig("latest_report", "text")
    if existing_report && !existing_report.empty?
      return {
        report: existing_report,
        source: "local_hook_state",
        privacy: "No prompts, code, file paths, repo names, or terminal output included."
      }
    end

    chonks = state.dig("inventory", "mat_chonks") || 0
    asteroid = asteroid_summary(state["current_asteroid_class_id"])
    {
      report: "MCP Miner: #{chonks} Chonks banked, #{asteroid[:display_name]} selected, orders ready.",
      source: "local_state",
      privacy: "No prompts, code, file paths, repo names, or terminal output included."
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
    s = state
    valid_modes = %w[off every_turn_compact every_turn_full meaningful_turns_only session_summary_only milestones_only]
    if args.key?("report_mode")
      mode = args["report_mode"]
      raise "Invalid report_mode #{mode.inspect}; expected one of #{valid_modes.join(', ')}" unless valid_modes.include?(mode)

      s["report_mode"] = mode
    end
    s["cloud_sync"] = !!args["cloud_sync"] if args.key?("cloud_sync")
    write_state(s)
    {
      ok: true,
      settings: {
        report_mode: s["report_mode"],
        cloud_sync: s["cloud_sync"]
      }
    }
  end

  def active_orders
    s = state
    if s["orders"].nil? || s["orders"].empty?
      s["orders"] = generate_orders
      s["orders_generated_at"] = Time.now.utc.iso8601
      write_state(s)
    end
    s["orders"]
  end

  def generate_orders
    generator = @data.dig(:order_generator, "order_generation")
    slots = generator["active_order_slots"]
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

  def nice_round(value)
    return 0 if value <= 0

    pow = 10**(Math.log10(value).floor - 1)
    (value / pow).ceil * pow
  end

  def state
    @state = if File.exist?(state_path)
      JSON.parse(File.read(state_path))
    else
      initial_state
    end
  end

  def initial_state
    start = @data.dig(:player_start, "player_start")
    {
      "space_bucks" => start["space_bucks"],
      "inventory" => start["inventory"],
      "unlocked_machine_ids" => start["unlocked_machine_ids"],
      "unlocked_asteroid_class_ids" => start["unlocked_asteroid_class_ids"],
      "current_asteroid_class_id" => start["current_asteroid_class_id"],
      "upgrades" => start["upgrades"],
      "base_modules" => start["base_modules"],
      "report_mode" => start["report_mode"],
      "cloud_sync" => false,
      "orders" => [],
      "suit_condition" => 100,
      "asteroid_progress" => {
        "asteroid_class_id" => start["current_asteroid_class_id"],
        "mined" => 0
      },
      "stats" => {
        "turns_seen" => 0,
        "tool_events_seen" => 0,
        "work_score_total" => 0.0,
        "chonks_mined_total" => 0,
        "materials_found_total" => 0,
        "reports_emitted" => 0,
        "work_events" => {}
      },
      "project_stats" => {},
      "agent_stats" => {},
      "dedupe_keys" => [],
      "current_turn" => nil,
      "latest_report" => nil,
      "created_at" => Time.now.utc.iso8601
    }
  end

  def write_state(next_state)
    @state = next_state
    FileUtils.mkdir_p(File.dirname(state_path))
    File.open("#{state_path}.lock", "w") do |lock|
      lock.flock(File::LOCK_EX)
      tmp_path = "#{state_path}.tmp"
      File.write(tmp_path, JSON.pretty_generate(next_state))
      File.rename(tmp_path, state_path)
    end
  end

  def state_path
    ENV["MCP_MINER_STATE_PATH"] || DEFAULT_STATE_PATH
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
    @data.dig(:materials, "materials") || []
  end

  def material_by_id
    @material_by_id ||= material_list.to_h { |mat| [mat["id"], mat] }
  end

  def machine_list
    @data.dig(:machines, "machines") || []
  end

  def machine_by_id
    @machine_by_id ||= machine_list.to_h { |machine| [machine["id"], machine] }
  end

  def recipe_list
    @data.dig(:recipes, "recipes") || []
  end

  def variant_list
    @data.dig(:variants, "order_variants") || []
  end

  def buyer_list
    @data.dig(:buyers, "buyers") || []
  end

  def asteroid_list
    @data.dig(:asteroids, "asteroid_classes") || []
  end

  def asteroid_by_id
    @asteroid_by_id ||= asteroid_list.to_h { |asteroid| [asteroid["id"], asteroid] }
  end

  def upgrade_list
    @data.dig(:upgrades, "upgrades") || []
  end

  def hazard_list
    @data.dig(:hazards, "hazards") || []
  end

  def result(id, payload)
    {
      jsonrpc: "2.0",
      id: id,
      result: payload
    }
  end

  def error_response(id, code, message)
    {
      jsonrpc: "2.0",
      id: id,
      error: {
        code: code,
        message: message
      }
    }
  end
end

McpMinerServer.new.run
