#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"
require "optparse"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
PLUGIN_SOURCE = File.join(ROOT, "plugins", "mcp-miner")
DEFAULT_DIST = File.join(ROOT, "dist")
TARGET_ALIASES = {
  "windows" => "windows-amd64",
  "windows-amd64" => "windows-amd64",
  "darwin-arm64" => "darwin-arm64",
  "macos-arm64" => "darwin-arm64",
  "mac-silicon" => "darwin-arm64",
  "darwin-amd64" => "darwin-amd64",
  "macos-amd64" => "darwin-amd64",
  "mac-intel" => "darwin-amd64"
}.freeze

options = {
  target: "darwin-arm64",
  output_dir: nil,
  force: false
}

OptionParser.new do |parser|
  parser.banner = "Usage: ruby scripts/package_plugin_release.rb [options]"

  parser.on("--target TARGET", "windows-amd64, darwin-arm64, or darwin-amd64") do |target|
    options[:target] = target
  end

  parser.on("--output-dir PATH", "Bundle root output directory") do |path|
    options[:output_dir] = path
  end

  parser.on("--force", "Replace an existing output directory") do
    options[:force] = true
  end
end.parse!

target = TARGET_ALIASES[options[:target].downcase]
abort("Unsupported package target: #{options[:target]}") unless target

output_dir = File.expand_path(options[:output_dir] || File.join(DEFAULT_DIST, "mcp-miner-#{target}"))
if File.exist?(output_dir)
  abort("Output directory exists, pass --force to replace: #{output_dir}") unless options[:force]

  unless output_dir.start_with?(File.expand_path(DEFAULT_DIST)) || output_dir.start_with?(Dir.tmpdir)
    abort("Refusing to remove output outside dist or temp: #{output_dir}")
  end
  FileUtils.rm_rf(output_dir)
end

plugin_output = File.join(output_dir, "plugins", "mcp-miner")
FileUtils.mkdir_p(plugin_output)

FileUtils.cp_r(File.join(ROOT, "data"), File.join(output_dir, "data"))
FileUtils.mkdir_p(File.join(output_dir, ".agents", "plugins"))
FileUtils.cp(File.join(ROOT, ".agents", "plugins", "marketplace.json"), File.join(output_dir, ".agents", "plugins", "marketplace.json"))
FileUtils.mkdir_p(File.join(output_dir, "scripts"))
FileUtils.cp(File.join(ROOT, "scripts", "install_codex_plugin.rb"), File.join(output_dir, "scripts", "install_codex_plugin.rb"))

Dir.children(PLUGIN_SOURCE).each do |name|
  next if name == "bin"

  FileUtils.cp_r(File.join(PLUGIN_SOURCE, name), File.join(plugin_output, name))
end

bin_dir = File.join(plugin_output, "bin")
stdout, stderr, status = Open3.capture3(
  "ruby",
  File.join(ROOT, "scripts", "build_plugin_go.rb"),
  "--target",
  target,
  "--output-dir",
  bin_dir
)
abort("Go package build failed: #{stderr}#{stdout}") unless status.success?

stdout, stderr, status = Open3.capture3(
  "ruby",
  File.join(ROOT, "scripts", "render_plugin_hooks.rb"),
  "--target",
  target,
  "--output",
  File.join(plugin_output, "hooks", "hooks.json")
)
abort("Hook render failed: #{stderr}#{stdout}") unless status.success?

puts JSON.pretty_generate({
  ok: true,
  target: target,
  output_dir: output_dir,
  plugin_root: plugin_output,
  binary: File.join(bin_dir, target == "windows-amd64" ? "mcp-miner.exe" : "mcp-miner")
})
