# Codex Plugin Install

MCP Miner is packaged as the local Codex desktop plugin at `plugins/mcp-miner`.

## Quick Install

Clone the repo, then run one installer from the repository root.

Release bundles include the compiled Go runtime in `plugins/mcp-miner/bin`, so end users do not need Go installed. A source checkout needs Go only when the installer has to rebuild that binary.

Windows PowerShell:

```powershell
git clone https://github.com/jrslyce/mcp-miner.git
cd mcp-miner
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1
```

macOS/Linux:

```sh
git clone https://github.com/jrslyce/mcp-miner.git
cd mcp-miner
go run ./cmd/mcp-miner build-plugin
sh scripts/install_codex_plugin.sh
```

Both installers register the same local Codex plugin. The Windows installer rebuilds the plugin binary with `go build` if it is missing. The Codex plugin runs the compiled Go binary for local hooks and MCP tools.

The installer updates `~/.codex/config.toml` with:

```toml
[marketplaces.mcp-miner]
source_type = "local"
source = "/absolute/path/to/mcp-miner"

[plugins."mcp-miner@mcp-miner"]
enabled = true
```

It also removes old standalone MCP server entries and older pre-rename plugin entries, then creates a timestamped backup before changing an existing config. To preview the config change, run:

```sh
sh scripts/install_codex_plugin.sh --dry-run
```

On Windows, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1 -DryRun
```

To remove the Codex entries later, run:

```sh
sh scripts/install_codex_plugin.sh --uninstall
```

On Windows, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1 -Uninstall
```

The repository includes `.agents/plugins/marketplace.json`, which points Codex at `./plugins/mcp-miner`.

## Update Flow

MCP Miner status checks the configured Git remote for a newer plugin checkout. If an update is available, the status report includes a red update alert and asks whether to update.

After an explicit yes, the `update_plugin` tool pulls the remote default branch, rebuilds `plugins/mcp-miner/bin/mcp-miner`, refreshes the Codex plugin entry, and tells the user to restart Codex. The updater pauses instead of changing files when the checkout has local changes or is not on the configured update branch.

Manual update from the repository root:

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

Other agent IDEs that point at this checkout should be restarted after rebuilding the binary.

## If You Only See The MCP Server

If Codex shows an MCP server but does not show the MCP Miner plugin, the config probably has only a standalone MCP server entry such as `[mcp_servers."mcp-miner"]`. That starts tools, but it is not the Codex plugin and it will not install the plugin manifest or hook trust flow.

Run the installer again from the repo root. It removes the stale standalone MCP Miner server entry and writes the plugin entry:

```toml
[plugins."mcp-miner@mcp-miner"]
enabled = true
```

After that, restart Codex. If the plugin still does not appear, open `~/.codex/config.toml` on macOS/Linux or `%USERPROFILE%\.codex\config.toml` on Windows and confirm both `[marketplaces.mcp-miner]` and `[plugins."mcp-miner@mcp-miner"]` are present.

## Local Install Smoke

From the repository root:

```sh
npm run validate:plugin
npm run test:plugin-install
npm run test:codex-installer
```

`test:plugin-install` verifies the plugin the same way Codex desktop should use it:

- `plugins/mcp-miner/.codex-plugin/plugin.json` keeps the validated manifest shape.
- `plugins/mcp-miner/.mcp.json` launches `./bin/mcp-miner mcp` with `cwd` set to the plugin root.
- `plugins/mcp-miner/.codex-plugin/plugin.json` points Codex at `./hooks/hooks.json`.
- On Windows, `plugins/mcp-miner/hooks/hooks.json` commands run through `cmd /d /c call "%PLUGIN_ROOT%\bin\mcp-miner.exe" hook ...` so `%PLUGIN_ROOT%` expands even when Codex spawns the hook without an extra shell.
- On Unix-like systems, the equivalent command target is `"$PLUGIN_ROOT/bin/mcp-miner" hook ...`.
- `plugins/mcp-miner/skills/mcp-miner/SKILL.md` documents the live MCP tool list and privacy behavior.
- `scripts/install_codex_plugin.sh` and `scripts/install_codex_plugin.ps1` safely register the local marketplace and plugin entry in a Codex config without Ruby install helpers.

## Local State

By default the plugin writes local game state to:

```text
~/.mcp-miner/state.json
```

The journal lives beside it:

```text
~/.mcp-miner/journal.jsonl
```

Both files are local-only. The journal stores privacy-safe abstract work events, not prompts, source code, file paths, repo names, terminal output, browser content, or transcripts.

For test runs, set `MCP_MINER_STATE_PATH` to a temporary file. The journal will default to `journal.jsonl` next to that file unless `MCP_MINER_JOURNAL_PATH` is set.

## Trust Hooks After Install

After adding the plugin entry and restarting Codex, open the Hooks UI (`/hooks` in Codex, or Hooks from settings) and trust the MCP Miner hooks.

Codex should show 6 MCP Miner hooks to review:

- `sessionStart`
- `userPromptSubmit`
- `postToolUse`
- `subagentStart`
- `subagentStop`
- `stop`

Trust all 6. Codex requires this because hooks run local Go commands. If they are not trusted, MCP Miner status tools can still load, but passive mining stays at zero because Codex never runs the prompt, tool, subagent, or stop hooks.

To verify the install, start a fresh Codex turn, do a small tool action, then ask:

```text
Show my MCP Miner status
```

`turns_seen`, `tool_events_seen`, and Chonks should start increasing after the trusted hooks run.

## Reset And Backup Notes

To reset local progress, quit active Codex sessions using the plugin, then move the state directory aside:

```sh
mv ~/.mcp-miner ~/.mcp-miner.backup-$(date +%Y%m%d%H%M%S)
```

The next hook or MCP call creates a fresh state file. Keep the backup until you know the reset was intentional.

MCP Miner also writes automatic backups in recovery cases:

- Schema migrations copy `state.json` to a `state.json.backup-*` file before rewriting it.
- Corrupt state or journal files are moved to `*.corrupt-*` files before recovery continues.

## Manual Codex Desktop Check

After enabling the local plugin in Codex desktop, restart Codex and complete the hook trust step above. If hooks are not trusted, the MCP tools still answer status requests, but passive mining remains at zero.

Then check these flows:

1. Start a new Codex turn and confirm the SessionStart hook returns MCP Miner context.
2. Run normal Codex work, then let the Stop hook record the latest report. Passive `systemMessage` hook output is non-blocking and may not be shown by every Codex UI.
3. Invoke `@mcp-miner` or ask for MCP Miner status and confirm `get_player_status`, `get_latest_report`, `get_active_orders`, `get_inventory`, `get_store_catalog`, and `open_dashboard` are available.
4. Confirm reports never include private prompts, code, file paths, repo names, terminal output, browser content, or transcripts.
