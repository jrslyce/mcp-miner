# Firestore Schema And Privacy Boundaries

MCP Miner cloud sync stores owner-scoped, privacy-safe game data under `/players/{uid}`. Firebase Auth UID is the tenancy boundary. Cloud Functions reduce abstract reward events into aggregate game state with the Admin SDK; dashboard and plugin clients can read owner data, but they cannot directly write trusted aggregate balances such as inventory, Space Bucks, orders, upgrades, or base state.

## Collections

| Path | Owner | Client access | Purpose |
| --- | --- | --- | --- |
| `/players/{uid}` | `request.auth.uid == uid` | owner read/create/update | Account shell, schema version, display names, sync enabled flag. |
| `/players/{uid}/profile/current` | owner | owner read/create/update | Miner profile fields and avatar/customization references. |
| `/players/{uid}/settings/current` | owner | owner read/create/update | Report mode, sync preference, digest opt-out, beta-feature opt-in, dashboard display preference, App Check debug flag. |
| `/players/{uid}/syncMetadata/{clientId}` | owner | owner read/create/update | Aggregate sync metadata at `default` plus server-maintained per-device cursors for linked Codex devices. |
| `/players/{uid}/syncDevices/{deviceId}` | owner | owner read only | Server-owned public metadata for linked Codex devices; device token hashes stay outside owner-readable docs. |
| `/players/{uid}/billing/current` | owner | owner read only | Server-owned normalized billing projection from Stripe or the active billing provider. |
| `/players/{uid}/entitlements/current` | owner | owner read only | Server-owned entitlement projection used by Functions, portal UI, and the local plugin. |
| `/players/{uid}/rewardEvents/{eventId}` | owner | owner read only | Server-owned append-only abstract Codex work-event summaries written after Functions validate and reduce sync receipts. |
| `/players/{uid}/gameState/current` | owner | owner read only | Cloud-reduced materialized game state, including Space Bucks and schema versions. |
| `/players/{uid}/inventory/{bucket}` | owner | owner read only | Cloud-reduced inventory buckets for dashboard reads. |
| `/players/{uid}/upgrades/current` | owner | owner read only | Cloud-reduced upgrade levels and effects. |
| `/players/{uid}/orders/{orderId}` | owner | owner read only | Cloud-reduced active and completed order state. |
| `/players/{uid}/base/current` | owner | owner read only | Cloud-reduced base module and drone state. |
| `/players/{uid}/cosmetics/current` | owner | owner read only | Server-validated profile/portal cosmetic selections and retained cosmetic ownership. |
| `/linkSessions/{sessionId}` | server | none | Short-lived device-link approval sessions created by callable Functions. |
| `/linkCodes/{code}` | server | none | Atomic one-time code reservations that prevent active link-code collisions. |
| `/deviceTokens/{tokenHash}` | server | none | Hash-only revocable device token records used by callable Functions. |
| `/billingWebhookEvents/{eventId}` | server | none | Server-only billing event audit records with abstract provider status and renewal references; raw payloads stay outside owner-readable documents. |
| `/supportAuditLogs/{auditId}` | server | none | Server-only audit trail for support inspection, reconciliation, stale-marking, and device revocation actions. |

## Client-Write Boundaries

Clients may create profile/settings/sync metadata. Clients may not directly append reward events or write aggregate balances. In production, Cloud Functions are responsible for validating reward event signatures, dedupe keys, cooldowns, daily soft caps, and reducers before writing sanitized reward events and game state.

Link sessions, link-code reservations, device-token hashes, billing webhook events, and support audit logs are top-level server-owned collections. They are written only by Cloud Functions or Admin SDK support tooling and remain blocked from direct dashboard/plugin Firestore access by the default deny rule.

Billing and entitlement documents under `/players/{uid}` are owner-readable but server-owned. Stripe is the source of truth for paid subscription state; Firestore billing and entitlement documents are projections written by Cloud Functions with the Admin SDK. Clients may read the effective plan and feature limits, but clients cannot directly write `plan`, `billingStatus`, provider IDs, provider transaction/renewal fields, sync cadence, device limits, history retention, or feature flags.

Support tooling may inspect billing projection fields, Stripe customer/subscription IDs, linked-device metadata, and sync cursors through Admin SDK scripts. Every support action writes `/supportAuditLogs/{auditId}` with actor, target UID, action, result, reason, and abstract details. Support summaries intentionally exclude token hashes, device secrets, raw Stripe payloads, prompts, commands, code, paths, and transcript-like content.

Cosmetic selections under `/players/{uid}/cosmetics/current` are also server-owned. Portal clients request cosmetic changes through `applyCosmeticSelection`; Functions re-read the server entitlement and profile ownership before writing the applied selections. Editing client state cannot unlock Pro, retired, beta, or earned cosmetics.

If `/players/{uid}/entitlements/current` is missing, stale, unpaid, canceled beyond the paid period, or otherwise invalid, Functions must evaluate the effective entitlement as Free. `past_due` subscriptions can remain Pro only until the configured grace-period end; canceled subscriptions can remain Pro only through `currentPeriodEnd`.

Cloud Functions enforce the evaluated entitlement for device linking, device-token sync, and sync state reads. Free accounts are limited to one active Codex device and one accepted sync batch per 60 seconds. Pro accounts are limited to five active Codex devices and the paid near-real-time cadence. Downgrades do not delete existing `syncDevices`; only the earliest allowed active device remains usable until the account upgrades or extra devices are disconnected.

Cloud sync uses per-device cursors so multiple Pro Codex instances can alternate event batches without one account-wide sequence causing stale rejections. `/players/{uid}/syncMetadata/default` remains the aggregate and legacy Firebase Auth cursor. Linked device tokens write their own `/players/{uid}/syncMetadata/{deviceId}` document while reward event IDs stay globally idempotent across the account.

Normalized entitlement fields:

```json
{
  "ownerUid": "firebase-auth-uid",
  "schemaVersion": 1,
  "privacyClass": "abstract",
  "plan": "pro_monthly",
  "billingStatus": "active",
  "provider": "stripe",
  "providerCustomerId": "cus_...",
  "providerSubscriptionId": "sub_...",
  "providerTransactionId": "tx_or_invoice_reference",
  "providerRenewalState": "active",
  "currentPeriodEnd": "2026-06-24T00:00:00.000Z",
  "cancelAtPeriodEnd": false,
  "syncCadenceSeconds": 10,
  "maxDevices": 5,
  "historyRetentionDays": 365,
  "features": {
    "nearRealTimeSync": true,
    "deviceManagement": true,
    "backupRestore": true,
    "advancedDashboard": true,
    "premiumCosmetics": true,
    "weeklyDigest": true,
    "exports": true,
    "priorityBetaAccess": true
  },
  "updatedAt": "2026-05-24T00:00:00.000Z"
}
```

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
    "score": 8,
    "scoreHint": 8,
    "category": "implementation",
    "scoreSource": "server_receipt_v2",
    "serverCalculated": true
  },
  "privacyClass": "abstract",
  "source": "codex_hook",
  "checksum": "sha256-of-canonical-abstract-payload",
  "signature": "v2.local-signature-placeholder"
}
```

Allowed reward-event fields intentionally exclude reward deltas and aggregate balances. Clients submit abstract sync receipts through callable Functions; Functions compute trusted rewards after validation and store the sanitized event.

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
- Admin SDK can create billing and entitlement projections
- owner can read, but not write, `/players/{uid}/billing/current`
- owner can read, but not write, `/players/{uid}/entitlements/current`

This command requires the Firebase CLI and Java runtime because the Firestore emulator is Java-based.
