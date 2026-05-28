#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
INSTALLER = File.join(ROOT, "scripts", "install_codex_plugin.rb")
WINDOWS_INSTALLER = File.join(ROOT, "scripts", "install_codex_plugin.ps1")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def run_installer(*args)
  stdout, stderr, status = Open3.capture3("ruby", INSTALLER, *args)
  raise "installer failed: #{stderr}#{stdout}" unless status.success?

  stdout
end

Dir.mktmpdir("mcp-miner-codex-installer") do |dir|
  config_path = File.join(dir, "codex", "config.toml")
  FileUtils.mkdir_p(File.dirname(config_path))
  File.write(config_path, <<~TOML)
    model = "gpt-5"

    [projects."/tmp/example"]
    trust_level = "trusted"

    [mcp_servers."mcp-miner"]
    command = "ruby"
    args = ["plugins/mcp-miner/scripts/mcp_server.rb"]
  TOML

  run_installer("--config", config_path, "--repo-root", ROOT)
  installed = File.read(config_path)
  assert("installer should preserve existing Codex config") do
    installed.include?('[projects."/tmp/example"]') &&
      installed.include?('trust_level = "trusted"')
  end
  assert("installer should add the Diamond MCP marketplace") do
    installed.include?("[marketplaces.diamond-mcp]") &&
      installed.include?('source_type = "local"') &&
      installed.include?(%Q(source = "#{ROOT}"))
  end
  assert("installer should enable the MCP Miner plugin") do
    installed.include?('[plugins."mcp-miner@diamond-mcp"]') &&
      installed.include?("enabled = true")
  end
  assert("installer should remove standalone MCP server config that is not the plugin") do
    !installed.include?('[mcp_servers."mcp-miner"]')
  end
  assert("installer should explain plugin vs standalone MCP server") do
    run_installer("--config", File.join(dir, "fresh", "config.toml"), "--repo-root", ROOT).include?("not only the standalone MCP server")
  end
  assert("installer should back up an existing config before changing it") do
    Dir.glob("#{config_path}.backup-*").any?
  end

  run_installer("--config", config_path, "--repo-root", ROOT)
  reinstalled = File.read(config_path)
  assert("installer should be idempotent") do
    reinstalled.scan("[marketplaces.diamond-mcp]").length == 1 &&
      reinstalled.scan('[plugins."mcp-miner@diamond-mcp"]').length == 1
  end

  dry_run_path = File.join(dir, "dry-run", "config.toml")
  dry_run = run_installer("--config", dry_run_path, "--repo-root", ROOT, "--dry-run")
  assert("dry-run should print config without writing files") do
    dry_run.include?("[marketplaces.diamond-mcp]") &&
      !File.exist?(dry_run_path)
  end

  run_installer("--config", config_path, "--uninstall")
  uninstalled = File.read(config_path)
  assert("uninstall should remove only MCP Miner config entries") do
    !uninstalled.include?("[marketplaces.diamond-mcp]") &&
      !uninstalled.include?('[plugins."mcp-miner@diamond-mcp"]') &&
      uninstalled.include?('[projects."/tmp/example"]')
  end
end

windows_installer = File.read(WINDOWS_INSTALLER)
assert("Windows installer should install the Codex plugin and repair standalone MCP server config") do
  windows_installer.include?('[plugins."$PluginRef"]') &&
    windows_installer.include?("mcp_servers") &&
    windows_installer.include?("not only the standalone MCP server") &&
    windows_installer.include?("Ruby is required") &&
    windows_installer.include?(".codex\\config.toml")
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  installer: File.basename(INSTALLER),
  windows_installer: File.basename(WINDOWS_INSTALLER)
})
