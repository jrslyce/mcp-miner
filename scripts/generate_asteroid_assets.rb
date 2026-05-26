#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "yaml"
require "zlib"

ROOT = File.expand_path("..", __dir__)
DATA_PATH = File.join(ROOT, "data", "asteroid_classes.yaml")
OUT_DIR = File.join(ROOT, "firebase", "hosting", "assets", "asteroids")

PALETTES = {
  "asteroid_starter_rubble" => {
    base: "#8d8174",
    shade: "#544d45",
    glow: "#42d998",
    crystals: ["#b7c0bd", "#7f8f89", "#d8c5a5"]
  },
  "asteroid_quartz_belt" => {
    base: "#7d8d98",
    shade: "#3f505d",
    glow: "#6ee7ff",
    crystals: ["#d8fbff", "#a7f3ff", "#8dd0f7"]
  },
  "asteroid_iron_tumblers" => {
    base: "#94634f",
    shade: "#4c3029",
    glow: "#ffb66e",
    crystals: ["#d7a17e", "#bc6e4f", "#f1d0ab"]
  },
  "asteroid_sapphire_debris_field" => {
    base: "#536c98",
    shade: "#202e56",
    glow: "#6ea8ff",
    crystals: ["#9fc7ff", "#5e8dff", "#e8f3ff"]
  },
  "asteroid_ember_rocks" => {
    base: "#884839",
    shade: "#341a1a",
    glow: "#ff6f3d",
    crystals: ["#ffcc66", "#ff8a4b", "#ffe2a6"]
  },
  "asteroid_amethyst_archive_belt" => {
    base: "#6b5a8e",
    shade: "#2e214c",
    glow: "#cf8dff",
    crystals: ["#d6b2ff", "#a56dff", "#f0dcff"]
  },
  "asteroid_diamond_class_body" => {
    base: "#a8bac7",
    shade: "#485967",
    glow: "#f8fbff",
    crystals: ["#ffffff", "#c8f4ff", "#f6e8ff"]
  }
}.freeze

def seeded_rng(id)
  Random.new(Zlib.crc32(id))
end

def rock_points(rng, cx, cy, radius, count)
  count.times.map do |index|
    angle = (Math::PI * 2 * index / count) + rng.rand(-0.08..0.08)
    warp = rng.rand(0.72..1.12)
    x = cx + Math.cos(angle) * radius * warp
    y = cy + Math.sin(angle) * radius * rng.rand(0.74..1.08)
    "#{x.round(1)},#{y.round(1)}"
  end.join(" ")
end

def crater(rng, index, palette)
  x = rng.rand(70..186)
  y = rng.rand(70..182)
  r = rng.rand(7..17)
  opacity = rng.rand(0.22..0.38).round(2)
  <<~SVG
    <ellipse cx="#{x}" cy="#{y}" rx="#{r}" ry="#{(r * rng.rand(0.58..0.9)).round(1)}" fill="#{palette.fetch(:shade)}" opacity="#{opacity}" transform="rotate(#{rng.rand(-28..28)} #{x} #{y})"/>
    <path d="M#{x - r} #{y - 1}c#{r * 0.7} #{r * 0.45} #{r * 1.3} #{r * 0.5} #{r * 2} 0" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="#{rng.rand(1..3)}" stroke-linecap="round"/>
  SVG
end

def crystal(rng, index, palette)
  x = rng.rand(70..180)
  y = rng.rand(66..176)
  h = rng.rand(18..36)
  w = rng.rand(8..16)
  color = palette.fetch(:crystals)[index % palette.fetch(:crystals).length]
  points = [
    [x, y - h],
    [x + w, y],
    [x + (w * 0.35), y + (h * 0.25)],
    [x - (w * 0.85), y + (h * 0.12)]
  ].map { |point| point.map { |v| v.round(1) }.join(",") }.join(" ")
  <<~SVG
    <polygon points="#{points}" fill="#{color}" fill-opacity="0.78" stroke="#fff" stroke-opacity="0.34" stroke-width="1.4" transform="rotate(#{rng.rand(-24..24)} #{x} #{y})"/>
  SVG
end

def asteroid_svg(asteroid)
  id = asteroid.fetch("id")
  display_name = asteroid.fetch("display_name")
  palette = PALETTES.fetch(id)
  rng = seeded_rng(id)
  points = rock_points(rng, 128, 128, rng.rand(72..86), rng.rand(18..24))
  craters = Array.new(rng.rand(7..10)) { |index| crater(rng, index, palette) }.join
  crystals = Array.new(rng.rand(3..6)) { |index| crystal(rng, index, palette) }.join
  scan_dash = rng.rand(16..26)

  <<~SVG
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="#{display_name} procedural asteroid">
      <defs>
        <radialGradient id="bg-#{id}" cx="35%" cy="28%" r="80%">
          <stop offset="0" stop-color="#{palette.fetch(:glow)}" stop-opacity="0.22"/>
          <stop offset="0.45" stop-color="#0b1720" stop-opacity="0.08"/>
          <stop offset="1" stop-color="#05080d" stop-opacity="0.28"/>
        </radialGradient>
        <linearGradient id="rock-#{id}" x1="62" y1="48" x2="190" y2="210">
          <stop offset="0" stop-color="#{palette.fetch(:base)}"/>
          <stop offset="1" stop-color="#{palette.fetch(:shade)}"/>
        </linearGradient>
        <filter id="shadow-#{id}" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#041015" flood-opacity="0.42"/>
        </filter>
      </defs>
      <rect width="256" height="256" rx="28" fill="url(#bg-#{id})"/>
      <circle cx="128" cy="128" r="102" fill="none" stroke="#{palette.fetch(:glow)}" stroke-opacity="0.22" stroke-width="2"/>
      <circle cx="128" cy="128" r="78" fill="none" stroke="#fff" stroke-opacity="0.13" stroke-width="2" stroke-dasharray="#{scan_dash} 12"/>
      <polygon points="#{points}" fill="url(#rock-#{id})" filter="url(#shadow-#{id})"/>
      <polygon points="#{points}" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="2"/>
      #{craters}
      #{crystals}
      <path d="M58 188c38 30 95 36 140 3" fill="none" stroke="#{palette.fetch(:glow)}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.72"/>
      <circle cx="52" cy="58" r="3" fill="#fff" opacity="0.7"/>
      <circle cx="209" cy="64" r="2.5" fill="#fff" opacity="0.55"/>
      <circle cx="213" cy="207" r="2" fill="#fff" opacity="0.5"/>
      <title>#{display_name}</title>
    </svg>
  SVG
end

def sprite_sheet(asteroids)
  symbols = asteroids.map do |asteroid|
    id = asteroid.fetch("id")
    body = asteroid_svg(asteroid)
      .sub(/\A<svg[^>]*>/, "")
      .sub(%r{</svg>\s*\z}, "")
    %(<symbol id="#{id}" viewBox="0 0 256 256">#{body}</symbol>)
  end.join("\n")

  <<~SVG
    <svg xmlns="http://www.w3.org/2000/svg" style="display:none">
    #{symbols}
    </svg>
  SVG
end

data = YAML.load_file(DATA_PATH)
asteroids = data.fetch("asteroid_classes")

FileUtils.mkdir_p(OUT_DIR)
asteroids.each do |asteroid|
  File.write(File.join(OUT_DIR, "#{asteroid.fetch("id")}.svg"), asteroid_svg(asteroid))
end
File.write(File.join(OUT_DIR, "sprite-sheet.svg"), sprite_sheet(asteroids))

puts "Generated #{asteroids.length} asteroid assets in #{OUT_DIR}"
