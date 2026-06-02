#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "rbconfig"

ROOT = File.expand_path("..", __dir__)
BIN_DIR = File.join(ROOT, "plugins", "mcp-miner", "bin")
GO = ENV.fetch("GO", "go")

host_os = RbConfig::CONFIG.fetch("host_os")
binary_name = host_os.match?(/mswin|mingw|cygwin/i) ? "mcp-miner.exe" : "mcp-miner"
binary_path = File.join(BIN_DIR, binary_name)
hook_binary_path = File.join(BIN_DIR, "mcp-miner")

FileUtils.mkdir_p(BIN_DIR)
success = system(GO, "build", "-trimpath", "-o", binary_path, "./cmd/mcp-miner", chdir: ROOT)
abort("failed to build MCP Miner Go binary with #{GO}") unless success

if binary_path != hook_binary_path
  FileUtils.cp(binary_path, hook_binary_path)
end

puts binary_path
