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
  raise "MCP cloud backup client test failed: #{stderr}" unless status.success?

  stdout.lines.map { |line| JSON.parse(line) }
end

def tool_payload(response)
  JSON.parse(response.dig("result", "content", 0, "text"))
end

def start_backup_server(responses, requests)
  server = WEBrick::HTTPServer.new(
    BindAddress: "127.0.0.1",
    Port: 0,
    Logger: WEBrick::Log.new(File::NULL),
    AccessLog: []
  )
  %w[getCloudBackupStatus createCloudBackup restoreCloudBackup].each do |function_name|
    server.mount_proc "/#{function_name}" do |request, response|
      requests << {
        path: request.path,
        headers: request.header,
        body: JSON.parse(request.body)
      }
      next_response = (responses[request.path] ||= []).shift || {
        status: 500,
        body: { error: { status: "INTERNAL", message: "No queued test response" } }
      }
      response.status = next_response.fetch(:status, 200)
      response["Content-Type"] = "application/json"
      response.body = JSON.generate(next_response.fetch(:body))
    end
  end
  thread = Thread.new { server.start }
  [server, thread, "http://127.0.0.1:#{server.config[:Port]}"]
end

def cloud_payload(space_bucks: 999)
  {
    "schemaVersion" => 1,
    "privacyClass" => "abstract",
    "sections" => {
      "profile" => {
        "display_name" => "Restored Miner",
        "miner_name" => "Restored",
        "suit_style" => "cozy sci-fi asteroid miner",
        "customization_unlocks" => ["suit_patch_basic"],
        "generated_assets" => []
      },
      "progress" => {
        "space_bucks" => space_bucks,
        "suit_condition" => 77,
        "current_asteroid_class_id" => "asteroid_starter_rubble",
        "unlocked_asteroid_class_ids" => ["asteroid_starter_rubble"],
        "unlocked_machine_ids" => ["machine_rock_cracker"],
        "asteroid_progress" => {
          "asteroid_class_id" => "asteroid_starter_rubble",
          "mined" => 321
        },
        "asteroid_progress_by_id" => {
          "asteroid_starter_rubble" => {
            "asteroid_class_id" => "asteroid_starter_rubble",
            "mined" => 321
          }
        },
        "stats" => {
          "turns_seen" => 3,
          "tool_events_seen" => 2,
          "work_score_total" => 12.5,
          "chonks_mined_total" => 321,
          "materials_found_total" => 4,
          "reports_emitted" => 1,
          "work_events" => {
            "work_apply_patch" => 1
          }
        }
      },
      "inventory" => {
        "mat_chonks" => 500
      },
      "orders" => {
        "orders" => [],
        "completed_orders" => [],
        "order_generation_index" => 2
      },
      "upgrades" => {
        "upgrades" => {},
        "unlocked_machine_ids" => ["machine_rock_cracker"]
      },
      "base" => {
        "base_modules" => {}
      },
      "cosmetics" => {
        "customization_unlocks" => ["suit_patch_basic"],
        "generated_assets" => []
      },
      "settings" => {
        "report_mode" => "milestones_only",
        "cloud_sync" => true
      },
      "syncMetadata" => {
        "last_pushed_sequence" => 4,
        "sync_cadence_seconds" => 10,
        "sync_mode" => "near_real_time",
        "entitlement_plan" => "pro_monthly"
      }
    }
  }
end

Dir.mktmpdir("mcp-miner-cloud-backup-client") do |dir|
  state_path = File.join(dir, "state.json")
  engine = McpMiner::GameEngine.new(root: ROOT, state_path: state_path)
  state = engine.initial_state
  state["space_bucks"] = 42
  state["inventory"]["mat_chonks"] = 12
  state["profile"]["display_name"] = "Local Miner"
  state["profile"]["avatar_concept_prompt"] = "Do not send this private prompt."
  state["profile"]["generated_assets"] = [
    {
      "asset_ref" => "#{dir}/private-avatar.png",
      "created_at" => "2026-05-24T00:00:00Z"
    },
    {
      "asset_ref" => "safe-avatar-ref",
      "created_at" => "2026-05-24T00:00:00Z"
    }
  ]
  engine.write_state(state)

  responses = {
    "/getCloudBackupStatus" => [
      {
        body: {
          result: {
            ok: true,
            eligible: false,
            entitlement: {
              plan: "free"
            },
            backup: nil
          }
        }
      }
    ],
    "/createCloudBackup" => [
      {
        status: 429,
        body: {
          error: {
            status: "RESOURCE_EXHAUSTED",
            message: "Cloud backup and restore is a Pro benefit.",
            details: {
              reason: "plan_limit_backup_restore"
            }
          }
        }
      },
      {
        body: {
          result: {
            ok: true,
            backup: {
              backupId: "current",
              checksum: "abc123",
              byteSize: 1234,
              sourceDeviceId: "device-a"
            }
          }
        }
      }
    ],
    "/restoreCloudBackup" => [
      {
        body: {
          result: {
            ok: true,
            backup: {
              backupId: "current",
              sourceDeviceId: "device-a"
            },
            conflict: {
              freshness: "local_newer",
              deviceRelation: "different_device"
            },
            payload: cloud_payload(space_bucks: 111)
          }
        }
      },
      {
        body: {
          result: {
            ok: true,
            backup: {
              backupId: "current",
              sourceDeviceId: "device-a"
            },
            conflict: {
              freshness: "cloud_newer",
              deviceRelation: "different_device"
            },
            payload: cloud_payload(space_bucks: 999)
          }
        }
      }
    ]
  }
  requests = []
  server, thread, origin = start_backup_server(responses, requests)
  begin
    linked = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "link_cloud_profile", arguments: { firebase_uid: "firebase_backup_uid" } } }
    ]).last)
    assert("local backup tests should start from a linked profile") do
      linked.dig("account_link", "status") == "linked"
    end

    status = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_backup_status", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    assert("backup status should show Free users the Pro-only benefit without changing local state") do
      status["ok"] == true &&
        status["status"] == "pro_required" &&
        status["eligible"] == false &&
        JSON.parse(File.read(state_path))["space_bucks"] == 42
    end

    free_create = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_cloud_backup", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    assert("Free backup creation should return Pro guidance without losing local play") do
      free_create["ok"] == false &&
        free_create["status"] == "pro_required" &&
        JSON.parse(File.read(state_path))["space_bucks"] == 42
    end

    pro_create = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_cloud_backup", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    create_request = requests.select { |request| request[:path] == "/createCloudBackup" }.last
    backup = create_request.dig(:body, "data", "backup")
    serialized_create = JSON.generate(create_request)
    assert("create_cloud_backup should send only allowlisted abstract backup sections") do
      pro_create["ok"] == true &&
        %w[profile progress inventory orders upgrades base cosmetics settings syncMetadata].all? { |section| backup.key?(section) } &&
        !serialized_create.include?("avatar_concept_prompt") &&
        !serialized_create.include?("Do not send this private prompt") &&
        !serialized_create.include?(dir) &&
        !serialized_create.include?(ROOT) &&
        serialized_create.include?("safe-avatar-ref")
    end

    restore_requests_before_confirmation = requests.count { |request| request[:path] == "/restoreCloudBackup" }
    missing_confirmation = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "restore_cloud_backup", arguments: { id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    assert("restore_cloud_backup should require explicit confirmation before contacting cloud restore") do
      missing_confirmation["ok"] == false &&
        missing_confirmation["status"] == "confirmation_required" &&
        requests.count { |request| request[:path] == "/restoreCloudBackup" } == restore_requests_before_confirmation
    end

    conflict = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "restore_cloud_backup", arguments: { confirm: true, id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    assert("local-newer cloud restore conflicts should not overwrite without allow_overwrite") do
      conflict["ok"] == false &&
        conflict["status"] == "local_newer_conflict" &&
        JSON.parse(File.read(state_path))["space_bucks"] == 42 &&
        Dir.glob("#{state_path}.backup-before-cloud-restore-*").empty?
    end

    restored = tool_payload(run_mcp(state_path, [
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "restore_cloud_backup", arguments: { confirm: true, allow_overwrite: true, id_token: "fake-id-token", functions_origin: origin } } }
    ]).last)
    restored_state = JSON.parse(File.read(state_path))
    assert("confirmed cloud restore should apply backup sections and preserve rollback file") do
      restored["ok"] == true &&
        restored["status"] == "restored" &&
        restored_state["space_bucks"] == 999 &&
        restored_state.dig("profile", "display_name") == "Restored Miner" &&
        restored_state["report_mode"] == "milestones_only" &&
        Dir.glob("#{state_path}.backup-before-cloud-restore-*").length == 1
    end
  ensure
    server.shutdown
    thread.join
  end
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks
})
