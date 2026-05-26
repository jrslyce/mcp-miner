# MCP Miner

MCP Miner is a passive asteroid-mining game for Codex work.

## Codex Hook Trust

After installing the Codex plugin, users must restart Codex and trust the 6 MCP Miner hooks in the Hooks UI (`/hooks` in Codex, or Hooks from settings):

- `sessionStart`
- `userPromptSubmit`
- `postToolUse`
- `subagentStart`
- `subagentStop`
- `stop`

Without hook trust, MCP Miner status tools can still load, but passive mining stays at zero because Codex never runs the local Ruby hook commands. See [docs/codex-plugin-install.md](docs/codex-plugin-install.md) for the full install check.

## Account Linking

Local play works without an account. The web portal does not know a user's Codex or OpenAI account
automatically. To connect Codex to the web dashboard, MCP Miner uses a short-lived browser approval
code:

1. Run `start_account_link` from the MCP Miner Codex plugin.
2. Open the returned MCP Miner web URL while signed in with Google or email/password.
3. Approve the Codex device.
4. Run `complete_account_link` from Codex.
5. Run `sync_cloud` whenever queued abstract game events should sync.

The plugin stores a revocable MCP Miner device token locally in `~/.mcp-miner/auth.json`. It does
not ask for OpenAI credentials, OpenAI API keys, Firebase passwords, Firebase refresh tokens,
prompts, source code, command text, terminal output, file paths, repo names, browser content, or
raw transcripts. Cloud sync sends abstract gameplay state only: work-event type, score/category
metadata, sequence/checksum values, and aggregate game progress.

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
