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

def run_mcp(state_path, calls)
  input = calls.map { |payload| JSON.generate(payload) }.join("\n")
  stdout, stderr, status = Open3.capture3({
    "MCP_MINER_STATE_PATH" => state_path
  }, "ruby", MCP_SERVER, stdin_data: "#{input}\n")
  raise "Profile MCP test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def state(path)
  JSON.parse(File.read(path))
end

Dir.mktmpdir("mcp-miner-profile") do |dir|
  state_path = File.join(dir, "state.json")
  McpMiner::GameEngine.new(root: ROOT, state_path: state_path).write_state(
    McpMiner::GameEngine.new(root: ROOT, state_path: state_path).initial_state
  )

  first_response = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_profile", arguments: {} } }
  ])
  tool_names = first_response[1].dig("result", "tools").map { |tool| tool["name"] }
  profile_payload = tool_payload(first_response[2])

  assert("tools/list should expose profile actions") do
    %w[get_profile update_profile].all? { |tool_name| tool_names.include?(tool_name) }
  end
  assert("get_profile should expose stable local default profile fields") do
    profile_payload.dig("profile", "display_name") == "Local Prospector" &&
      profile_payload.dig("profile", "suit_style") == "cozy sci-fi asteroid miner" &&
      profile_payload.dig("profile", "avatar_concept_prompt").include?("cozy sci-fi asteroid miner") &&
      profile_payload.dig("avatar_workflow", "image_generation_required") == false &&
      profile_payload.dig("profile", "cloud_sync") == false
  end

  update_payload = tool_payload(run_mcp(state_path, [
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "update_profile",
        arguments: {
          display_name: "Jared the Prospector",
          miner_name: "J-7",
          pronouns: "they/them",
          suit_style: "patched teal survey suit",
          avatar_concept_prompt: "A cheerful miner in a patched teal survey suit with warm helmet lights.",
          add_customization_unlock: "visor_teal",
          generated_asset_ref: "local-avatar-v1.png"
        }
      }
    }
  ]).first)
  updated_state = state(state_path)
  assert("update_profile should persist user-customized local profile fields") do
    update_payload["ok"] == true &&
      updated_state.dig("profile", "display_name") == "Jared the Prospector" &&
      updated_state.dig("profile", "miner_name") == "J-7" &&
      updated_state.dig("profile", "pronouns") == "they/them" &&
      updated_state.dig("profile", "suit_style") == "patched teal survey suit" &&
      updated_state.dig("profile", "customization_unlocks").include?("visor_teal") &&
      updated_state.dig("profile", "generated_assets").last["asset_ref"] == "local-avatar-v1.png"
  end

  player_payload = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_player_status", arguments: {} } }
  ]).first)
  assert("get_player_status should include the local profile") do
    player_payload.dig("profile", "display_name") == "Jared the Prospector" &&
      player_payload.dig("profile", "avatar_concept_prompt").include?("patched teal")
  end

  serialized = JSON.generate([profile_payload, update_payload, player_payload])
  assert("profile payloads should not expose local filesystem details") do
    !serialized.include?(ROOT) && !serialized.include?(dir) && !serialized.include?(state_path)
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    display_name: updated_state.dig("profile", "display_name"),
    suit_style: updated_state.dig("profile", "suit_style"),
    generated_assets: updated_state.dig("profile", "generated_assets").length
  })
end
