# V1 Launch Readiness

This checklist records the V1 privacy, security, and launch-readiness pass for MCP Miner.

## Scope Result

| Area | Status | Evidence |
| --- | --- | --- |
| Local-only play | Ready | `test:v1-readiness`, `test:mcp`, `test:hooks`, and `test:plugin-install` run with temporary local state and no Firebase auth requirement. |
| Optional Firebase linking/sync | Ready for emulator validation | `test:auth-linking`, `test:cloud-sync-client`, `test:cloud-sync-api`, `test:firestore-schema`, and `test:firebase-integration` cover static and local client behavior. Java-backed emulator smoke commands are listed below. |
| Dashboard/store privacy | Ready | `test:dashboard`, `test:store`, `test:firebase-integration`, and this readiness test verify the dashboard/store surfaces only abstract owner-scoped game data. |
| Security rules and sync API | Ready | Firestore schema/static checks, Cloud Functions static checks, sync API tests, and privacy denylist scans pass in `npm run check`. |
| Plugin packaging | Ready | `validate:plugin` and `test:plugin-install` verify manifest shape, hooks, MCP server launch, skill/tool alignment, and install docs. |
| V2 non-goals | Documented | GDD sections 22-24 and this document keep V2-only work out of V1 launch scope. |

## Required Verification

Run the full local verification suite:

```sh
npm run check
```

Run the focused readiness check:

```sh
npm run test:v1-readiness
```

Run Java-backed Firebase Emulator Suite smokes before production launch on a machine with Java:

```sh
npm run firebase:emulators:smoke
npm run firebase:rules:smoke
npm run firebase:auth:smoke
npm run firebase:sync:smoke
npm run firebase:dashboard:smoke
npm run firebase:integration:smoke
```

The Firestore emulator requires Java. If Java is unavailable, the static checks in `npm run check` still verify rules, schemas, Functions syntax, dashboard privacy surfaces, and sync reducers, but they do not replace a final emulator run.

## Privacy Review

Local state lives under `~/.mcp-miner/state.json` by default, with `journal.jsonl` beside it. Hook inputs may contain prompts, commands, working directories, or tool output, but persisted game state and journal reward entries must stay abstract.

Private data that must not be stored, synced, displayed, or logged:

- Prompts or assistant replies.
- Source code, diffs, commands, terminal output, or shell history.
- File paths, working directories, repository names, browser content, app content, email, or raw transcripts.

Allowed V1 data:

- Abstract event IDs, scores, reward totals, inventory, Space Bucks, upgrades, base modules, orders, weekly contracts, store transactions, profile fields, sync metadata, and anonymous project/agent fingerprints.

## Firebase And GCP Deployment Notes

Use the Firebase demo project only for local emulator work. Production setup must use a real Firebase project with:

- Firebase Auth enabled for dashboard sessions and linked profiles.
- Firestore rules deployed from `firebase/firestore.rules`.
- Cloud Functions deployed from `firebase/functions/src` with runtime secrets managed outside the repo.
- Firebase Hosting for the static dashboard, or Firebase App Hosting if the dashboard becomes a Next.js app.
- App Check enabled for production browser/dashboard calls where supported.
- Cloud Logging limited to operational metadata: request IDs, UID presence, privacy class, event type, reducer status, counts, and error codes. Logs must not include private work content.
- Least-privilege IAM for deploy identities and runtime service accounts.

## Dashboard And Store Review

The dashboard and Space Bucks store are V1 gameplay surfaces, not private-work surfaces. They may show:

- Player profile metadata, inventory, current asteroid, orders, weekly contracts, upgrade/base/store state, sync status, and recent MCP Miner reports.

They must not show:

- Prompt text, assistant replies, code, file paths, repo names, terminal output, browser/app content, email, or raw transcripts.

Store purchases use earned Space Bucks only. Real-money purchases are a non-goal for V1.

## V2 Non-Goals

These are intentionally out of scope for V1:

- Guild asteroids, leaderboards, seasons, events, real-time multiplayer, and public social sharing.
- Real-money payments or marketplace cosmetics.
- Mobile companion app, prestige worlds, public guild APIs, and animated miner/base dashboard.
- Raw token usage scoring or private-work-content analytics.

## Manual Smoke Notes

When Codex desktop plugin UI testing is available, enable the local plugin at `plugins/mcp-miner`, start a fresh turn, and confirm:

1. The SessionStart hook returns MCP Miner context.
2. Normal work can generate a compact `MCP Miner:` footer through the Stop hook.
3. `get_player_status`, `get_active_orders`, `get_inventory`, `get_store_catalog`, `open_dashboard`, and `open_store` are available.
4. Reports and dashboard/store panels contain only abstract gameplay data.
