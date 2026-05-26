#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "tmpdir"
require "webrick"
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
  raise "MCP cloud sync client test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def seed_reward_events(engine)
  engine.write_state(engine.initial_state)
  engine.with_state do |state|
    engine.ensure_turn(state, "turn-sync-client")
    engine.add_event_reward(
      state,
      "work_search",
      turn_id: "turn-sync-client",
      hook_event_name: "PostToolUse",
      line_count: 0,
      event_key_suffix: "search"
    )
    engine.add_event_reward(
      state,
      "work_apply_patch",
      turn_id: "turn-sync-client",
      hook_event_name: "PostToolUse",
      line_count: 10,
      event_key_suffix: "patch"
    )
  end
end

def start_sync_server(response_queue, requests)
  server = WEBrick::HTTPServer.new(
    BindAddress: "127.0.0.1",
    Port: 0,
    Logger: WEBrick::Log.new(File::NULL),
    AccessLog: []
  )
  server.mount_proc "/syncRewardEvents" do |request, response|
    requests << {
      headers: request.header,
      body: JSON.parse(request.body)
    }
    next_response = response_queue.shift || {}
    response.status = next_response.fetch(:status, 200)
    response["Content-Type"] = "application/json"
    response.body = JSON.generate(next_response.fetch(:body))
  end
  thread = Thread.new { server.start }
  [server, thread, "http://127.0.0.1:#{server.config[:Port]}"]
end

Dir.mktmpdir("mcp-miner-cloud-sync-client") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  seed_reward_events(engine)

  unauth = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_settings", arguments: { cloud_sync: true } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sync_cloud", arguments: {} } }
  ]).last)
  assert("sync_cloud should queue events while unauthenticated") do
    unauth["ok"] == false &&
      unauth["status"] == "unauthenticated" &&
      unauth["queued_event_count"] >= 2 &&
      unauth.dig("sync", "metadata", "status") == "queued_unauthenticated"
  end

  auth_required = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "link_cloud_profile", arguments: { firebase_uid: "firebase_uid_sync" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "sync_cloud", arguments: {} } }
  ]).last)
  assert("sync_cloud should queue linked events when no Firebase ID token is available") do
    auth_required["ok"] == false &&
      auth_required["status"] == "auth_required" &&
      auth_required.dig("sync", "metadata", "status") == "queued_auth_required"
  end

  requests = []
  response_queue = Queue.new
  server, thread, origin = start_sync_server(response_queue, requests)
  begin
    response_queue << {
      body: {
        result: {
          ok: true,
          accepted: [],
          duplicates: [],
          rejected: [],
          state: {
            eventCount: 0,
            lastSequence: 0
          }
        }
      }
    }
    first_response = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "sync_cloud", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    first_request = requests.last
    first_events = first_request.dig(:body, "data", "events")
    accepted_ids = first_events.map { |event| event["eventId"] }
    max_sequence = first_events.map { |event| event["sequence"].to_i }.max

    assert("sync_cloud should post abstract events with bearer auth") do
      first_request.dig(:headers, "authorization").first == "Bearer fake-id-token" &&
        first_events.length >= 2 &&
        first_events.all? do |event|
          event["schemaVersion"] == 2 &&
            event["receiptType"] == "abstract_work" &&
            event["privacyClass"] == "abstract" &&
            event.dig("observedFields", "scoreHint").is_a?(Numeric) &&
            !event.dig("observedFields", "score") &&
            event["checksum"].to_s.length == 64 &&
            event["signature"].to_s.start_with?("v2.")
        end
    end
    assert("sync_cloud request should not include raw rewards or private local data") do
      serialized_request = JSON.generate(first_request)
      !serialized_request.include?("rewards") &&
        !serialized_request.include?("materials") &&
        !serialized_request.include?("please implement") &&
        !serialized_request.include?(ROOT)
    end

    response_queue << {
      body: {
        result: {
          ok: true,
          accepted: accepted_ids,
          duplicates: [],
          rejected: [],
          state: {
            eventCount: accepted_ids.length,
            lastSequence: max_sequence
          }
        }
      }
    }
    synced = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sync_cloud", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    assert("successful sync should update local sync metadata") do
      synced["ok"] == true &&
        synced["status"] == "synced" &&
        synced.dig("sync", "metadata", "last_pushed_sequence") == max_sequence &&
        synced.dig("sync", "metadata", "pending_event_count") == 0
    end

    engine.with_state do |state|
      state["cloud_sync_metadata"]["last_pushed_sequence"] = 0
    end
    response_queue << {
      body: {
        result: {
          ok: true,
          accepted: [],
          duplicates: first_events.map { |event| { eventId: event["eventId"], sequence: event["sequence"], reason: "duplicate" } },
          rejected: [],
          state: {
            eventCount: accepted_ids.length,
            lastSequence: max_sequence
          }
        }
      }
    }
    duplicate = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "sync_cloud", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    assert("duplicate retry responses should be idempotent and advance metadata") do
      duplicate["ok"] == true &&
        duplicate["duplicate_event_ids"].sort == accepted_ids.sort &&
        duplicate.dig("sync", "metadata", "last_pushed_sequence") == max_sequence
    end

    engine.with_state do |state|
      state["cloud_sync_metadata"]["last_pushed_sequence"] = 0
    end
    response_queue << {
      body: {
        result: {
          ok: false,
          accepted: [],
          duplicates: [],
          rejected: [{ eventId: first_events.first["eventId"], sequence: first_events.first["sequence"], reason: "stale_sequence" }],
          state: {
            eventCount: accepted_ids.length,
            lastSequence: max_sequence
          }
        }
      }
    }
    conflict = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "sync_cloud", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    assert("rejected cloud events should produce a local conflict status") do
      conflict["ok"] == false &&
        conflict["status"] == "conflict" &&
        conflict.dig("sync", "account_link", "status") == "sync_error" &&
        conflict.dig("sync", "metadata", "rejected_events").first["reason"] == "stale_sequence"
    end
  ensure
    server.shutdown
    thread.join
    $requests_seen = requests.length
  end
end

Dir.mktmpdir("mcp-miner-cloud-sync-empty") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  engine.write_state(engine.initial_state)

  empty_unauth = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "update_settings", arguments: { cloud_sync: true } } },
    { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "sync_cloud", arguments: {} } }
  ]).last)
  assert("sync_cloud should not report synced for an unauthenticated empty queue") do
    empty_unauth["ok"] == false &&
      empty_unauth["status"] == "unauthenticated" &&
      empty_unauth["queued_event_count"] == 0
  end

  empty_auth_required = tool_payload(run_mcp(state_path, [
    { jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "link_cloud_profile", arguments: { firebase_uid: "firebase_uid_empty" } } },
    { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "sync_cloud", arguments: {} } }
  ]).last)
  assert("sync_cloud should not report synced for a linked empty queue without a token") do
    empty_auth_required["ok"] == false &&
      empty_auth_required["status"] == "auth_required" &&
      empty_auth_required["queued_event_count"] == 0
  end
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  requests_seen: $requests_seen
})
