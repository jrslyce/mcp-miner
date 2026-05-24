#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require_relative "../lib/mcp_miner/game_engine"

class McpMinerServer
  PROTOCOL_VERSION = "2024-11-05"
  ROOT = File.expand_path("../../..", __dir__)

  def initialize
    @engine = McpMiner::GameEngine.new(root: ROOT)
  end

  def run
    $stdout.sync = true
    $stderr.sync = true

    STDIN.each_line do |line|
      next if line.strip.empty?

      request = JSON.parse(line)
      response = handle(request)
      $stdout.puts(JSON.generate(response)) if response
    rescue JSON::ParserError => e
      warn "MCP Miner JSON parse error: #{e.message}"
    rescue StandardError => e
      warn "MCP Miner server error: #{e.class}: #{e.message}"
      if request && request["id"]
        $stdout.puts(JSON.generate(error_response(request["id"], -32_603, e.message)))
      end
    end
  end

  private

  def handle(request)
    method = request["method"]
    id = request["id"]

    case method
    when "initialize"
      result(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: {
          name: "mcp-miner",
          version: "0.1.0"
        },
        capabilities: {
          tools: {}
        }
      })
    when "notifications/initialized", "initialized"
      nil
    when "tools/list"
      result(id, { tools: tools })
    when "tools/call"
      call_tool(id, request.dig("params", "name"), request.dig("params", "arguments") || {})
    else
      id ? error_response(id, -32_601, "Unknown method: #{method}") : nil
    end
  end

  def tools
    [
      {
        name: "get_player_status",
        description: "Return the local MCP Miner player status, inventory summary, settings, and current asteroid.",
        inputSchema: object_schema({})
      },
      {
        name: "get_latest_report",
        description: "Return the latest compact MCP Miner report.",
        inputSchema: object_schema({})
      },
      {
        name: "get_profile",
        description: "Return the local MCP Miner profile and avatar workflow metadata.",
        inputSchema: object_schema({})
      },
      {
        name: "update_profile",
        description: "Update local MCP Miner profile and avatar customization fields.",
        inputSchema: object_schema({
          display_name: {
            type: "string"
          },
          miner_name: {
            type: "string"
          },
          pronouns: {
            type: "string"
          },
          suit_style: {
            type: "string"
          },
          avatar_concept_prompt: {
            type: "string"
          },
          add_customization_unlock: {
            type: "string"
          },
          generated_asset_ref: {
            type: "string"
          }
        })
      },
      {
        name: "get_inventory",
        description: "Return the local MCP Miner inventory with material names, categories, rarity, and value totals.",
        inputSchema: object_schema({})
      },
      {
        name: "get_asteroid_status",
        description: "Return unlocked/selectable MCP Miner asteroid classes, depletion, composition, hazards, and rare-find pity.",
        inputSchema: object_schema({})
      },
      {
        name: "select_asteroid",
        description: "Select an unlocked MCP Miner asteroid class for future mining rewards.",
        inputSchema: object_schema({
          asteroid_id: {
            type: "string"
          }
        })
      },
      {
        name: "get_fabrication_status",
        description: "Return MCP Miner fabrication machines, queue state, completed products, and throughput.",
        inputSchema: object_schema({})
      },
      {
        name: "queue_fabrication",
        description: "Queue a fabricated product from a recipe and order variant when machine and materials are available.",
        inputSchema: object_schema({
          recipe_id: {
            type: "string"
          },
          variant_id: {
            type: "string"
          },
          quantity: {
            type: "integer",
            minimum: 1
          }
        })
      },
      {
        name: "get_active_orders",
        description: "Return currently generated MCP Miner orders with required materials and Space Bucks payouts.",
        inputSchema: object_schema({})
      },
      {
        name: "get_weekly_contracts",
        description: "Return longer-lived MCP Miner weekly contracts generated separately from active orders.",
        inputSchema: object_schema({})
      },
      {
        name: "complete_weekly_contract",
        description: "Complete a weekly contract using available materials or matching completed product stock.",
        inputSchema: object_schema({
          contract_id: {
            type: "string"
          }
        })
      },
      {
        name: "fulfill_order",
        description: "Fulfill an active MCP Miner order when required inventory is available.",
        inputSchema: object_schema({
          order_id: {
            type: "string"
          }
        })
      },
      {
        name: "refine_material",
        description: "Convert eligible raw inventory into refined MCP Miner materials.",
        inputSchema: object_schema({
          material_id: {
            type: "string"
          },
          quantity: {
            type: "integer",
            minimum: 1
          }
        })
      },
      {
        name: "sell_material",
        description: "Sell raw or refined MCP Miner inventory directly to the market for Space Bucks.",
        inputSchema: object_schema({
          material_id: {
            type: "string"
          },
          quantity: {
            type: "integer",
            minimum: 1
          }
        })
      },
      {
        name: "get_upgrade_status",
        description: "Return MCP Miner upgrade levels, next costs, effects, and affordability.",
        inputSchema: object_schema({})
      },
      {
        name: "purchase_upgrade",
        description: "Purchase one level of an MCP Miner upgrade when Space Bucks and materials are available.",
        inputSchema: object_schema({
          upgrade_id: {
            type: "string"
          }
        })
      },
      {
        name: "get_base_status",
        description: "Return MCP Miner base modules, configured effects, and drone automation state.",
        inputSchema: object_schema({})
      },
      {
        name: "purchase_base_module",
        description: "Purchase or repair one level of an MCP Miner base module when prerequisites and costs are met.",
        inputSchema: object_schema({
          module_id: {
            type: "string"
          }
        })
      },
      {
        name: "get_settings",
        description: "Return current MCP Miner report, privacy, and local sync settings.",
        inputSchema: object_schema({})
      },
      {
        name: "get_account_link_status",
        description: "Return local Firebase Auth account-link status for optional cloud sync.",
        inputSchema: object_schema({})
      },
      {
        name: "link_cloud_profile",
        description: "Link the local MCP Miner profile to a Firebase Auth UID without storing credentials.",
        inputSchema: object_schema({
          firebase_uid: {
            type: "string"
          },
          display_name: {
            type: "string"
          }
        })
      },
      {
        name: "unlink_cloud_profile",
        description: "Unlink the local MCP Miner profile from Firebase Auth and keep local-only progress enabled.",
        inputSchema: object_schema({})
      },
      {
        name: "get_reward_controls",
        description: "Return privacy-safe MCP Miner reward-control diagnostics, cooldowns, soft caps, and diversity policy.",
        inputSchema: object_schema({})
      },
      {
        name: "get_milestone_status",
        description: "Return current asteroid milestone progress and local claim support status.",
        inputSchema: object_schema({})
      },
      {
        name: "get_catalog_summary",
        description: "Return counts and loaded gameplay-data summary for the MCP Miner catalog.",
        inputSchema: object_schema({})
      },
      {
        name: "update_settings",
        description: "Update local MCP Miner settings such as report mode or cloud sync preference.",
        inputSchema: object_schema({
          report_mode: {
            type: "string",
            enum: McpMiner::GameEngine::VALID_REPORT_MODES
          },
          cloud_sync: {
            type: "boolean"
          }
        })
      },
      {
        name: "sync_progress",
        description: "Report local/offline sync state, queued event counts, and account-link status.",
        inputSchema: object_schema({})
      },
      {
        name: "sync_cloud",
        description: "Push queued privacy-safe MCP Miner journal events to the configured Cloud Functions sync API.",
        inputSchema: object_schema({
          id_token: {
            type: "string"
          },
          functions_origin: {
            type: "string"
          }
        })
      },
      {
        name: "claim_milestone",
        description: "Return local milestone claim availability. Claiming is disabled until milestone rewards are defined.",
        inputSchema: object_schema({
          milestone_id: {
            type: "string"
          }
        })
      },
      {
        name: "open_dashboard",
        description: "Return the MCP Miner dashboard URL.",
        inputSchema: object_schema({})
      },
      {
        name: "open_store",
        description: "Return the MCP Miner in-game store URL.",
        inputSchema: object_schema({})
      }
    ]
  end

  def object_schema(properties)
    {
      type: "object",
      properties: properties,
      additionalProperties: false
    }
  end

  def call_tool(id, name, args)
    payload =
      case name
      when "get_player_status"
        @engine.player_status
      when "get_latest_report"
        @engine.latest_report_payload
      when "get_profile"
        @engine.profile_payload
      when "update_profile"
        @engine.update_profile_payload(args)
      when "get_inventory"
        @engine.inventory_payload
      when "get_asteroid_status"
        @engine.asteroid_status_payload
      when "select_asteroid"
        @engine.select_asteroid_payload(args)
      when "get_fabrication_status"
        @engine.fabrication_status_payload
      when "queue_fabrication"
        @engine.queue_fabrication_payload(args)
      when "get_active_orders"
        @engine.active_orders_payload
      when "get_weekly_contracts"
        @engine.weekly_contracts_payload
      when "complete_weekly_contract"
        @engine.complete_weekly_contract_payload(args)
      when "fulfill_order"
        @engine.fulfill_order_payload(args)
      when "refine_material"
        @engine.refine_material_payload(args)
      when "sell_material"
        @engine.sell_material_payload(args)
      when "get_upgrade_status"
        @engine.upgrade_status_payload
      when "purchase_upgrade"
        @engine.purchase_upgrade_payload(args)
      when "get_base_status"
        @engine.base_status_payload
      when "purchase_base_module"
        @engine.purchase_base_module_payload(args)
      when "get_settings"
        @engine.settings_payload
      when "get_account_link_status"
        @engine.account_link_status_payload
      when "link_cloud_profile"
        @engine.link_cloud_profile_payload(args)
      when "unlink_cloud_profile"
        @engine.unlink_cloud_profile_payload(args)
      when "get_reward_controls"
        @engine.reward_controls_payload
      when "get_milestone_status"
        @engine.milestone_status_payload
      when "get_catalog_summary"
        @engine.catalog_summary
      when "update_settings"
        @engine.update_settings(args)
      when "sync_progress"
        @engine.sync_progress_payload
      when "sync_cloud"
        @engine.sync_cloud_payload(args)
      when "claim_milestone"
        @engine.claim_milestone_payload(args)
      when "open_dashboard"
        {
          dashboard_url: "http://localhost:3317/dashboard",
          status: "reserved",
          available: false,
          note: "Dashboard server is not implemented yet; this is the reserved MVP URL.",
          privacy: McpMiner::GameEngine::PRIVACY_NOTICE
        }
      when "open_store"
        {
          store_url: "http://localhost:3317/store",
          status: "reserved",
          available: false,
          note: "Store UI is not implemented yet; this is the reserved in-game store URL.",
          privacy: McpMiner::GameEngine::PRIVACY_NOTICE
        }
      else
        return error_response(id, -32_602, "Unknown tool: #{name}")
      end

    result(id, {
      content: [
        {
          type: "text",
          text: JSON.pretty_generate(payload)
        }
      ]
    })
  end

  def result(id, payload)
    {
      jsonrpc: "2.0",
      id: id,
      result: payload
    }
  end

  def error_response(id, code, message)
    {
      jsonrpc: "2.0",
      id: id,
      error: {
        code: code,
        message: message
      }
    }
  end
end

McpMinerServer.new.run
