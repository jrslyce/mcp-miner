package miner

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func testEngine(t *testing.T) *Engine {
	t.Helper()
	root, err := LocateRoot()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("MCP_MINER_STATE_PATH", filepath.Join(t.TempDir(), "state.json"))
	engine, err := NewEngine(root)
	if err != nil {
		t.Fatal(err)
	}
	return engine
}

func TestLoadValidatedGameplayData(t *testing.T) {
	engine := testEngine(t)
	if len(engine.Data.Materials) < 100 {
		t.Fatalf("expected material catalog, got %d", len(engine.Data.Materials))
	}
	if engine.Data.MaterialByID["mat_chonks"] == nil {
		t.Fatal("missing starter material mat_chonks")
	}
	if engine.Data.AsteroidByID["asteroid_starter_rubble"] == nil {
		t.Fatal("missing starter asteroid")
	}
}

func TestMCPSettingsAndStatus(t *testing.T) {
	engine := testEngine(t)
	requests := []M{
		{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": M{}},
		{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": M{"name": "update_settings", "arguments": M{"report_mode": "every_turn_compact", "cloud_sync": true}}},
		{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": M{"name": "get_player_status", "arguments": M{}}},
	}
	var input bytes.Buffer
	for _, request := range requests {
		raw, _ := json.Marshal(request)
		input.Write(raw)
		input.WriteByte('\n')
	}
	var output bytes.Buffer
	if err := RunMCP(engine, &input, &output, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 JSON-RPC responses, got %d", len(lines))
	}
	var response M
	if err := json.Unmarshal([]byte(lines[1]), &response); err != nil {
		t.Fatal(err)
	}
	payloadText := asString(asMap(asSlice(asMap(response["result"])["content"])[0])["text"])
	var payload M
	if err := json.Unmarshal([]byte(payloadText), &payload); err != nil {
		t.Fatal(err)
	}
	if !asBool(payload["ok"]) || asString(asMap(payload["settings"])["report_mode"]) != "every_turn_compact" {
		t.Fatalf("settings update failed: %#v", payload)
	}
}

func TestHookJournalStaysPrivacySafe(t *testing.T) {
	engine := testEngine(t)
	input := M{
		"session_id":      "session-test",
		"turn_id":         "turn-test",
		"hook_event_name": "PostToolUse",
		"cwd":             filepath.Join("C:", "private", "repo"),
		"tool_name":       "Bash",
		"tool_use_id":     "tool-search",
		"tool_input":      M{"command": "rg -n private ."},
		"tool_response":   M{"exit_code": 0},
	}
	raw, _ := json.Marshal(input)
	if err := RunHook(engine, "post_tool_use", bytes.NewReader(raw), &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	state, err := engine.State()
	if err != nil {
		t.Fatal(err)
	}
	if asInt(asMap(state["inventory"])["mat_chonks"]) <= 0 {
		t.Fatal("hook did not mine Chonks")
	}
	journal, err := engine.readJournalEntries()
	if err != nil {
		t.Fatal(err)
	}
	if len(journal) != 1 {
		t.Fatalf("expected one journal entry, got %d", len(journal))
	}
	serialized := stableJSON(journal[0])
	for _, private := range []string{"private", "repo", "rg -n"} {
		if strings.Contains(serialized, private) {
			t.Fatalf("journal leaked private value %q: %s", private, serialized)
		}
	}
}
