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

func TestEveryTurnFullStopRecordsPassiveFooter(t *testing.T) {
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
	if asString(response["decision"]) != "block" {
		t.Fatalf("full report should request a footer continuation: %#v", response)
	}
	if !strings.Contains(asString(response["reason"]), "MCP Miner Expedition Report") {
		t.Fatalf("expected report continuation reason: %#v", response)
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

func TestAsteroidDepletionUnlocksInCatalogOrderAndClaimsRepeat(t *testing.T) {
	engine := testEngine(t)
	_, err := engine.WithState(func(state M) (any, error) {
		state["unlocked_asteroid_class_ids"] = []any{"asteroid_starter_rubble", "asteroid_quartz_belt", "asteroid_iron_tumblers"}
		state["current_asteroid_class_id"] = "asteroid_iron_tumblers"
		state["asteroid_progress"] = M{"asteroid_class_id": "asteroid_iron_tumblers", "mined": 2598}
		state["asteroid_progress_by_id"] = M{
			"asteroid_starter_rubble": M{"asteroid_class_id": "asteroid_starter_rubble", "mined": 1000},
			"asteroid_quartz_belt":    M{"asteroid_class_id": "asteroid_quartz_belt", "mined": 1800},
			"asteroid_iron_tumblers":  M{"asteroid_class_id": "asteroid_iron_tumblers", "mined": 2598},
		}
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = engine.WithState(func(state M) (any, error) {
		engine.ApplyJournalEntry(state, M{
			"event_id":      "evt_deplete_iron",
			"event_type":    "work_apply_patch",
			"timestamp":     "2026-06-08T00:00:00Z",
			"turn_id":       "turn-deplete-iron",
			"privacy_class": "abstract",
			"score":         4,
			"rewards": M{
				"chonks":               2,
				"materials":            M{},
				"asteroid_class_id":    "asteroid_iron_tumblers",
				"asteroid_mined_delta": 8,
				"suit_damage":          0,
				"rare_find":            false,
			},
		})
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	state := mustState(t, engine)
	if asString(state["current_asteroid_class_id"]) != "asteroid_sapphire_debris_field" {
		t.Fatalf("expected same-tier Sapphire unlock, got %s", asString(state["current_asteroid_class_id"]))
	}
	if !hasString(strSlice(state["unlocked_asteroid_class_ids"]), "asteroid_sapphire_debris_field") {
		t.Fatalf("sapphire field was not unlocked: %#v", state["unlocked_asteroid_class_ids"])
	}
	if asInt(asMap(state["asteroid_progress"])["mined"]) != 6 {
		t.Fatalf("expected overflow 6 to carry forward, got %#v", state["asteroid_progress"])
	}

	claimed := engine.ClaimAsteroidPayload(M{"asteroid_id": "asteroid_starter_rubble"})
	if asString(claimed["status"]) != "claimed_new_asteroid" {
		t.Fatalf("expected starter rubble repeat claim, got %#v", claimed)
	}
	state = mustState(t, engine)
	if asString(state["current_asteroid_class_id"]) != "asteroid_starter_rubble" || asInt(asMap(state["asteroid_progress"])["mined"]) != 0 {
		t.Fatalf("claim did not reset and select starter rubble: %#v", state["asteroid_progress"])
	}
}

func TestRareFindPityResetsOnRareReward(t *testing.T) {
	engine := testEngine(t)
	_, err := engine.WithState(func(state M) (any, error) {
		engine.ApplyJournalEntry(state, M{
			"event_id":      "evt_common",
			"event_type":    "work_search",
			"timestamp":     "2026-06-08T00:00:00Z",
			"turn_id":       "turn-common",
			"privacy_class": "abstract",
			"score":         1,
			"rewards": M{
				"chonks":               1,
				"materials":            M{},
				"asteroid_class_id":    "asteroid_starter_rubble",
				"asteroid_mined_delta": 1,
				"suit_damage":          0,
				"rare_find":            false,
			},
		})
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	state := mustState(t, engine)
	if asFloat(state["rare_find_pity_score"]) != 1.0 {
		t.Fatalf("expected pity to increment by 1, got %#v", state["rare_find_pity_score"])
	}
	_, err = engine.WithState(func(state M) (any, error) {
		engine.ApplyJournalEntry(state, M{
			"event_id":      "evt_rare",
			"event_type":    "work_search",
			"timestamp":     "2026-06-08T00:01:00Z",
			"turn_id":       "turn-rare",
			"privacy_class": "abstract",
			"score":         1,
			"rewards": M{
				"chonks":               1,
				"materials":            M{"mat_fictional_sparkglass": 1},
				"asteroid_class_id":    "asteroid_starter_rubble",
				"asteroid_mined_delta": 2,
				"suit_damage":          0,
				"rare_find":            true,
			},
		})
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	state = mustState(t, engine)
	if asFloat(state["rare_find_pity_score"]) != 0.0 {
		t.Fatalf("expected pity reset on rare find, got %#v", state["rare_find_pity_score"])
	}
}

func mustState(t *testing.T, engine *Engine) M {
	t.Helper()
	state, err := engine.State()
	if err != nil {
		t.Fatal(err)
	}
	return state
}
