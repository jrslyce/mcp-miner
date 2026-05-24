# Firebase Dashboard MVP

The Firebase Hosting dashboard is a static web app in `firebase/hosting`. It opens on a working MCP Miner dashboard instead of a marketing page, with a signed-out demo snapshot and authenticated Firebase profile mode.

## Data Sources

- Signed-out users see a local demo snapshot with status, inventory, active orders, asteroid progress, upgrades, recent reports, sync state, and privacy state.
- Signed-in users use Firebase Auth, then read owner-scoped documents under `/players/{uid}`.
- The dashboard reads `getSyncState` from Cloud Functions when available and falls back to direct owner reads for `gameState/current` and `syncMetadata/default`.
- Inventory, orders, upgrades, and base panels read their Firestore collections/documents where reducers have produced data. If cloud economy reducers have not produced those documents yet, the dashboard keeps the demo economy preview visible while still showing the Firebase profile and sync state.

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
