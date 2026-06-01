#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
PLUGIN_ROOT = File.expand_path(ARGV[0] || "plugins/mcp-miner", ROOT)
MANIFEST_PATH = File.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json")
UPSTREAM_VALIDATOR_CANDIDATES = [
  ENV["CODEX_PLUGIN_VALIDATOR"],
  File.join(Dir.home, ".codex", "skills", ".system", "plugin-creator", "scripts", "validate_plugin.py"),
  "/Users/jared/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py"
].compact.freeze
PYTHON_CANDIDATES = [
  ENV["PYTHON"],
  "python3",
  "python",
  "py"
].compact.freeze

def fail_with(message)
  warn message
  exit 1
end

def executable_available?(command)
  _stdout, _stderr, status = Open3.capture3(command, "--version")
  status.success?
rescue Errno::ENOENT
  false
end

def upstream_validator_path
  UPSTREAM_VALIDATOR_CANDIDATES.find { |path| File.file?(path) }
end

def python_command
  PYTHON_CANDIDATES.find { |command| executable_available?(command) }
end

def upstream_validator_dependencies_available?(command)
  _stdout, _stderr, status = Open3.capture3(command, "-c", "import yaml")
  status.success?
end

manifest = JSON.parse(File.read(MANIFEST_PATH))
hooks_path = manifest["hooks"]
fail_with("plugin.json field `hooks` must point at hooks/hooks.json") unless hooks_path == "./hooks/hooks.json"

resolved_hooks = File.expand_path(hooks_path, PLUGIN_ROOT)
resolved_root = File.expand_path(PLUGIN_ROOT)
inside_plugin = resolved_hooks == resolved_root || resolved_hooks.start_with?("#{resolved_root}#{File::SEPARATOR}")
fail_with("plugin.json field `hooks` must stay inside the plugin root") unless inside_plugin
fail_with("plugin.json field `hooks` does not resolve to a file") unless File.file?(resolved_hooks)

Dir.mktmpdir("mcp-miner-plugin-validate") do |dir|
  temp_plugin = File.join(dir, File.basename(PLUGIN_ROOT))
  FileUtils.cp_r(PLUGIN_ROOT, temp_plugin)

  temp_manifest_path = File.join(temp_plugin, ".codex-plugin", "plugin.json")
  temp_manifest = JSON.parse(File.read(temp_manifest_path))
  temp_manifest.delete("hooks")
  File.write(temp_manifest_path, "#{JSON.pretty_generate(temp_manifest)}\n")

  validator = upstream_validator_path
  python = python_command
  if validator && python && upstream_validator_dependencies_available?(python)
    stdout, stderr, status = Open3.capture3(python, validator, temp_plugin)
    unless status.success?
      warn stdout unless stdout.empty?
      warn stderr unless stderr.empty?
      exit(status.exitstatus || 1)
    end
  else
    reason = if validator.nil?
               "validator script was not found"
             elsif python.nil?
               "Python is not available"
             else
               "Python validator dependencies are not available"
             end
    warn "Skipping upstream plugin validator: #{reason}."
  end
end

puts JSON.pretty_generate({
  ok: true,
  plugin: manifest.fetch("name"),
  hooks: hooks_path
})
