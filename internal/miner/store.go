package miner

import (
	"fmt"
	"math"
	"strings"
)

func (e *Engine) UpgradeStatusPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	items := []any{}
	for _, upgrade := range e.Data.Upgrades {
		items = append(items, e.upgradeStatus(upgrade, state))
	}
	return M{"upgrades": items, "privacy": PrivacyNotice}
}

func (e *Engine) upgradeStatus(upgrade M, state M) M {
	id := asString(upgrade["id"])
	level := asInt(asMap(state["upgrades"])[id])
	maxLevel := asInt(upgrade["max_level"])
	cost := e.upgradeNextCost(upgrade, level, state)
	missingMaterials := missingMaterials(asMap(cost["materials"]), asMap(state["inventory"]))
	missingSB := maxInt(0, asInt(cost["space_bucks"])-asInt(state["space_bucks"]))
	effect := e.upgradeEffect(upgrade, level)
	nextEffect := e.upgradeEffect(upgrade, level+1)
	return M{"upgrade_id": id, "display_name": asString(upgrade["display_name"]), "level": level, "max_level": maxLevel, "is_maxed": level >= maxLevel, "cost_to_next": cost, "missing_space_bucks": missingSB, "missing_materials": missingMaterials, "affordable": missingSB == 0 && len(missingMaterials) == 0 && level < maxLevel, "effect": effect, "next_effect": nextEffect, "effect_delta": round(asFloat(nextEffect["value"])-asFloat(effect["value"]), 2)}
}

func (e *Engine) upgradeNextCost(upgrade M, level int, state M) M {
	if level >= asInt(upgrade["max_level"]) {
		return M{"space_bucks": 0, "materials": M{}}
	}
	base := asInt(asMap(upgrade["cost"])["base_space_bucks"])
	growth := asFloat(asMap(upgrade["cost"])["growth_rate"])
	if growth <= 0 {
		growth = 1.18
	}
	raw := float64(base) * math.Pow(growth, float64(level)) * e.upgradePhaseMultiplier(level) * e.upgradeRarityPressure(upgrade, level)
	if state != nil {
		discount := math.Min(e.baseModuleEffectValue("upgrade_discount_percent", state), 0.5)
		raw *= (1 - discount)
	}
	spaceBucks := int(math.Ceil(niceRound(raw)))
	materials := M{}
	basket := asMap(upgrade["material_basket"])
	for _, item := range asSlice(basket["base_quantities"]) {
		m := asMap(item)
		materialID := asString(m["material_id"])
		materials[materialID] = e.upgradeMaterialQuantity(materialID, asInt(m["quantity"]), level)
	}
	for _, item := range asSlice(basket["gates"]) {
		gate := asMap(item)
		if level >= asInt(gate["min_level"]) {
			materialID := asString(gate["add_material_id"])
			materials[materialID] = e.upgradeMaterialQuantity(materialID, asInt(gate["base_quantity"]), level)
		}
	}
	return M{"space_bucks": spaceBucks, "materials": materials}
}

func niceRound(value float64) float64 {
	if value <= 0 {
		return 0
	}
	pow := math.Pow(10, math.Floor(math.Log10(value))-1)
	return math.Ceil(value/pow) * pow
}

func (e *Engine) upgradePhaseMultiplier(level int) float64 {
	config := asMap(e.Data.Balance["upgrade_phase"])
	interval := asInt(config["interval"])
	if interval <= 0 {
		interval = 10
	}
	multiplier := asFloat(config["multiplier_per_phase_squared"])
	if multiplier == 0 {
		multiplier = 0.08
	}
	phase := level / interval
	return 1.0 + multiplier*float64(phase*phase)
}

func (e *Engine) upgradeRarityPressure(upgrade M, level int) float64 {
	count := 0
	for _, item := range asSlice(asMap(upgrade["material_basket"])["gates"]) {
		gate := asMap(item)
		if level >= asInt(gate["min_level"]) && rareUpgradeMaterial(asString(asMap(e.Data.MaterialByID[asString(gate["add_material_id"])])["rarity"])) {
			count++
		}
	}
	return 1.0 + 0.04*float64(count)
}

func rareUpgradeMaterial(rarity string) bool {
	return rarity == "rare" || rarity == "dangerous" || rarity == "fictional_rare" || rarity == "legendary"
}

func (e *Engine) upgradeMaterialQuantity(materialID string, baseQuantity int, level int) int {
	material := e.Data.MaterialByID[materialID]
	scaled := float64(baseQuantity) * rarityMultiplier(asString(material["rarity"])) * math.Pow(1+float64(level)/10.0, 1.30) * e.upgradePhaseMultiplier(level)
	return int(math.Ceil(scaled))
}

func rarityMultiplier(rarity string) float64 {
	switch rarity {
	case "uncommon":
		return 1.6
	case "rare":
		return 2.4
	case "dangerous":
		return 2.8
	case "fictional_rare":
		return 3.2
	case "legendary":
		return 5.0
	default:
		return 1.0
	}
}

func (e *Engine) upgradeEffect(upgrade M, level int) M {
	return M{"type": asString(asMap(upgrade["effect"])["type"]), "target": asString(asMap(upgrade["effect"])["target"]), "value": round(e.upgradeEffectByID(asString(upgrade["id"]), level), 2), "formula": asString(asMap(upgrade["effect"])["formula"])}
}

func (e *Engine) upgradeEffectByID(id string, level int) float64 {
	L := float64(level)
	switch id {
	case "upgrade_drill_power":
		return 1 + 2.6*(1-math.Exp(-0.045*L)) + 0.05*math.Floor(L/10)
	case "upgrade_scanner_range":
		return 1 + 1.8*(1-math.Exp(-0.05*L))
	case "upgrade_scanner_precision":
		return 1 + 1.2*(1-math.Exp(-0.04*L))
	case "upgrade_suit_plating":
		return 0.72 * (1 - math.Exp(-0.045*L))
	case "upgrade_refinery_purity":
		return 1 + 1.6*(1-math.Exp(-0.04*L))
	case "upgrade_fabricator_throughput":
		return 1 + 1.4*(1-math.Exp(-0.045*L))
	case "upgrade_vault_storage":
		return 1 + 3.0*(1-math.Exp(-0.035*L))
	case "upgrade_drone_automation":
		return 1 + 0.06*L + 0.005*math.Pow(L, 1.35)
	default:
		if level == 0 {
			return 1
		}
		return 1 + float64(level)*0.05
	}
}

func (e *Engine) PurchaseUpgradePayload(args M) M {
	upgradeID := asString(args["upgrade_id"])
	upgrade := e.Data.UpgradeByID[upgradeID]
	if upgrade == nil {
		return M{"ok": false, "status": "unknown_upgrade", "upgrade_id": upgradeID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		status := e.upgradeStatus(upgrade, state)
		if asBool(status["is_maxed"]) {
			return M{"ok": false, "status": "max_level", "upgrade": status, "privacy": PrivacyNotice}, nil
		}
		missingSB := asInt(status["missing_space_bucks"])
		missingMat := asMap(status["missing_materials"])
		if missingSB > 0 || len(missingMat) > 0 {
			statusName := "insufficient_resources"
			if missingSB > 0 && len(missingMat) == 0 {
				statusName = "insufficient_space_bucks"
			}
			if missingSB == 0 && len(missingMat) > 0 {
				statusName = "insufficient_materials"
			}
			return M{"ok": false, "status": statusName, "upgrade_id": upgradeID, "missing_space_bucks": missingSB, "missing_materials": missingMat, "upgrade": status, "privacy": PrivacyNotice}, nil
		}
		cost := asMap(status["cost_to_next"])
		state["space_bucks"] = asInt(state["space_bucks"]) - asInt(cost["space_bucks"])
		for id, qty := range asMap(cost["materials"]) {
			asMap(state["inventory"])[id] = asInt(asMap(state["inventory"])[id]) - asInt(qty)
		}
		prev := asInt(asMap(state["upgrades"])[upgradeID])
		asMap(state["upgrades"])[upgradeID] = prev + 1
		next := e.upgradeStatus(upgrade, state)
		e.recordStoreTransaction(state, "upgrade", upgradeID, cost)
		return M{"ok": true, "status": "purchased", "upgrade_id": upgradeID, "previous_level": prev, "new_level": prev + 1, "spent": cost, "upgrade": next, "upgrades": state["upgrades"], "dashboard": e.storeDashboardSnapshot(state), "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) BaseStatusPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	return M{"modules": e.baseModuleStatuses(state), "effects": e.baseEffects(state), "drone_automation": e.droneAutomation(state), "privacy": PrivacyNotice}
}

func (e *Engine) baseModuleStatuses(state M) []any {
	out := []any{}
	for _, mod := range e.Data.BaseModules {
		out = append(out, e.baseModuleStatus(mod, state))
	}
	return out
}

func (e *Engine) baseModuleStatus(mod M, state M) M {
	id := asString(mod["id"])
	level := asInt(asMap(state["base_modules"])[id])
	maxLevel := asInt(mod["max_level"])
	cost := e.baseModuleNextCost(mod, level)
	missingSB := maxInt(0, asInt(cost["space_bucks"])-asInt(state["space_bucks"]))
	missingMat := missingMaterials(asMap(cost["materials"]), asMap(state["inventory"]))
	missingModules := []any{}
	for _, required := range strSlice(asMap(mod["unlock"])["required_modules"]) {
		if asInt(asMap(state["base_modules"])[required]) <= 0 {
			missingModules = append(missingModules, required)
		}
	}
	return M{"module_id": id, "display_name": asString(mod["display_name"]), "level": level, "max_level": maxLevel, "is_maxed": level >= maxLevel, "cost_to_next": cost, "missing_space_bucks": missingSB, "missing_materials": missingMat, "missing_required_modules": missingModules, "prerequisites_met": len(missingModules) == 0, "affordable": missingSB == 0 && len(missingMat) == 0 && len(missingModules) == 0 && level < maxLevel, "effects": e.baseModuleEffects(mod, level)}
}

func (e *Engine) baseModuleNextCost(mod M, level int) M {
	if level >= asInt(mod["max_level"]) {
		return M{"space_bucks": 0, "materials": M{}}
	}
	spaceBucks := asInt(asMap(mod["unlock"])["space_bucks"])
	if level > 0 {
		spaceBucks = int(math.Ceil(float64(spaceBucks) * math.Pow(1.6, float64(level))))
	}
	materials := M{}
	for _, item := range asSlice(mod["material_costs"]) {
		m := asMap(item)
		qty := asInt(m["base_quantity"])
		if level > 0 {
			qty *= (level + 1)
		}
		if qty > 0 {
			materials[asString(m["material_id"])] = qty
		}
	}
	return M{"space_bucks": spaceBucks, "materials": materials}
}

func (e *Engine) PurchaseBaseModulePayload(args M) M {
	moduleID := asString(args["module_id"])
	mod := e.Data.BaseModuleByID[moduleID]
	if mod == nil {
		return M{"ok": false, "status": "unknown_base_module", "module_id": moduleID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		status := e.baseModuleStatus(mod, state)
		if asBool(status["is_maxed"]) {
			return M{"ok": false, "status": "max_level", "module": status, "privacy": PrivacyNotice}, nil
		}
		if !asBool(status["prerequisites_met"]) {
			return M{"ok": false, "status": "missing_prerequisites", "missing_required_modules": status["missing_required_modules"], "module": status, "privacy": PrivacyNotice}, nil
		}
		missingSB := asInt(status["missing_space_bucks"])
		missingMat := asMap(status["missing_materials"])
		if missingSB > 0 || len(missingMat) > 0 {
			statusName := "insufficient_resources"
			if missingSB > 0 && len(missingMat) == 0 {
				statusName = "insufficient_space_bucks"
			}
			if missingSB == 0 && len(missingMat) > 0 {
				statusName = "insufficient_materials"
			}
			return M{"ok": false, "status": statusName, "missing_space_bucks": missingSB, "missing_materials": missingMat, "module": status, "privacy": PrivacyNotice}, nil
		}
		cost := asMap(status["cost_to_next"])
		state["space_bucks"] = asInt(state["space_bucks"]) - asInt(cost["space_bucks"])
		for id, qty := range asMap(cost["materials"]) {
			asMap(state["inventory"])[id] = asInt(asMap(state["inventory"])[id]) - asInt(qty)
		}
		prev := asInt(asMap(state["base_modules"])[moduleID])
		asMap(state["base_modules"])[moduleID] = prev + 1
		next := e.baseModuleStatus(mod, state)
		e.recordStoreTransaction(state, "base_module", moduleID, cost)
		return M{"ok": true, "status": "purchased", "module_id": moduleID, "previous_level": prev, "new_level": prev + 1, "spent": cost, "module": next, "effects": e.baseEffects(state), "dashboard": e.storeDashboardSnapshot(state), "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) baseModuleEffects(mod M, level int) []any {
	out := []any{}
	for _, effect := range asSlice(mod["effects"]) {
		target := asString(asMap(effect)["target"])
		out = append(out, M{"target": target, "value": e.baseEffectValue(target, level), "formula": asString(asMap(effect)["formula"])})
	}
	return out
}

func (e *Engine) baseEffects(state M) M {
	out := M{}
	for _, mod := range e.Data.BaseModules {
		level := asInt(asMap(state["base_modules"])[asString(mod["id"])])
		for _, effect := range e.baseModuleEffects(mod, level) {
			m := asMap(effect)
			out[asString(m["target"])] = asFloat(m["value"])
		}
	}
	return out
}

func (e *Engine) baseModuleEffectValue(target string, state M) float64 {
	return asFloat(e.baseEffects(state)[target])
}

func (e *Engine) baseEffectValue(target string, level int) float64 {
	L := float64(level)
	switch target {
	case "expedition_log_slots":
		return 1 + L
	case "upgrade_discount_percent":
		return 0.02 * L
	case "refining_queue_slots":
		return 1 + L
	case "fabrication_queue_slots":
		return 1 + L
	case "active_order_slots":
		return 3 + L
	case "weird_matter_quality_cap":
		return L
	default:
		return L
	}
}

func (e *Engine) droneAutomation(state M) M {
	value := e.upgradeEffectByID("upgrade_drone_automation", asInt(asMap(state["upgrades"])["upgrade_drone_automation"]))
	return M{"passive_support_multiplier": round(value, 2), "bounded": true, "privacy_class": "abstract"}
}

func (e *Engine) StoreCatalogPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	categories := M{
		"upgrades":     e.upgradeStoreItems(state),
		"machines":     e.machineStoreItems(state),
		"recipes":      e.recipeStoreItems(state),
		"base_modules": e.baseStoreItems(state),
		"cosmetics":    e.cosmeticStoreItems(state),
	}
	return M{"ok": true, "store": M{"currency": "Space Bucks", "real_money": false, "payment_integration": false, "space_bucks": asInt(state["space_bucks"]), "categories": categories, "summary": e.storeSummary(categories), "purchase_tool": "purchase_store_item"}, "privacy": PrivacyNotice}
}

func (e *Engine) PurchaseStoreItemPayload(args M) M {
	raw := asString(args["store_item_id"])
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 {
		return M{"ok": false, "status": "unknown_store_item", "store_item_id": raw, "privacy": PrivacyNotice}
	}
	var result M
	switch parts[0] {
	case "upgrade":
		result = e.PurchaseUpgradePayload(M{"upgrade_id": parts[1]})
	case "base_module":
		result = e.PurchaseBaseModulePayload(M{"module_id": parts[1]})
	case "machine":
		result = e.purchaseMachinePayload(parts[1])
	case "cosmetic":
		result = e.purchaseCosmeticPayload(parts[1])
	default:
		result = M{"ok": false, "status": "unknown_store_item", "store_item_id": raw, "privacy": PrivacyNotice}
	}
	result["store_item_id"] = raw
	state, _ := e.State()
	result["store"] = asMap(e.StoreCatalogPayload(state)["store"])
	result["dashboard"] = e.storeDashboardSnapshot(state)
	return result
}

func (e *Engine) purchaseMachinePayload(machineID string) M {
	machine := e.Data.MachineByID[machineID]
	if machine == nil {
		return M{"ok": false, "status": "unknown_machine", "machine_id": machineID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		if hasString(strSlice(state["unlocked_machine_ids"]), machineID) {
			return M{"ok": false, "status": "already_owned", "machine_id": machineID, "privacy": PrivacyNotice}, nil
		}
		status := e.machineStatus(machine, state)
		if len(asSlice(status["missing_required_base_modules"])) > 0 || len(asSlice(status["missing_required_upgrades"])) > 0 {
			return M{"ok": false, "status": "locked_prerequisites", "machine_id": machineID, "missing_required_base_modules": status["missing_required_base_modules"], "missing_required_upgrades": status["missing_required_upgrades"], "privacy": PrivacyNotice}, nil
		}
		cost := asMap(machine["unlock"])
		spaceBucks := asInt(cost["space_bucks"])
		if asInt(state["space_bucks"]) < spaceBucks {
			return M{"ok": false, "status": "insufficient_space_bucks", "missing_space_bucks": spaceBucks - asInt(state["space_bucks"]), "machine_id": machineID, "privacy": PrivacyNotice}, nil
		}
		state["space_bucks"] = asInt(state["space_bucks"]) - spaceBucks
		state["unlocked_machine_ids"] = anySlice(uniqueAppend(strSlice(state["unlocked_machine_ids"]), machineID))
		e.recordStoreTransaction(state, "machine", machineID, M{"space_bucks": spaceBucks, "materials": M{}})
		return M{"ok": true, "status": "purchased", "machine_id": machineID, "spent": M{"space_bucks": spaceBucks, "materials": M{}}, "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) purchaseCosmeticPayload(cosmeticID string) M {
	var cosmetic M
	for _, item := range storeCosmetics {
		if asString(item["id"]) == cosmeticID {
			cosmetic = item
		}
	}
	if cosmetic == nil {
		return M{"ok": false, "status": "unknown_cosmetic", "cosmetic_id": cosmeticID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		profile := asMap(state["profile"])
		unlock := asString(cosmetic["unlock_id"])
		if hasString(strSlice(profile["customization_unlocks"]), unlock) {
			return M{"ok": false, "status": "already_owned", "cosmetic_id": cosmeticID, "unlock_id": unlock, "privacy": PrivacyNotice}, nil
		}
		cost := asInt(cosmetic["space_bucks"])
		if asInt(state["space_bucks"]) < cost {
			return M{"ok": false, "status": "insufficient_space_bucks", "missing_space_bucks": cost - asInt(state["space_bucks"]), "cosmetic_id": cosmeticID, "privacy": PrivacyNotice}, nil
		}
		state["space_bucks"] = asInt(state["space_bucks"]) - cost
		profile["customization_unlocks"] = anySlice(uniqueAppend(strSlice(profile["customization_unlocks"]), unlock))
		state["profile"] = profile
		e.recordStoreTransaction(state, "cosmetic", cosmeticID, M{"space_bucks": cost, "materials": M{}})
		return M{"ok": true, "status": "purchased", "cosmetic_id": cosmeticID, "unlock_id": unlock, "profile": profile, "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) recordStoreTransaction(state M, kind, itemID string, cost M) {
	tx := asSlice(state["store_transactions"])
	tx = append(tx, M{"kind": kind, "item_id": itemID, "cost": cost, "created_at": nowISO()})
	state["store_transactions"] = tx
}

func (e *Engine) storeDashboardSnapshot(state M) M {
	return M{"space_bucks": asInt(state["space_bucks"]), "inventory": state["inventory"], "upgrades": state["upgrades"], "base_modules": state["base_modules"], "unlocked_machine_ids": state["unlocked_machine_ids"]}
}

func (e *Engine) upgradeStoreItems(state M) []any {
	out := []any{}
	for _, upgrade := range e.Data.Upgrades {
		status := e.upgradeStatus(upgrade, state)
		out = append(out, M{"store_item_id": "upgrade:" + asString(upgrade["id"]), "state": purchaseState(status), "upgrade": status, "cost": status["cost_to_next"]})
	}
	return out
}

func (e *Engine) baseStoreItems(state M) []any {
	out := []any{}
	for _, mod := range e.Data.BaseModules {
		status := e.baseModuleStatus(mod, state)
		out = append(out, M{"store_item_id": "base_module:" + asString(mod["id"]), "state": purchaseState(status), "module": status, "cost": status["cost_to_next"]})
	}
	return out
}

func (e *Engine) machineStoreItems(state M) []any {
	out := []any{}
	for _, machine := range e.Data.Machines {
		status := e.machineStatus(machine, state)
		stateName := "available"
		if asBool(status["unlocked"]) {
			stateName = "owned"
		} else if len(asSlice(status["missing_required_base_modules"])) > 0 || len(asSlice(status["missing_required_upgrades"])) > 0 {
			stateName = "locked"
		} else if asInt(state["space_bucks"]) < asInt(asMap(machine["unlock"])["space_bucks"]) {
			stateName = "unaffordable"
		}
		out = append(out, M{"store_item_id": "machine:" + asString(machine["id"]), "state": stateName, "machine": status, "cost": M{"space_bucks": asInt(asMap(machine["unlock"])["space_bucks"]), "materials": M{}}})
	}
	return out
}

func (e *Engine) recipeStoreItems(state M) []any {
	out := []any{}
	for _, recipe := range e.Data.Recipes {
		stateName := "available"
		if !hasString(strSlice(state["unlocked_machine_ids"]), asString(recipe["machine_id"])) {
			stateName = "locked"
		}
		out = append(out, M{"store_item_id": "recipe:" + asString(recipe["id"]), "state": stateName, "recipe_id": asString(recipe["id"]), "display_name": asString(recipe["display_name"])})
	}
	return out
}

func (e *Engine) cosmeticStoreItems(state M) []any {
	out := []any{}
	for _, cosmetic := range storeCosmetics {
		stateName := "available"
		if hasString(strSlice(asMap(state["profile"])["customization_unlocks"]), asString(cosmetic["unlock_id"])) {
			stateName = "owned"
		} else if asInt(state["space_bucks"]) < asInt(cosmetic["space_bucks"]) {
			stateName = "unaffordable"
		}
		out = append(out, M{"store_item_id": "cosmetic:" + asString(cosmetic["id"]), "state": stateName, "cosmetic": cosmetic, "cost": M{"space_bucks": asInt(cosmetic["space_bucks"]), "materials": M{}}, "real_money": false})
	}
	return out
}

func purchaseState(status M) string {
	if asBool(status["is_maxed"]) {
		return "maxed"
	}
	if !asBool(status["prerequisites_met"]) {
		return "locked"
	}
	if asBool(status["affordable"]) {
		return "affordable"
	}
	return "unaffordable"
}

func (e *Engine) storeSummary(categories M) M {
	counts := M{"affordable": 0, "unaffordable": 0, "locked": 0, "maxed": 0, "owned": 0, "available": 0}
	for _, list := range categories {
		for _, item := range asSlice(list) {
			state := asString(asMap(item)["state"])
			counts[state] = asInt(counts[state]) + 1
		}
	}
	return counts
}

func (e *Engine) baseEffectByTarget(state M, target string) float64 {
	return asFloat(e.baseEffects(state)[target])
}

func _unusedFmtGuard() {
	_ = fmt.Sprintf
}
