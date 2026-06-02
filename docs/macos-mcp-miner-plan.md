# MCP Miner macOS Plugin Plan

## Goal

Ship MCP Miner as local Codex plugin bundles for macOS Apple Silicon and macOS Intel without requiring testers to install Go, Ruby, or any language runtime.

## Branches

- `Mac-Silicon`: validates the `darwin-arm64` package for Apple Silicon Macs.
- `Mac-Intel`: validates the `darwin-amd64` package for Intel Macs.

Both branches should share the same source implementation. The architecture-specific work happens at package time by cross-compiling the Go binary and rendering a macOS hook manifest.

## Release Targets

| Target | Go OS | Go Arch | Binary | Hook command |
| --- | --- | --- | --- | --- |
| Mac Silicon | `darwin` | `arm64` | `bin/mcp-miner` | `"$PLUGIN_ROOT/bin/mcp-miner" hook ...` |
| Mac Intel | `darwin` | `amd64` | `bin/mcp-miner` | `"$PLUGIN_ROOT/bin/mcp-miner" hook ...` |
| Windows | `windows` | `amd64` | `bin/mcp-miner.exe` | `cmd /d /c call "%PLUGIN_ROOT%\bin\mcp-miner.exe" hook ...` |

## Implementation Tasks

1. Keep the checked-out Windows plugin working for current testers.
2. Add a hook-rendering script that can generate `hooks.json` for Windows or macOS targets.
3. Add a package script that creates a minimal local marketplace tree under `dist/`.
4. Cross-compile Go binaries for `darwin-arm64` and `darwin-amd64`.
5. Copy required runtime data into each bundle so `LocateRoot` can find `data/materials.yaml`.
6. Render macOS hook commands into each bundle.
7. Add tests that verify:
   - the Mac bundles contain the marketplace file, plugin manifest, data, skills, hooks, and binary;
   - the macOS hook command uses `$PLUGIN_ROOT` and never `cmd` or `.exe`;
   - both macOS binaries have Mach-O headers;
   - Apple Silicon and Intel binaries are different artifacts;
   - generated bundles do not leak local workspace paths in hook commands.
8. Document tester install steps and limitations.

## Tester Instructions

1. Download the correct bundle:
   - Apple Silicon: `mcp-miner-darwin-arm64`
   - Intel: `mcp-miner-darwin-amd64`
2. Place the bundle anywhere under the tester's home directory.
3. From inside the bundle root, run:

   ```sh
   ruby scripts/install_codex_plugin.rb
   ```

4. Restart Codex.
5. Open Settings -> Hooks -> MCP Miner.
6. Trust all 6 hooks.
7. Start a new Codex turn and run one normal tool-using prompt.
8. Ask:

   ```text
   MCP Miner status
   ```

Expected result: `turns_seen`, `work_score_total`, and Chonks increase. The local heartbeat file appears at `~/.mcp-miner/hook-heartbeat.jsonl`.

## Acceptance Criteria

- `go test ./...` passes.
- `ruby scripts/test_plugin_install.rb` passes for the source checkout.
- `ruby scripts/test_macos_plugin_package.rb` passes for both macOS targets.
- `git diff --check` passes.
- The Mac Silicon branch can produce a `darwin-arm64` bundle.
- The Mac Intel branch can produce a `darwin-amd64` bundle.
- No generated bundle requires Go to be installed on the tester machine.

## Known Limits

- Cross-compiled macOS binaries cannot be executed on Windows CI or this Windows development machine.
- Final manual verification still needs one Apple Silicon Mac and one Intel Mac because Codex hook execution, Gatekeeper prompts, and filesystem permissions are OS-local behavior.
