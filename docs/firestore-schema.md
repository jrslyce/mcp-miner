# Firestore Schema And Privacy Boundaries

MCP Miner cloud sync stores owner-scoped, privacy-safe game data under `/players/{uid}`. Firebase Auth UID is the tenancy boundary. Cloud Functions reduce abstract reward events into aggregate game state with the Admin SDK; dashboard and plugin clients can read owner data, but they cannot directly write trusted aggregate balances such as inventory, Space Bucks, orders, upgrades, or base state.

## Collections

| Path | Owner | Client access | Purpose |
| --- | --- | --- | --- |
| `/players/{uid}` | `request.auth.uid == uid` | owner read/create/update | Account shell, schema version, display names, sync enabled flag. |
| `/players/{uid}/profile/current` | owner | owner read/create/update | Miner profile fields and avatar/customization references. |
| `/players/{uid}/settings/current` | owner | owner read/create/update | Report mode, sync preference, dashboard display preference, App Check debug flag. |
| `/players/{uid}/syncMetadata/{clientId}` | owner | owner read/create/update | Per-client cursors and conflict metadata. |
| `/players/{uid}/syncDevices/{deviceId}` | owner | owner read only | Server-owned public metadata for linked Codex devices; device token hashes stay outside owner-readable docs. |
| `/players/{uid}/entitlements/current` | owner | owner read only | Server-owned Free/Pro plan limits such as sync cadence, device count, and history retention. |
| `/players/{uid}/rewardEvents/{eventId}` | owner | owner read only | Server-owned abstract Codex work-event summaries after Functions validate and reduce receipts. |
| `/players/{uid}/gameState/current` | owner | owner read only | Cloud-reduced materialized game state, including Space Bucks and schema versions. |
| `/players/{uid}/inventory/{bucket}` | owner | owner read only | Cloud-reduced inventory buckets for dashboard reads. |
| `/players/{uid}/upgrades/current` | owner | owner read only | Cloud-reduced upgrade levels and effects. |
| `/players/{uid}/orders/{orderId}` | owner | owner read only | Cloud-reduced active and completed order state. |
| `/players/{uid}/base/current` | owner | owner read only | Cloud-reduced base module and drone state. |
| `/linkSessions/{sessionId}` | server | none | Short-lived device-link approval sessions created by callable Functions. |
| `/linkCodes/{code}` | server | none | Atomic one-time code reservations that prevent active link-code collisions. |
| `/deviceTokens/{tokenHash}` | server | none | Hash-only revocable device token records used by callable Functions. |

## Client-Write Boundaries

Clients may create profile/settings/sync metadata. Clients may not write reward events or aggregate balances directly. In production, Cloud Functions are responsible for validating reward event signatures, dedupe keys, cooldowns, daily soft caps, and reducers before writing reward events and game state.

Link sessions, link-code reservations, and device-token hashes are top-level server-owned collections. They are written only by Cloud Functions through the Admin SDK and remain blocked from direct dashboard/plugin Firestore access by the default deny rule.

The owner field must match Firebase Auth:

```json
{
  "ownerUid": "firebase-auth-uid",
  "schemaVersion": 1,
  "privacyClass": "abstract",
  "updatedAt": "2026-05-24T00:00:00Z"
}
```

## Abstract Reward Event

Server-stored reward events are append-only and use deterministic event IDs from the local journal:

```json
{
  "ownerUid": "firebase-auth-uid",
  "eventId": "evt_abc123",
  "eventType": "work_apply_patch",
  "schemaVersion": 1,
  "receiptSchemaVersion": 2,
  "receiptType": "abstract_work",
  "sequence": 42,
  "timestamp": "2026-05-24T00:00:00Z",
  "sessionId": "session_abc",
  "turnId": "turn_def",
  "observedFields": {
    "score": 8.5,
    "scoreSource": "server_receipt_v2",
    "serverCalculated": true
  },
  "privacyClass": "abstract",
  "source": "codex_hook",
  "checksum": "sha256-of-canonical-abstract-payload",
  "signature": "v2.local-signature-placeholder"
}
```

Allowed reward-event fields intentionally exclude reward deltas and aggregate balances. New sync
clients send schema v2 receipts; Functions compute trusted score/rewards after validation and store
only the sanitized event.

## Rejected Private Fields

Rules reject practical top-level private field names on client-writeable documents:

- prompts and assistant replies
- code and source code
- terminal output and commands
- file paths, working directories, repo names, and repository names
- browser content, app content, transcripts, and raw transcripts
- tokens, API keys, and secrets

Rules cannot understand every possible nested semantic value, so Functions must repeat privacy validation before reducing an event. The local plugin should continue to send only abstract event summaries by default.

## Emulator Rule Smoke Cases

`npm run firebase:rules:smoke` starts Auth and Firestore emulators and runs `scripts/firebase_firestore_rules_smoke.js`. It covers:

- owner can write `/players/{uid}/profile/current`
- another signed-in user cannot write the owner profile
- owner cannot directly append an abstract reward event
- direct reward events with private fields are denied
- owner cannot directly write `/players/{uid}/gameState/current`

This command requires the Firebase CLI and Java runtime because the Firestore emulator is Java-based.
