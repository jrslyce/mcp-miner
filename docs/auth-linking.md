# Firebase Auth Account Linking

MCP Miner account linking is optional. Local play remains the default, and the plugin never asks for OpenAI credentials, OpenAI API keys, Firebase refresh tokens, or Firebase ID tokens.

## States

| State | Meaning |
| --- | --- |
| `off` | Cloud sync is disabled; local progress continues normally. |
| `unauthenticated` | Cloud sync is enabled locally, but no Firebase Auth UID has been linked. |
| `linked` | A Firebase Auth UID is associated with the local miner profile. |
| `sync_error` | A future sync worker hit an error while a UID was linked. |

The local state stores only:

- Firebase Auth UID
- provider name `firebase`
- link/update timestamps
- optional sync error text
- MCP Miner profile metadata already visible in local profile tools

## Dashboard Flow

`firebase/hosting/index.html` loads `auth.js`, which initializes Firebase Web SDK, connects to the Auth and Firestore emulators on localhost, and supports:

- email/password sign-in
- email/password account creation
- sign-out
- create-or-load of `/players/{uid}`, `/players/{uid}/profile/current`, and `/players/{uid}/settings/current`

The dashboard writes only the owner-scoped profile/settings fields allowed by `firestore.rules`.

## Plugin Flow

MCP tools expose the local account-linking state:

- `get_account_link_status`
- `link_cloud_profile`
- `unlink_cloud_profile`

`update_settings` can enable cloud sync before sign-in; in that case `sync_progress` returns `unauthenticated` instead of failing. Linking a UID changes `sync_progress` to `linked_sync_pending` until the sync API/reducer work is available.

## Emulator Smoke

`npm run firebase:auth:smoke` starts Auth and Firestore emulators, creates an Auth emulator user, writes the linked player/profile/settings docs, and verifies an unauthenticated write is denied. It requires the Firebase CLI and Java runtime because Firestore runs on Java.
