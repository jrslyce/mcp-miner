#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

ROOT = File.expand_path("..", __dir__)
$checks = 0

def assert(message)
  raise message unless yield

  $checks += 1
end

def read(path)
  File.read(File.join(ROOT, path))
end

index = read("firebase/hosting/index.html")
auth_js = read("firebase/hosting/auth.js")
styles = read("firebase/hosting/styles.css")
asset = read("firebase/hosting/assets/asteroid-scan.svg")
smoke = read("scripts/firebase_dashboard_smoke.js")
package = JSON.parse(read("package.json"))

required_panels = %w[auth sync-privacy status asteroid inventory orders upgrades store reports base]
assert("dashboard should render the V1 dashboard panels on the first screen") do
  required_panels.all? { |panel| index.include?(%(data-panel="#{panel}")) } &&
    index.include?(%(<script type="module" src="/auth.js"></script>)) &&
    index.include?(%(<img class="scan-art" src="/assets/asteroid-scan.svg"))
end

assert("dashboard should expose concrete status, inventory, order, upgrade, report, sync, and base targets") do
  %w[
    metric-space-bucks
    metric-chonks
    asteroid-progress-fill
    inventory-list
    orders-list
    upgrades-list
    store-list
    store-balance
    reports-list
    sync-status
    privacy-list
    base-detail
  ].all? { |id| index.include?(%(id="#{id}")) }
end

assert("dashboard JavaScript should support Auth, Firestore, Functions, and demo mode") do
  %w[
    getAuth
    signInWithEmailAndPassword
    createUserWithEmailAndPassword
    getFirestore
    getFunctions
    httpsCallable
    connectFunctionsEmulator
    DEMO_DASHBOARD
    renderStore
    getSyncState
    ensureLinkedProfile
  ].all? { |needle| auth_js.include?(needle) }
end

assert("dashboard reads should stay owner-scoped under players/{uid}") do
  auth_js.scan(/doc\(db, "players", user\.uid/).length >= 7 &&
    auth_js.include?('collection(db, "players", user.uid, "inventory")') &&
    auth_js.include?('collection(db, "players", user.uid, "orders")')
end

private_needles = %w[
  assistantReply
  sourceCode
  terminalOutput
  filePath
  rawTranscript
  browserContent
  appContent
  repoName
]
assert("dashboard should not fetch or render private Codex work fields") do
  combined = "#{index}\n#{auth_js}"
  private_needles.none? { |needle| combined.include?(needle) }
end

assert("dashboard styles should be responsive and stable across mobile and desktop") do
  styles.include?("@media (max-width: 980px)") &&
    styles.include?("@media (max-width: 700px)") &&
    styles.include?("grid-template-columns: 340px minmax(0, 1fr)") &&
    styles.include?("grid-template-columns: repeat(4, minmax(0, 1fr))") &&
    !styles.include?("letter-spacing: -")
end

assert("dashboard visual asset should be included as a Firebase Hosting static asset") do
  asset.include?("<svg") &&
    asset.include?("Asteroid scan") &&
    asset.include?("#1f7a5a")
end

assert("emulator dashboard smoke should exercise hosting and callable sync state") do
  smoke.include?("syncRewardEvents") &&
    smoke.include?("getSyncState") &&
    smoke.include?("HOSTING_HOST") &&
    smoke.include?("eventChecksum")
end

assert("package scripts should include dashboard checks without forcing Java-backed emulators in npm run check") do
  package.dig("scripts", "test:dashboard") == "ruby scripts/test_dashboard_static.rb" &&
    package.dig("scripts", "firebase:dashboard:smoke") &&
    package.dig("scripts", "check").include?("npm run test:dashboard") &&
    !package.dig("scripts", "check").include?("firebase:dashboard:smoke")
end

puts JSON.pretty_generate({
  ok: true,
  checks: $checks,
  panels: required_panels
})
