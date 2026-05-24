#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
PLUGIN_ROOT = File.join(ROOT, "plugins", "mcp-miner")
PLUGIN_MANIFEST = File.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json")
MCP_CONFIG = File.join(PLUGIN_ROOT, ".mcp.json")
HOOKS_CONFIG = File.join(PLUGIN_ROOT, "hooks", "hooks.json")
SKILL_FILE = File.join(PLUGIN_ROOT, "skills", "mcp-miner", "SKILL.md")
INSTALL_DOC = File.join(ROOT, "docs", "codex-plugin-install.md")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def read_json(path)
  JSON.parse(File.read(path))
end

def run_mcp_from_config(mcp_config, state_path)
  server = mcp_config.fetch("mcpServers").fetch("mcp-miner")
  calls = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_catalog_summary", arguments: {} } }
  ]
  input = calls.map { |payload| JSON.generate(payload) }.join("\n")
  stdout, stderr, status = Open3.capture3({
    "PLUGIN_ROOT" => PLUGIN_ROOT,
    "MCP_MINER_STATE_PATH" => state_path
  }, server.fetch("command"), *server.fetch("args"), chdir: File.expand_path(server.fetch("cwd"), PLUGIN_ROOT), stdin_data: "#{input}\n")
  raise "configured MCP server failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def run_hook_command(command, mode_name, state_path)
  payload = {
    "session_id" => "plugin-install-smoke",
    "turn_id" => "plugin-install-turn",
    "hook_event_name" => mode_name,
    "cwd" => ROOT,
    "prompt" => "this prompt must not be persisted"
  }
  stdout, stderr, status = Open3.capture3({
    "PLUGIN_ROOT" => PLUGIN_ROOT,
    "MCP_MINER_STATE_PATH" => state_path
  }, command, chdir: PLUGIN_ROOT, stdin_data: JSON.generate(payload))
  raise "configured hook failed: #{stderr}" unless status.success?

  stdout.empty? ? {} : JSON.parse(stdout)
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def documented_tool_names(skill_source)
  skill_source.lines.map do |line|
    match = line.match(/^- `([^`]+)`:/)
    match && match[1]
  end.compact
end

manifest = read_json(PLUGIN_MANIFEST)
mcp_config = read_json(MCP_CONFIG)
hooks_config = read_json(HOOKS_CONFIG)
skill_source = File.read(SKILL_FILE)
install_doc = File.read(INSTALL_DOC)

assert("plugin manifest should preserve the validated top-level shape") do
  (manifest.keys - %w[name version description author skills interface mcpServers]).empty? &&
    manifest.fetch("skills") == "./skills/" &&
    manifest.fetch("mcpServers") == "./.mcp.json" &&
    manifest.dig("interface", "defaultPrompt").include?("Show my MCP Miner status")
end

assert("plugin-relative manifest paths should resolve from plugin root") do
  File.directory?(File.expand_path(manifest.fetch("skills"), PLUGIN_ROOT)) &&
    File.file?(File.expand_path(manifest.fetch("mcpServers"), PLUGIN_ROOT)) &&
    File.file?(SKILL_FILE)
end

server = mcp_config.fetch("mcpServers").fetch("mcp-miner")
assert(".mcp.json should launch the Ruby server from plugin root") do
  server.fetch("command") == "ruby" &&
    server.fetch("args") == ["./scripts/mcp_server.rb"] &&
    server.fetch("cwd") == "." &&
    File.file?(File.join(PLUGIN_ROOT, "scripts", "mcp_server.rb"))
end

hook_commands = hooks_config.fetch("hooks").values.flat_map do |entries|
  entries.flat_map { |entry| entry.fetch("hooks").map { |hook| hook.fetch("command") } }
end
assert("hook commands should use PLUGIN_ROOT-relative scripts") do
  hook_commands.length >= 5 &&
    hook_commands.all? { |command| command.include?('$PLUGIN_ROOT/hooks/mcp_miner_hook.rb') } &&
    File.file?(File.join(PLUGIN_ROOT, "hooks", "mcp_miner_hook.rb"))
end

Dir.mktmpdir("mcp-miner-plugin-install") do |dir|
  state_path = File.join(dir, "state.json")
  session_start_command = hooks_config.dig("hooks", "SessionStart", 0, "hooks", 0, "command")
  session_output = run_hook_command(session_start_command, "SessionStart", state_path)
  assert("configured hook should run with PLUGIN_ROOT and resolve local data") do
    session_output.dig("hookSpecificOutput", "hookEventName") == "SessionStart" &&
      File.exist?(state_path)
  end

  responses = run_mcp_from_config(mcp_config, state_path)
  tool_names = responses[1].dig("result", "tools").map { |tool| tool.fetch("name") }
  catalog_payload = tool_payload(responses[2])
  assert("configured MCP server should launch and read local gameplay data") do
    responses[0].dig("result", "serverInfo", "name") == "mcp-miner" &&
      tool_names.include?("get_player_status") &&
      catalog_payload.fetch("materials") >= 100 &&
      catalog_payload.fetch("recipes") >= 100
  end

  documented_tools = documented_tool_names(skill_source)
  assert("skill tool instructions should match the live MCP tool list") do
    (documented_tools - tool_names).empty? &&
      (tool_names - documented_tools).empty?
  end

  serialized_state = File.read(state_path)
  assert("install smoke state should not contain private prompt text or repo paths") do
    !serialized_state.include?("this prompt must not be persisted") &&
      !serialized_state.include?(ROOT) &&
      !serialized_state.include?(PLUGIN_ROOT)
  end
end

assert("skill should document actual privacy behavior") do
  skill_source.include?("Never include private work details") &&
    skill_source.include?("prompts, code, file paths, repo names, terminal output") &&
    skill_source.include?("Space Bucks")
end

assert("install docs should cover state path, reset, backup, and smoke commands") do
  install_doc.include?("~/.mcp-miner/state.json") &&
    install_doc.include?("journal.jsonl") &&
    install_doc.include?("reset") &&
    install_doc.include?("backup") &&
    install_doc.include?("npm run test:plugin-install") &&
    install_doc.include?("npm run validate:plugin")
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  plugin: manifest.fetch("name"),
  hook_commands: hook_commands.length,
  documented_tools: documented_tool_names(skill_source).length
})
