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
  raise "MCP auth-linking test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def start_link_server(requests)
  server = WEBrick::HTTPServer.new(
    BindAddress: "127.0.0.1",
    Port: 0,
    Logger: WEBrick::Log.new(File::NULL),
    AccessLog: []
  )
  server.mount_proc "/createLinkSession" do |request, response|
    requests << ["createLinkSession", JSON.parse(request.body)]
    response["Content-Type"] = "application/json"
    response.body = JSON.generate({
      result: {
        ok: true,
        privacyClass: "abstract",
        session: {
          sessionId: "link_test_session",
          code: "TEST-1234",
          status: "pending",
          expiresAt: "2026-05-25T12:10:00Z"
        },
        linkUrl: "https://mcp-miner.web.app/?linkCode=TEST-1234&sessionId=link_test_session",
        deviceSecret: "local-device-secret",
        message: "Approve this device."
      }
    })
  end
  server.mount_proc "/exchangeLinkSession" do |request, response|
    requests << ["exchangeLinkSession", JSON.parse(request.body)]
    response["Content-Type"] = "application/json"
    response.body = JSON.generate({
      result: {
        ok: true,
        privacyClass: "abstract",
        uid: "firebase_uid_linked_device",
        deviceId: "device_test",
        deviceToken: "mcpd_test_device_token",
        tokenType: "mcp_miner_device",
        scopes: ["sync:read", "sync:write"]
      }
    })
  end
  server.mount_proc "/revokeDeviceToken" do |request, response|
    requests << ["revokeDeviceToken", JSON.parse(request.body), {
      "authorization" => request.header["authorization"],
      "x-mcp-miner-device-token" => request.header["x-mcp-miner-device-token"]
    }]
    response["Content-Type"] = "application/json"
    response.body = JSON.generate({ result: { ok: true, status: "revoked" } })
  end
  thread = Thread.new { server.start }
  [server, thread, "http://127.0.0.1:#{server.config[:Port]}"]
end

Dir.mktmpdir("mcp-miner-auth-linking") do |dir|
  state_path = File.join(dir, "state.json")
  McpMiner::GameEngine.new(root: ROOT, state_path: state_path).write_state(
    McpMiner::GameEngine.new(root: ROOT, state_path: state_path).initial_state
  )

  responses = run_mcp(state_path, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_settings", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "update_settings", arguments: { cloud_sync: true } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "link_cloud_profile", arguments: { firebase_uid: "firebase_uid_123", display_name: "Jared the Prospector" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sync_progress", arguments: {} } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "unlink_cloud_profile", arguments: {} } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_account_link_status", arguments: {} } }
  ])

  tool_names = responses[1].dig("result", "tools").map { |tool| tool["name"] }
  initial_settings = tool_payload(responses[2])
  unauthenticated = tool_payload(responses[3])
  linked = tool_payload(responses[4])
  sync = tool_payload(responses[5])
  unlinked = tool_payload(responses[6])
  final_status = tool_payload(responses[7])

  assert("MCP tools should expose account linking actions") do
    %w[get_account_link_status start_account_link complete_account_link get_sync_status disconnect_account link_cloud_profile unlink_cloud_profile].all? { |tool| tool_names.include?(tool) }
  end

  assert("local-only mode should be the default") do
    initial_settings.dig("settings", "cloud_sync") == false &&
      initial_settings.dig("account_link", "status") == "off"
  end

  assert("enabling cloud sync without Firebase Auth should be unauthenticated") do
    unauthenticated.dig("settings", "cloud_sync") == true &&
      unauthenticated.dig("account_link", "status") == "unauthenticated" &&
      unauthenticated.dig("sync", "status") == "unauthenticated"
  end

  assert("link_cloud_profile should store only Firebase UID and game profile metadata") do
    linked["ok"] == true &&
      linked.dig("account_link", "status") == "linked" &&
      linked.dig("account_link", "uid") == "firebase_uid_123" &&
      linked.dig("profile", "cloud_sync") == true &&
      linked.dig("firestore_paths", "profile") == "players/firebase_uid_123/profile/current"
  end

  assert("linked sync state should be represented without requiring sync to run") do
    sync.dig("sync", "status") == "linked_sync_pending" &&
      sync.dig("sync", "available") == true &&
      sync.dig("sync", "account_link", "status") == "linked"
  end

  assert("unlink should return to local-only mode") do
    unlinked["ok"] == true &&
      unlinked.dig("account_link", "status") == "off" &&
      final_status.dig("account_link", "status") == "off"
  end

  serialized_state = File.read(state_path)
  assert("account linking should not store OpenAI credentials or Firebase tokens") do
    !serialized_state.match?(/openai/i) &&
      !serialized_state.include?("idToken") &&
      !serialized_state.include?("refreshToken") &&
      !serialized_state.include?("apiKey") &&
      !serialized_state.include?("@mcp-miner.local")
  end

  requests = []
  server, thread, origin = start_link_server(requests)
  begin
    linked_responses = run_mcp(state_path, [
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "start_account_link", arguments: { functions_origin: origin, dashboard_url: "https://mcp-miner.web.app", device_name: "Test Codex" } } },
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "complete_account_link", arguments: { functions_origin: origin } } },
      { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "get_sync_status", arguments: {} } }
    ])
    pending = tool_payload(linked_responses[0])
    completed = tool_payload(linked_responses[1])
    sync_status = tool_payload(linked_responses[2])
    auth_path = File.join(dir, "auth.json")

    assert("start_account_link should create a pending web approval link") do
      pending["status"] == "link_pending" &&
        pending.dig("link", "code") == "TEST-1234" &&
        pending.dig("link", "url").include?("sessionId=link_test_session")
    end

    assert("complete_account_link should store a local device token outside public state") do
      completed["status"] == "linked" &&
        completed.dig("account_link", "uid") == "firebase_uid_linked_device" &&
        File.exist?(auth_path) &&
        File.read(auth_path).include?("mcpd_test_device_token") &&
        !File.read(state_path).include?("mcpd_test_device_token")
    end

    assert("get_sync_status should report that a device token is present without exposing it") do
      sync_status.dig("sync", "metadata", "device_token_present") == true &&
        !JSON.generate(sync_status).include?("mcpd_test_device_token")
    end

    disconnected = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "disconnect_account", arguments: { functions_origin: origin } } }
    ]).last)

    assert("disconnect_account should revoke and remove the local auth file") do
      revoke_request = requests.find { |entry| entry.first == "revokeDeviceToken" }
      disconnected["status"] == "unlinked" &&
        disconnected["revoke_status"] == "revoked" &&
        !File.exist?(auth_path) &&
        revoke_request[2]["x-mcp-miner-device-token"].first == "mcpd_test_device_token" &&
        revoke_request[2]["authorization"].empty?
    end
  ensure
    server.shutdown
    thread.join
  end

  auth_js = File.read(File.join(ROOT, "firebase", "hosting", "auth.js"))
  auth_smoke = File.read(File.join(ROOT, "scripts", "firebase_auth_linking_smoke.js"))
  assert("dashboard auth shell should use Firebase Auth sign-in and sign-out") do
    auth_js.include?("getAuth") &&
      auth_js.include?("signInWithEmailAndPassword") &&
      auth_js.include?("createUserWithEmailAndPassword") &&
      auth_js.include?("signOut") &&
      auth_js.include?("setDoc") &&
      auth_smoke.include?("signed_out_write_denied")
  end

  puts JSON.pretty_generate({
    ok: true,
    checks: $checks,
    linked_status: linked.dig("account_link", "status"),
    sync_status: sync.dig("sync", "status")
  })
end
