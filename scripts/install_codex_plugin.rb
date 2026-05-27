#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "optparse"

ROOT = File.expand_path("..", __dir__)
MARKETPLACE_NAME = "diamond-mcp"
PLUGIN_REF = "mcp-miner@diamond-mcp"
PLUGIN_NAME = "MCP Miner"

options = {
  config: ENV.fetch("CODEX_CONFIG_PATH", File.join(Dir.home, ".codex", "config.toml")),
  repo_root: ROOT,
  dry_run: false,
  uninstall: false
}

OptionParser.new do |parser|
  parser.banner = "Usage: ruby scripts/install_codex_plugin.rb [options]"

  parser.on("--config PATH", "Codex config.toml path") do |path|
    options[:config] = path
  end

  parser.on("--repo-root PATH", "Repository root to register with Codex") do |path|
    options[:repo_root] = path
  end

  parser.on("--dry-run", "Print the updated config without writing it") do
    options[:dry_run] = true
  end

  parser.on("--uninstall", "Remove the MCP Miner Codex entries from config.toml") do
    options[:uninstall] = true
  end
end.parse!

def toml_string(value)
  JSON.generate(value.to_s)
end

def table_header?(line)
  line.match?(/^\s*\[[^\]]+\]\s*(?:#.*)?$/)
end

def remove_table(source, header)
  lines = source.lines(chomp: false)
  output = []
  index = 0
  target = "[#{header}]"

  while index < lines.length
    if lines[index].strip == target
      index += 1
      index += 1 while index < lines.length && !table_header?(lines[index])
      next
    end

    output << lines[index]
    index += 1
  end

  output.join
end

def install_config(source, repo_root)
  config = remove_table(source, "marketplaces.#{MARKETPLACE_NAME}")
  config = remove_table(config, %(plugins."#{PLUGIN_REF}")).rstrip
  config = "#{config}\n\n" unless config.empty?

  config + <<~TOML
    [marketplaces.#{MARKETPLACE_NAME}]
    source_type = "local"
    source = #{toml_string(repo_root)}

    [plugins."#{PLUGIN_REF}"]
    enabled = true
  TOML
end

def uninstall_config(source)
  config = remove_table(source, "marketplaces.#{MARKETPLACE_NAME}")
  remove_table(config, %(plugins."#{PLUGIN_REF}")).rstrip + "\n"
end

repo_root = File.expand_path(options[:repo_root])
config_path = File.expand_path(options[:config])
manifest_path = File.join(repo_root, "plugins", "mcp-miner", ".codex-plugin", "plugin.json")
marketplace_path = File.join(repo_root, ".agents", "plugins", "marketplace.json")

unless options[:uninstall]
  abort("Missing plugin manifest: #{manifest_path}") unless File.file?(manifest_path)
  abort("Missing marketplace file: #{marketplace_path}") unless File.file?(marketplace_path)
end

current_config = File.file?(config_path) ? File.read(config_path) : ""
updated_config = if options[:uninstall]
                   uninstall_config(current_config)
                 else
                   install_config(current_config, repo_root)
                 end

if options[:dry_run]
  puts updated_config
  exit 0
end

if updated_config == current_config
  action = options[:uninstall] ? "already removed from" : "already installed in"
  puts "#{PLUGIN_NAME} is #{action} #{config_path}."
  exit 0
end

FileUtils.mkdir_p(File.dirname(config_path))
if File.file?(config_path)
  backup_path = "#{config_path}.backup-#{Time.now.utc.strftime('%Y%m%d%H%M%S')}"
  FileUtils.cp(config_path, backup_path)
  puts "Backed up existing Codex config to #{backup_path}."
end

File.write(config_path, updated_config)

if options[:uninstall]
  puts "#{PLUGIN_NAME} entries removed from #{config_path}."
else
  puts "#{PLUGIN_NAME} installed in #{config_path}."
  puts "Restart Codex, then trust the 6 MCP Miner hooks in the Hooks UI."
  puts "Verify with: Show my MCP Miner status"
end
