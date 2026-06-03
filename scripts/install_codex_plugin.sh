#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PLUGIN_BIN="$REPO_ROOT/plugins/mcp-miner/bin/mcp-miner"

if [ -x "$PLUGIN_BIN" ]; then
  exec "$PLUGIN_BIN" install-codex-plugin --repo-root "$REPO_ROOT" "$@"
fi

cd "$REPO_ROOT"
exec go run ./cmd/mcp-miner install-codex-plugin --repo-root "$REPO_ROOT" "$@"
