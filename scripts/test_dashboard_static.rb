#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "yaml"

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
subscription_catalog = JSON.parse(read("firebase/hosting/subscription-plans.json"))
subscription_config = YAML.load_file(File.join(ROOT, "data/subscription_plans.yaml"))
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

required_panels = %w[auth billing device-link linked-devices sync-privacy status analytics weekly-digest cosmetics asteroid asteroid-atlas inventory orders upgrades store reports raw-sync base]
assert("landing page should explain MCP Miner before the dashboard") do
  index.include?(%(<main id="home" class="landing-shell">)) &&
    index.include?("Turn Codex work into a tiny asteroid-mining game.") &&
    index.include?("Install the plugin") &&
    index.include?("Open dashboard") &&
    index.include?(%(href="https://github.com/jrslyce/mcp-miner")) &&
    index.include?(%(src="/assets/logo.png")) &&
    index.include?(%(src="/assets/asteroids/asteroid_diamond_class_body.svg"))
end

assert("landing page should document gameplay, install, privacy, and account linking") do
  index.include?(%(id="how-it-works")) &&
    index.include?(%(id="privacy")) &&
    index.include?(%(id="install")) &&
    index.include?(%(id="portal")) &&
    index.include?("git clone https://github.com/jrslyce/mcp-miner.git") &&
    index.include?("ruby scripts/install_codex_plugin.rb") &&
    index.include?("Prompts stored") &&
    index.include?("Not collected for gameplay") &&
    index.include?("short-lived approval code") &&
    index.include?("revocable device token")
end

assert("landing page should use responsive production styles") do
  styles.include?(".landing-hero") &&
    styles.include?(".hero-console") &&
    styles.include?(".play-grid") &&
    styles.include?(".privacy-columns") &&
    styles.include?(".install-terminal") &&
    styles.include?("@media (max-width: 980px)") &&
    styles.include?("@media (max-width: 700px)") &&
    !styles.include?("radial-gradient")
end

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
    raw-sync-list
    raw-sync-count
    sync-status
    sync-cadence
    sync-next-refresh
    billing-status
    plan-cards
    checkout-monthly
    checkout-annual
    manage-billing
    linked-devices-usage
    linked-devices-list
    analytics-summary
    analytics-list
    export-json
    export-csv
    weekly-digest-status
    weekly-digest-summary
    weekly-digest-list
    weekly-digest-enabled
    beta-features-enabled
    beta-access-status
    cosmetics-summary
    cosmetics-list
    cosmetics-status
    privacy-list
    base-detail
  ].all? { |id| index.include?(%(id="#{id}")) }
end

assert("dashboard brand copy should describe the game instead of Firebase infrastructure") do
  index.include?(%(<p class="eyebrow">Space Mining Idle Game</p>)) &&
    !index.include?(%(<p class="eyebrow">Firebase dashboard</p>))
end

assert("dashboard JavaScript should support Auth, Firestore, Functions, and demo mode") do
  %w[
    getAuth
    GoogleAuthProvider
    signInWithPopup
    signInWithEmailAndPassword
    createUserWithEmailAndPassword
    sendEmailVerification
    reload
    getFirestore
    getFunctions
    httpsCallable
    connectFunctionsEmulator
    DEMO_DASHBOARD
    EMPTY_CLOUD_DASHBOARD
    renderDeviceLink
    approveLinkSession
    rejectLinkSession
    revokeSyncDevice
    renameSyncDevice
    renderLinkedDevices
    schedulePortalRefresh
    syncCadenceModel
    getDashboardAnalytics
    exportDashboardHistory
    getWeeklyDigest
    renderWeeklyDigest
    updatePortalPreference
    renderAnalytics
    requestHistoryExport
    getCosmeticCatalog
    applyCosmeticSelection
    renderCosmetics
    requestCosmeticApply
    cosmetic-preview
    cosmetic-apply
    renderStore
    createCheckoutSession
    createCustomerPortalSession
    loadPlanCatalog
    renderPlanCards
    annualDiscountCopy
    normalizeRawSyncRows
    renderRawSyncEvents
    getSyncState
    ensureLinkedProfile
    requiresEmailVerification
  ].all? { |needle| auth_js.include?(needle) }
end

assert("dashboard should render Pro weekly digest and beta preference controls") do
  index.include?(%(data-panel="weekly-digest")) &&
    index.include?(%(id="weekly-digest-enabled")) &&
    index.include?(%(id="beta-features-enabled")) &&
    auth_js.include?("function renderWeeklyDigest(digest, rawEntitlement, settings = {})") &&
    auth_js.include?("httpsCallable(functions, \"getWeeklyDigest\")") &&
    auth_js.include?("weeklyDigestEnabled") &&
    auth_js.include?("betaFeaturesEnabled") &&
    styles.include?(".digest-summary") &&
    styles.include?(".preference-grid") &&
    styles.include?(".toggle-row")
end

assert("dashboard should render cosmetic preview, apply, locked, and mobile-safe states") do
  index.include?(%(data-panel="cosmetics")) &&
    auth_js.include?("Cosmetics are visual only and do not affect mining rewards, Space Bucks, or orders.") &&
    auth_js.include?("data-state=\"${escapeHtml(activeCosmeticPreview === item.id ? \"preview\"") &&
    auth_js.include?("data-locked=\"${item.locked ? \"true\" : \"false\"}") &&
    auth_js.include?("cosmeticApplyAriaLabel") &&
    auth_js.include?("Preview ${escapeHtml(itemName)}") &&
    auth_js.include?("${itemName} applied") &&
    auth_js.include?("${itemName} locked: ${displayNameFromId(item.lockedReason || item.availability || \"locked\")}") &&
    styles.include?(".cosmetics-list") &&
    styles.include?(".cosmetic-row") &&
    styles.include?(":root[data-cosmetic-theme=\"nebula\"]") &&
    styles.include?("@media (max-width: 700px)") &&
    styles.include?(".cosmetics-list,")
end

assert("dashboard brand copy should match the game instead of Firebase internals") do
  index.include?("Space Mining Idle Game") &&
    !index.include?("Firebase dashboard")
end

assert("dashboard pricing catalog should match subscription pricing config") do
  plans_by_id = subscription_config.fetch("plans").to_h { |plan| [plan.fetch("id"), plan] }
  catalog_by_id = subscription_catalog.fetch("plans").to_h { |plan| [plan.fetch("id"), plan] }
  subscription_catalog.fetch("annualMonthsCharged") == subscription_config.dig("subscription_pricing", "annual_months_charged") &&
    catalog_by_id.keys.sort == plans_by_id.keys.sort &&
    catalog_by_id.all? do |id, plan|
      source = plans_by_id.fetch(id)
      plan.fetch("monthlyPriceCents") == source.fetch("monthly_price_cents") &&
        plan["annualPriceCents"] == source["annual_price_cents"] &&
        plan.fetch("shortCopy") == source.fetch("short_copy") &&
        plan.fetch("privacyCopy") == source.fetch("privacy_copy") &&
        plan.dig("entitlements", "maxCodexDevices") == source.dig("entitlements", "max_codex_devices") &&
        plan.dig("entitlements", "syncCadenceSeconds") == source.dig("entitlements", "sync_cadence_seconds")
    end
end

assert("dashboard subscription UX should expose plan cards without Stripe internals") do
  index.include?(%(id="plan-cards")) &&
    auth_js.include?("planActionState") &&
    auth_js.include?("billingActionLabel") &&
    auth_js.include?("Sign in to start monthly checkout") &&
    auth_js.include?("Sign in to start annual checkout") &&
    auth_js.include?("Sign in to manage billing") &&
    auth_js.include?("Current plan: ${planName}") &&
    auth_js.include?("Sign in to choose ${planName}") &&
    auth_js.include?(%(aria-label="${escapeHtml(action.ariaLabel)}")) &&
    auth_js.include?("Opening secure billing.") &&
    auth_js.include?("Cancellation scheduled.") &&
    auth_js.include?("Payment needs attention.") &&
    auth_js.include?("without collecting private work data") &&
    !subscription_catalog.to_s.include?("price_") &&
    !subscription_catalog.to_s.include?("cus_")
end

assert("dashboard should render linked device management without token secrets") do
  index.include?(%(data-panel="linked-devices")) &&
    index.include?(%(id="linked-devices-list")) &&
    auth_js.include?("function renderLinkedDevices(devices = [], rawEntitlement = FREE_ENTITLEMENT)") &&
    auth_js.include?("function updateLinkedDevice(action, deviceId, name = \"\")") &&
    auth_js.include?("httpsCallable(functions, action === \"rename\" ? \"renameSyncDevice\" : \"revokeSyncDevice\")") &&
    auth_js.include?("device-revoke") &&
    auth_js.include?("device-rename") &&
    !auth_js.include?("tokenHash") &&
    !index.include?("token hash")
end

assert("dashboard should use cadence polling instead of realtime listeners") do
  auth_js.include?("const PORTAL_POLLING") &&
    auth_js.include?("window.setTimeout") &&
    auth_js.include?("portalPollingSeconds") &&
    !auth_js.include?("onSnapshot")
end

assert("dashboard should render Pro analytics and export controls") do
  index.include?(%(data-panel="analytics")) &&
    index.include?(%(id="analytics-list")) &&
    index.include?(%(id="export-json")) &&
    index.include?(%(id="export-csv")) &&
    auth_js.include?("const getDashboardAnalytics = httpsCallable(functions, \"getDashboardAnalytics\")") &&
    auth_js.include?("function renderAnalytics(analytics, rawEntitlement)") &&
    auth_js.include?("function requestHistoryExport(format)") &&
    auth_js.include?("httpsCallable(functions, \"exportDashboardHistory\")") &&
    auth_js.include?("Exports contain abstract gameplay history only.") &&
    auth_js.include?("Pro unlocks history export.")
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
    index.include?(%(id="topbar-sign-out")) &&
    auth_js.include?("googleSignInButton.disabled = signedIn") &&
    auth_js.include?("signInButton.disabled = signedIn") &&
    auth_js.include?("createAccount.disabled = signedIn") &&
    auth_js.include?("signOutButton.disabled = !signedIn") &&
    auth_js.include?("topbarSignOutButton.hidden = !signedIn") &&
    auth_js.include?("topbarSignOutButton.disabled = !signedIn")
end

assert("password auth should require email verification before cloud sync and device linking") do
  index.include?(%(id="send-verification-email")) &&
    index.include?(%(id="email-verification-status")) &&
    auth_js.include?("function sendVerificationEmailFor(user = currentUser)") &&
    auth_js.include?("await sendEmailVerification(user)") &&
    auth_js.include?("function verificationDashboard()") &&
    auth_js.include?("Verify email before cloud sync") &&
    auth_js.include?("profileStatus.textContent = \"Verification required\"") &&
    auth_js.include?("approveDeviceLink.disabled = !signedIn || verificationRequired") &&
    auth_js.include?("await reload(currentUser)") &&
    auth_js.include?("await currentUser.getIdToken(true)")
end

assert("link URLs should promote device linking above the demo dashboard") do
  index.index(%(data-panel="device-link")) < index.index(%(data-panel="auth")) &&
    auth_js.include?("const pendingLink = {") &&
    auth_js.include?("function setLinkMode()") &&
    auth_js.include?("document.body.dataset.linkMode = hasPendingLink() ? \"pending\" : \"dashboard\"") &&
    auth_js.include?("function linkModeLabel(user)") &&
    auth_js.include?("pill: \"Device link\"") &&
    auth_js.include?("mode: \"Sign in to connect\"") &&
    auth_js.include?("mode: \"Approve Codex device\"") &&
    auth_js.include?("updated: \"Awaiting account\"") &&
    auth_js.include?("lastUpdated.textContent = linkLabel ? linkLabel.updated") &&
    auth_js.include?("const linkLabel = linkModeLabel(currentUser);") &&
    styles.include?("body[data-link-mode=\"pending\"] .workspace-grid") &&
    styles.include?("body[data-link-mode=\"pending\"] .link-panel")
end

assert("device link flow should expose clear account, verification, terminal, and error states") do
  index.include?(">Create Account</button>") &&
    auth_js.include?("const LINK_STATE_MESSAGES = {") &&
    auth_js.include?("const LINK_ERROR_MESSAGES = [") &&
    auth_js.include?("let deviceLinkState = \"waiting\"") &&
    auth_js.include?("function friendlyLinkMessage(error)") &&
    auth_js.include?("function deviceLinkContent(user, status)") &&
    auth_js.include?("Use Google, Sign In, or Create Account below") &&
    auth_js.include?("Verify your email, then refresh this dashboard before approving") &&
    auth_js.include?("Device approved. Return to Codex and run complete_account_link.") &&
    auth_js.include?("Start a new link from Codex if you want to connect later.") &&
    auth_js.include?("This link code expired. Return to Codex and start a new account link.") &&
    auth_js.include?("This link code was not found. Return to Codex and start a new account link.") &&
    auth_js.include?("This Codex device was already approved. Return to Codex and complete the account link.") &&
    auth_js.include?("approveDeviceLink.disabled = !signedIn || verificationRequired || linkLocked") &&
    auth_js.include?("rejectDeviceLink.disabled = !signedIn || verificationRequired || linkLocked") &&
    auth_js.include?("const callable = httpsCallable(functions, action === \"approve\" ? \"approveLinkSession\" : \"rejectLinkSession\");") &&
    auth_js.include?("renderDeviceLink(currentUser, action === \"approve\" ? \"approving\" : \"rejecting\")") &&
    auth_js.include?("renderDeviceLink(currentUser, friendly.status)")
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
  auth_js.include?("authIdentity.textContent = \"Private profile\";") &&
    auth_js.include?("email.value = \"\";") &&
    auth_js.include?("profileStatus.textContent = \"Loading\"")
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
    auth_js.include?("failedIndexes.includes(11)") &&
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

assert("billing panel should show annual copy and webhook-safe checkout state") do
  index.include?("12 months for 11") &&
    auth_js.include?("Pro unlocks only after Stripe confirms the subscription webhook.") &&
    auth_js.include?("openBillingSession(\"createCheckoutSession\", { plan: \"pro_monthly\" })") &&
    auth_js.include?("openBillingSession(\"createCheckoutSession\", { plan: \"pro_annual\" })") &&
    auth_js.include?("openBillingSession(\"createCustomerPortalSession\")") &&
    auth_js.include?("checkoutMonthly.disabled = !signedIn || verificationRequired || pro") &&
    auth_js.include?("manageBilling.disabled = !signedIn || verificationRequired || !entitlement.providerCustomerId")
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
    styles.include?("grid-template-columns: repeat(auto-fit, minmax(118px, 1fr))") &&
    styles.include?(".topbar,\n.workspace-grid,\n.side-rail,\n.main-board") &&
    styles.include?("grid-template-columns: repeat(auto-fit, minmax(76px, 1fr))") &&
    styles.include?(".topbar-actions > * {\n    width: 100%;\n    min-width: 0;\n  }") &&
    !styles.include?("letter-spacing: -")
end

assert("mobile dashboard header should stay compact instead of stacking every control") do
  styles.include?(".brand-lockup {\n    grid-auto-flow: column;\n    grid-template-columns: auto minmax(0, 1fr);\n    gap: 10px;\n  }") &&
    styles.include?(".brand-mark {\n    width: 48px;\n    height: 48px;\n  }") &&
    styles.include?(".topbar-actions {\n    width: 100%;\n    grid-auto-flow: row;\n    grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));\n    gap: 8px;\n    justify-content: stretch;\n  }")
end

assert("privacy rows should stack on narrow mobile screens") do
  styles.include?("@media (max-width: 700px)") &&
    styles.include?(".privacy-list li {\n    grid-template-columns: 1fr;\n    gap: 4px;\n  }")
end

assert("panel headings should stack on narrow mobile screens") do
  styles.include?("@media (max-width: 430px)") &&
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
    smoke.include?("getDashboardAnalytics") &&
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
