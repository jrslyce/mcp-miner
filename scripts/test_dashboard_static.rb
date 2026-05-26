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
asteroid_ids = %w[
  asteroid_starter_rubble
  asteroid_quartz_belt
  asteroid_iron_tumblers
  asteroid_sapphire_debris_field
  asteroid_ember_rocks
  asteroid_amethyst_archive_belt
  asteroid_diamond_class_body
]

required_panels = %w[auth device-link sync-privacy status asteroid asteroid-atlas inventory orders upgrades store reports base]
assert("dashboard should render the V1 dashboard panels on the first screen") do
  required_panels.all? { |panel| index.include?(%(data-panel="#{panel}")) } &&
    index.include?(%(<script type="module" src="/auth.js"></script>)) &&
    index.include?(%(<img id="asteroid-art" class="scan-art")) &&
    index.include?(%(<canvas id="asteroid-canvas"))
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
    GoogleAuthProvider
    signInWithPopup
    signInWithEmailAndPassword
    createUserWithEmailAndPassword
    getFirestore
    getFunctions
    httpsCallable
    connectFunctionsEmulator
    DEMO_DASHBOARD
    EMPTY_CLOUD_DASHBOARD
    renderDeviceLink
    approveLinkSession
    rejectLinkSession
    renderStore
    getSyncState
    ensureLinkedProfile
  ].all? { |needle| auth_js.include?(needle) }
end

assert("refresh control should not expose placeholder icon text") do
  index.include?(%(id="refresh-dashboard")) &&
    !index.include?(%(<span aria-hidden="true">R</span>))
end

assert("dashboard images should expose appropriate accessibility text") do
  index.include?(%(<img class="brand-mark" src="/assets/logo.png" alt="" aria-hidden="true">)) &&
    index.include?(%(<img id="asteroid-art" class="scan-art" src="/assets/asteroids/asteroid_starter_rubble.svg")) &&
    index.include?(%(alt="Starter Rubble procedural asteroid visualization"))
end

assert("order payout color should meet contrast on row backgrounds") do
  styles.include?("--amber: #92400e") &&
    styles.include?(".order-row b") &&
    !styles.include?("--amber: #b46b16")
end

assert("order payouts should identify Space Bucks units") do
  auth_js.include?("const reward = formatNumber(order.rewardSpaceBucks);") &&
    auth_js.include?("<b>${reward} SB</b>") &&
    !auth_js.include?("<b>${formatNumber(order.rewardSpaceBucks)}</b>")
end

assert("disabled dashboard buttons should use explicit readable colors instead of opacity") do
  styles.include?("button:disabled") &&
    styles.include?("background: var(--button-disabled-bg)") &&
    styles.include?("color: var(--button-disabled-ink)") &&
    styles.include?("opacity: 1") &&
    !styles.include?("opacity: 0.55")
end

assert("dashboard should support a persistent accessible theme toggle") do
  index.include?(%(id="theme-toggle")) &&
    index.include?(%(localStorage.getItem("mcp-miner-theme"))) &&
    auth_js.include?("const THEME_STORAGE_KEY = \"mcp-miner-theme\"") &&
    auth_js.include?("function applyTheme(theme)") &&
    auth_js.include?("themeToggle.setAttribute(\"aria-pressed\"") &&
    styles.include?(":root[data-theme=\"dark\"]") &&
    styles.include?("--button-secondary-bg")
end

assert("signed-in empty cloud profiles should not inherit demo progress") do
  auth_js.include?("Cloud profile ready") &&
    auth_js.include?("Waiting for Codex sync") &&
    auth_js.include?("cloneEmptyCloud") &&
    auth_js.include?("hasCloudState") &&
    !auth_js.include?("Firebase profile plus demo economy preview")
end

assert("signed-in auth transitions should clear the demo dashboard before async cloud reads finish") do
  auth_js.include?("profileStatus.textContent = \"Loading\"") &&
    auth_js.include?("setMessage(\"Loading profile.\")") &&
    auth_js.include?("renderDashboard(cloneEmptyCloud({\n    source: \"Checking cloud sync...\"\n  }))") &&
    auth_js.index("renderDashboard(cloneEmptyCloud({\n    source: \"Checking cloud sync...\"\n  }))") < auth_js.index("const result = await ensureLinkedProfile(user)")
end

assert("signed-in empty asteroid progress should not render zero-over-zero progress") do
  auth_js.include?("const hasAsteroidProgress = numberValue(asteroid.depletionSize) > 0;") &&
    auth_js.include?("No asteroid progress synced yet.") &&
    auth_js.include?("asteroidProgressPercent.hidden = !hasAsteroidProgress") &&
    auth_js.include?("progressTrack.hidden = !hasAsteroidProgress")
end

assert("asteroid class identity should drive generated art and canvas rendering") do
  auth_js.include?("const ASTEROID_CLASSES = [") &&
    auth_js.include?("function asteroidClassIdFrom(value)") &&
    auth_js.include?("function normalizeAsteroid(state)") &&
    auth_js.include?("asteroidClassId,") &&
    auth_js.include?("function renderAsteroidArt(asteroid, progress)") &&
    auth_js.include?("function drawAsteroidCanvas(timestamp = 0)") &&
    auth_js.include?("function renderAsteroidAtlas(asteroid)") &&
    auth_js.include?("reducedMotion.matches")
end

assert("report mode should render as player-readable text") do
  auth_js.include?("function reportModeLabel(mode)") &&
    auth_js.include?("[\"Report mode\", reportModeLabel(data.settings && data.settings.reportMode)]") &&
    !auth_js.include?("[\"Report mode\", data.settings && data.settings.reportMode ? data.settings.reportMode : \"meaningful_turns_only\"]")
end

assert("privacy metadata should render as player-readable text") do
  auth_js.include?("[\"Data class\", \"Abstract progress only\"]") &&
    auth_js.include?("[\"Private details\", \"Not collected\"]") &&
    auth_js.include?("[\"Owner scope\", currentUser ? \"Private profile boundary\" : \"Local demo\"]") &&
    !auth_js.include?("[\"Data class\", \"abstract\"]") &&
    !auth_js.include?("[\"Private details\", \"not fetched\"]") &&
    !auth_js.include?("Firebase UID boundary")
end

assert("last event should render as a friendly event label") do
  auth_js.include?("function eventLabel(cloudState)") &&
    auth_js.include?("return \"No events yet\";") &&
    auth_js.include?("return sequence > 0 ? `Event ${formatNumber(sequence)}` : displayNameFromId(eventId);") &&
    auth_js.include?("<div><dt>Last event</dt><dd>${escapeHtml(eventLabel(cloudState))}</dd></div>") &&
    !auth_js.include?("return \"none\";") &&
    !auth_js.include?("<div><dt>Last event</dt><dd>${escapeHtml(cloudState.lastEventId || \"none\")}</dd></div>")
end

assert("auth buttons should reflect signed-in and signed-out states") do
  auth_js.include?("function updateAuthControls(user)") &&
    index.include?(%(id="google-sign-in")) &&
    auth_js.include?("googleSignInButton.disabled = signedIn") &&
    auth_js.include?("signInButton.disabled = signedIn") &&
    auth_js.include?("createAccount.disabled = signedIn") &&
    auth_js.include?("signOutButton.disabled = !signedIn")
end

assert("signed-in account panel should not render the raw Firebase UID") do
  index.include?("<dt>Account</dt>") &&
    index.include?(%(id="auth-identity">Not signed in</dd>)) &&
    auth_js.include?("authIdentity.textContent = \"Private profile\"") &&
    auth_js.include?("authIdentity.textContent = \"Not signed in\"") &&
    !index.include?("<dt>UID</dt>") &&
    !auth_js.include?("authUid.textContent = user.uid")
end

assert("signed-in auth form should not keep account identifiers in disabled inputs") do
  auth_js.include?("authIdentity.textContent = \"Private profile\";\n  email.value = \"\";\n  profileStatus.textContent = \"Loading\"")
end

assert("auth flow should validate form input, hide Firebase internals, and clear passwords") do
    auth_js.include?("AUTH_ERROR_MESSAGES") &&
    auth_js.include?("friendlyAuthMessage") &&
    auth_js.include?("FORM_VALIDATION_MESSAGE") &&
    auth_js.include?("function validateAuthForm()") &&
    auth_js.include?("function handleInvalidAuthField()") &&
    auth_js.include?("setMessage(FORM_VALIDATION_MESSAGE, true)") &&
    auth_js.include?("form.addEventListener(\"invalid\", handleInvalidAuthField, true)") &&
    auth_js.scan("validateAuthForm()").length >= 3 &&
    auth_js.include?("finally {\n    password.value = \"\";\n  }") &&
    !auth_js.include?("setMessage(error.message || \"Authentication failed.\"")
end

assert("sign-out should clear account-specific auth form values") do
  auth_js.include?("const previousUser = currentUser;") &&
    auth_js.include?("if (previousUser) {\n      email.value = \"\";\n    }") &&
    auth_js.include?("password.value = \"\";")
end

assert("store controls should not render active signed-in purchases without a purchase API") do
  auth_js.include?("state === \"affordable\" && !currentUser") &&
    auth_js.include?("applyDemoStorePurchase") &&
    auth_js.include?("purchased with earned Space Bucks")
end

assert("store action labels should distinguish disabled states from active buys") do
  auth_js.include?("function storeActionLabel(state, canBuy)") &&
    auth_js.include?("return \"Buy\"") &&
    auth_js.include?("return \"Unavailable\"") &&
    auth_js.include?("unaffordable: \"Need more\"") &&
    auth_js.include?("purchased: \"Owned\"") &&
    auth_js.include?("locked: \"Unavailable\"") &&
    auth_js.include?("${escapeHtml(actionLabel)}</button>")
end

assert("store action buttons should expose item-specific accessible names") do
  auth_js.include?("function storeButtonAccessibleLabel(item, actionLabel)") &&
    auth_js.include?("return `Buy ${itemName} ${kind}`;") &&
    auth_js.include?("return `Need more for ${itemName} ${kind}`;") &&
    auth_js.include?(%(aria-label="${escapeHtml(accessibleLabel)}"))
end

assert("store cost labels should show material quantities and names") do
  auth_js.include?("Object.entries(materials)") &&
    auth_js.include?("formatNumber(quantity)") &&
    auth_js.include?("displayNameFromId(materialId)") &&
    !auth_js.include?("materialCount = Object.keys(materials).length")
end

assert("signed-out dashboard refresh should replace stale action messages") do
  auth_js.include?("Demo preview refreshed.") &&
    auth_js.include?("purchased with earned Space Bucks.")
end

assert("signed-in dashboard refresh should warn when cloud reads are partial") do
  auth_js.include?("const DASHBOARD_REFRESH_SUCCESS = \"Dashboard refreshed.\"") &&
    auth_js.include?("const DASHBOARD_REFRESH_PARTIAL = \"Some cloud data could not be refreshed. Showing available owner data.\"") &&
    auth_js.include?("const SYNC_API_REFRESH_PARTIAL = \"Cloud sync API did not respond. Showing available owner data.\"") &&
    auth_js.include?("function refreshWarning(reads)") &&
    auth_js.include?("failedIndexes.includes(10)") &&
    auth_js.include?("if (data.refreshWarning)") &&
    auth_js.include?("setMessage(data.refreshWarning, true)") &&
    auth_js.include?("setMessage(DASHBOARD_REFRESH_SUCCESS)")
end

assert("signed-in reports panel should show an empty state when no reports are synced") do
  auth_js.include?("No cloud reports have been synced yet.") &&
    auth_js.include?("function renderReports(reports)") &&
    auth_js.include?("if (!reports.length)")
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

assert("privacy rows should stack on narrow mobile screens") do
  styles.include?("@media (max-width: 700px)") &&
    styles.include?(".privacy-list li {\n    grid-template-columns: 1fr;\n    gap: 4px;\n  }")
end

assert("panel headings should stack on very narrow mobile screens") do
  styles.include?("@media (max-width: 360px)") &&
    styles.include?(".panel-heading {\n    grid-template-columns: 1fr;\n    gap: 8px;\n  }") &&
    styles.include?(".panel-heading .pill,\n  .panel-heading .status-dot {\n    justify-self: start;\n  }") &&
    styles.include?("overflow-wrap: anywhere;")
end

assert("dashboard visual asset should be included as a Firebase Hosting static asset") do
  asset.include?("<svg") &&
    asset.include?("Asteroid scan") &&
    asset.include?("#1f7a5a")
end

assert("generated asteroid assets and plugin logo should be hosted") do
  File.exist?(File.join(ROOT, "firebase/hosting/assets/logo.png")) &&
    File.exist?(File.join(ROOT, "firebase/hosting/assets/asteroids/sprite-sheet.svg")) &&
    asteroid_ids.all? { |id| File.exist?(File.join(ROOT, "firebase/hosting/assets/asteroids/#{id}.svg")) } &&
    asteroid_ids.all? { |id| auth_js.include?("/assets/asteroids/#{id}.svg") }
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
