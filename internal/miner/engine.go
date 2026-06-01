package miner

import (
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"time"
)

var storeCosmetics = []M{
	{"id": "cosmetic_suit_trim_teal", "unlock_id": "suit_trim_teal", "display_name": "Teal Suit Trim", "description": "A profile cosmetic for the local miner suit.", "space_bucks": 90},
	{"id": "cosmetic_helmet_glow_green", "unlock_id": "helmet_glow_green", "display_name": "Green Helmet Glow", "description": "A soft dashboard portrait lighting unlock.", "space_bucks": 140},
	{"id": "cosmetic_survey_badge_gold", "unlock_id": "survey_badge_gold", "display_name": "Gold Survey Badge", "description": "A profile badge bought only with earned Space Bucks.", "space_bucks": 260},
}

func (e *Engine) EnsureTurn(state M, turnID string) {
	if turnID == "" {
		turnID = "turn_local"
	}
	current := asMap(state["current_turn"])
	if asString(current["turn_id"]) == turnID {
		return
	}
	stats := asMap(state["stats"])
	stats["turns_seen"] = asInt(stats["turns_seen"]) + 1
	state["stats"] = stats
	state["current_turn"] = M{
		"turn_id":        turnID,
		"score":          0.0,
		"chonks":         0,
		"materials":      M{},
		"events":         M{},
		"report_emitted": false,
		"started_at":     nowISO(),
	}
}

func (e *Engine) AddStatEvent(state M, eventID string, score float64) {
	stats := asMap(state["stats"])
	stats["work_score_total"] = round(asFloat(stats["work_score_total"])+score, 2)
	workEvents := asMap(stats["work_events"])
	workEvents[eventID] = asInt(workEvents[eventID]) + 1
	stats["work_events"] = workEvents
	state["stats"] = stats
}

func (e *Engine) AddEventReward(state M, eventType, turnID, hookName string, lineCount int, suffix, sessionID, projectID, agentID string) {
	if _, ok := e.Data.WorkEventByID[eventType]; !ok {
		return
	}
	key := strings.Join([]string{turnID, hookName, eventType, suffix}, ":")
	journalEventID := eventID(key)
	for _, item := range asSlice(state["dedupe_keys"]) {
		s := asString(item)
		if s == key || s == journalEventID {
			return
		}
	}
	rawScore := e.eventScore(eventType, lineCount)
	control := e.rewardControlDecision(state, eventType, rawScore, time.Now().UTC())
	score := round(rawScore*asFloat(control["multiplier"]), 2)
	if score <= 0 {
		return
	}
	reward := e.calculateReward(state, eventType, score, turnID)
	entry := M{
		"event_id":       journalEventID,
		"event_type":     eventType,
		"timestamp":      nowISO(),
		"session_id":     sessionID,
		"turn_id":        turnID,
		"privacy_class":  "abstract",
		"score":          score,
		"rewards":        reward,
		"project_id":     projectID,
		"agent_id":       agentID,
		"reward_control": control,
	}
	_ = e.AppendJournal(entry)
	e.ApplyJournalEntry(state, entry)
}

func (e *Engine) eventScore(eventType string, lineCount int) float64 {
	event := e.Data.WorkEventByID[eventType]
	score := asFloat(event["base_score"])
	if lineCount > 0 && event["score_per_changed_line"] != nil {
		score += float64(lineCount) * asFloat(event["score_per_changed_line"])
		if max := asFloat(event["max_score_per_event"]); max > 0 && score > max {
			score = max
		}
	}
	if eventType == "work_test_pass" && asFloat(event["verification_bonus"]) > 0 {
		score *= asFloat(event["verification_bonus"])
	}
	return round(score, 2)
}

func (e *Engine) rewardControlDecision(state M, eventType string, rawScore float64, now time.Time) M {
	event := e.Data.WorkEventByID[eventType]
	dateKey := now.Format("2006-01-02")
	eventStats := asMap(asMap(asMap(state["reward_controls"])["event_stats"])[eventType])
	dayStats := asMap(asMap(eventStats["daily"])[dateKey])
	reasons := []any{}
	multiplier := 1.0
	if cooldown := asInt(event["cooldown_seconds"]); cooldown > 0 {
		if last, ok := parseTime(asString(eventStats["last_rewarded_at"])); ok && now.Sub(last) < time.Duration(cooldown)*time.Second {
			multiplier *= 0.25
			reasons = append(reasons, "cooldown")
		}
	}
	if softCap := asInt(event["daily_soft_cap"]); softCap > 0 && asInt(dayStats["count"]) >= softCap {
		multiplier *= 0.2
		reasons = append(reasons, "daily_soft_cap")
	}
	category := asString(event["category"])
	catsToday := asMap(asMap(asMap(state["reward_controls"])["daily_category_counts"])[dateKey])
	if _, ok := catsToday[category]; !ok && len(catsToday) >= 2 {
		multiplier *= 1.10
		reasons = append(reasons, "diverse_work_bonus")
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "standard")
	}
	return M{
		"raw_score":       round(rawScore, 2),
		"multiplier":      round(multiplier, 4),
		"effective_score": round(rawScore*multiplier, 2),
		"reasons":         reasons,
		"event_type":      eventType,
		"category":        category,
		"date":            dateKey,
		"privacy_class":   "abstract",
	}
}

func (e *Engine) calculateReward(state M, eventType string, score float64, turnID string) M {
	asteroid := e.asteroidFor(state)
	multiplier := asFloat(asteroid["yield_multiplier"]) * e.drillMultiplier(state)
	if multiplier <= 0 {
		multiplier = 1
	}
	chonks := int(math.Floor(score * 1.25 * multiplier))
	if chonks < 1 {
		chonks = 1
	}
	materials, rareFound, rareChance := e.weightedMaterials(state, asteroid, score, turnID, eventType)
	hazard, damage := e.hazardResult(eventType, asteroid, state)
	return M{
		"chonks":               chonks,
		"materials":            materials,
		"asteroid_class_id":    asString(asteroid["id"]),
		"asteroid_mined_delta": chonks + materialQuantity(materials),
		"suit_damage":          damage,
		"rare_find":            rareFound,
		"rare_find_chance":     rareChance,
		"hazard":               hazard,
	}
}

func (e *Engine) weightedMaterials(state M, asteroid M, score float64, turnID, eventType string) (M, bool, float64) {
	units := int(math.Floor(score / 4.0))
	if units < 1 {
		units = 1
	}
	if units > 8 {
		units = 8
	}
	out := M{}
	chance := e.rareFindChance(state, asteroid, eventType)
	rareFound := false
	weights := asSlice(asteroid["composition"])
	for i := 0; i < units; i++ {
		seed := fmt.Sprintf("%s:%v:%s:%d", turnID, asMap(state["stats"])["work_score_total"], eventType, i)
		var materialID string
		if deterministicUnit(seed+":rare") < chance {
			rareFound = true
			materialID = pickWeighted(rareComposition(weights), seed+":rare_pick")
		} else {
			materialID = pickWeighted(weights, seed)
		}
		if materialID == "" || materialID == "mat_chonks" {
			continue
		}
		out[materialID] = asInt(out[materialID]) + 1
	}
	return out, rareFound, round(chance, 4)
}

func deterministicUnit(seed string) float64 {
	h := shaHex(seed)
	v, _ := strconvParseHex(h[:12])
	return float64(v%1_000_000) / 1_000_000.0
}

func strconvParseHex(s string) (uint64, error) {
	var out uint64
	for _, r := range s {
		out <<= 4
		switch {
		case r >= '0' && r <= '9':
			out += uint64(r - '0')
		case r >= 'a' && r <= 'f':
			out += uint64(r-'a') + 10
		case r >= 'A' && r <= 'F':
			out += uint64(r-'A') + 10
		}
	}
	return out, nil
}

func pickWeighted(weights []any, seed string) string {
	total := 0.0
	for _, item := range weights {
		total += asFloat(asMap(item)["weight"])
	}
	if total <= 0 {
		return ""
	}
	target := deterministicUnit(seed) * total
	running := 0.0
	for _, item := range weights {
		m := asMap(item)
		running += asFloat(m["weight"])
		if target <= running {
			return asString(m["material_id"])
		}
	}
	if len(weights) == 0 {
		return ""
	}
	return asString(asMap(weights[len(weights)-1])["material_id"])
}

func rareComposition(weights []any) []any {
	out := []any{}
	for _, item := range weights {
		m := asMap(item)
		w := asFloat(m["weight"])
		if w <= 0.05 {
			out = append(out, item)
		}
	}
	if len(out) == 0 {
		return weights
	}
	return out
}

func (e *Engine) hazardResult(eventType string, asteroid M, state M) (M, int) {
	if eventType != "work_test_fail" {
		return M{}, 0
	}
	hazard := e.Data.HazardByID["hazard_micro_meteor_shove"]
	damage := int(math.Ceil(8.0 * asFloat(asteroid["hazard_multiplier"]) * (1.0 - e.upgradeEffectByID("upgrade_suit_plating", asInt(asMap(state["upgrades"])["upgrade_suit_plating"])))))
	if damage < 1 {
		damage = 1
	}
	return M{"hazard_id": "hazard_micro_meteor_shove", "display_name": asString(hazard["display_name"]), "mitigation": round(e.upgradeEffectByID("upgrade_suit_plating", asInt(asMap(state["upgrades"])["upgrade_suit_plating"])), 2)}, damage
}

func (e *Engine) asteroidFor(state M) M {
	id := asString(state["current_asteroid_class_id"])
	if a, ok := e.Data.AsteroidByID[id]; ok {
		return a
	}
	return e.Data.Asteroids[0]
}

func (e *Engine) drillMultiplier(state M) float64 {
	return e.upgradeEffectByID("upgrade_drill_power", asInt(asMap(state["upgrades"])["upgrade_drill_power"]))
}

func (e *Engine) handleAsteroidDepletion(state M, asteroidID string) {
	nextID := ""
	current := e.Data.AsteroidByID[asteroidID]
	currentTier := asInt(current["unlock_tier"])
	for _, asteroid := range e.Data.Asteroids {
		id := asString(asteroid["id"])
		if asInt(asteroid["unlock_tier"]) > currentTier {
			nextID = id
			break
		}
	}
	if nextID == "" && len(e.Data.Asteroids) > 0 {
		nextID = asString(e.Data.Asteroids[0]["id"])
	}
	unlocked := strSlice(state["unlocked_asteroid_class_ids"])
	unlocked = uniqueAppend(unlocked, nextID)
	state["unlocked_asteroid_class_ids"] = anySlice(unlocked)
	state["current_asteroid_class_id"] = nextID
	state["asteroid_progress"] = M{"asteroid_class_id": nextID, "mined": 1}
	asMap(state["asteroid_progress_by_id"])[nextID] = M{"asteroid_class_id": nextID, "mined": 1}
	depletions := asSlice(state["asteroid_depletions"])
	depletions = append(depletions, M{"asteroid_class_id": asteroidID, "unlocked_asteroid_class_id": nextID, "depleted_at": nowISO()})
	state["asteroid_depletions"] = depletions
}

func anySlice(items []string) []any {
	out := make([]any, len(items))
	for i, v := range items {
		out[i] = v
	}
	return out
}

func (e *Engine) ShouldEmitReport(state M) bool {
	mode := asString(state["report_mode"])
	turn := asMap(state["current_turn"])
	if mode == "" {
		mode = "meaningful_turns_only"
	}
	if mode == "off" || asBool(turn["report_emitted"]) {
		return false
	}
	if mode == "every_turn_compact" || mode == "every_turn_full" {
		return true
	}
	if mode == "milestones_only" {
		return e.milestoneTurn(state)
	}
	return e.concreteWorkTurn(turn) || e.milestoneTurn(state)
}

func (e *Engine) BuildReport(state M) string {
	mode := asString(state["report_mode"])
	turn := asMap(state["current_turn"])
	if mode == "every_turn_full" || mode == "session_summary_only" {
		return fmt.Sprintf("MCP Miner Expedition Report\nMined: %d Chonks\nSpace Bucks: %d\nAsteroid: %s", asInt(turn["chonks"]), asInt(state["space_bucks"]), asString(e.asteroidFor(state)["display_name"]))
	}
	if mode == "milestones_only" && e.milestoneTurn(state) {
		return fmt.Sprintf("MCP Miner milestone: %s reached. Space Bucks balance %d.", asString(e.asteroidFor(state)["display_name"]), asInt(state["space_bucks"]))
	}
	highlight := "scanner swept fresh veins"
	if asInt(asMap(turn["events"])["work_test_pass"]) > 0 {
		highlight = "lab alarms stayed polite"
	}
	order := e.orderSummary(state)
	return fmt.Sprintf("MCP Miner: +%d Chonks, %s, suit %d%%, %s.", asInt(turn["chonks"]), highlight, asInt(state["suit_condition"]), order)
}

func (e *Engine) DisplayReport(report string) string {
	icon := "![MCP Miner](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMyIgZmlsbD0iIzJmN2Q2ZCIvPjxjaXJjbGUgY3g9IjgiIGN5PSI4IiByPSI0IiBmaWxsPSIjZDVmNmRlIi8+PC9zdmc+)"
	if strings.HasPrefix(report, "MCP Miner Expedition Report") {
		return icon + "\n" + report
	}
	return icon + " " + report
}

func (e *Engine) RecordReport(state M, report, turnID string) {
	state["latest_report"] = M{"text": report, "turn_id": turnID, "created_at": nowISO()}
	stats := asMap(state["stats"])
	stats["reports_emitted"] = asInt(stats["reports_emitted"]) + 1
	state["stats"] = stats
	turn := asMap(state["current_turn"])
	if len(turn) > 0 {
		turn["report_emitted"] = true
		state["current_turn"] = turn
	}
}

func (e *Engine) concreteWorkTurn(turn M) bool {
	if asFloat(turn["score"]) >= MeaningfulScore {
		for _, event := range []string{"work_apply_patch", "work_test_pass", "work_test_fail", "work_review", "work_write_docs", "work_commit_or_pr", "work_fabrication_artifact"} {
			if asInt(asMap(turn["events"])[event]) > 0 {
				return true
			}
		}
	}
	return false
}

func (e *Engine) milestoneTurn(state M) bool {
	turn := asMap(state["current_turn"])
	progress := asMap(state["asteroid_progress"])
	mined := asInt(progress["mined"])
	return mined > 0 && mined%MilestoneInterval <= asInt(turn["chonks"]) && asInt(turn["chonks"]) > 0
}

func (e *Engine) orderSummary(state M) string {
	orders := asSlice(state["orders"])
	if len(orders) == 0 {
		return "orders waiting"
	}
	order := asMap(orders[0])
	required := asMap(order["required_materials"])
	if len(required) == 0 {
		return "orders waiting"
	}
	minPercent := 100
	for id, qty := range required {
		pct := 100
		if asInt(qty) > 0 {
			pct = int(math.Floor(float64(asInt(asMap(state["inventory"])[id])) / float64(asInt(qty)) * 100))
		}
		if pct < minPercent {
			minPercent = pct
		}
	}
	if minPercent > 100 {
		minPercent = 100
	}
	return fmt.Sprintf("order +%d%%, %d days left", minPercent, asInt(order["expires_in_days"]))
}

func (e *Engine) LatestReportPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	if report := asString(asMap(state["latest_report"])["text"]); report != "" {
		return M{"report": report, "source": "local_hook_state", "privacy": PrivacyNotice}
	}
	chonks := asInt(asMap(state["inventory"])["mat_chonks"])
	asteroid := e.asteroidSummary(asString(state["current_asteroid_class_id"]))
	return M{"report": fmt.Sprintf("MCP Miner: %d Chonks banked, %s selected, orders ready.", chonks, asString(asteroid["display_name"])), "source": "local_state", "privacy": PrivacyNotice}
}

func (e *Engine) PlayerStatus() M {
	state, _ := e.State()
	return M{
		"player":            M{"space_bucks": asInt(state["space_bucks"]), "report_mode": asString(state["report_mode"]), "cloud_sync": asBool(state["cloud_sync"]), "suit_condition": asInt(state["suit_condition"])},
		"profile":           asMap(e.ProfilePayload(state)["profile"]),
		"inventory":         asMap(state["inventory"]),
		"current_asteroid":  e.asteroidSummary(asString(state["current_asteroid_class_id"])),
		"asteroid_progress": asMap(state["asteroid_progress"]),
		"unlocked_machines": e.unlockedMachineNames(state),
		"upgrades":          asMap(state["upgrades"]),
		"base":              M{"modules": e.baseModuleStatuses(state), "effects": e.baseEffects(state), "drone_automation": e.droneAutomation(state)},
		"stats":             asMap(state["stats"]),
		"project_stats":     asMap(state["project_stats"]),
		"agent_stats":       asMap(state["agent_stats"]),
		"latest_report":     asString(e.LatestReportPayload(state)["report"]),
		"settings":          asMap(e.SettingsPayload(state)["settings"]),
		"sync":              asMap(e.SyncProgressPayload(state)["sync"]),
		"milestones":        asMap(e.MilestoneStatusPayload(state)["milestones"]),
		"privacy":           PrivacyNotice,
	}
}

func (e *Engine) unlockedMachineNames(state M) []any {
	out := []any{}
	for _, id := range strSlice(state["unlocked_machine_ids"]) {
		out = append(out, asString(e.Data.MachineByID[id]["display_name"]))
	}
	return out
}

func (e *Engine) ProfilePayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	return M{
		"profile":         asMap(state["profile"]),
		"avatar_workflow": M{"image_generation_required": false, "local_first": true, "generated_assets_supported": true},
		"privacy":         PrivacyNotice,
	}
}

func (e *Engine) UpdateProfilePayload(args M) M {
	result, _ := e.WithState(func(state M) (any, error) {
		profile := asMap(state["profile"])
		for _, field := range []string{"display_name", "miner_name", "pronouns", "suit_style", "avatar_concept_prompt"} {
			if v, ok := args[field]; ok {
				profile[field] = asString(v)
			}
		}
		if unlock := asString(args["add_customization_unlock"]); unlock != "" {
			profile["customization_unlocks"] = anySlice(uniqueAppend(strSlice(profile["customization_unlocks"]), unlock))
		}
		if ref := asString(args["generated_asset_ref"]); ref != "" {
			assets := asSlice(profile["generated_assets"])
			assets = append(assets, M{"asset_ref": ref, "created_at": nowISO()})
			profile["generated_assets"] = assets
		}
		state["profile"] = profile
		return M{"ok": true, "status": "updated", "profile": profile, "avatar_workflow": e.ProfilePayload(state)["avatar_workflow"], "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) InventoryPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	items := []any{}
	total := 0
	categories := M{}
	keys := []string{}
	for k := range asMap(state["inventory"]) {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, id := range keys {
		qty := asInt(asMap(state["inventory"])[id])
		if qty <= 0 {
			continue
		}
		info := e.materialPayload(id)
		info["quantity"] = qty
		items = append(items, info)
		total += qty
		cat := asString(info["category"])
		catMap := asMap(categories[cat])
		catMap["quantity"] = asInt(catMap["quantity"]) + qty
		catMap["value_space_bucks"] = asInt(catMap["value_space_bucks"]) + qty*asInt(info["space_bucks_each"])
		categories[cat] = catMap
	}
	return M{"inventory": M{"items": items, "total_units": total, "categories": categories}, "privacy": PrivacyNotice}
}

func (e *Engine) materialPayload(materialID string) M {
	refined := false
	baseID := materialID
	if strings.HasPrefix(materialID, "refined:") {
		refined = true
		baseID = strings.TrimPrefix(materialID, "refined:")
	}
	material := e.Data.MaterialByID[baseID]
	price := asInt(material["raw_space_bucks"])
	if refined && asInt(material["refined_space_bucks"]) > 0 {
		price = asInt(material["refined_space_bucks"])
	}
	name := asString(material["display_name"])
	if refined {
		name = "Refined " + name
	}
	return M{
		"material_id":      materialID,
		"base_material_id": baseID,
		"display_name":     name,
		"category":         asString(material["category"]),
		"rarity":           asString(material["rarity"]),
		"space_bucks_each": price,
		"can_refine":       asBool(material["can_refine"]),
		"refinement_state": map[bool]string{true: "refined", false: "raw"}[refined],
	}
}

func (e *Engine) SettingsPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	return M{
		"settings":     M{"report_mode": asString(state["report_mode"]), "cloud_sync": asBool(state["cloud_sync"]), "valid_report_modes": anySlice(validReportModes), "valid_cloud_auth_statuses": anySlice(validAuthStates), "privacy": PrivacyNotice},
		"sync":         asMap(e.SyncProgressPayload(state)["sync"]),
		"account_link": asMap(e.AccountLinkStatusPayload(state)["account_link"]),
		"privacy":      PrivacyNotice,
	}
}

func (e *Engine) UpdateSettings(args M) M {
	_, err := e.WithState(func(state M) (any, error) {
		if mode := asString(args["report_mode"]); mode != "" && hasString(validReportModes, mode) {
			state["report_mode"] = mode
		}
		if _, ok := args["cloud_sync"]; ok {
			state["cloud_sync"] = asBool(args["cloud_sync"])
			auth := asMap(state["cloud_auth"])
			if asBool(args["cloud_sync"]) && asString(auth["status"]) == "off" {
				auth["status"] = "unauthenticated"
			}
			if !asBool(args["cloud_sync"]) {
				auth["status"] = "off"
			}
			auth["updated_at"] = nowISO()
			state["cloud_auth"] = auth
		}
		return nil, nil
	})
	if err != nil {
		return M{"ok": false, "status": "state_update_failed", "message": sanitizeErrorMessage(err.Error(), M{}), "privacy": PrivacyNotice}
	}
	state, _ := e.State()
	return M{"ok": true, "settings": asMap(e.SettingsPayload(state)["settings"]), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "account_link": asMap(e.AccountLinkStatusPayload(state)["account_link"]), "privacy": PrivacyNotice}
}

func (e *Engine) CatalogSummary() M {
	return M{"materials": len(e.Data.Materials), "machines": len(e.Data.Machines), "recipes": len(e.Data.Recipes), "order_variants": len(e.Data.Variants), "buyers": len(e.Data.Buyers), "asteroid_classes": len(e.Data.Asteroids), "upgrades": len(e.Data.Upgrades), "hazards": len(e.Data.Hazards), "base_modules": len(e.Data.BaseModules), "privacy": PrivacyNotice}
}

func (e *Engine) ClaimMilestonePayload(_ M) M {
	state, _ := e.State()
	return M{"ok": false, "status": "disabled", "milestones": asMap(e.MilestoneStatusPayload(state)["milestones"]), "reason": "Milestone rewards are not defined in local MVP data yet.", "privacy": PrivacyNotice}
}

func (e *Engine) RewardControlsPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	events := M{}
	for _, event := range e.Data.WorkEvents {
		events[asString(event["id"])] = M{"category": asString(event["category"]), "base_score": asFloat(event["base_score"]), "cooldown_seconds": asInt(event["cooldown_seconds"]), "daily_soft_cap": asInt(event["daily_soft_cap"])}
	}
	diags := asSlice(asMap(state["reward_controls"])["diagnostics"])
	return M{"ok": true, "reward_controls": M{"policy": M{"events": events}, "recent_diagnostics": diags, "state": asMap(state["reward_controls"])}, "privacy": PrivacyNotice}
}

func (e *Engine) MilestoneStatusPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	progress := asMap(state["asteroid_progress"])
	mined := asInt(progress["mined"])
	nextTarget := ((mined / MilestoneInterval) + 1) * MilestoneInterval
	return M{"milestones": M{"progress": progress, "next_milestone": M{"target_mined": nextTarget}, "claim_status": "not_supported_in_local_mvp", "claimable": false}, "privacy": PrivacyNotice}
}

func (e *Engine) OpenDashboard() M {
	url := os.Getenv("MCP_MINER_DASHBOARD_URL")
	if url == "" {
		url = DefaultDashboardURL
	}
	return M{"dashboard_url": url, "status": "available", "available": true, "note": "Hosted dashboard is available for account linking, cloud sync, and portal views.", "privacy": PrivacyNotice}
}

func (e *Engine) OpenStore() M {
	url := os.Getenv("MCP_MINER_DASHBOARD_URL")
	if url == "" {
		url = DefaultDashboardURL
	}
	return M{"store_url": url + "#store", "status": "available", "available": true, "note": "Hosted store preview is available; local purchases continue through get_store_catalog and purchase_store_item.", "privacy": PrivacyNotice}
}

func (e *Engine) RefineMaterialPayload(args M) M {
	materialID := asString(args["material_id"])
	qty := asInt(args["quantity"])
	if qty <= 0 {
		return M{"ok": false, "status": "invalid_quantity", "quantity": qty, "privacy": PrivacyNotice}
	}
	material := e.Data.MaterialByID[materialID]
	if material == nil {
		return M{"ok": false, "status": "unknown_material", "material_id": materialID, "privacy": PrivacyNotice}
	}
	if !asBool(material["can_refine"]) {
		return M{"ok": false, "status": "not_refinable", "material_id": materialID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		inv := asMap(state["inventory"])
		available := asInt(inv[materialID])
		if available < qty {
			return M{"ok": false, "status": "insufficient_inventory", "material_id": materialID, "needed": qty, "available": available, "missing": qty - available, "privacy": PrivacyNotice}, nil
		}
		multiplier := e.upgradeEffectByID("upgrade_refinery_purity", asInt(asMap(state["upgrades"])["upgrade_refinery_purity"]))
		produced := int(math.Floor(float64(qty) * multiplier))
		if produced < qty {
			produced = qty
		}
		refinedID := "refined:" + materialID
		inv[materialID] = available - qty
		inv[refinedID] = asInt(inv[refinedID]) + produced
		return M{"ok": true, "status": "refined", "material_id": materialID, "quantity": qty, "produced": M{refinedID: produced}, "refinery_multiplier": round(multiplier, 2), "inventory": inv, "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) SellMaterialPayload(args M) M {
	materialID := asString(args["material_id"])
	qty := asInt(args["quantity"])
	if qty <= 0 {
		return M{"ok": false, "status": "invalid_quantity", "quantity": qty, "privacy": PrivacyNotice}
	}
	info := e.materialPayload(materialID)
	if asString(info["display_name"]) == "" {
		return M{"ok": false, "status": "unknown_material", "material_id": materialID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		inv := asMap(state["inventory"])
		available := asInt(inv[materialID])
		if available < qty {
			return M{"ok": false, "status": "insufficient_inventory", "material_id": materialID, "available": available, "needed": qty, "missing": qty - available, "privacy": PrivacyNotice}, nil
		}
		idx := asInt(state["market_sale_index"]) + 1
		state["market_sale_index"] = idx
		cfg := asMap(e.Data.Balance["direct_market"])
		min := asFloat(cfg["min_multiplier"])
		max := asFloat(cfg["max_multiplier"])
		if min <= 0 {
			min = 0.72
		}
		if max <= 0 {
			max = 0.92
		}
		mult := round(min+(max-min)*deterministicUnit(fmt.Sprintf("%s:%d", materialID, idx)), 2)
		each := asInt(info["space_bucks_each"])
		payout := int(math.Floor(float64(each*qty) * mult))
		if payout < 1 {
			payout = 1
		}
		inv[materialID] = available - qty
		state["space_bucks"] = asInt(state["space_bucks"]) + payout
		sale := M{"material_id": materialID, "quantity": qty, "space_bucks_each": each, "market_multiplier": mult, "payout_space_bucks": payout}
		tx := asSlice(state["market_transactions"])
		tx = append(tx, sale)
		state["market_transactions"] = tx
		return M{"ok": true, "status": "sold", "sale": sale, "direct_market": M{"min_multiplier": min, "max_multiplier": max}, "space_bucks": asInt(state["space_bucks"]), "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) AsteroidStatusPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	current := asString(e.asteroidFor(state)["id"])
	asteroids := []any{}
	for _, asteroid := range e.Data.Asteroids {
		asteroids = append(asteroids, e.asteroidStatusFor(asteroid, state))
	}
	return M{"current_asteroid": e.asteroidStatusFor(e.Data.AsteroidByID[current], state), "asteroids": asteroids, "rare_find_pity": M{"score": round(asFloat(state["rare_find_pity_score"]), 2), "config": asMap(e.Data.Balance["pity"])}, "recent_depletions": asSlice(state["asteroid_depletions"]), "recent_hazards": asSlice(state["hazard_log"]), "privacy": PrivacyNotice}
}

func (e *Engine) SelectAsteroidPayload(args M) M {
	asteroidID := asString(args["asteroid_id"])
	asteroid := e.Data.AsteroidByID[asteroidID]
	if asteroid == nil {
		return M{"ok": false, "status": "unknown_asteroid", "asteroid_id": asteroidID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		if !hasString(strSlice(state["unlocked_asteroid_class_ids"]), asteroidID) {
			return M{"ok": false, "status": "locked", "asteroid": e.asteroidSummary(asteroidID), "required_unlock_tier": asInt(asteroid["unlock_tier"]), "unlocked_asteroid_class_ids": state["unlocked_asteroid_class_ids"], "privacy": PrivacyNotice}, nil
		}
		currentProgress := asMap(state["asteroid_progress"])
		asMap(state["asteroid_progress_by_id"])[asString(currentProgress["asteroid_class_id"])] = M{"asteroid_class_id": asString(currentProgress["asteroid_class_id"]), "mined": asInt(currentProgress["mined"])}
		progress := asMap(asMap(state["asteroid_progress_by_id"])[asteroidID])
		if len(progress) == 0 {
			progress = M{"asteroid_class_id": asteroidID, "mined": 0}
		}
		state["current_asteroid_class_id"] = asteroidID
		state["asteroid_progress"] = clone(progress)
		return M{"ok": true, "status": "selected", "current_asteroid": e.asteroidStatusFor(asteroid, state), "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) asteroidStatusFor(asteroid M, state M) M {
	id := asString(asteroid["id"])
	progress := asMap(asMap(state["asteroid_progress_by_id"])[id])
	if asString(asMap(state["asteroid_progress"])["asteroid_class_id"]) == id {
		progress = asMap(state["asteroid_progress"])
	}
	depletionSize := asInt(asteroid["depletion_size"])
	mined := asInt(progress["mined"])
	if progress == nil || len(progress) == 0 {
		progress = M{"asteroid_class_id": id, "mined": 0}
	}
	return M{
		"asteroid_class_id": id,
		"display_name":      asString(asteroid["display_name"]),
		"unlock_tier":       asInt(asteroid["unlock_tier"]),
		"unlocked":          hasString(strSlice(state["unlocked_asteroid_class_ids"]), id),
		"selected":          asString(state["current_asteroid_class_id"]) == id,
		"depletion":         M{"mined": mined, "depletion_size": depletionSize, "remaining": maxInt(0, depletionSize-mined)},
		"composition":       asSlice(asteroid["composition"]),
		"base_rare_rate":    asFloat(asteroid["base_rare_rate"]),
		"rare_find_chance":  e.rareFindChance(state, asteroid, ""),
		"yield_multiplier":  asFloat(asteroid["yield_multiplier"]),
	}
}

func (e *Engine) rareFindChance(state M, asteroid M, eventType string) float64 {
	cfg := asMap(e.Data.Balance["pity"])
	chance := asFloat(asteroid["base_rare_rate"]) + mathMin(asFloat(state["rare_find_pity_score"]), asFloat(cfg["max_score"]))*asFloat(cfg["bonus_per_score"])
	if eventType == "work_search" {
		chance += 0.01
	}
	maxChance := asFloat(cfg["max_final_rare_chance"])
	if maxChance > 0 && chance > maxChance {
		chance = maxChance
	}
	return round(chance, 4)
}

func (e *Engine) asteroidSummary(id string) M {
	asteroid := e.Data.AsteroidByID[id]
	if asteroid == nil {
		return M{"asteroid_class_id": id, "display_name": id}
	}
	return M{"asteroid_class_id": id, "id": id, "display_name": asString(asteroid["display_name"]), "unlock_tier": asInt(asteroid["unlock_tier"]), "depletion_size": asInt(asteroid["depletion_size"])}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
