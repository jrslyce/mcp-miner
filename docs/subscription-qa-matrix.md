# Subscription QA Matrix

This matrix is the launch gate for MCP Miner subscriptions and Pro sync, including Stripe, optional
crypto provider evaluation, entitlement projection, portal UX, plugin UX, sync cadence, device limits,
downgrade/cancellation states, payment failure, backups, exports, cosmetics, and privacy
boundaries. A release candidate cannot ship until every high-risk row marked `Launch blocker` has
current evidence in the PR, Linear issue, CI logs, Stripe test-mode dashboard, emulator output, or
production-smoke log named by the row.

## Evidence Rules

- Every executed row must record an evidence link or log reference in the release PR and the relevant Linear ticket.
- Evidence should include command output, Stripe event IDs, emulator log paths, screenshots, or production-smoke run IDs.
- Failed rows must create a Linear bug before another deploy attempt. The bug must link back to the failed matrix row.
- High-risk rows are launch blockers. Medium and low rows may ship only with an explicit release-owner exception.

## Test Accounts

Use separate accounts so plan state, devices, and cleanup remain obvious:

- `qa-free-1@mcp-miner.local`: Free baseline with one approved Codex device.
- `qa-free-2@mcp-miner.local`: cross-user and forged owner checks.
- `qa-pro-monthly@mcp-miner.local`: Stripe test-mode monthly subscriber.
- `qa-pro-annual@mcp-miner.local`: Stripe test-mode annual subscriber charged at 11 monthly periods.
- `qa-pro-downgrade@mcp-miner.local`: Pro account with five linked Codex devices before downgrade.
- `qa-past-due@mcp-miner.local`: payment failure and grace-period projection.
- `qa-canceled@mcp-miner.local`: cancellation through paid period and post-period fallback.
- `qa-crypto-sandbox@mcp-miner.local`: optional wallet provider only if crypto subscriptions are enabled.

Device names should follow `QA Free A`, `QA Pro 1` through `QA Pro 5`, and `QA Revoked`.

## Cleanup And Revocation

After each QA run:

- Cancel Stripe test-mode subscriptions and record the final invoice/subscription IDs.
- Delete or archive test Stripe customers only after webhook evidence is captured.
- Revoke all Codex device tokens from the portal and verify revoked tokens fail sync.
- Clear emulator data, or for production smoke delete QA Auth users and owner-scoped Firestore documents.
- Remove App Check debug tokens, local `~/.mcp-miner/auth.json` test tokens, and temporary screenshots containing account emails.
- File Linear bugs for unresolved failures before starting the next production-smoke iteration.

## Matrix

| ID | Phase | Risk | Scenario | Tickets | Required Evidence | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| QA-001 | Emulator | High | Entitlement projection evaluates Free, monthly Pro, annual Pro, trialing, past_due inside grace, canceled before period end, canceled after period end, and unpaid fallback. | MUX-192, MUX-194, MUX-198, MUX-207 | `npm run test:entitlements`; sampled `/players/{uid}/entitlements/current` emulator docs. | Launch blocker |
| QA-002 | Emulator | High | Stripe webhook reconciliation accepts valid events, rejects forged webhooks, ignores replayed event IDs, audits unknown Price IDs, and never grants Pro from Checkout redirect alone. | MUX-195, MUX-196, MUX-207 | `npm run test:stripe-webhooks`; webhook event IDs or unit log. | Launch blocker |
| QA-003 | Stripe test-mode | High | Monthly Checkout creates a test subscription, webhook writes Pro, Customer/Subscription metadata includes `firebaseUid`, `plan`, and `source`. | MUX-193, MUX-195, MUX-196, MUX-202, MUX-207 | Stripe test-mode Checkout Session, Subscription ID, webhook event ID, portal screenshot. | Launch blocker |
| QA-004 | Stripe test-mode | High | Annual Checkout charges exactly 11 monthly periods and grants the same entitlement features as monthly Pro. | MUX-193, MUX-195, MUX-196, MUX-202, MUX-207 | Stripe annual Price ID, invoice amount, `npm run validate:data`, entitlement projection log. | Launch blocker |
| QA-005 | Stripe test-mode | High | Annual renewal keeps Pro active and does not duplicate billing/customer records. | MUX-193, MUX-196, MUX-207 | Stripe test clock renewal event IDs, billing projection before/after. | Launch blocker |
| QA-006 | Stripe test-mode | High | Payment failure moves account to past_due, keeps Pro inside grace, and falls back to Free after grace expires. | MUX-196, MUX-198, MUX-207 | Failed invoice event, entitlement before/after grace, `npm run test:entitlements`. | Launch blocker |
| QA-007 | Stripe test-mode | High | Customer Portal cancellation keeps Pro until `currentPeriodEnd`, then downgrades to Free. | MUX-196, MUX-198, MUX-202, MUX-207 | Customer Portal screenshot, subscription deletion/update events, entitlement timestamps. | Launch blocker |
| QA-008 | Emulator | High | Free second-device rejection blocks a second Codex sync device without deleting the first device or local save. | MUX-194, MUX-199, MUX-200, MUX-207 | `npm run firebase:sync:smoke`; `plan_limit_device_count` log. | Launch blocker |
| QA-009 | Emulator | High | Pro supports five Codex instances with per-device cursors and rejects the sixth. | MUX-194, MUX-199, MUX-200, MUX-207 | `npm run firebase:sync:smoke`; device cursor docs for five devices. | Launch blocker |
| QA-010 | Emulator | High | Downgrade from Pro with five devices leaves all device metadata visible but allows only one active syncing device. | MUX-198, MUX-199, MUX-200, MUX-207 | `npm run firebase:sync:smoke`; downgrade device-limit evidence. | Launch blocker |
| QA-011 | Emulator | High | Sync cadence enforces one-minute Free batches and near-real-time Pro cadence with retry metadata instead of dropped local progress. | MUX-198, MUX-201, MUX-207 | `npm run test:sync-cadence-cost`; `npm run firebase:sync:smoke`. | Launch blocker |
| QA-012 | Emulator | High | Privacy boundary rejects private field injection in reward events, backups, exports, dashboard analytics, and weekly digest. | MUX-198, MUX-203, MUX-204, MUX-206, MUX-207 | `npm run firebase:sync:smoke`; `npm run firebase:backup:smoke`; `npm run test:dashboard-analytics`; `npm run test:weekly-digest`. | Launch blocker |
| QA-013 | Emulator | High | Firestore rules deny forged client writes to server-owned billing, entitlements, game state, cosmetics, devices, and cross-user documents. | MUX-194, MUX-196, MUX-205, MUX-207 | `npm run firebase:rules:smoke`; denied write cases. | Launch blocker |
| QA-014 | Emulator | High | Revoked device tokens, cross-user device IDs, and stale link sessions cannot sync, rename, revoke, or read another owner's metadata. | MUX-199, MUX-200, MUX-207 | `npm run firebase:sync:smoke`; revoked token and cross-user denial logs. | Launch blocker |
| QA-015 | Emulator | Medium | Cloud backup create/restore is Pro-only, requires explicit restore confirmation, preserves rollback metadata, and rejects private backup fields. | MUX-203, MUX-207 | `npm run firebase:backup:smoke`; `npm run test:cloud-backups`; `npm run test:cloud-backup-client`. | Release evidence |
| QA-016 | Emulator | Medium | Dashboard history export is Pro-only, Free export is unavailable, and exported rows contain only abstract event fields. | MUX-204, MUX-207 | `npm run test:dashboard-analytics`; dashboard export smoke or browser screenshot. | Release evidence |
| QA-017 | Browser | Medium | Portal subscription UX shows Free, monthly Pro, annual Pro, annual discount copy, Stripe buttons, Customer Portal entry, and plan-gated states on desktop and mobile. | MUX-193, MUX-195, MUX-202, MUX-207 | `npm run test:dashboard`; browser screenshots for desktop and mobile. | Release evidence |
| QA-018 | Browser | Medium | Portal linked-device UX can rename and revoke owner devices, shows Free/Pro device usage, and keeps token hashes/secrets hidden. | MUX-199, MUX-200, MUX-202, MUX-207 | Browser screenshots; `npm run firebase:dashboard:smoke`. | Release evidence |
| QA-019 | Browser | Medium | Weekly digest and beta preference UX renders mobile-safe, allows opt-out/in, and suppresses locked or disabled generated digest content. | MUX-206, MUX-207 | `npm run test:weekly-digest`; `npm run firebase:weekly-digest:smoke`; mobile screenshot. | Release evidence |
| QA-020 | Browser | Medium | Cosmetics are visual-only, Pro/beta cosmetics are entitlement-gated, earned cosmetics persist after downgrade, and inactive paid selections fall back to Free defaults. | MUX-205, MUX-207 | `npm run test:cosmetics-entitlements`; `npm run firebase:cosmetics:smoke`; portal screenshot. | Release evidence |
| QA-021 | Plugin UX | High | Plugin account-link flow starts link session, opens portal, approves device, stores token locally with restrictive permissions, syncs abstract events, and can disconnect/revoke. | MUX-192, MUX-199, MUX-200, MUX-207 | `npm run test:auth-linking`; `npm run test:cloud-sync-client`; local plugin transcript with no private content. | Launch blocker |
| QA-022 | Emulator | High | Rate-limit abuse and cadence bypass attempts return structured denials with retry metadata and do not write duplicate reward events. | MUX-198, MUX-201, MUX-207 | `npm run firebase:sync:smoke`; repeated cadence-denial log. | Launch blocker |
| QA-023 | Crypto sandbox | Medium | Optional wallet provider remains disabled for launch unless sandbox proves monthly, annual, failed renewal, cancellation, webhook idempotency, and no direct entitlement writes. | MUX-193, MUX-197, MUX-207 | `npm run test:crypto-evaluation`; provider sandbox IDs if enabled. | Release evidence |
| QA-024 | Production smoke | High | After deploy, live portal loads, Auth sign-in works, functions respond, App Check/logging posture is clean, Stripe production config is present, and no private data appears in logs. | MUX-202, MUX-208, MUX-209, MUX-210, MUX-207 | Production-smoke run ID, live URL screenshot, Cloud Logging query link, Linear bug links for failures. | Launch blocker |

## Dry-Run Commands

Run these before marking a release candidate ready for Stripe or production manual QA:

```sh
npm run check
npm run firebase:rules:smoke
npm run firebase:sync:smoke
npm run firebase:backup:smoke
npm run firebase:analytics:smoke
npm run firebase:cosmetics:smoke
npm run firebase:weekly-digest:smoke
npm run firebase:dashboard:smoke
npm run firebase:integration:smoke
```

Stripe test-mode rows require configured test secrets and test Price IDs. If those are unavailable,
the release PR must record the blocker and cannot mark QA-003 through QA-007 as passed.

## Required Negative Tests

- Forged client writes to billing, entitlements, server-owned game state, cosmetics, and device metadata.
- Forged webhooks with invalid Stripe signatures or unknown Price IDs.
- Revoked device tokens attempting sync, read, backup, or restore.
- Cross-user device IDs for rename, revoke, and sync calls.
- Private field injection in reward events, backups, exports, analytics, weekly digest, and logs.
- Rate-limit abuse against Free cadence, Pro cadence, duplicate event IDs, and replayed webhooks.
