#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "time"
require "tmpdir"
require "yaml"
require_relative "../plugins/mcp-miner/lib/mcp_miner/game_engine"

module McpMiner
  class EconomySimulation
    ROOT = File.expand_path("..", __dir__)
    PROJECTIONS = [30, 100].freeze
    RARE_RARITIES = %w[rare dangerous fictional_rare legendary].freeze

    # Simulation assumptions. Gameplay values still come from data/*.yaml and GameEngine formulas.
    EVENT_MIX = [
      { category: "research", id: "work_search", line_count: 0 },
      { category: "coding", id: "work_apply_patch", line_count: 85 },
      { category: "testing", id: "work_test_pass", line_count: 0 },
      { category: "writing", id: "work_write_docs", line_count: 45 },
      { category: "shipping", id: "work_commit_or_pr", line_count: 0 }
    ].freeze
    MATERIAL_RESERVE_BASE = 8
    CHONK_RESERVE = 180
    MARKET_SELL_EVERY_N_SESSIONS = 2
    MARKET_SELL_FRACTION = 0.35
    UPGRADE_PURCHASES_PER_SESSION = 2
    ORDER_MIN_PREMIUM = 1.0
    WINDFALL_RATE_TOLERANCE = 0.07

    GDD_PAYBACK_TARGET = {
      base_sessions: 1.5,
      per_level_sessions: 0.14,
      per_phase_sessions: 0.35,
      phase_interval: 10,
      lower_ratio: 0.75,
      upper_ratio: 1.25
    }.freeze

    def initialize(root: ROOT, projections: PROJECTIONS)
      @root = root
      @projections = projections.sort
      @metrics = fresh_metrics
      @observed_order_ids = {}
      @observed_depletion_keys = {}
    end

    def run
      Dir.mktmpdir("mcp-miner-economy-sim") do |dir|
        @state_path = File.join(dir, "state.json")
        @engine = GameEngine.new(root: @root, state_path: @state_path)
        @engine.write_state(@engine.initial_state)
        @work_events = load_work_events
        @materials = @engine.material_list.to_h { |material| [material.fetch("id"), material] }

        projections = {}
        (1..@projections.max).each do |session_number|
          simulate_session(session_number)
          projections[session_number] = projection(session_number) if @projections.include?(session_number)
        end

        {
          ok: true,
          report: "mcp_miner_economy_balance",
          assumptions: assumptions,
          projections: projections.transform_keys(&:to_s)
        }
      end
    end

    def render_markdown(report)
      lines = []
      lines << "MCP Miner Economy Simulation"
      lines << ""
      lines << "Assumptions: #{report.fetch(:assumptions).fetch(:events_per_session)} meaningful work events/session, surplus market sales every #{MARKET_SELL_EVERY_N_SESSIONS} sessions, upgrades purchased only through live store rules."
      lines << ""

      report.fetch(:projections).each do |session_count, projection|
        lines << "#{session_count}-session projection"
        lines << "- Chonks banked: #{projection.dig(:inventory, :chonks)}"
        lines << "- Space Bucks: #{projection.dig(:space_bucks, :current)} current, #{projection.dig(:space_bucks, :earned_total)} earned, #{projection.dig(:space_bucks, :spent_total)} spent, #{projection.dig(:space_bucks, :average_earned_per_session)} avg/session"
        lines << "- Upgrades: #{format_upgrade_levels(projection.dig(:upgrades, :levels))}"
        lines << "- Orders: #{projection.dig(:orders, :completed)} completed, #{projection.dig(:orders, :observed)} observed, #{projection.dig(:orders, :average_payout)} avg payout, #{projection.dig(:orders, :average_premium)}x avg premium, #{projection.dig(:orders, :windfall_rate)} windfall rate"
        lines << "- Asteroids: #{projection.dig(:asteroids, :depleted)} depleted, current #{projection.dig(:asteroids, :current)}, unlocked #{projection.dig(:asteroids, :unlocked).join(", ")}"
        lines << "- Rare finds: #{projection.dig(:rare_finds, :count)} over #{projection.dig(:rare_finds, :reward_turns)} reward turns, rate #{projection.dig(:rare_finds, :rate)}, rare material units #{projection.dig(:rare_finds, :rare_material_units)}"
        lines << "- Flags: #{flag_summary(projection.fetch(:flags))}"
        top_flags(projection.fetch(:flags)).each { |flag| lines << "  - #{flag}" }
        lines << ""
      end

      lines.join("\n")
    end

    private

    def fresh_metrics
      {
        sessions_run: 0,
        reward_turns: 0,
        rare_finds: 0,
        rare_materials: Hash.new(0),
        order_payout_space_bucks: 0,
        market_space_bucks: 0,
        orders_completed: 0,
        order_payouts: [],
        order_premiums: [],
        orders_observed: 0,
        windfall_orders_observed: 0,
        market_sales: 0,
        purchases: [],
        asteroid_depletions: []
      }
    end

    def assumptions
      {
        session_counts: @projections,
        events_per_session: EVENT_MIX.length,
        event_mix: EVENT_MIX.map { |event| event.slice(:category, :id, :line_count) },
        order_refresh: "one in-game day per simulated session",
        material_reserve_base: MATERIAL_RESERVE_BASE,
        chonk_reserve: CHONK_RESERVE,
        market_sell_every_n_sessions: MARKET_SELL_EVERY_N_SESSIONS,
        market_sell_fraction: MARKET_SELL_FRACTION,
        upgrade_purchases_per_session: UPGRADE_PURCHASES_PER_SESSION,
        gdd_payback_target: GDD_PAYBACK_TARGET
      }
    end

    def load_work_events
      path = File.join(@root, "data", "work_scoring.yaml")
      YAML.load_file(path).fetch("work_events").to_h { |event| [event.fetch("id"), event] }
    end

    def simulate_session(session_number)
      @metrics[:sessions_run] = session_number
      expire_orders_for_session(session_number)
      observe_orders(@engine.active_orders_payload.fetch(:orders))
      EVENT_MIX.each_with_index do |event, index|
        apply_reward_event(event, session_number, index + 1)
      end
      observe_depletions
      fulfill_ready_orders
      sell_surplus_materials(session_number)
      buy_available_upgrades
    end

    def expire_orders_for_session(session_number)
      return if session_number == 1

      @engine.with_state do |current_state|
        current_state["orders"].each do |order|
          order["expires_at"] = "2000-01-01T00:00:00Z"
        end
        current_state["orders_refresh_due_at"] = "2000-01-01T00:00:00Z"
      end
    end

    def apply_reward_event(event, session_number, event_index)
      event_id = event.fetch(:id)
      raise "Unknown work event #{event_id}" unless @work_events.key?(event_id)

      turn_id = "sim-session-#{session_number}-turn-#{event_index}"
      score = @engine.event_score(event_id, event.fetch(:line_count, 0))
      reward = nil
      @engine.with_state do |current_state|
        reward = @engine.calculate_reward(current_state, event_id, score, turn_id: turn_id)
        @engine.send(:apply_journal_entry, current_state, reward_entry(event_id, score, reward, turn_id, session_number, event_index))
      end

      @metrics[:reward_turns] += 1
      @metrics[:rare_finds] += 1 if reward.fetch(:rare_find)
      reward.fetch(:materials).each do |material_id, quantity|
        next unless rare_material?(material_id)

        @metrics[:rare_materials][material_id] += quantity.to_i
      end
    end

    def reward_entry(event_id, score, reward, turn_id, session_number, event_index)
      {
        "event_id" => "sim:#{session_number}:#{event_index}:#{event_id}",
        "event_type" => event_id,
        "timestamp" => (Time.utc(2026, 1, 1) + (session_number * 86_400) + (event_index * 900)).iso8601,
        "privacy_class" => "abstract",
        "turn_id" => turn_id,
        "session_id" => "sim-session-#{session_number}",
        "project_id" => "economy-simulation",
        "score" => score,
        "rewards" => stringify_reward(reward),
        "reward_control" => {
          "raw_score" => score,
          "multiplier" => 1.0,
          "effective_score" => score,
          "reasons" => ["simulation_assumption"],
          "event_type" => event_id,
          "category" => @work_events.fetch(event_id).fetch("category"),
          "date" => (Time.utc(2026, 1, 1) + (session_number * 86_400)).strftime("%Y-%m-%d"),
          "privacy_class" => "abstract"
        }
      }
    end

    def stringify_reward(reward)
      {
        "chonks" => reward.fetch(:chonks),
        "materials" => reward.fetch(:materials),
        "asteroid_class_id" => reward.fetch(:asteroid_class_id),
        "asteroid_mined_delta" => reward.fetch(:asteroid_mined_delta),
        "suit_damage" => reward.fetch(:suit_damage),
        "rare_find" => reward.fetch(:rare_find),
        "rare_find_chance" => reward.fetch(:rare_find_chance),
        "hazard" => reward.fetch(:hazard)
      }.compact
    end

    def fulfill_ready_orders
      loop_guard = 0
      loop do
        loop_guard += 1
        break if loop_guard > 10

        orders = @engine.active_orders_payload.fetch(:orders)
        observe_orders(orders)
        ready = orders.select { |order| order["can_fulfill"] }.max_by { |order| order["payout_space_bucks"].to_i }
        break unless ready

        result = @engine.fulfill_order_payload("order_id" => ready.fetch("order_id"))
        next unless result[:ok]

        payout = result.fetch(:payout_space_bucks).to_i
        @metrics[:orders_completed] += 1
        @metrics[:order_payout_space_bucks] += payout
        @metrics[:order_payouts] << payout
        observe_orders([result[:replacement_order]]) if result[:replacement_order]
      end
    end

    def observe_orders(orders)
      orders.each do |order|
        order_id = order["order_id"]
        next if order_id.to_s.empty? || @observed_order_ids[order_id]

        @observed_order_ids[order_id] = true
        @metrics[:orders_observed] += 1
        @metrics[:windfall_orders_observed] += 1 if order["is_windfall"]
        premium_base = raw_material_value(order.fetch("required_materials", {}))
        @metrics[:order_premiums] << (order["payout_space_bucks"].to_f / premium_base) if premium_base.positive?
      end
    end

    def sell_surplus_materials(session_number)
      return unless (session_number % MARKET_SELL_EVERY_N_SESSIONS).zero?

      state = @engine.state
      sellable_materials(state).each do |material_id, quantity|
        reserve = material_id == "mat_chonks" ? CHONK_RESERVE : MATERIAL_RESERVE_BASE + (session_number / 10)
        surplus = quantity.to_i - reserve
        next unless surplus.positive?

        sale_quantity = [(surplus * MARKET_SELL_FRACTION).floor, 1].max
        result = @engine.sell_material_payload("material_id" => material_id, "quantity" => sale_quantity)
        next unless result[:ok]

        @metrics[:market_sales] += 1
        @metrics[:market_space_bucks] += result.fetch(:sale).fetch("payout_space_bucks").to_i
      end
    end

    def sellable_materials(state)
      state.fetch("inventory", {}).select do |material_id, quantity|
        quantity.to_i.positive? &&
          @materials.key?(material_id) &&
          @materials.fetch(material_id).fetch("raw_space_bucks").to_i.positive?
      end
    end

    def buy_available_upgrades
      UPGRADE_PURCHASES_PER_SESSION.times do
        candidates = @engine.store_catalog_payload.dig(:store, :categories, :upgrades).select { |item| item[:can_purchase] }
        candidate = candidates.max_by { |item| upgrade_priority(item) }
        break unless candidate

        result = @engine.purchase_store_item_payload("store_item_id" => candidate.fetch(:store_item_id))
        next unless result[:ok]

        @metrics[:purchases] << {
          kind: "upgrade",
          item_id: candidate.fetch(:upgrade_id),
          display_name: candidate.fetch(:display_name),
          spent_space_bucks: result.fetch(:spent).fetch(:space_bucks).to_i,
          new_level: result.fetch(:new_level).to_i
        }
      end
    end

    def upgrade_priority(item)
      effect_delta = item[:effect_delta].to_f
      affordability = item.dig(:cost_to_next, :space_bucks).to_i
      [(effect_delta * 1000).round, -affordability, item.fetch(:display_name)]
    end

    def observe_depletions
      @engine.state.fetch("asteroid_depletions", []).each do |depletion|
        key = [depletion["asteroid_class_id"], depletion["depleted_at"]].join(":")
        next if @observed_depletion_keys[key]

        @observed_depletion_keys[key] = true
        @metrics[:asteroid_depletions] << depletion
      end
    end

    def projection(session_number)
      state = @engine.state
      upgrade_payload = @engine.upgrade_status_payload(state)
      order_balance_flags = order_flags
      upgrade_balance_flags = upgrade_payback_flags(upgrade_payload.fetch(:upgrades), session_number)

      {
        sessions: session_number,
        inventory: inventory_summary(state),
        space_bucks: space_bucks_summary(state, session_number),
        upgrades: upgrade_summary(upgrade_payload.fetch(:upgrades), state),
        orders: order_summary,
        asteroids: asteroid_summary(state),
        rare_finds: rare_find_summary,
        flags: {
          upgrade_payback: upgrade_balance_flags,
          orders: order_balance_flags
        }
      }
    end

    def inventory_summary(state)
      inventory = state.fetch("inventory", {})
      {
        chonks: inventory.fetch("mat_chonks", 0).to_i,
        material_units: inventory.values.sum(&:to_i),
        rare_material_units: @metrics[:rare_materials].values.sum
      }
    end

    def space_bucks_summary(state, session_number)
      earned = @metrics[:order_payout_space_bucks] + @metrics[:market_space_bucks]
      spent = @metrics[:purchases].sum { |purchase| purchase.fetch(:spent_space_bucks) }
      {
        current: state.fetch("space_bucks", 0).to_i,
        earned_total: earned,
        spent_total: spent,
        from_orders: @metrics[:order_payout_space_bucks],
        from_market: @metrics[:market_space_bucks],
        average_earned_per_session: average(earned, session_number)
      }
    end

    def upgrade_summary(upgrades, state)
      {
        levels: state.fetch("upgrades", {}).sort.to_h,
        purchases: @metrics[:purchases].length,
        affordable_now: upgrades.count { |upgrade| upgrade[:can_purchase] },
        next_costs: upgrades.to_h do |upgrade|
          [upgrade.fetch(:upgrade_id), upgrade.dig(:cost_to_next, :space_bucks).to_i]
        end
      }
    end

    def order_summary
      {
        completed: @metrics[:orders_completed],
        observed: @metrics[:orders_observed],
        windfall_observed: @metrics[:windfall_orders_observed],
        windfall_rate: average(@metrics[:windfall_orders_observed], @metrics[:orders_observed]),
        average_payout: average(@metrics[:order_payouts].sum, @metrics[:order_payouts].length),
        average_premium: average(@metrics[:order_premiums].sum, @metrics[:order_premiums].length),
        market_sales: @metrics[:market_sales]
      }
    end

    def asteroid_summary(state)
      {
        current: state.fetch("current_asteroid_class_id"),
        depleted: @metrics[:asteroid_depletions].length,
        unlocked: state.fetch("unlocked_asteroid_class_ids", []),
        recent_depletions: @metrics[:asteroid_depletions].last(5).map { |entry| entry["asteroid_class_id"] }
      }
    end

    def rare_find_summary
      {
        count: @metrics[:rare_finds],
        reward_turns: @metrics[:reward_turns],
        rate: average(@metrics[:rare_finds], @metrics[:reward_turns]),
        rare_material_units: @metrics[:rare_materials].values.sum,
        rare_materials: @metrics[:rare_materials].sort.to_h
      }
    end

    def upgrade_payback_flags(upgrades, session_number)
      average_space_bucks = average(@metrics[:order_payout_space_bucks] + @metrics[:market_space_bucks], session_number)
      return [{ status: "blocked", reason: "No Space Bucks earned in simulation." }] unless average_space_bucks.positive?

      upgrades.map do |upgrade|
        next if upgrade[:is_maxed]

        level = upgrade.fetch(:level).to_i
        cost = upgrade.dig(:cost_to_next, :space_bucks).to_i
        target = target_sessions_to_afford(level)
        actual = cost / average_space_bucks
        ratio = actual / target
        next if ratio.between?(GDD_PAYBACK_TARGET.fetch(:lower_ratio), GDD_PAYBACK_TARGET.fetch(:upper_ratio))

        {
          upgrade_id: upgrade.fetch(:upgrade_id),
          display_name: upgrade.fetch(:display_name),
          level: level,
          next_cost_space_bucks: cost,
          actual_sessions_to_afford: actual.round(2),
          target_sessions_to_afford: target.round(2),
          ratio_to_target: ratio.round(2),
          status: ratio > GDD_PAYBACK_TARGET.fetch(:upper_ratio) ? "too_slow" : "too_fast"
        }
      end.compact.sort_by { |flag| -((flag[:ratio_to_target] - 1.0).abs) }
    end

    def order_flags
      flags = []
      average_premium = average(@metrics[:order_premiums].sum, @metrics[:order_premiums].length)
      if @metrics[:order_premiums].any? && average_premium < ORDER_MIN_PREMIUM
        flags << {
          status: "low_order_premium",
          average_premium: average_premium,
          target_minimum: ORDER_MIN_PREMIUM
        }
      end

      windfall_rate = average(@metrics[:windfall_orders_observed], @metrics[:orders_observed])
      expected = @engine.order_generator.dig("windfall", "chance").to_f
      if @metrics[:orders_observed] >= 20 && (windfall_rate - expected).abs > WINDFALL_RATE_TOLERANCE
        flags << {
          status: "windfall_rate_outside_target",
          observed_rate: windfall_rate,
          target_rate: expected,
          tolerance: WINDFALL_RATE_TOLERANCE,
          orders_observed: @metrics[:orders_observed]
        }
      end
      flags
    end

    def target_sessions_to_afford(level)
      GDD_PAYBACK_TARGET.fetch(:base_sessions) +
        (GDD_PAYBACK_TARGET.fetch(:per_level_sessions) * level) +
        (GDD_PAYBACK_TARGET.fetch(:per_phase_sessions) * (level / GDD_PAYBACK_TARGET.fetch(:phase_interval)))
    end

    def raw_material_value(required)
      required.sum do |material_id, quantity|
        lookup_id = material_id.to_s.sub(/^refined:/, "")
        material = @materials.fetch(lookup_id)
        value = material_id.to_s.start_with?("refined:") ? material["refined_space_bucks"].to_i : material["raw_space_bucks"].to_i
        value * quantity.to_i
      end.to_f
    end

    def rare_material?(material_id)
      material = @materials[material_id]
      material && RARE_RARITIES.include?(material["rarity"])
    end

    def average(total, count)
      return 0.0 unless count.to_i.positive?

      (total.to_f / count.to_f).round(2)
    end

    def format_upgrade_levels(levels)
      levels.map { |upgrade_id, level| "#{upgrade_id.sub(/^upgrade_/, "")}=#{level}" }.join(", ")
    end

    def flag_summary(flags)
      upgrade_count = flags.fetch(:upgrade_payback).length
      order_count = flags.fetch(:orders).length
      return "none" if upgrade_count.zero? && order_count.zero?

      "#{upgrade_count} upgrade payback, #{order_count} order"
    end

    def top_flags(flags)
      upgrade_flags = flags.fetch(:upgrade_payback).first(4).map do |flag|
        "#{flag.fetch(:display_name, flag.fetch(:upgrade_id, "upgrade"))} #{flag.fetch(:status)}: #{flag.fetch(:actual_sessions_to_afford, "?")} sessions vs #{flag.fetch(:target_sessions_to_afford, "?")} target"
      end
      order_flags = flags.fetch(:orders).map do |flag|
        "#{flag.fetch(:status)}: #{flag.reject { |key, _| key == :status }.map { |key, value| "#{key}=#{value}" }.join(", ")}"
      end
      upgrade_flags + order_flags
    end
  end
end

if $PROGRAM_NAME == __FILE__
  simulation = McpMiner::EconomySimulation.new
  report = simulation.run
  if ARGV.include?("--json")
    puts JSON.pretty_generate(report)
  else
    puts simulation.render_markdown(report)
  end
end
