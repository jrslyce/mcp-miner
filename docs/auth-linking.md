# Firebase Auth Account Linking

MCP Miner account linking is optional. Local play remains the default, and the plugin never asks for OpenAI credentials, OpenAI API keys, Firebase passwords, Firebase refresh tokens, or raw Firebase ID tokens.

## Recommended Model

The default production flow is a short-lived web link code plus a revocable per-device sync token.
This is more user-friendly than per-user API keys and safer than asking Codex for Firebase
credentials:

1. Codex calls `start_account_link`.
2. The backend creates a 10-minute link session and returns a code plus approval URL.
3. The user opens the URL while signed in at the MCP Miner web portal with Google or email/password.
4. The web portal calls `approveLinkSession` with Firebase Auth.
5. Codex calls `complete_account_link`.
6. The backend exchanges the approved session for a scoped device token.
7. The plugin stores the device token locally in `~/.mcp-miner/auth.json` with file mode `0600`.

The device token is API-key-like internally, but users do not need to manage or paste it during
normal setup. It is scoped to MCP Miner sync, can be revoked, and is stored server-side only as a
hash. A manually pasted device token may remain an advanced fallback, but it should not be the
primary UX.

The web portal does not know a user's Codex or OpenAI account automatically. It only knows the
Firebase account the user signed into on the portal, whether that account used Google sign-in or
email/password, and it only connects to Codex after the user approves a link session.

## States

| State | Meaning |
| --- | --- |
| `off` | Cloud sync is disabled; local progress continues normally. |
| `unauthenticated` | Cloud sync is enabled locally, but no Firebase Auth UID has been linked. |
| `link_pending` | Codex has created a short-lived link session; the user still needs to approve it in the web portal. |
| `linked` | A Firebase Auth UID is associated with the local miner profile. |
| `sync_error` | A future sync worker hit an error while a UID was linked. |

The local state stores only:

- Firebase Auth UID
- device ID
- provider name `firebase`
- link/update timestamps
- optional sync error text
- MCP Miner profile metadata already visible in local profile tools

The local auth file may store:

- pending link session ID
- pending link device secret
- revocable MCP Miner device token

The local auth file must never store OpenAI account credentials, OpenAI API keys, Firebase
passwords, Firebase refresh tokens, prompt text, source code, command text, terminal output, paths,
repo names, browser content, or transcripts.

## Dashboard Flow

`firebase/hosting/index.html` loads `auth.js`, which initializes Firebase Web SDK, connects to the Auth, Firestore, and Functions emulators on localhost, and supports:

- Google sign-in
- email/password sign-in
- email/password account creation
- sign-out
- create-or-load of `/players/{uid}`, `/players/{uid}/profile/current`, and `/players/{uid}/settings/current`
- dashboard reads from `/players/{uid}` owner-scoped game documents and the `getSyncState` callable

The dashboard writes only the owner-scoped profile/settings fields allowed by `firestore.rules`.

## Plugin Flow

MCP tools expose the local account-linking state:

- `start_account_link`
- `complete_account_link`
- `get_account_link_status`
- `get_sync_status`
- `sync_cloud`
- `get_backup_status`
- `create_cloud_backup`
- `restore_cloud_backup`
- `disconnect_account`
- `link_cloud_profile`
- `unlink_cloud_profile`

`update_settings` can enable cloud sync before sign-in; in that case `sync_progress` returns `unauthenticated` instead of failing. Starting a link session changes local status to `link_pending`. Completing an approved session changes local status to `linked`; the sync client can then call the Cloud Functions sync API with the stored device token. `sync_progress` also reports the current plan cadence and `next_eligible_sync_at`, and `sync_cloud` debounces locally until that time unless called with `force: true` for test/debug use.

Pro cloud backup uses the same linked device token. `create_cloud_backup` uploads only allowlisted abstract game sections, while `restore_cloud_backup` requires `confirm: true` and writes a local rollback file before applying restored state. Free users see the Pro-only backup benefit without losing local play.

`link_cloud_profile` remains a low-level test/development tool for linking a Firebase UID manually.
It is not the recommended production user flow.

## Data Boundary

Cloud sync sends abstract gameplay events only:

- work event type, such as `work_search` or `work_test_pass`
- score/category metadata used for rewards
- monotonically increasing event sequence
- checksums and signatures for dedupe/validation

Cloud sync does not send:

- prompts
- assistant replies
- source code
- command text
- terminal output
- file paths
- repository names
- browser content
- app content
- raw transcripts
- OpenAI account data

## Emulator Smoke

`npm run firebase:auth:smoke` starts Auth and Firestore emulators, creates an Auth emulator user, writes the linked player/profile/settings docs, and verifies an unauthenticated write is denied. It requires the Firebase CLI and Java runtime because Firestore runs on Java.
