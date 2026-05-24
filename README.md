# MCP Miner

MCP Miner is a passive asteroid-mining game for Codex work.

## Firebase Local Scaffold

The V1 Firebase scaffold uses the demo project `demo-mcp-miner` and local emulators for Auth, Firestore, Functions, Hosting, and the Emulator UI.

```sh
npm install --prefix firebase/functions
npm run firebase:emulators:start
npm run firebase:emulators:smoke
npm run firebase:rules:smoke
npm run firebase:auth:smoke
npm run firebase:sync:smoke
```

See [docs/firebase-local.md](docs/firebase-local.md) for ports, privacy boundaries, App Check, Secret Manager, Cloud Logging, IAM, and Cloud Run notes. See [docs/firestore-schema.md](docs/firestore-schema.md) for owner-scoped Firestore collections and security rule boundaries, [docs/auth-linking.md](docs/auth-linking.md) for optional Firebase Auth linking, and [docs/cloud-sync-api.md](docs/cloud-sync-api.md) for Cloud Functions sync behavior.
