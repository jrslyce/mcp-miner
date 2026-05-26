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
| `/players/{uid}/rewardEvents/{eventId}` | owner | owner read/create only | Append-only abstract Codex work-event summaries for Functions to validate and reduce. |
| `/players/{uid}/gameState/current` | owner | owner read only | Cloud-reduced materialized game state, including Space Bucks and schema versions. |
| `/players/{uid}/inventory/{bucket}` | owner | owner read only | Cloud-reduced inventory buckets for dashboard reads. |
| `/players/{uid}/upgrades/current` | owner | owner read only | Cloud-reduced upgrade levels and effects. |
| `/players/{uid}/orders/{orderId}` | owner | owner read only | Cloud-reduced active and completed order state. |
| `/players/{uid}/base/current` | owner | owner read only | Cloud-reduced base module and drone state. |

## Client-Write Boundaries

Clients may create profile/settings/sync metadata and append abstract reward events. Clients may not write aggregate balances. In production, Cloud Functions are responsible for validating reward event signatures, dedupe keys, cooldowns, daily soft caps, and reducers before writing game state.

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

Reward events are append-only and use deterministic event IDs from the local journal:

```json
{
  "ownerUid": "firebase-auth-uid",
  "eventId": "evt_abc123",
  "eventType": "work_apply_patch",
  "schemaVersion": 1,
  "sequence": 42,
  "timestamp": "2026-05-24T00:00:00Z",
  "sessionId": "session_abc",
  "turnId": "turn_def",
  "observedFields": {
    "changedLines": 42,
    "filesTouchedCount": 2
  },
  "privacyClass": "abstract",
  "source": "codex_hook",
  "checksum": "sha256-of-canonical-abstract-payload",
  "signature": "v1.local-signature-placeholder"
}
```

Allowed reward-event fields intentionally exclude reward deltas and aggregate balances. Functions compute trusted rewards after validation.

## Rejected Private Fields

Rules reject practical top-level private field names on client-writeable documents and inside reward-event `observedFields`:

- prompts and assistant replies
- code and source code
- terminal output and commands
- file paths, working directories, repo names, and repository names
- browser content, app content, transcripts, and raw transcripts

Rules cannot understand every possible nested semantic value, so Functions must repeat privacy validation before reducing an event. The local plugin should continue to send only abstract event summaries by default.

## Emulator Rule Smoke Cases

`npm run firebase:rules:smoke` starts Auth and Firestore emulators and runs `scripts/firebase_firestore_rules_smoke.js`. It covers:

- owner can write `/players/{uid}/profile/current`
- another signed-in user cannot write the owner profile
- owner can append an abstract reward event
- reward events with private fields are denied
- owner cannot directly write `/players/{uid}/gameState/current`

This command requires the Firebase CLI and Java runtime because the Firestore emulator is Java-based.
