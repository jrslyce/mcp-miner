#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
SIMULATION_SCRIPT = File.join(ROOT, "scripts", "economy_simulation.rb")
PACKAGE_JSON = File.join(ROOT, "package.json")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

stdout, stderr, status = Open3.capture3("ruby", SIMULATION_SCRIPT, "--json")
raise "economy simulation failed: #{stderr}" unless status.success?

report = JSON.parse(stdout)
package = JSON.parse(File.read(PACKAGE_JSON))
script_source = File.read(SIMULATION_SCRIPT)
projections = report.fetch("projections")
projection_30 = projections.fetch("30")
projection_100 = projections.fetch("100")

assert("package scripts should expose the repeatable economy simulation") do
  package.dig("scripts", "simulate:economy") == "ruby scripts/economy_simulation.rb" &&
    package.dig("scripts", "test:economy-simulation") == "ruby scripts/test_economy_simulation.rb" &&
    package.dig("scripts", "check").include?("npm run test:economy-simulation")
end

assert("simulation should load gameplay data and use GameEngine formulas") do
  script_source.include?("data\", \"work_scoring.yaml") &&
    script_source.include?("GameEngine") &&
    script_source.include?("calculate_reward") &&
    script_source.include?("GDD_PAYBACK_TARGET")
end

assert("report should cover 30-session and 100-session projections") do
  projection_30.fetch("sessions") == 30 &&
    projection_100.fetch("sessions") == 100
end

assert("report should include economy totals and upgrade affordability") do
  projection_30.dig("inventory", "chonks").is_a?(Integer) &&
    projection_30.dig("space_bucks", "earned_total").positive? &&
    projection_30.dig("upgrades", "levels").key?("upgrade_drill_power") &&
    projection_30.dig("upgrades", "affordable_now").is_a?(Integer)
end

assert("report should include order payouts, asteroid depletion, and rare find rates") do
  projection_100.dig("orders", "observed").positive? &&
    projection_100.dig("orders", "average_premium").positive? &&
    projection_100.dig("asteroids", "depleted").positive? &&
    projection_100.dig("rare_finds", "reward_turns") == 500 &&
    projection_100.dig("rare_finds", "rare_material_units").positive?
end

assert("report should expose upgrade and order balance flags") do
  projection_30.dig("flags", "upgrade_payback").is_a?(Array) &&
    projection_30.dig("flags", "orders").is_a?(Array) &&
    projection_100.dig("flags", "upgrade_payback").is_a?(Array) &&
    projection_100.dig("flags", "orders").is_a?(Array)
end

serialized_report = JSON.generate(report)
assert("simulation report should not expose local filesystem details") do
  !serialized_report.include?(ROOT) &&
    !serialized_report.include?(Dir.tmpdir) &&
    !serialized_report.include?("state.json")
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  sessions: projections.keys,
  orders_completed_100: projection_100.dig("orders", "completed"),
  asteroid_depletions_100: projection_100.dig("asteroids", "depleted"),
  upgrade_flags_100: projection_100.dig("flags", "upgrade_payback").length
})
