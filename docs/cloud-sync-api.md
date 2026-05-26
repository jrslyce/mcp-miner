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
      "schemaVersion": 2,
      "receiptType": "abstract_work",
      "sequence": 1,
      "timestamp": "2026-05-24T00:00:00Z",
      "turnId": "turn_sync",
      "observedFields": {
        "scoreHint": 8.5,
        "category": "coding",
        "rewardControlReasons": []
      },
      "privacyClass": "abstract",
      "source": "codex_hook",
      "signature": "v2.local-placeholder",
      "checksum": "sha256-of-canonical-abstract-payload"
    }
  ]
}
```

Schema v2 entries are receipts, not final reward events. The server calculates the stored
`observedFields.score` from the receipt's allowed abstract fields and caps score hints by event
type. Legacy schema v1 events are accepted during rollout, but new plugin clients should send
schema v2 receipts.

Authentication:

- Firebase Auth ID token from the web app or emulator in the standard `Authorization` header; or
- MCP Miner device token from an approved Codex link session in `x-mcp-miner-device-token`.

Validation:

- An authenticated Firebase UID is required, either directly from Firebase Auth or indirectly from a linked device token.
- Device-token sync resolves the token hash to a Firebase Auth UID; writes are still stored under `/players/{uid}`.
- `schemaVersion` must be either the legacy event schema or the current receipt schema.
- schema v2 receipts must use `receiptType: "abstract_work"` and must not include final client
  `observedFields.score` values.
- `privacyClass` must be `abstract`.
- `source` must be `codex_hook`.
- `sequence` must be monotonic for new event IDs.
- `eventId` dedupes repeated submissions.
- `checksum` must match the canonical abstract payload.
- `signature` must use the V2 receipt placeholder format until plugin signing is finalized.
- private field names such as prompts, code, terminal output, commands, paths, repo names,
  browser/app content, transcripts, tokens, API keys, and secrets are rejected recursively.

Reducer writes:

- `/players/{uid}/rewardEvents/{eventId}` stores the sanitized event.
- `/players/{uid}/gameState/current` stores aggregate abstract state such as event counts, score totals, work-event counters, last event ID, and last sequence.
- `/players/{uid}/syncMetadata/default` stores sequence/counter metadata.
- `/players/{uid}/entitlements/current` optionally stores normalized plan limits. Missing
  entitlement docs resolve to Free defaults.

Sync cadence:

- Free defaults to one accepted batch per 60 seconds.
- Pro defaults to a shorter accepted-batch cadence.
- The cadence changes portal freshness, not reward math. Free and Pro receipts use the same
  server-side score calculation.
- Throttled calls return `status: "throttled"` plus `throttle.nextEligibleSyncAt`; the local plugin
  keeps events queued and retries later.

### `getSyncState`

Returns the current server-owned `gameState/current`, `syncMetadata/default`, and public entitlement
summary for the authenticated UID.

## Payload Inspection

The local plugin exposes `preview_sync_payload`, which builds the next `syncRewardEvents` request
without sending it. It shows the exact abstract JSON request body that would be posted and redacts
Firebase ID tokens or device sync tokens in headers.

The web portal reads the owner-scoped `/players/{uid}/rewardEvents` collection and shows recent
stored receipt payloads. This portal view is a sanitized audit view of abstract sync data; it does
not fetch or render auth headers, Codex/OpenAI account data, prompts, code, terminal output,
commands, paths, repo names, browser/app content, transcripts, tokens, API keys, or secrets.

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
