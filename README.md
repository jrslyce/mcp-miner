# MCP Miner

MCP Miner is a passive asteroid-mining game for Codex work. You work normally in Codex, and the plugin turns abstract work signals into mining progress, Chonks, materials, Space Bucks, orders, upgrades, and compact progress reports.

Website: [mcpminer.net](https://mcpminer.net/)

## How The Game Works

MCP Miner runs as a local Codex plugin. After installation and hook trust, Codex work events such as session starts, prompts, tool use, subagent activity, and turn stops feed a local Go runtime. The runtime scores those events as privacy-safe gameplay signals and advances your mining run in the background.

Your miner gathers Chonks and materials from asteroids, earns Space Bucks, discovers rare finds, and fills orders. Materials can be refined, orders can be fulfilled for rewards, and earned currency can be spent on upgrades, base modules, fabrication, cosmetics, and other progression systems.

The game is local-first. State is stored under `~/.mcp-miner`, and the plugin does not store prompts, source code, file paths, repo names, terminal output, browser content, transcripts, secrets, or raw Codex conversations. Optional account linking can sync abstract gameplay state to the web dashboard without sending private work content.

Use the MCP Miner tools in Codex to check status, inventory, active orders, asteroid claims, store catalog, upgrades, settings, latest reports, and the dashboard link. The website provides the public install flow, dashboard, account-linking surface, and cloud profile views.

## Install In Codex

There is not currently a public self-serve OpenAI plugin marketplace submission flow documented for Codex plugins, so the simplest user install path is a public GitHub repo plus the local marketplace file in this repository.

MCP Miner's Codex runtime is a compiled Go binary. Normal release installs do not require Go or Node on the user's machine. Source checkouts need Go only when rebuilding `plugins/mcp-miner/bin/mcp-miner`.

macOS/Linux:

```sh
git clone https://github.com/jrslyce/mcp-miner.git
cd mcp-miner
go run ./cmd/mcp-miner build-plugin
sh scripts/install_codex_plugin.sh
```

Windows PowerShell:

```powershell
git clone https://github.com/jrslyce/mcp-miner.git
cd mcp-miner
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1
```

The installer backs up `~/.codex/config.toml` or `%USERPROFILE%\.codex\config.toml`, rebuilds the Go plugin binary from source if needed, registers this repo as the `mcp-miner` marketplace, removes stale standalone MCP Miner server config and older pre-rename plugin entries, and enables `mcp-miner@mcp-miner`. Restart Codex after running it.

After restart, ask Codex:

```text
Show my MCP Miner status
```

## Codex Hook Trust

After installing the Codex plugin, users must restart Codex and trust the 6 MCP Miner hooks in the Hooks UI (`/hooks` in Codex, or Hooks from settings):

- `sessionStart`
- `userPromptSubmit`
- `postToolUse`
- `subagentStart`
- `subagentStop`
- `stop`

Without hook trust, MCP Miner status tools can still load, but passive mining stays at zero because Codex never runs the local Go hook commands. See [docs/codex-plugin-install.md](docs/codex-plugin-install.md) for the full install check.

## Updating MCP Miner

The status tool checks the configured Git remote for a newer MCP Miner checkout. When an update is available, the status report ends with a red update alert and asks whether to update.

If the player answers yes, the `update_plugin` tool pulls the remote default branch, rebuilds the local MCP binary, refreshes the Codex plugin install, and reports that Codex or any other agent IDE should be restarted. The updater refuses to run when the checkout has local changes or when the current branch is not the configured update branch.

Manual update from a source checkout:

```sh
git pull --ff-only
go run ./cmd/mcp-miner build-plugin
sh scripts/install_codex_plugin.sh
```

Windows PowerShell:

```powershell
git pull --ff-only
go run ./cmd/mcp-miner build-plugin
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1
```

For other agent IDEs that launch the MCP server from this checkout, restart the IDE after rebuilding so it reloads the updated binary.

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
