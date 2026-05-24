# Cloud Functions Sync API

MCP Miner cloud sync uses callable Cloud Functions so Firebase Auth is the identity boundary. The API accepts only privacy-safe abstract event summaries from linked players and reduces accepted events into server-owned cloud state.

## Callable Functions

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

Validation:

- Firebase Auth is required; writes are stored under `/players/{uid}`.
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
- `/players/{uid}/syncMetadata/default` stores sequence/counter metadata.

### `getSyncState`

Returns the current server-owned `gameState/current` and `syncMetadata/default` documents for the authenticated UID.

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
