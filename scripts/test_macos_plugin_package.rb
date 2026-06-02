#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
PACKAGER = File.join(ROOT, "scripts", "package_plugin_release.rb")
TARGETS = %w[darwin-arm64 darwin-amd64].freeze
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def package_target(target, output_dir)
  stdout, stderr, status = Open3.capture3("ruby", PACKAGER, "--target", target, "--output-dir", output_dir, "--force")
  raise "package #{target} failed: #{stderr}#{stdout}" unless status.success?

  JSON.parse(stdout)
end

def mach_o_64?(path)
  File.binread(path, 4).unpack1("H*") == "cffaedfe"
end

def read_json(path)
  JSON.parse(File.read(path))
end

Dir.mktmpdir("mcp-miner-macos-packages") do |dir|
  packages = TARGETS.to_h do |target|
    output_dir = File.join(dir, "mcp-miner-#{target}")
    [target, package_target(target, output_dir)]
  end

  TARGETS.each do |target|
    root = packages.fetch(target).fetch("output_dir")
    plugin_root = File.join(root, "plugins", "mcp-miner")
    binary = File.join(plugin_root, "bin", "mcp-miner")
    hooks = read_json(File.join(plugin_root, "hooks", "hooks.json"))
    commands = hooks.fetch("hooks").values.flat_map do |entries|
      entries.flat_map { |entry| entry.fetch("hooks").map { |hook| hook.fetch("command") } }
    end

    assert("#{target} package should include local marketplace, data, manifest, skill, hooks, and binary") do
        File.file?(File.join(root, ".agents", "plugins", "marketplace.json")) &&
        File.file?(File.join(root, "scripts", "install_codex_plugin.rb")) &&
        File.file?(File.join(root, "data", "materials.yaml")) &&
        File.file?(File.join(plugin_root, ".codex-plugin", "plugin.json")) &&
        File.file?(File.join(plugin_root, "skills", "mcp-miner", "SKILL.md")) &&
        File.file?(File.join(plugin_root, "hooks", "hooks.json")) &&
        File.file?(binary) &&
        !File.file?(File.join(plugin_root, "bin", "mcp-miner.exe"))
    end

    assert("#{target} binary should be a Mach-O 64-bit executable") do
      mach_o_64?(binary)
    end

    assert("#{target} hooks should use macOS shell expansion and no Windows launcher") do
      commands.length == 6 &&
        commands.all? { |command| command.include?('"$PLUGIN_ROOT/bin/mcp-miner" hook') } &&
        commands.none? { |command| command.include?("cmd /d /c") || command.include?("%PLUGIN_ROOT%") || command.include?(".exe") }
    end

    serialized_hooks = JSON.generate(hooks)
    assert("#{target} hooks should not contain local workspace paths") do
      !serialized_hooks.include?(ROOT) &&
        !serialized_hooks.include?(dir)
    end
  end

  arm_binary = File.binread(File.join(packages.fetch("darwin-arm64").fetch("output_dir"), "plugins", "mcp-miner", "bin", "mcp-miner"))
  intel_binary = File.binread(File.join(packages.fetch("darwin-amd64").fetch("output_dir"), "plugins", "mcp-miner", "bin", "mcp-miner"))
  assert("Apple Silicon and Intel package binaries should differ") do
    arm_binary != intel_binary
  end
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  targets: TARGETS
})
