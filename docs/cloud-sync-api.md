# Cloud Functions Sync API

MCP Miner cloud sync uses callable Cloud Functions. Firebase Auth is the web identity boundary, and a browser-approved per-device sync token is the Codex plugin identity boundary. The API accepts only privacy-safe abstract event summaries from linked players and reduces accepted events into server-owned cloud state.

## Callable Functions

### `createLinkSession`

Called by the local Codex plugin without Firebase Auth. It creates a 10-minute pending link session
and returns:

- `session.sessionId`
- `session.code`
- `linkUrl`
- `deviceSecret`

The plugin stores `deviceSecret` locally until the session is approved or expires. The server stores
only a hash of the secret.

### `approveLinkSession`

Called by the signed-in web portal with Firebase Auth. It binds the pending session to
`request.auth.uid`. The portal copy must state that approving a device syncs only abstract game
state, not Codex/OpenAI account data or private work content.

### `exchangeLinkSession`

Called by the local Codex plugin after approval. It validates the session ID and device secret, then
returns a one-time-visible device sync token. The backend stores only a token hash. The plugin stores
the token in the local auth file and uses it for future sync calls.

### `revokeDeviceToken`

Called by a linked plugin device with its current device token. It revokes that local device without
deleting the player's web account or local save.

### `syncRewardEvents`

Input:

```json
{
  "events": [
    {
      "eventId": "evt_sync_1",
      "eventType": "work_apply_patch",
      "schemaVersion": 1,
      "sequence": 1,
      "timestamp": "2026-05-24T00:00:00Z",
      "turnId": "turn_sync",
      "observedFields": {
        "changedLines": 12,
        "filesTouchedCount": 2,
        "score": 8.5
      },
      "privacyClass": "abstract",
      "source": "codex_hook",
      "signature": "v1.local-placeholder",
      "checksum": "sha256-of-canonical-abstract-payload"
    }
  ]
}
```

Authentication:

- Firebase Auth ID token from the web app or emulator in the standard `Authorization` header; or
- MCP Miner device token from an approved Codex link session in `x-mcp-miner-device-token`.

Validation:

- An authenticated Firebase UID is required, either directly from Firebase Auth or indirectly from a linked device token.
- Device-token sync resolves the token hash to a Firebase Auth UID; writes are still stored under `/players/{uid}`.
- Functions evaluate `/players/{uid}/entitlements/current` on every sync. Missing, stale, unpaid, or invalid entitlement projections fall back to Free.
- Free accounts can have one active linked Codex device; Pro accounts can have five. Extra device tokens are rejected without deleting local saves or server device metadata.
- Free accepts at most one new cloud batch per 60 seconds. Pro uses the paid `syncCadenceSeconds` limit for near-real-time sync within cost controls.
- Sequence and cadence are checked against the caller's sync cursor: `/players/{uid}/syncMetadata/default` for Firebase Auth and `/players/{uid}/syncMetadata/{deviceId}` for linked Codex device tokens.
- Plan-limit denials use structured reasons such as `plan_limit_device_count` and `plan_limit_sync_cadence`.
- `schemaVersion` must match the current sync schema.
- `privacyClass` must be `abstract`.
- `source` must be `codex_hook`.
- `sequence` must be monotonic for new event IDs.
- `eventId` dedupes repeated submissions.
- `checksum` must match the canonical abstract payload.
- `signature` must use the V1 placeholder format until plugin signing is finalized.
- private field names such as prompts, code, terminal output, commands, paths, repo names, browser/app content, and transcripts are rejected recursively.

Reducer writes:

- `/players/{uid}/rewardEvents/{eventId}` stores the sanitized event.
- `/players/{uid}/gameState/current` stores aggregate abstract state such as event counts, score totals, work-event counters, last event ID, and last sequence.
- `/players/{uid}/syncMetadata/default` stores aggregate sequence/counter metadata for the account and the legacy Firebase Auth cursor.
- `/players/{uid}/syncMetadata/{deviceId}` stores the per-device cursor for linked Codex instances. Reward event IDs remain globally idempotent under `/players/{uid}/rewardEvents/{eventId}`.

### `getSyncState`

Returns the current server-owned `gameState/current`, aggregate `syncMetadata/default`, the caller's `deviceSyncMetadata`, and the evaluated entitlement for the authenticated UID.

## Logging

Cloud Logging entries include operational metadata only: privacy class, UID presence, requested event count, accepted count, duplicate count, rejected count, and error code. Logs do not include prompt text, source code, terminal output, commands, paths, repo names, browser/app content, or transcripts.

## Emulator Smoke

`npm run firebase:sync:smoke` starts Auth, Firestore, and Functions emulators and covers authenticated sync, duplicate idempotency, invalid private fields, and state reduction. It requires the Firebase CLI and Java runtime because Firestore is Java-based.

## Plugin Client

The local plugin exposes `sync_cloud`, which converts local journal reward entries into the canonical abstract event format and posts them to `syncRewardEvents`.

Local metadata records:

- `last_pushed_sequence`
- `pending_event_ids`
- `duplicate_event_ids`
- `rejected_events`
- retry count and next retry timestamp
- last sync error
- configured Functions origin

If sync is disabled, unauthenticated, offline, or missing a Firebase ID token, local events stay queued and gameplay progress remains local. Duplicate responses are treated as success because cloud event IDs are idempotent. Rejected stale/private events set local conflict metadata and leave local rewards untouched.
