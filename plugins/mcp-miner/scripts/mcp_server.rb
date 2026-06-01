#!/usr/bin/env ruby
# frozen_string_literal: true

plugin_root = File.expand_path("..", __dir__)
repo_root = File.expand_path("../..", plugin_root)
binary_names = Gem.win_platform? ? %w[mcp-miner.exe mcp-miner] : %w[mcp-miner]
binary_path = binary_names.map { |name| File.join(plugin_root, "bin", name) }.find { |path| File.file?(path) }

if binary_path
  exec({ "MCP_MINER_REPO_ROOT" => repo_root }, binary_path, "mcp")
end

go = ENV.fetch("GO", "go")
exec({ "MCP_MINER_REPO_ROOT" => repo_root }, go, "run", File.join(repo_root, "cmd", "mcp-miner"), "mcp")
