#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "optparse"
require "rbconfig"

ROOT = File.expand_path("..", __dir__)
DEFAULT_OUTPUT = File.join(ROOT, "plugins", "mcp-miner", "hooks", "hooks.json")

TARGET_ALIASES = {
  "host" => "host",
  "windows" => "windows-amd64",
  "windows-amd64" => "windows-amd64",
  "darwin-arm64" => "darwin-arm64",
  "macos-arm64" => "darwin-arm64",
  "mac-silicon" => "darwin-arm64",
  "darwin-amd64" => "darwin-amd64",
  "macos-amd64" => "darwin-amd64",
  "mac-intel" => "darwin-amd64"
}.freeze

HOOKS = {
  "SessionStart" => {
    matcher: "startup|resume|clear|compact",
    mode: "session_start",
    status: "Powering MCP Miner"
  },
  "UserPromptSubmit" => {
    mode: "user_prompt_submit",
    status: "Scanning asteroid work signal"
  },
  "SubagentStart" => {
    mode: "subagent_start",
    status: "Tagging MCP Miner agent shift"
  },
  "SubagentStop" => {
    mode: "subagent_stop",
    status: "Closing MCP Miner agent shift"
  },
  "PostToolUse" => {
    matcher: ".*",
    mode: "post_tool_use",
    status: "Mining Codex work"
  },
  "Stop" => {
    mode: "stop",
    status: "Preparing MCP Miner report"
  }
}.freeze

options = {
  target: ENV.fetch("MCP_MINER_PLUGIN_TARGET", "host"),
  output: DEFAULT_OUTPUT
}

OptionParser.new do |parser|
  parser.banner = "Usage: ruby scripts/render_plugin_hooks.rb [options]"

  parser.on("--target TARGET", "host, windows-amd64, darwin-arm64, or darwin-amd64") do |target|
    options[:target] = target
  end

  parser.on("--output PATH", "hooks.json output path") do |path|
    options[:output] = path
  end
end.parse!

def host_target
  host_os = RbConfig::CONFIG.fetch("host_os")
  return "windows-amd64" if host_os.match?(/mswin|mingw|cygwin/i)
  return "darwin-arm64" if host_os.match?(/darwin/i) && RbConfig::CONFIG.fetch("host_cpu").match?(/arm64|aarch64/i)
  return "darwin-amd64" if host_os.match?(/darwin/i)

  "linux-amd64"
end

def normalize_target(target)
  resolved = TARGET_ALIASES[target.downcase]
  abort("Unsupported hook target: #{target}") unless resolved

  resolved == "host" ? host_target : resolved
end

def hook_command_prefix(target)
  case target
  when "windows-amd64"
    'cmd /d /c call "%PLUGIN_ROOT%\bin\mcp-miner.exe" hook'
  when "darwin-arm64", "darwin-amd64", "linux-amd64"
    '"$PLUGIN_ROOT/bin/mcp-miner" hook'
  else
    abort("Unsupported hook target: #{target}")
  end
end

target = normalize_target(options[:target])
prefix = hook_command_prefix(target)

payload = {
  "hooks" => HOOKS.transform_values do |definition|
    entry = {}
    entry["matcher"] = definition.fetch(:matcher) if definition[:matcher]
    entry["hooks"] = [
      {
        "type" => "command",
        "command" => "#{prefix} #{definition.fetch(:mode)}",
        "timeout" => 10,
        "statusMessage" => definition.fetch(:status)
      }
    ]
    [entry]
  end
}

File.write(options[:output], "#{JSON.pretty_generate(payload)}\n")

puts JSON.pretty_generate({
  ok: true,
  target: target,
  output: File.expand_path(options[:output]),
  hooks: HOOKS.length
})
