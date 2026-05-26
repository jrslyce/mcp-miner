#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "tmpdir"
require_relative "../plugins/mcp-miner/lib/mcp_miner/game_engine"

ROOT = File.expand_path("..", __dir__)
MCP_SERVER = File.join(ROOT, "plugins", "mcp-miner", "scripts", "mcp_server.rb")
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def state(path)
  JSON.parse(File.read(path))
end

def journal_path(state_path)
  File.join(File.dirname(state_path), "journal.jsonl")
end

def journal_entries(state_path)
  File.readlines(journal_path(state_path), chomp: true).reject(&:empty?).map { |line| JSON.parse(line) }
end

def run_mcp(state_path, calls)
  input = calls.map { |payload| JSON.generate(payload) }.join("\n")
  stdout, stderr, status = Open3.capture3({
    "MCP_MINER_STATE_PATH" => state_path
  }, "ruby", MCP_SERVER, stdin_data: "#{input}\n")
  raise "MCP migration smoke failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

Dir.mktmpdir("mcp-miner-migrations") do |dir|
  legacy_state_path = File.join(dir, "legacy-state.json")
  legacy_engine = McpMiner::GameEngine.new(root: ROOT, state_path: legacy_state_path)
  legacy_state = legacy_engine.initial_state
  legacy_state.delete("state_schema_version")
  legacy_state.delete("journal")
  legacy_state["inventory"]["mat_chonks"] = 77
  legacy_state["report_mode"] = "every_turn_full"
  File.write(legacy_state_path, JSON.pretty_generate(legacy_state))

  migrated_state = McpMiner::GameEngine.new(root: ROOT, state_path: legacy_state_path).state
  migration_backups = Dir.glob("#{legacy_state_path}.backup-v0-to-v#{McpMiner::GameEngine::CURRENT_STATE_SCHEMA_VERSION}-*")
  assert("legacy state should migrate to current state schema") do
    migrated_state["state_schema_version"] == McpMiner::GameEngine::CURRENT_STATE_SCHEMA_VERSION &&
      migrated_state.dig("inventory", "mat_chonks") == 77 &&
      migrated_state["report_mode"] == "every_turn_full"
  end
  assert("migration should write a timestamped backup before rewriting state") do
    migration_backups.length == 1 &&
      migrated_state.dig("last_migration", "from_state_schema_version") == 0 &&
      migrated_state.dig("last_migration", "to_state_schema_version") == McpMiner::GameEngine::CURRENT_STATE_SCHEMA_VERSION &&
      migrated_state.dig("last_migration", "backup_file") == File.basename(migration_backups.first)
  end
  assert("legacy migration should also create a journal snapshot") do
    journal_entries(legacy_state_path).first["event_type"] == "state_snapshot"
  end

  current_state_path = File.join(dir, "current-state.json")
  current_engine = McpMiner::GameEngine.new(root: ROOT, state_path: current_state_path)
  current_engine.write_state(current_engine.initial_state)
  current_backups_before = Dir.glob("#{current_state_path}.backup-*")
  current_state = McpMiner::GameEngine.new(root: ROOT, state_path: current_state_path).state
  current_backups_after = Dir.glob("#{current_state_path}.backup-*")
  assert("current schema state should load without migration backup churn") do
    current_state["state_schema_version"] == McpMiner::GameEngine::CURRENT_STATE_SCHEMA_VERSION &&
      current_backups_before.empty? &&
      current_backups_after.empty?
  end

  corrupt_state_path = File.join(dir, "corrupt-state.json")
  File.write(corrupt_state_path, "{not-json")
  recovered_state = McpMiner::GameEngine.new(root: ROOT, state_path: corrupt_state_path).state
  corrupt_backups = Dir.glob("#{corrupt_state_path}.corrupt-*")
  assert("corrupt state should back up and reset to recoverable current schema") do
    corrupt_backups.length == 1 &&
      recovered_state["state_schema_version"] == McpMiner::GameEngine::CURRENT_STATE_SCHEMA_VERSION &&
      recovered_state.dig("last_recovery", "type") == "state_corrupt_backup" &&
      recovered_state.dig("last_recovery", "backup_file") == File.basename(corrupt_backups.first)
  end

  sync_response = run_mcp(corrupt_state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sync_progress", arguments: {} } }
  ])
  sync_payload = tool_payload(sync_response.last)
  assert("MCP sync status should expose safe recovery metadata") do
    sync_payload.dig("sync", "state_schema_version") == McpMiner::GameEngine::CURRENT_STATE_SCHEMA_VERSION &&
      sync_payload.dig("sync", "last_recovery", "type") == "state_corrupt_backup" &&
      !JSON.generate(sync_payload).include?(dir)
  end

  corrupt_journal_state_path = File.join(dir, "corrupt-journal-state.json")
  corrupt_journal_engine = McpMiner::GameEngine.new(root: ROOT, state_path: corrupt_journal_state_path)
  corrupt_journal_engine.write_state(corrupt_journal_engine.initial_state.merge("space_bucks" => 12))
  File.write(journal_path(corrupt_journal_state_path), "{not-json")
  recovered_journal_state = McpMiner::GameEngine.new(root: ROOT, state_path: corrupt_journal_state_path).state
  journal_backups = Dir.glob("#{journal_path(corrupt_journal_state_path)}.corrupt-*")
  assert("corrupt journal should back up and preserve materialized state") do
    journal_backups.length == 1 &&
      recovered_journal_state["space_bucks"] == 12 &&
      recovered_journal_state.dig("last_recovery", "type") == "journal_corrupt_backup"
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    state_schema_version: McpMiner::GameEngine::CURRENT_STATE_SCHEMA_VERSION,
    migration_backups: migration_backups.length,
    corrupt_state_backups: corrupt_backups.length,
    corrupt_journal_backups: journal_backups.length
  })
end
