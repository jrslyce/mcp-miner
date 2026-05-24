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
        name: "get_active_orders",
        description: "Return currently generated MCP Miner orders with required materials and Space Bucks payouts.",
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
      when "get_active_orders"
        @engine.active_orders_payload
      when "get_catalog_summary"
        @engine.catalog_summary
      when "update_settings"
        @engine.update_settings(args)
      when "open_dashboard"
        { dashboard_url: "http://localhost:3317/dashboard", note: "Dashboard server is not implemented yet; this is the reserved MVP URL." }
      when "open_store"
        { store_url: "http://localhost:3317/store", note: "Store UI is not implemented yet; this is the reserved in-game store URL." }
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
