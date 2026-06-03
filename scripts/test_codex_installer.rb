#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
WINDOWS_INSTALLER = File.join(ROOT, "scripts", "install_codex_plugin.ps1")
UNIX_INSTALLER = File.join(ROOT, "scripts", "install_codex_plugin.sh")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def run_installer(*args)
  stdout, stderr, status = Open3.capture3("go", "run", "./cmd/mcp-miner", "install-codex-plugin", *args, chdir: ROOT)
  raise "installer failed: #{stderr}#{stdout}" unless status.success?

  stdout
end

def backup_exists_for?(path)
  prefix = "#{File.basename(path)}.backup-"
  Dir.children(File.dirname(path)).any? { |name| name.start_with?(prefix) }
end

def powershell_available?
  _stdout, _stderr, status = Open3.capture3("powershell", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()")
  status.success?
rescue Errno::ENOENT
  false
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

    [marketplaces.diamond-mcp]
    source_type = "local"
    source = "/old/mcp-miner"

    [plugins."mcp-miner@diamond-mcp"]
    enabled = true
  TOML

  run_installer("--config", config_path, "--repo-root", ROOT)
  installed = File.read(config_path)
  assert("installer should preserve existing Codex config") do
    installed.include?('[projects."/tmp/example"]') &&
      installed.include?('trust_level = "trusted"')
  end
  assert("installer should add the MCP Miner marketplace") do
    installed.include?("[marketplaces.mcp-miner]") &&
      installed.include?('source_type = "local"') &&
      installed.include?("source = ")
  end
  assert("installer should enable the MCP Miner plugin") do
    installed.include?('[plugins."mcp-miner@mcp-miner"]') &&
      installed.include?("enabled = true")
  end
  assert("installer should remove standalone MCP server config that is not the plugin") do
    !installed.include?('[mcp_servers."mcp-miner"]')
  end
  assert("installer should remove legacy Diamond MCP config") do
    !installed.include?("[marketplaces.diamond-mcp]") &&
      !installed.include?('[plugins."mcp-miner@diamond-mcp"]')
  end
  assert("installer should explain plugin vs standalone MCP server") do
    run_installer("--config", File.join(dir, "fresh", "config.toml"), "--repo-root", ROOT).include?("not only the standalone MCP server")
  end
  assert("installer should back up an existing config before changing it") do
    backup_exists_for?(config_path)
  end

  run_installer("--config", config_path, "--repo-root", ROOT)
  reinstalled = File.read(config_path)
  assert("installer should be idempotent") do
    reinstalled.scan("[marketplaces.mcp-miner]").length == 1 &&
      reinstalled.scan('[plugins."mcp-miner@mcp-miner"]').length == 1
  end

  dry_run_path = File.join(dir, "dry-run", "config.toml")
  dry_run = run_installer("--config", dry_run_path, "--repo-root", ROOT, "--dry-run")
  assert("dry-run should print config without writing files") do
    dry_run.include?("[marketplaces.mcp-miner]") &&
      !File.exist?(dry_run_path)
  end

  run_installer("--config", config_path, "--uninstall")
  uninstalled = File.read(config_path)
  assert("uninstall should remove only MCP Miner config entries") do
    !uninstalled.include?("[marketplaces.mcp-miner]") &&
      !uninstalled.include?('[plugins."mcp-miner@mcp-miner"]') &&
      !uninstalled.include?("[marketplaces.diamond-mcp]") &&
      !uninstalled.include?('[plugins."mcp-miner@diamond-mcp"]') &&
      uninstalled.include?('[projects."/tmp/example"]')
  end
end

windows_installer = File.read(WINDOWS_INSTALLER)
unix_installer = File.read(UNIX_INSTALLER)
assert("macOS/Linux installer should provide a simple shell entrypoint") do
  unix_installer.include?("install-codex-plugin") &&
    unix_installer.include?("go run ./cmd/mcp-miner install-codex-plugin") &&
    !unix_installer.include?("ruby")
end

assert("Windows installer should install the Codex plugin and repair standalone MCP server config") do
  windows_installer.include?('[plugins."$PluginRef"]') &&
    windows_installer.include?("mcp-miner@mcp-miner") &&
    windows_installer.include?("diamond-mcp") &&
    windows_installer.include?("mcp_servers") &&
    windows_installer.include?("not only the standalone MCP server") &&
    windows_installer.include?("MCP Miner Go binary") &&
    windows_installer.include?("go build") &&
    !windows_installer.include?("ruby") &&
    windows_installer.include?(".codex\\config.toml")
end

if powershell_available?
  Dir.mktmpdir("mcp-miner-codex-windows-installer") do |dir|
    config_path = File.join(dir, "config.toml")
    stdout, stderr, status = Open3.capture3(
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINDOWS_INSTALLER,
      "-DryRun",
      "-Config",
      config_path,
      "-RepoRoot",
      ROOT
    )
    raise "Windows installer dry-run failed: #{stderr}#{stdout}" unless status.success?

    assert("Windows installer dry-run should emit the simplified MCP Miner identity") do
      stdout.include?("[marketplaces.mcp-miner]") &&
        stdout.include?('[plugins."mcp-miner@mcp-miner"]') &&
        !stdout.include?("[marketplaces.diamond-mcp]") &&
        !File.exist?(config_path)
    end
  end
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  installer: "go run ./cmd/mcp-miner install-codex-plugin",
  windows_installer: File.basename(WINDOWS_INSTALLER)
})
