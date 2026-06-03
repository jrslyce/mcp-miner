package miner

import (
	"bytes"
	"encoding/json"
	"os"
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
	heartbeatRaw, err := os.ReadFile(filepath.Join(filepath.Dir(engine.StatePath), "hook-heartbeat.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	heartbeat := string(heartbeatRaw)
	if !strings.Contains(heartbeat, `"mode":"post_tool_use"`) {
		t.Fatalf("hook heartbeat did not record mode: %s", heartbeat)
	}
	for _, private := range []string{"private", "repo", "rg -n"} {
		if strings.Contains(heartbeat, private) {
			t.Fatalf("hook heartbeat leaked private value %q: %s", private, heartbeat)
		}
	}
}

func TestEveryTurnFullStopRequestsVisibleFooter(t *testing.T) {
	engine := testEngine(t)
	_, err := engine.WithState(func(state M) (any, error) {
		state["report_mode"] = "every_turn_full"
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	userPrompt := M{
		"session_id":      "session-test",
		"turn_id":         "turn-visible",
		"hook_event_name": "UserPromptSubmit",
		"prompt":          "please check status",
	}
	rawPrompt, _ := json.Marshal(userPrompt)
	if err := RunHook(engine, "user_prompt_submit", bytes.NewReader(rawPrompt), &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	stop := M{
		"session_id":             "session-test",
		"turn_id":                "turn-visible",
		"hook_event_name":        "Stop",
		"stop_hook_active":       false,
		"last_assistant_message": "Done.",
	}
	rawStop, _ := json.Marshal(stop)
	var output bytes.Buffer
	if err := RunHook(engine, "stop", bytes.NewReader(rawStop), &output, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	var response M
	if err := json.Unmarshal(output.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if _, ok := response["decision"]; ok {
		t.Fatalf("full report should not force a continuation decision: %#v", response)
	}
	if _, ok := response["reason"]; ok {
		t.Fatalf("full report should not emit a continuation reason: %#v", response)
	}
	if !strings.Contains(asString(response["systemMessage"]), "MCP Miner Expedition Report") {
		t.Fatalf("expected report system message: %#v", response)
	}

	stop["stop_hook_active"] = true
	stop["turn_id"] = "turn-visible-active"
	rawStop, _ = json.Marshal(stop)
	output.Reset()
	if err := RunHook(engine, "stop", bytes.NewReader(rawStop), &output, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	response = M{}
	if err := json.Unmarshal(output.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if _, ok := response["decision"]; ok {
		t.Fatalf("active stop continuation should not loop: %#v", response)
	}
}
