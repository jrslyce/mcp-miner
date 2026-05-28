#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

ROOT = File.expand_path("..", __dir__)
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def read_json(path)
  JSON.parse(File.read(File.join(ROOT, path)))
end

firebase = read_json("firebase.json")
firebaserc = read_json(".firebaserc")
indexes = read_json("firestore.indexes.json")
functions_package = read_json("firebase/functions/package.json")
rules = File.read(File.join(ROOT, "firestore.rules"))
docs = File.read(File.join(ROOT, "docs", "firebase-local.md"))
package = read_json("package.json")

assert("Firebase project should default to a demo project") do
  firebaserc.dig("projects", "default") == "demo-mcp-miner"
end

assert("Firebase config should wire Firestore rules and indexes") do
  firebase.dig("firestore", "rules") == "firestore.rules" &&
    firebase.dig("firestore", "indexes") == "firestore.indexes.json" &&
    indexes["indexes"].is_a?(Array)
end

assert("Firebase Hosting should revalidate launch-critical dashboard files") do
  headers = firebase.dig("hosting", "headers") || []
  headers.any? do |entry|
    entry["source"] == "**" &&
      entry["headers"].any? { |header| header["key"] == "Cache-Control" && header["value"] == "no-cache" }
  end
end

assert("Firebase Hosting should include baseline browser security headers") do
  headers = firebase.dig("hosting", "headers") || []
  dashboard_headers = headers.find { |entry| entry["source"] == "**" }.fetch("headers")
  header_values = dashboard_headers.to_h { |header| [header["key"], header["value"]] }
  header_values["X-Content-Type-Options"] == "nosniff" &&
    header_values["Content-Security-Policy"].include?("default-src 'self'") &&
    header_values["Content-Security-Policy"].include?("script-src 'self' https://www.gstatic.com https://apis.google.com") &&
    header_values["Content-Security-Policy"].include?("object-src 'none'") &&
    header_values["Content-Security-Policy"].include?("frame-ancestors 'none'") &&
    header_values["Cross-Origin-Opener-Policy"] == "same-origin-allow-popups" &&
    header_values["Cross-Origin-Resource-Policy"] == "same-origin" &&
    header_values["Referrer-Policy"] == "strict-origin-when-cross-origin" &&
    header_values["X-Permitted-Cross-Domain-Policies"] == "none" &&
    header_values["X-Frame-Options"] == "DENY" &&
    header_values["Permissions-Policy"].include?("camera=()") &&
    header_values["Permissions-Policy"].include?("microphone=()") &&
    header_values["Permissions-Policy"].include?("geolocation=()")
end

assert("Emulator config should cover Auth, Firestore, Functions, Hosting, and UI") do
  emulators = firebase.fetch("emulators")
  emulators.dig("auth", "port") == 9099 &&
    emulators.dig("firestore", "port") == 8080 &&
    emulators.dig("functions", "port") == 5001 &&
    emulators.dig("hosting", "port") == 5000 &&
    emulators.dig("ui", "enabled") == true &&
    emulators["singleProjectMode"] == true
end

assert("Functions scaffold should declare Firebase dependencies and Node runtime") do
  function_config = firebase.fetch("functions").first
  function_config["source"] == "firebase/functions" &&
    function_config["runtime"] == "nodejs22" &&
    functions_package.dig("engines", "node").include?("22") &&
    functions_package.dig("dependencies", "firebase-admin") &&
    functions_package.dig("dependencies", "firebase-functions")
end

assert("Firestore rules should stay closed except authenticated emulator smoke writes") do
  rules.include?("match /_emulatorSmoke/{uid}") &&
    rules.include?("request.auth.uid == uid") &&
    rules.include?("allow read, write: if false") &&
    !rules.include?("allow read, write: if true")
end

assert("Firestore owner rules should require verified password email auth") do
  rules.include?("function isVerifiedEmailAuth()") &&
    rules.include?("request.auth.token.firebase.sign_in_provider == \"password\"") &&
    rules.include?("request.auth.token.email_verified == true") &&
    rules.include?("isSignedIn() && request.auth.uid == uid && isVerifiedEmailAuth()")
end

assert("Local startup and smoke-test commands should be documented and scripted") do
  package.dig("scripts", "firebase:emulators:start") &&
    package.dig("scripts", "firebase:emulators:smoke") &&
    docs.include?("npm run firebase:emulators:start") &&
    docs.include?("npm run firebase:emulators:smoke")
end

assert("Architecture notes should cover App Check, Secret Manager, logging, IAM, and Cloud Run") do
  %w[App\ Check Secret\ Manager Cloud\ Logging least-privilege Cloud\ Run].all? do |phrase|
    docs.include?(phrase)
  end
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  project: firebaserc.dig("projects", "default"),
  emulators: firebase.fetch("emulators").keys,
  functions_runtime: firebase.fetch("functions").first["runtime"]
})
