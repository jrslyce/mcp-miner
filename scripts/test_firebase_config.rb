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
    function_config["runtime"] == "nodejs20" &&
    functions_package.dig("engines", "node").include?("20") &&
    functions_package.dig("dependencies", "firebase-admin") &&
    functions_package.dig("dependencies", "firebase-functions")
end

assert("Firestore rules should stay closed except authenticated emulator smoke writes") do
  rules.include?("match /_emulatorSmoke/{uid}") &&
    rules.include?("request.auth.uid == uid") &&
    rules.include?("allow read, write: if false") &&
    !rules.include?("allow read, write: if true")
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
