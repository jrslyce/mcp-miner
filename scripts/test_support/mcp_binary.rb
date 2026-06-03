#!/usr/bin/env ruby
# frozen_string_literal: true

require "rbconfig"

module McpMinerBinary
  module_function

  def root
    File.expand_path("../..", __dir__)
  end

  def plugin_root
    File.join(root, "plugins", "mcp-miner")
  end

  def path
    name = RbConfig::CONFIG.fetch("host_os").match?(/mswin|mingw|cygwin/i) ? "mcp-miner.exe" : "mcp-miner"
    binary = File.join(plugin_root, "bin", name)
    return binary if File.file?(binary)

    fallback = File.join(plugin_root, "bin", "mcp-miner")
    return fallback if File.file?(fallback)

    raise "missing MCP Miner Go binary; run npm run build:plugin-go first"
  end
end
