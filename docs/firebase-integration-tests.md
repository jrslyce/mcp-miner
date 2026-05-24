# Firebase Emulator Integration Tests

`npm run firebase:integration:smoke` runs the local Firebase Emulator Suite against `scripts/firebase_integration_smoke.js`.

The integration smoke covers:

- Auth emulator sign-up for an owner and second user.
- Owner profile/settings creation in Firestore.
- signed-out profile write denial.
- cross-user profile read denial.
- unauthenticated `getSyncState` denial.
- valid Cloud Functions sync.
- duplicate sync idempotency.
- private-field sync rejection.
- dashboard state reads through `getSyncState` and Firestore REST.
- Firebase Hosting serving the dashboard panels.

The script uses the demo Firebase project `demo-mcp-miner` and does not require production Firebase credentials, service-account keys, or deployed Firebase resources.

Run it with:

```sh
npm install --prefix firebase/functions
npm run firebase:integration:smoke
```

The Firestore emulator requires a Java runtime. On machines without Java, use the static verification path instead:

```sh
npm run test:firebase-integration
npm run check
```
