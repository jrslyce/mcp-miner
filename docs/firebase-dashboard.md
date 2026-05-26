# Firebase Dashboard MVP

The Firebase Hosting dashboard is a static web app in `firebase/hosting`. It opens on a working MCP Miner dashboard instead of a marketing page, with a signed-out demo snapshot and a signed-in cloud profile state.

## Data Sources

- Signed-out users see a local demo snapshot with status, inventory, active orders, asteroid progress, upgrades, Space Bucks store items, recent reports, sync state, linked-device state, and privacy state.
- Signed-in users use Firebase Auth, then read owner-scoped documents under `/players/{uid}`.
- The dashboard reads `getSyncState` from Cloud Functions when available and falls back to direct owner reads for `gameState/current` and `syncMetadata/default`.
- Linked device management reads owner-visible `/players/{uid}/syncDevices` metadata and uses `renameSyncDevice` / `revokeSyncDevice` callables for owner-only changes. Token hashes and secrets stay server-side.
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

The smoke test signs up an Auth emulator user, sends one abstract reward event to `syncRewardEvents`, reads `getSyncState`, and verifies Firebase Hosting serves the dashboard panels.
