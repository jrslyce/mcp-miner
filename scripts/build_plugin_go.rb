#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "optparse"
require "rbconfig"

ROOT = File.expand_path("..", __dir__)
GO = ENV.fetch("GO", "go")

TARGETS = {
  "windows-amd64" => { goos: "windows", goarch: "amd64", binary_name: "mcp-miner.exe" },
  "darwin-arm64" => { goos: "darwin", goarch: "arm64", binary_name: "mcp-miner" },
  "darwin-amd64" => { goos: "darwin", goarch: "amd64", binary_name: "mcp-miner" },
  "linux-amd64" => { goos: "linux", goarch: "amd64", binary_name: "mcp-miner" }
}.freeze

TARGET_ALIASES = {
  "windows" => "windows-amd64",
  "windows-amd64" => "windows-amd64",
  "darwin-arm64" => "darwin-arm64",
  "macos-arm64" => "darwin-arm64",
  "mac-silicon" => "darwin-arm64",
  "darwin-amd64" => "darwin-amd64",
  "macos-amd64" => "darwin-amd64",
  "mac-intel" => "darwin-amd64",
  "linux-amd64" => "linux-amd64"
}.freeze

options = {
  target: ENV["MCP_MINER_PLUGIN_TARGET"],
  output_dir: File.join(ROOT, "plugins", "mcp-miner", "bin")
}

OptionParser.new do |parser|
  parser.banner = "Usage: ruby scripts/build_plugin_go.rb [options]"

  parser.on("--target TARGET", "windows-amd64, darwin-arm64, darwin-amd64, or linux-amd64") do |target|
    options[:target] = target
  end

  parser.on("--output-dir PATH", "Directory for the compiled plugin binary") do |path|
    options[:output_dir] = path
  end
end.parse!

def host_target
  host_os = RbConfig::CONFIG.fetch("host_os")
  return "windows-amd64" if host_os.match?(/mswin|mingw|cygwin/i)
  return "darwin-arm64" if host_os.match?(/darwin/i) && RbConfig::CONFIG.fetch("host_cpu").match?(/arm64|aarch64/i)
  return "darwin-amd64" if host_os.match?(/darwin/i)

  "linux-amd64"
end

target = options[:target] ? TARGET_ALIASES[options[:target].downcase] : host_target
abort("Unsupported build target: #{options[:target]}") unless target && TARGETS[target]

config = TARGETS.fetch(target)
bin_dir = File.expand_path(options[:output_dir])
binary_path = File.join(bin_dir, config.fetch(:binary_name))
hook_binary_path = File.join(bin_dir, "mcp-miner")

FileUtils.mkdir_p(bin_dir)
env = {
  "GOOS" => config.fetch(:goos),
  "GOARCH" => config.fetch(:goarch)
}
success = system(env, GO, "build", "-trimpath", "-o", binary_path, "./cmd/mcp-miner", chdir: ROOT)
abort("failed to build MCP Miner Go binary with #{GO}") unless success

if binary_path != hook_binary_path
  FileUtils.cp(binary_path, hook_binary_path)
end

FileUtils.chmod(0o755, binary_path)
FileUtils.chmod(0o755, hook_binary_path) if File.file?(hook_binary_path)

puts binary_path
