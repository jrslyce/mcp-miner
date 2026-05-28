# Codex Plugin Install

MCP Miner is packaged as the local Codex desktop plugin at `plugins/mcp-miner`.

## Quick Install

Clone the repo, then run the installer from the repository root.

macOS/Linux:

```sh
git clone https://github.com/jrslyce/mcp-miner.git
cd mcp-miner
ruby scripts/install_codex_plugin.rb
```

Windows PowerShell:

```powershell
git clone https://github.com/jrslyce/mcp-miner.git
cd mcp-miner
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1
```

The Windows installer checks that Ruby is available on `PATH`, because the plugin uses Ruby for its local hooks and MCP tools.

The installer updates `~/.codex/config.toml` with:

```toml
[marketplaces.diamond-mcp]
source_type = "local"
source = "/absolute/path/to/mcp-miner"

[plugins."mcp-miner@diamond-mcp"]
enabled = true
```

It also creates a timestamped backup before changing an existing config. To preview the config change, run:

```sh
ruby scripts/install_codex_plugin.rb --dry-run
```

On Windows, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1 -DryRun
```

To remove the Codex entries later, run:

```sh
ruby scripts/install_codex_plugin.rb --uninstall
```

On Windows, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_codex_plugin.ps1 -Uninstall
```

The repository includes `.agents/plugins/marketplace.json`, which points Codex at `./plugins/mcp-miner`.

## If You Only See The MCP Server

If Codex shows an MCP server but does not show the MCP Miner plugin, the config probably has only a standalone MCP server entry such as `[mcp_servers."mcp-miner"]`. That starts tools, but it is not the Codex plugin and it will not install the plugin manifest or hook trust flow.

Run the installer again from the repo root. It removes the stale standalone MCP Miner server entry and writes the plugin entry:

```toml
[plugins."mcp-miner@diamond-mcp"]
enabled = true
```

After that, restart Codex. If the plugin still does not appear, open `~/.codex/config.toml` on macOS/Linux or `%USERPROFILE%\.codex\config.toml` on Windows and confirm both `[marketplaces.diamond-mcp]` and `[plugins."mcp-miner@diamond-mcp"]` are present.

## Local Install Smoke

From the repository root:

```sh
npm run validate:plugin
npm run test:plugin-install
npm run test:codex-installer
```

`test:plugin-install` verifies the plugin the same way Codex desktop should use it:

- `plugins/mcp-miner/.codex-plugin/plugin.json` keeps the validated manifest shape.
- `plugins/mcp-miner/.mcp.json` launches `ruby ./scripts/mcp_server.rb` with `cwd` set to the plugin root.
- `plugins/mcp-miner/.codex-plugin/plugin.json` points Codex at `./hooks/hooks.json`.
- `plugins/mcp-miner/hooks/hooks.json` commands run through `ruby "$PLUGIN_ROOT/hooks/mcp_miner_hook.rb" ...`.
- `plugins/mcp-miner/skills/mcp-miner/SKILL.md` documents the live MCP tool list and privacy behavior.
- `scripts/install_codex_plugin.rb` safely registers the local marketplace and plugin entry in a Codex config.

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

Trust all 6. Codex requires this because hooks run local Ruby commands. If they are not trusted, MCP Miner status tools can still load, but passive mining stays at zero because Codex never runs the prompt, tool, subagent, or stop hooks.

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
2. Run normal Codex work, then let the Stop hook record and surface a compact `MCP Miner:` report when appropriate.
3. Ask for MCP Miner status and confirm `get_player_status`, `get_active_orders`, `get_inventory`, `get_store_catalog`, and `open_dashboard` are available.
4. Confirm reports never include private prompts, code, file paths, repo names, terminal output, browser content, or transcripts.
