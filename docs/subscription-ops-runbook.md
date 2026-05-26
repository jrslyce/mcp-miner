# Subscription Ops Runbook

This runbook keeps the MCP Miner Pro launch observable, rate-limited, and cost-bounded.

## Operator Questions

Operators must be able to answer these from Firestore projections and Cloud Logging without reading
private work content:

- Who is Pro: `/players/{uid}/entitlements/current.entitlementStatus`.
- Which provider says so: `/players/{uid}/billing/current.provider`, `providerCustomerId`, and `providerSubscriptionId`.
- When access changed: `billing/current.updatedAt`, `entitlements/current.updatedAt`, and `mcp_miner_entitlement_projection_changed`.
- Why sync or device operations were rejected: `mcp_miner_entitlement_operation_rejected`, `mcp_miner_rate_limit_rejected`, and structured `reason` fields such as `plan_limit_device_count`, `plan_limit_sync_cadence`, and `rate_limit_exceeded`.

## Structured Logs

Cloud Logging entries must stay abstract and must not include prompts, code, commands, paths,
repository names, browser/app content, transcripts, emails, or raw Stripe payloads.

| Log name | Purpose | Key fields |
| --- | --- | --- |
| `mcp_miner_stripe_checkout_start` | Checkout attempt started. | `uidPresent`, `plan` |
| `mcp_miner_stripe_checkout_session` | Checkout or portal destination returned. | `uidPresent`, `destination`, `plan` |
| `mcp_miner_stripe_customer_portal_start` | Customer Portal attempt started. | `uidPresent` |
| `mcp_miner_billing_error` | Billing callable failed closed. | `operation`, `uidPresent`, `code`, `plan` |
| `mcp_miner_stripe_webhook_processed` | Stripe webhook accepted and mapped. | `eventId`, `eventType`, `action`, `duplicate` |
| `mcp_miner_stripe_webhook_rejected` | Stripe webhook failed signature/config/mapping. | `privacyClass`, `message` |
| `mcp_miner_entitlement_projection_changed` | Server-owned entitlement changed from Stripe state. | `provider`, `uidPresent`, `plan`, `billingStatus`, `entitlementStatus`, `accessReason`, `currentPeriodEnd` |
| `mcp_miner_sync_reward_events` | Sync batch processed. | `authType`, `requestedCount`, `acceptedCount`, `duplicateCount`, `rejectedCount`, `cursorId` |
| `mcp_miner_sync_reward_events_rejected` | Sync payload, cadence, or device operation rejected. | `authType`, `requestedCount`, `code`, `reason` |
| `mcp_miner_entitlement_operation_rejected` | Plan/device/cadence/export/backup gate denied an operation. | `operation`, `authType`, `reason`, `plan`, `billingStatus`, `entitlementStatus` |
| `mcp_miner_rate_limit_rejected` | Fixed-window abuse control denied a request. | `operation`, `subjectType`, `limit`, `windowSeconds`, `retryAfterSeconds` |
| `mcp_miner_dashboard_history_exported` | Pro history export generated. | `authType`, `format`, `rowCount` |
| `mcp_miner_cloud_backup_created` | Pro backup stored. | `authType`, `byteSize` |
| `mcp_miner_cloud_backup_restore_requested` | Pro restore payload requested. | `authType`, `freshness`, `deviceRelation` |
| `mcp_miner_link_session_created` | Device link session created. | `sessionId`, `expiresAt` |
| `mcp_miner_link_session_approved` | Device link approved by signed-in owner. | `uidPresent`, `sessionId` |
| `mcp_miner_link_session_exchanged` | Device token minted and shown once. | `uidPresent`, `deviceId` |
| `mcp_miner_sync_device_revoked` | Owner revoked a linked device. | `uidPresent`, `deviceId`, `tokenCount` |

## Abuse Controls

Server-side fixed-window rate limits are intentionally above normal idle-game usage:

| Operation | Limit | Window | Normal expectation |
| --- | ---: | --- | --- |
| `syncRewardEvents` | 120 | 60 seconds | Free accepts one batch per 60 seconds; Pro accepts one batch per 10 seconds. This abuse limit catches invalid/spam attempts before cost spikes. |
| `exportDashboardHistory` | 12 | 1 hour | Humans export occasionally; UI buttons are disabled while preparing an export. |
| `createCloudBackup` | 12 | 1 hour | Local clients should back up on demand or major milestones, not continuously. |
| `restoreCloudBackup` | 12 | 1 hour | Restore requires explicit confirmation and should be rare. |
| `createCheckoutSession` | 8 | 1 hour | A user should create at most a few Checkout sessions during plan selection. |
| `createCustomerPortalSession` | 12 | 1 hour | A user may reopen Customer Portal but should not loop it. |
| `createLinkSession` | 20 | 1 hour | Link-code creation is unauthenticated and keyed by hashed IP. |
| `approveLinkSession` | 30 | 1 hour | Owner approval is signed-in and keyed by hashed UID. |
| `exchangeLinkSession` | 30 | 1 hour | Exchange attempts are keyed by hashed session ID. |

Rate-limit state is stored in `operationalRateLimits/{operation_subjectHash}` with hashed subjects
only. Raw IPs, emails, tokens, prompts, code, paths, and payloads are not stored.

## Support Tooling

Use `scripts/subscription_support_admin.js` for subscription support tasks. The script requires
Firebase Admin credentials plus `MCP_MINER_SUPPORT_ACTOR` in the form `support:name`,
`admin:name`, or `release:name`; browser/dashboard users cannot call it.

Supported commands:

- `inspect --uid UID`: exports a support-safe account summary with billing projection, Stripe customer/subscription IDs, evaluated entitlement, linked-device metadata, and sync cursors.
- `reconcile-stripe --uid UID`: refreshes billing and entitlement from provider-backed Stripe subscription evidence. Unknown Price IDs, missing customers, and UID/customer mismatches do not grant Pro.
- `refresh-entitlement --uid UID`: rebuilds the entitlement projection from the existing billing projection. Stale billing remains Free.
- `mark-billing-stale --uid UID --reason REASON`: forces the projection stale so the account evaluates as Free until provider-backed reconciliation succeeds.
- `revoke-device --uid UID --device-id DEVICE_ID`: revokes a linked device and any matching server-side token records without exposing token hashes.

Every command writes `/supportAuditLogs/{auditId}` with `actor`, `targetUid`, `action`, `result`,
`reason`, and abstract details. Support summaries and audit details must not include token hashes,
device secrets, raw Stripe payloads, prompts, code, commands, paths, or transcripts.

## Budget And Alert Setup

Configure before production launch:

- GCP budget alert on the Firebase billing account with thresholds at 50%, 80%, 100%, and 125% of the monthly launch budget.
- Cloud Monitoring alert for `mcp_miner_rate_limit_rejected` count above baseline for 15 minutes.
- Cloud Monitoring alert for `mcp_miner_billing_error` or `mcp_miner_stripe_webhook_rejected` count greater than zero for 10 minutes.
- Cloud Monitoring alert for Functions error rate above 2% over 10 minutes.
- Stripe Dashboard alerting for failed webhook deliveries, abnormal Checkout Session volume, abnormal payment failure volume, and disabled webhook endpoint status.
- Weekly review of Firestore reads/writes, Functions invocations, Auth sign-ins, Hosting egress, and Stripe webhook failures during the first month.

Record screenshots or alert-policy links against QA-024 in the release PR.

## Usage And Cost Assumptions

Launch sizing assumptions:

- Free users: one Codex device, one accepted cloud sync batch per 60 seconds, no exports, no backups.
- Pro users: up to five Codex devices, accepted cloud sync every 10 seconds per active device, 365-day history, exports, backup/restore, cosmetics, weekly digest, and near-real-time dashboard refresh.
- Dashboard polling should respect `syncCadenceSeconds`: Free one-minute refresh, Pro near-real-time refresh.
- Expected launch mix for smoke cost modeling: 100 Free users and 25 Pro users active in a day, plus burst tests from `sync_cadence_cost_smoke.js`.
- Any sustained traffic above 2x the modeled daily reads/writes or checkout attempts should trigger a budget/abuse review before increasing limits.

## Deploy Order

1. Confirm `npm run check` and all required `docs/subscription-qa-matrix.md` launch-blocker rows are green.
2. Configure Firebase project, Auth providers, App Check, Firestore indexes/rules, Functions secrets, and Hosting target.
3. Configure Stripe test-mode webhook endpoint and verify QA-003 through QA-007 in test mode.
4. Configure Stripe live Price IDs, live webhook endpoint, and `STRIPE_WEBHOOK_SECRET`.
5. Deploy Firestore rules and indexes.
6. Deploy Functions.
7. Deploy Hosting.
8. Run production-smoke QA-024 and create Linear bugs for any failures before repeating deploy/test.

## Rollback

- Hosting rollback: use Firebase Hosting release rollback to the previous known-good release.
- Functions rollback: redeploy the previous commit or pin the previous Functions source revision.
- Firestore rules rollback: deploy the previous `firestore.rules` from the last known-good commit.
- Stripe rollback: disable the live webhook endpoint or pause Checkout entry points from the portal if billing writes are unsafe.
- Entitlement rollback: do not edit client state. Fix the server-owned billing projection or webhook handler, then let `entitlements/current` be rebuilt from provider state.

## Incident Response

1. Pause new Checkout starts if billing or entitlement projection is suspect.
2. Preserve Cloud Logging, Stripe event IDs, and Linear/PR evidence links.
3. Create a Linear bug with the affected matrix row, first observed time, impact, and rollback decision.
4. If private data appears in logs or Firestore, treat it as a privacy incident: stop sync, revoke affected device tokens, preserve evidence, and rotate any exposed secrets.
5. Communicate customer-facing impact using plan-safe language: local play continues even if cloud sync/billing is paused.

## Support Contacts

- Release owner: Jared.
- Billing owner: Stripe dashboard administrator.
- Firebase/GCP owner: project billing administrator.
- Support inbox: configured product support email before launch.
- Escalation record: Linear project `MCP Miner Subscriptions & Pro Sync`.

## Test-Mode To Production Checklist

- Test Price IDs and live Price IDs match monthly/annual plan math from `data/subscription_plans.yaml`.
- Stripe live webhook signs the same event set as test mode.
- `MCP_MINER_DASHBOARD_URL` points at the production Hosting URL.
- App Check enforcement and debug-token policy are reviewed.
- QA accounts are created, then cleaned up after production smoke.
- Budget and webhook alert screenshots are linked in QA-024.
- Any bug found during production smoke is filed in Linear before redeploying.
