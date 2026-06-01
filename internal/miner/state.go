package miner

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Engine struct {
	Root        string
	StatePath   string
	JournalPath string
	AuthPath    string
	Data        *Data
}

func NewEngine(root string) (*Engine, error) {
	data, err := loadData(root)
	if err != nil {
		return nil, err
	}
	statePath := os.Getenv("MCP_MINER_STATE_PATH")
	if statePath == "" {
		statePath = homeStatePath()
	}
	journalPath := os.Getenv("MCP_MINER_JOURNAL_PATH")
	if journalPath == "" {
		journalPath = filepath.Join(filepath.Dir(statePath), DefaultJournalFilename)
	}
	authPath := os.Getenv("MCP_MINER_AUTH_PATH")
	if authPath == "" {
		authPath = filepath.Join(filepath.Dir(statePath), "auth.json")
	}
	e := &Engine{
		Root:        root,
		StatePath:   statePath,
		JournalPath: journalPath,
		AuthPath:    authPath,
		Data:        data,
	}
	for _, p := range []string{statePath, journalPath, authPath} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return nil, err
		}
	}
	return e, nil
}

func (e *Engine) InitialState() M {
	start := e.Data.PlayerStart
	currentAsteroid := asString(start["current_asteroid_class_id"])
	return M{
		"state_schema_version":             CurrentStateSchemaVersion,
		"profile":                          defaultProfile(),
		"cloud_auth":                       defaultCloudAuth(),
		"cloud_sync_metadata":              defaultCloudSyncMetadata(),
		"space_bucks":                      asInt(start["space_bucks"]),
		"reward_controls":                  defaultRewardControls(),
		"inventory":                        clone(asMap(start["inventory"])),
		"unlocked_machine_ids":             clone(asSlice(start["unlocked_machine_ids"])),
		"unlocked_asteroid_class_ids":      clone(asSlice(start["unlocked_asteroid_class_ids"])),
		"current_asteroid_class_id":        currentAsteroid,
		"upgrades":                         clone(asMap(start["upgrades"])),
		"base_modules":                     clone(asMap(start["base_modules"])),
		"report_mode":                      asString(start["report_mode"]),
		"cloud_sync":                       false,
		"orders":                           []any{},
		"completed_orders":                 []any{},
		"order_generation_index":           0,
		"weekly_contracts":                 []any{},
		"completed_weekly_contracts":       []any{},
		"weekly_contract_generation_index": 0,
		"market_sale_index":                0,
		"market_transactions":              []any{},
		"store_transactions":               []any{},
		"fabrication_queue":                []any{},
		"completed_products":               []any{},
		"fabrication_sequence":             0,
		"suit_condition":                   100,
		"asteroid_progress": M{
			"asteroid_class_id": currentAsteroid,
			"mined":             0,
		},
		"asteroid_progress_by_id": M{
			currentAsteroid: M{"asteroid_class_id": currentAsteroid, "mined": 0},
		},
		"rare_find_pity_score": 0.0,
		"asteroid_depletions":  []any{},
		"hazard_log":           []any{},
		"stats":                defaultStats(),
		"project_stats":        M{},
		"agent_stats":          M{},
		"dedupe_keys":          []any{},
		"current_turn":         nil,
		"latest_report":        nil,
		"journal":              e.defaultJournalMetadata(),
		"last_migration":       nil,
		"last_recovery":        nil,
		"created_at":           nowISO(),
	}
}

func defaultStats() M {
	return M{
		"turns_seen":            0,
		"tool_events_seen":      0,
		"work_score_total":      0.0,
		"chonks_mined_total":    0,
		"materials_found_total": 0,
		"reports_emitted":       0,
		"work_events":           M{},
	}
}

func defaultProfile() M {
	return M{
		"display_name":          "Local Prospector",
		"miner_name":            "Prospector",
		"pronouns":              nil,
		"suit_style":            "cozy sci-fi asteroid miner",
		"avatar_concept_prompt": "A cozy sci-fi asteroid miner in a practical patched pressure suit, warm helmet lights, compact tool harness, friendly dashboard portrait style.",
		"generated_assets":      []any{},
		"customization_unlocks": []any{"suit_patch_basic", "helmet_lamp_warm"},
		"cloud_sync":            false,
	}
}

func defaultCloudAuth() M {
	return M{
		"provider":   "firebase",
		"status":     "off",
		"uid":        nil,
		"linked_at":  nil,
		"last_error": nil,
		"updated_at": nil,
	}
}

func defaultCloudSyncMetadata() M {
	return M{
		"status":                "off",
		"client_id":             "mcp-miner-local",
		"last_pushed_sequence":  0,
		"last_pulled_version":   nil,
		"last_attempt_at":       nil,
		"last_success_at":       nil,
		"next_retry_at":         nil,
		"retry_count":           0,
		"pending_event_ids":     []any{},
		"duplicate_event_ids":   []any{},
		"rejected_events":       []any{},
		"last_error":            nil,
		"functions_origin":      nil,
		"sync_cadence_seconds":  DefaultSyncCadenceSeconds,
		"sync_mode":             "batch",
		"next_eligible_sync_at": nil,
		"entitlement_plan":      "free",
		"link_session_id":       nil,
		"link_code":             nil,
		"link_url":              nil,
		"link_expires_at":       nil,
		"device_id":             nil,
	}
}

func defaultRewardControls() M {
	return M{"event_stats": M{}, "daily_category_counts": M{}, "diagnostics": []any{}}
}

func (e *Engine) defaultJournalMetadata() M {
	return M{"path": e.JournalPath, "applied_event_count": 0, "last_event_id": nil}
}

func (e *Engine) State() (M, error) {
	var out M
	err := e.withLock(func() error {
		state, err := e.loadMaterializedState()
		if err != nil {
			return err
		}
		out = state
		return nil
	})
	return out, err
}

func (e *Engine) WithState(fn func(M) (any, error)) (any, error) {
	var result any
	err := e.withLock(func() error {
		state, err := e.loadMaterializedState()
		if err != nil {
			return err
		}
		nextResult, err := fn(state)
		if err != nil {
			return err
		}
		e.syncJournalMetadata(state, nil)
		if err := e.writeStateUnlocked(state); err != nil {
			return err
		}
		result = nextResult
		return nil
	})
	return result, err
}

func (e *Engine) WriteState(state M) error {
	return e.withLock(func() error {
		e.normalizeState(state)
		e.syncJournalMetadata(state, nil)
		return e.writeStateUnlocked(state)
	})
}

func (e *Engine) withLock(fn func() error) error {
	lockPath := e.StatePath + ".lock"
	deadline := time.Now().Add(15 * time.Second)
	for {
		lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			_, _ = fmt.Fprintln(lock, os.Getpid())
			_ = lock.Close()
			defer os.Remove(lockPath)
			return fn()
		}
		if info, statErr := os.Stat(lockPath); statErr == nil {
			age := time.Since(info.ModTime())
			if (info.Size() == 0 && age > 100*time.Millisecond) || age > 30*time.Second {
				_ = os.Remove(lockPath)
				continue
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for state lock")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func (e *Engine) loadMaterializedState() (M, error) {
	state, err := e.readStateFile()
	if err != nil {
		backup := e.backupCorruptFile(e.StatePath, ".corrupt-")
		replayed, replayErr := e.replayJournalFromDisk()
		if replayErr == nil {
			replayed["last_recovery"] = M{"type": "state_corrupt_backup", "backup_file": filepath.Base(backup), "at": nowISO()}
			_ = e.writeStateUnlocked(replayed)
			return replayed, nil
		}
		fresh := e.InitialState()
		fresh["last_recovery"] = M{"type": "state_corrupt_backup", "backup_file": filepath.Base(backup), "at": nowISO()}
		_ = e.writeStateUnlocked(fresh)
		return fresh, nil
	}
	if asInt(state["state_schema_version"]) != CurrentStateSchemaVersion {
		from := asInt(state["state_schema_version"])
		backup := e.backupStateForMigration(from)
		state["last_migration"] = M{
			"from_state_schema_version": from,
			"to_state_schema_version":   CurrentStateSchemaVersion,
			"backup_file":               filepath.Base(backup),
			"at":                        nowISO(),
		}
		state["state_schema_version"] = CurrentStateSchemaVersion
	}
	e.normalizeState(state)
	entries, journalErr := e.readJournalEntries()
	if journalErr != nil {
		backup := e.backupCorruptFile(e.JournalPath, ".corrupt-")
		state["last_recovery"] = M{"type": "journal_corrupt_backup", "backup_file": filepath.Base(backup), "at": nowISO()}
		_ = e.appendSnapshotUnlocked(state)
		e.syncJournalMetadata(state, nil)
		_ = e.writeStateUnlocked(state)
		return state, nil
	}
	if len(entries) == 0 && asInt(asMap(state["journal"])["applied_event_count"]) == 0 && !fileExists(e.JournalPath) {
		return state, nil
	}
	if _, ok := state["journal"]; !ok || (len(entries) == 0 && asInt(asMap(state["journal"])["applied_event_count"]) == 0 && !fileExists(e.JournalPath)) {
		_ = e.appendSnapshotUnlocked(state)
	}
	if len(entries) == 0 && fileExists(e.JournalPath) {
		e.syncJournalMetadata(state, entries)
		return state, nil
	}
	if asInt(asMap(state["journal"])["applied_event_count"]) < len(entries) {
		replayed := e.ReplayJournal(entries)
		replayed["last_migration"] = state["last_migration"]
		replayed["last_recovery"] = state["last_recovery"]
		_ = e.writeStateUnlocked(replayed)
		return replayed, nil
	}
	e.syncJournalMetadata(state, entries)
	return state, nil
}

func (e *Engine) readStateFile() (M, error) {
	raw, err := os.ReadFile(e.StatePath)
	if errors.Is(err, os.ErrNotExist) {
		return e.InitialState(), nil
	}
	if err != nil {
		return nil, err
	}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	return asMap(normalizeJSON(parsed)), nil
}

func (e *Engine) writeStateUnlocked(state M) error {
	e.normalizeState(state)
	if err := os.MkdirAll(filepath.Dir(e.StatePath), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmp := e.StatePath + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	_ = os.Remove(e.StatePath)
	return os.Rename(tmp, e.StatePath)
}

func (e *Engine) normalizeState(state M) {
	start := e.Data.PlayerStart
	if asInt(state["state_schema_version"]) <= 0 {
		state["state_schema_version"] = CurrentStateSchemaVersion
	}
	profile := defaultProfile()
	for k, v := range asMap(state["profile"]) {
		profile[k] = v
	}
	if _, ok := profile["customization_unlocks"]; !ok {
		profile["customization_unlocks"] = []any{}
	}
	if _, ok := profile["generated_assets"]; !ok {
		profile["generated_assets"] = []any{}
	}
	state["profile"] = profile
	auth := defaultCloudAuth()
	for k, v := range asMap(state["cloud_auth"]) {
		auth[k] = v
	}
	if !hasString(validAuthStates, asString(auth["status"])) {
		auth["status"] = "off"
	}
	state["cloud_auth"] = auth
	meta := defaultCloudSyncMetadata()
	for k, v := range asMap(state["cloud_sync_metadata"]) {
		meta[k] = v
	}
	meta["last_pushed_sequence"] = asInt(meta["last_pushed_sequence"])
	if asInt(meta["sync_cadence_seconds"]) <= 0 {
		meta["sync_cadence_seconds"] = DefaultSyncCadenceSeconds
	}
	state["cloud_sync_metadata"] = meta
	controls := defaultRewardControls()
	for k, v := range asMap(state["reward_controls"]) {
		controls[k] = v
	}
	state["reward_controls"] = controls
	if _, ok := state["space_bucks"]; !ok {
		state["space_bucks"] = asInt(start["space_bucks"])
	}
	if _, ok := state["inventory"]; !ok {
		state["inventory"] = clone(asMap(start["inventory"]))
	}
	for _, key := range []string{"unlocked_machine_ids", "unlocked_asteroid_class_ids"} {
		if _, ok := state[key]; !ok {
			state[key] = clone(asSlice(start[key]))
		}
	}
	if asString(state["current_asteroid_class_id"]) == "" {
		state["current_asteroid_class_id"] = asString(start["current_asteroid_class_id"])
	}
	if _, ok := state["upgrades"]; !ok {
		state["upgrades"] = clone(asMap(start["upgrades"]))
	}
	if _, ok := state["base_modules"]; !ok {
		state["base_modules"] = clone(asMap(start["base_modules"]))
	}
	if !hasString(validReportModes, asString(state["report_mode"])) {
		state["report_mode"] = asString(start["report_mode"])
	}
	if _, ok := state["cloud_sync"]; !ok {
		state["cloud_sync"] = false
	}
	if asInt(state["suit_condition"]) <= 0 {
		state["suit_condition"] = 100
	}
	currentAsteroid := asString(state["current_asteroid_class_id"])
	if _, ok := state["asteroid_progress"]; !ok {
		state["asteroid_progress"] = M{"asteroid_class_id": currentAsteroid, "mined": 0}
	}
	if _, ok := state["asteroid_progress_by_id"]; !ok {
		state["asteroid_progress_by_id"] = M{}
	}
	progress := asMap(state["asteroid_progress"])
	if asString(progress["asteroid_class_id"]) == "" {
		progress["asteroid_class_id"] = currentAsteroid
	}
	asMap(state["asteroid_progress_by_id"])[asString(progress["asteroid_class_id"])] = M{
		"asteroid_class_id": asString(progress["asteroid_class_id"]),
		"mined":             asInt(progress["mined"]),
	}
	state["asteroid_progress"] = progress
	for _, key := range []string{"orders", "completed_orders", "weekly_contracts", "completed_weekly_contracts", "market_transactions", "store_transactions", "fabrication_queue", "completed_products", "asteroid_depletions", "hazard_log", "dedupe_keys"} {
		if _, ok := state[key]; !ok {
			state[key] = []any{}
		}
	}
	for _, key := range []string{"order_generation_index", "weekly_contract_generation_index", "market_sale_index", "fabrication_sequence"} {
		state[key] = asInt(state[key])
	}
	stats := defaultStats()
	for k, v := range asMap(state["stats"]) {
		stats[k] = v
	}
	if _, ok := stats["work_events"]; !ok {
		stats["work_events"] = M{}
	}
	state["stats"] = stats
	if _, ok := state["project_stats"]; !ok {
		state["project_stats"] = M{}
	}
	if _, ok := state["agent_stats"]; !ok {
		state["agent_stats"] = M{}
	}
	if v := state["current_turn"]; v != nil {
		if len(asMap(v)) == 0 {
			state["current_turn"] = nil
		}
	}
	journal := e.defaultJournalMetadata()
	for k, v := range asMap(state["journal"]) {
		journal[k] = v
	}
	state["journal"] = journal
}

func (e *Engine) readJournalEntries() ([]M, error) {
	file, err := os.Open(e.JournalPath)
	if errors.Is(err, os.ErrNotExist) {
		return []M{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	entries := []M{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var parsed any
		if err := json.Unmarshal([]byte(line), &parsed); err != nil {
			return nil, err
		}
		entries = append(entries, asMap(normalizeJSON(parsed)))
	}
	return entries, scanner.Err()
}

func (e *Engine) AppendJournal(entry M) error {
	raw, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(e.JournalPath), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(e.JournalPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(append(raw, '\n'))
	return err
}

func (e *Engine) ReplayJournal(entries []M) M {
	state := e.InitialState()
	for _, entry := range entries {
		e.ApplyJournalEntry(state, entry)
	}
	e.syncJournalMetadata(state, entries)
	return state
}

func (e *Engine) replayJournalFromDisk() (M, error) {
	entries, err := e.readJournalEntries()
	if err != nil {
		return nil, err
	}
	return e.ReplayJournal(entries), nil
}

func (e *Engine) ApplyJournalEntry(state M, entry M) {
	switch asString(entry["event_type"]) {
	case "state_snapshot":
		snap := asMap(entry["state"])
		for k, v := range snap {
			state[k] = clone(v)
		}
		e.normalizeState(state)
	default:
		if strings.HasPrefix(asString(entry["event_type"]), "work_") {
			e.applyRewardJournalEntry(state, entry)
		}
	}
}

func (e *Engine) applyRewardJournalEntry(state M, entry M) {
	eventType := asString(entry["event_type"])
	if eventType == "" {
		return
	}
	for _, existing := range asSlice(state["dedupe_keys"]) {
		if asString(existing) == asString(entry["event_id"]) {
			return
		}
	}
	e.EnsureTurn(state, asString(entry["turn_id"]))
	rewards := asMap(entry["rewards"])
	chonks := asInt(rewards["chonks"])
	inv := asMap(state["inventory"])
	inv["mat_chonks"] = asInt(inv["mat_chonks"]) + chonks
	for materialID, qty := range asMap(rewards["materials"]) {
		inv[materialID] = asInt(inv[materialID]) + asInt(qty)
	}
	turn := asMap(state["current_turn"])
	turn["score"] = round(asFloat(turn["score"])+asFloat(entry["score"]), 2)
	turn["chonks"] = asInt(turn["chonks"]) + chonks
	turnMaterials := asMap(turn["materials"])
	for materialID, qty := range asMap(rewards["materials"]) {
		turnMaterials[materialID] = asInt(turnMaterials[materialID]) + asInt(qty)
	}
	turn["materials"] = turnMaterials
	turnEvents := asMap(turn["events"])
	turnEvents[eventType] = asInt(turnEvents[eventType]) + 1
	turn["events"] = turnEvents
	stats := asMap(state["stats"])
	if eventType != "work_user_prompt" {
		stats["tool_events_seen"] = asInt(stats["tool_events_seen"]) + 1
	}
	stats["work_score_total"] = round(asFloat(stats["work_score_total"])+asFloat(entry["score"]), 2)
	stats["chonks_mined_total"] = asInt(stats["chonks_mined_total"]) + chonks
	stats["materials_found_total"] = asInt(stats["materials_found_total"]) + materialQuantity(asMap(rewards["materials"]))
	workEvents := asMap(stats["work_events"])
	workEvents[eventType] = asInt(workEvents[eventType]) + 1
	stats["work_events"] = workEvents
	state["stats"] = stats
	if damage := asInt(rewards["suit_damage"]); damage > 0 {
		next := asInt(state["suit_condition"]) - damage
		if next < 0 {
			next = 0
		}
		state["suit_condition"] = next
	}
	progress := asMap(state["asteroid_progress"])
	progress["asteroid_class_id"] = asString(rewards["asteroid_class_id"])
	mined := asInt(progress["mined"]) + asInt(rewards["asteroid_mined_delta"])
	asteroid := e.Data.AsteroidByID[asString(progress["asteroid_class_id"])]
	depletionSize := asInt(asteroid["depletion_size"])
	if depletionSize > 0 && mined >= depletionSize {
		mined = depletionSize
		progress["mined"] = mined
		asMap(state["asteroid_progress_by_id"])[asString(progress["asteroid_class_id"])] = M{"asteroid_class_id": asString(progress["asteroid_class_id"]), "mined": mined}
		e.handleAsteroidDepletion(state, asString(progress["asteroid_class_id"]))
	} else {
		progress["mined"] = mined
		asMap(state["asteroid_progress_by_id"])[asString(progress["asteroid_class_id"])] = M{"asteroid_class_id": asString(progress["asteroid_class_id"]), "mined": mined}
	}
	if hazard := asMap(rewards["hazard"]); asString(hazard["hazard_id"]) != "" {
		log := asSlice(state["hazard_log"])
		log = append(log, M{
			"hazard_id":   asString(hazard["hazard_id"]),
			"suit_damage": asInt(rewards["suit_damage"]),
			"mitigation":  asFloat(hazard["mitigation"]),
			"created_at":  asString(entry["timestamp"]),
		})
		if len(log) > 20 {
			log = log[len(log)-20:]
		}
		state["hazard_log"] = log
	}
	state["rare_find_pity_score"] = mathMin(3.0, asFloat(state["rare_find_pity_score"])+0.1)
	if projectID := asString(entry["project_id"]); projectID != "" {
		project := asMap(asMap(state["project_stats"])[projectID])
		if len(project) == 0 {
			project = M{"turns": M{}, "work_events": M{}, "last_seen_at": nil}
		}
		asMap(project["turns"])[asString(entry["turn_id"])] = true
		asMap(project["work_events"])[eventType] = asInt(asMap(project["work_events"])[eventType]) + 1
		project["last_seen_at"] = asString(entry["timestamp"])
		asMap(state["project_stats"])[projectID] = project
	}
	if agentID := asString(entry["agent_id"]); agentID != "" {
		agent := asMap(asMap(state["agent_stats"])[agentID])
		if len(agent) == 0 {
			agent = M{"agent_type": "unknown", "starts": 0, "stops": 0, "last_seen_at": nil}
		}
		agent["last_seen_at"] = asString(entry["timestamp"])
		asMap(state["agent_stats"])[agentID] = agent
	}
	e.applyRewardControlJournal(state, eventType, entry)
	dedupe := asSlice(state["dedupe_keys"])
	dedupe = append(dedupe, asString(entry["event_id"]))
	if len(dedupe) > 300 {
		dedupe = dedupe[len(dedupe)-300:]
	}
	state["dedupe_keys"] = dedupe
	e.advanceFabrication(state, eventType, asFloat(entry["score"]), asString(entry["timestamp"]))
}

func (e *Engine) applyRewardControlJournal(state M, eventType string, entry M) {
	controls := asMap(state["reward_controls"])
	stats := asMap(controls["event_stats"])
	eventStats := asMap(stats[eventType])
	dateKey := ""
	if t, ok := parseTime(asString(entry["timestamp"])); ok {
		dateKey = t.Format("2006-01-02")
	}
	if dateKey == "" {
		dateKey = time.Now().UTC().Format("2006-01-02")
	}
	eventStats["count"] = asInt(eventStats["count"]) + 1
	daily := asMap(eventStats["daily"])
	day := asMap(daily[dateKey])
	day["count"] = asInt(day["count"]) + 1
	day["effective_score"] = round(asFloat(day["effective_score"])+asFloat(entry["score"]), 2)
	daily[dateKey] = day
	eventStats["daily"] = daily
	eventStats["last_rewarded_at"] = asString(entry["timestamp"])
	stats[eventType] = eventStats
	controls["event_stats"] = stats
	category := asString(asMap(e.Data.WorkEventByID[eventType])["category"])
	cats := asMap(controls["daily_category_counts"])
	todayCats := asMap(cats[dateKey])
	todayCats[category] = asInt(todayCats[category]) + 1
	cats[dateKey] = todayCats
	controls["daily_category_counts"] = cats
	if diag := asMap(entry["reward_control"]); len(diag) > 0 {
		diagnostics := asSlice(controls["diagnostics"])
		diagnostics = append(diagnostics, diag)
		if len(diagnostics) > 50 {
			diagnostics = diagnostics[len(diagnostics)-50:]
		}
		controls["diagnostics"] = diagnostics
	}
	state["reward_controls"] = controls
}

func (e *Engine) appendSnapshotUnlocked(state M) error {
	snap := M{
		"event_id":      eventID("snapshot:" + nowISO()),
		"event_type":    "state_snapshot",
		"timestamp":     nowISO(),
		"privacy_class": "abstract",
		"state":         e.snapshotState(state),
	}
	return e.AppendJournal(snap)
}

func (e *Engine) snapshotState(state M) M {
	keys := []string{"state_schema_version", "profile", "cloud_auth", "cloud_sync_metadata", "space_bucks", "reward_controls", "inventory", "unlocked_machine_ids", "unlocked_asteroid_class_ids", "current_asteroid_class_id", "upgrades", "base_modules", "report_mode", "cloud_sync", "orders", "completed_orders", "order_generation_index", "weekly_contracts", "completed_weekly_contracts", "weekly_contract_generation_index", "market_sale_index", "market_transactions", "store_transactions", "fabrication_queue", "completed_products", "fabrication_sequence", "suit_condition", "asteroid_progress", "asteroid_progress_by_id", "rare_find_pity_score", "asteroid_depletions", "hazard_log", "stats", "project_stats", "agent_stats", "dedupe_keys", "current_turn", "latest_report", "last_migration", "last_recovery", "created_at"}
	out := M{}
	for _, key := range keys {
		if v, ok := state[key]; ok {
			out[key] = clone(v)
		}
	}
	return out
}

func (e *Engine) syncJournalMetadata(state M, entries []M) {
	if entries == nil {
		var err error
		entries, err = e.readJournalEntries()
		if err != nil {
			entries = []M{}
		}
	}
	last := any(nil)
	if len(entries) > 0 {
		last = asString(entries[len(entries)-1]["event_id"])
	}
	state["journal"] = M{"path": e.JournalPath, "applied_event_count": len(entries), "last_event_id": last}
}

func (e *Engine) backupStateForMigration(from int) string {
	backup := fmt.Sprintf("%s.backup-v%d-to-v%d-%d", e.StatePath, from, CurrentStateSchemaVersion, time.Now().UTC().Unix())
	if raw, err := os.ReadFile(e.StatePath); err == nil {
		_ = os.WriteFile(backup, raw, 0o600)
	}
	return backup
}

func (e *Engine) backupCorruptFile(path, suffix string) string {
	backup := fmt.Sprintf("%s%s%d", path, suffix, time.Now().UTC().UnixNano())
	if raw, err := os.ReadFile(path); err == nil {
		_ = os.WriteFile(backup, raw, 0o600)
		_ = os.Remove(path)
	}
	return backup
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func materialQuantity(materials M) int {
	total := 0
	for _, qty := range materials {
		total += asInt(qty)
	}
	return total
}

func mathMin(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
