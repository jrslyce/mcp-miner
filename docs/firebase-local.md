# Firebase Local Development

MCP Miner V1 uses Firebase as the local-first cloud scaffold for optional account linking, abstract reward sync, dashboard, and store development. This configuration is intentionally emulator-first and points at the Firebase demo project `demo-mcp-miner` so local commands do not touch production resources.

## Local Commands

Install the Firebase CLI and a Java runtime before running Firestore locally:

```sh
npm install --prefix firebase/functions
npm run firebase:emulators:start
```

Run the local smoke test against Auth, Firestore, and Functions emulators:

```sh
npm install --prefix firebase/functions
npm run firebase:emulators:smoke
```

Run Firestore rule allow/deny smoke cases:

```sh
npm run firebase:rules:smoke
```

Run the repo-level static Firebase scaffold checks:

```sh
npm run test:firebase-config
npm run test:firestore-schema
```

The emulator UI runs at `http://127.0.0.1:4000`, Hosting at `http://127.0.0.1:5000`, Functions at `http://127.0.0.1:5001`, Firestore at `127.0.0.1:8080`, and Auth at `127.0.0.1:9099`.

## Services

- Firebase Auth: account linking and dashboard sessions.
- Cloud Firestore: privacy-safe game state, sync cursors, and abstract reward-event summaries.
- Cloud Functions for Firebase: signed sync API, validation, balance reducers, and store transactions.
- Firebase Hosting: static dashboard/store shell for the current scaffold. If the dashboard becomes a Next.js app, prefer Firebase App Hosting.

## Privacy And Secrets

No production secrets are committed. Local files such as `.env`, `.env.*`, `.runtimeconfig.json`, emulator exports, and Firebase debug logs are ignored. Production secrets should be referenced through Secret Manager and injected into Functions or App Hosting at deploy time.

The backend must only accept abstract reward events and game state. Prompts, source code, terminal output, file paths, repository names, browser content, app content, and raw transcripts remain out of cloud payloads by default.

## App Check, Logging, And IAM

App Check is planned for browser dashboard/store calls before production launch. Emulator development does not enforce App Check, but production Functions and web clients should require it where supported.

Cloud Logging should record request IDs, privacy class, event type, reducer status, and error codes. Logs must not include raw prompts, commands, paths, source code, or transcripts.

Production IAM should follow least-privilege boundaries:

- Functions service account can read/write only the Firestore collections it reduces.
- Dashboard hosting/app service can call public web APIs but does not receive admin Firestore credentials.
- CI deploy identities can deploy Firebase resources but do not receive runtime Secret Manager secret values.
- Human operators use read-only logging roles by default; emergency write roles should be time-bound.

## Functions Versus Cloud Run

Use Cloud Functions for Firebase for V1 sync endpoints, callable dashboard APIs, Firestore triggers, and compact reducer jobs. Functions match the event-driven Firebase surface and are easy to run in the Emulator Suite.

Use Cloud Run instead when a backend needs long-running processes, streaming, custom containers, non-Node runtimes, high-concurrency HTTP services, background workers with specialized binaries, or APIs that no longer fit Functions timeout and deployment constraints. Firebase App Hosting also runs app revisions on Cloud Run under the hood, which makes it the preferred path if the dashboard becomes a full Next.js app.
