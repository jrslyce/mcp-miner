#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "open3"
require "tmpdir"
require "yaml"

ROOT = File.expand_path("..", __dir__)
DATA_DIR = File.join(ROOT, "data")
VALIDATOR = File.join(ROOT, "scripts", "validate_data.rb")

def assert(message)
  raise message unless yield
end

def run_validator(data_dir)
  stdout, stderr, status = Open3.capture3({ "MCP_MINER_DATA_DIR" => data_dir }, "ruby", VALIDATOR)
  [stdout, stderr, status]
end

def mutate_yaml(data_dir, filename)
  path = File.join(data_dir, filename)
  data = YAML.load_file(path)
  yield data
  File.write(path, YAML.dump(data))
end

def expect_failure(name, expected_message)
  Dir.mktmpdir("mcp-miner-data-validator") do |dir|
    data_dir = File.join(dir, "data")
    FileUtils.cp_r(DATA_DIR, data_dir)
    yield data_dir
    stdout, stderr, status = run_validator(data_dir)
    output = "#{stdout}\n#{stderr}"
    assert("#{name} should fail validation") { !status.success? }
    assert("#{name} should include actionable error #{expected_message.inspect}; got:\n#{output}") do
      output.include?(expected_message)
    end
  end
end

positive_stdout, positive_stderr, positive_status = run_validator(DATA_DIR)
assert("current data should pass validation:\n#{positive_stdout}\n#{positive_stderr}") { positive_status.success? }

expect_failure(
  "unknown upgrade formula id",
  "data/upgrades.yaml upgrade upgrade_drill_power.cost.phase_formula references unknown formula id formula_missing"
) do |data_dir|
  mutate_yaml(data_dir, "upgrades.yaml") do |data|
    data.fetch("upgrades").first.fetch("cost")["phase_formula"] = "formula_missing"
  end
end

expect_failure(
  "unknown report placeholder",
  "data/report_templates.yaml report_templates.compact[0] references unknown placeholder repo_name"
) do |data_dir|
  mutate_yaml(data_dir, "report_templates.yaml") do |data|
    data.fetch("report_templates").fetch("compact")[0] += " {repo_name}"
  end
end

expect_failure(
  "invalid order generator range",
  "data/order_generator.yaml order_generation.quantity_by_tier.1 min must be <= max"
) do |data_dir|
  mutate_yaml(data_dir, "order_generator.yaml") do |data|
    range = data.fetch("order_generation").fetch("quantity_by_tier").fetch(1)
    range["min"] = 9
    range["max"] = 1
  end
end

expect_failure(
  "invalid upgrade effect target",
  "data/upgrades.yaml upgrade upgrade_drill_power.effect.target references unknown target private_prompt_count"
) do |data_dir|
  mutate_yaml(data_dir, "upgrades.yaml") do |data|
    data.fetch("upgrades").first.fetch("effect")["target"] = "private_prompt_count"
  end
end

expect_failure(
  "invalid base module effect target",
  "data/base_modules.yaml base module base_command_center.effects[0].target references unknown target private_prompt_count"
) do |data_dir|
  mutate_yaml(data_dir, "base_modules.yaml") do |data|
    data.fetch("base_modules").first.fetch("effects").first["target"] = "private_prompt_count"
  end
end

expect_failure(
  "invalid machine unlock reference level",
  "data/fabrication_machines.yaml machine machine_circuit_loom.unlock.required_upgrades.upgrade_scanner_range exceeds max_level 50"
) do |data_dir|
  mutate_yaml(data_dir, "fabrication_machines.yaml") do |data|
    data.fetch("machines")[1].fetch("unlock").fetch("required_upgrades").first["upgrade_scanner_range"] = 99
  end
end

expect_failure(
  "invalid annual subscription math",
  "data/subscription_plans.yaml pro_annual annual_price_cents must equal pro_monthly monthly_price_cents * annual_months_charged"
) do |data_dir|
  mutate_yaml(data_dir, "subscription_plans.yaml") do |data|
    data.fetch("plans").find { |plan| plan.fetch("id") == "pro_annual" }["annual_price_cents"] = 5000
  end
end

expect_failure(
  "unsupported subscription currency",
  "data/subscription_plans.yaml subscription_pricing.currency must be supported"
) do |data_dir|
  mutate_yaml(data_dir, "subscription_plans.yaml") do |data|
    data.fetch("subscription_pricing")["currency"] = "cad"
  end
end

expect_failure(
  "invalid pro annual entitlement drift",
  "data/subscription_plans.yaml pro_annual entitlements must match pro_monthly entitlements"
) do |data_dir|
  mutate_yaml(data_dir, "subscription_plans.yaml") do |data|
    data.fetch("plans").find { |plan| plan.fetch("id") == "pro_annual" }.fetch("entitlements")["exports"] = false
  end
end

expect_failure(
  "missing provider price id",
  "data/subscription_plans.yaml subscription_pricing.provider_price_ids.stripe.live.pro_monthly must be configured"
) do |data_dir|
  mutate_yaml(data_dir, "subscription_plans.yaml") do |data|
    data.fetch("subscription_pricing").fetch("provider_price_ids").fetch("stripe").fetch("live")["pro_monthly"] = ""
  end
end

puts "Validator fixture checks passed: 11"
