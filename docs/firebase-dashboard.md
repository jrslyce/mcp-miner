# Firebase Dashboard MVP

The Firebase Hosting dashboard is a static web app in `firebase/hosting`. It opens on a working MCP Miner dashboard instead of a marketing page, with a signed-out demo snapshot and a signed-in cloud profile state.

## Data Sources

- Signed-out users see a local demo snapshot with status, inventory, active orders, asteroid progress, upgrades, Space Bucks store items, recent reports, sync state, linked-device state, and privacy state.
- Signed-in users use Firebase Auth, then read owner-scoped documents under `/players/{uid}`.
- The dashboard reads `getSyncState` and `getDashboardAnalytics` from Cloud Functions when available and falls back to direct owner reads for `gameState/current` and `syncMetadata/default`.
- Pro users can export abstract dashboard history through `exportDashboardHistory`; Free users see the shorter retained history without export access.
- Profile cosmetics load through `getCosmeticCatalog` and apply through `applyCosmeticSelection`, so Pro, beta, retired, and earned cosmetic access is validated server-side before it changes the portal/profile state.
- Linked device management reads owner-visible `/players/{uid}/syncDevices` metadata and uses `renameSyncDevice` / `revokeSyncDevice` callables for owner-only changes. Token hashes and secrets stay server-side.
- Portal refreshes use entitlement cadence polling instead of Firestore realtime listeners: Free stays on low-frequency one-minute refresh while Pro uses the configured near-real-time cadence.
- Subscription cards load from `firebase/hosting/subscription-plans.json`, which mirrors `data/subscription_plans.yaml` for public prices, annual discount copy, plan limits, and privacy-safe plan descriptions.
- Inventory, orders, upgrades, and base panels read their Firestore collections/documents where reducers have produced data. If cloud economy reducers have not produced those documents yet, the dashboard shows that the cloud profile is ready and is waiting for Codex sync.

## Privacy Boundary

The dashboard only fetches owner-scoped, abstract MCP Miner data. It does not fetch raw Codex work details, terminal output, file paths, prompts, assistant replies, repository names, browser content, app content, transcripts, or source code.

## Local Verification

Run static dashboard checks:

```sh
npm run test:dashboard
```

Run the emulator-backed dashboard smoke test when Java is available for the Firestore emulator:

```sh
npm run firebase:dashboard:smoke
```

The smoke test signs up an Auth emulator user, sends one abstract reward event to `syncRewardEvents`, reads `getSyncState`, `getDashboardAnalytics`, and `getCosmeticCatalog`, and verifies Firebase Hosting serves the dashboard panels.
