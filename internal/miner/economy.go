package miner

import (
	"fmt"
	"math"
	"strings"
	"time"
)

func (e *Engine) ActiveOrdersPayload() M {
	state, _ := e.State()
	_ = e.ensureOrdersPersisted()
	state, _ = e.State()
	return M{"orders": orderPayloads(asSlice(state["orders"])), "active_order_slots": e.activeOrderSlots(state), "refresh_cadence_hours": asInt(e.Data.OrderGenerator["refresh_cadence_hours"]), "missed_order_penalty": asString(e.Data.OrderGenerator["missed_order_penalty"]), "refresh_due_at": refreshDueAt(state), "generated_at": asString(state["orders_generated_at"]), "privacy": PrivacyNotice}
}

func (e *Engine) ensureOrdersPersisted() error {
	_, err := e.WithState(func(state M) (any, error) {
		e.refreshOrders(state)
		return nil, nil
	})
	return err
}

func (e *Engine) refreshOrders(state M) {
	now := time.Now().UTC()
	orders := asSlice(state["orders"])
	filtered := []any{}
	for _, item := range orders {
		order := asMap(item)
		if expires, ok := parseTime(asString(order["expires_at"])); ok && expires.Before(now) {
			continue
		}
		filtered = append(filtered, order)
	}
	state["orders"] = filtered
	slots := e.activeOrderSlots(state)
	for len(asSlice(state["orders"])) < slots {
		slot := len(asSlice(state["orders"]))
		state["orders"] = append(asSlice(state["orders"]), e.generateOrder(state, slot, false))
	}
	state["orders_generated_at"] = now.Format(time.RFC3339)
}

func (e *Engine) activeOrderSlots(state M) int {
	base := asInt(e.Data.OrderGenerator["active_order_slots"])
	if base <= 0 {
		base = 3
	}
	if level := asInt(asMap(state["base_modules"])["base_order_terminal"]); level > 0 {
		base = 3 + level
	}
	return base
}

func refreshDueAt(state M) string {
	if t, ok := parseTime(asString(state["orders_generated_at"])); ok {
		return t.Add(24 * time.Hour).Format(time.RFC3339)
	}
	return time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)
}

func orderPayloads(items []any) []any {
	out := []any{}
	for _, item := range items {
		out = append(out, asMap(item))
	}
	return out
}

func (e *Engine) generateOrder(state M, slot int, weekly bool) M {
	idxKey := "order_generation_index"
	deadline := 3
	if weekly {
		idxKey = "weekly_contract_generation_index"
		deadline = 7
	}
	idx := asInt(state[idxKey]) + 1
	state[idxKey] = idx
	recipe := e.pickRecipe(state, idx)
	variant := e.Data.VariantByID["order_variant_standard_batch"]
	if variant == nil && len(e.Data.Variants) > 0 {
		variant = e.Data.Variants[0]
	}
	if weekly {
		recipe = e.pickWeeklyRecipe(state, idx)
		variant = e.pickWeeklyVariant(state, recipe, idx)
	}
	buyer := e.Data.Buyers[idx%len(e.Data.Buyers)]
	quantity := 1 + (idx % 2)
	required := e.requiredMaterials(recipe, variant, quantity)
	payout := e.orderPayout(required, recipe, variant, buyer, false, 1.0)
	created := time.Now().UTC()
	order := M{
		"slot":               slot,
		"status":             "active",
		"recipe_id":          asString(recipe["id"]),
		"product":            fmt.Sprintf("%s %s", asString(variant["display_name"]), asString(recipe["display_name"])),
		"variant_id":         asString(variant["id"]),
		"buyer_id":           asString(buyer["id"]),
		"buyer":              asString(buyer["display_name"]),
		"quantity":           quantity,
		"required_materials": required,
		"payout_space_bucks": payout,
		"price_multiplier":   1.0,
		"is_windfall":        false,
		"deadline_days":      deadline,
		"expires_in_days":    deadline,
		"created_at":         created.Format(time.RFC3339),
		"expires_at":         created.Add(time.Duration(deadline) * 24 * time.Hour).Format(time.RFC3339),
	}
	if weekly {
		order["contract_id"] = fmt.Sprintf("weekly_%d_%d_%s", slot, idx, shaHex(fmt.Sprint(idx))[:10])
		order["kind"] = "weekly_contract"
		order["missed_contract_penalty"] = "lost_opportunity_only"
	} else {
		order["order_id"] = fmt.Sprintf("order_%d_%d_%s", slot, idx, shaHex(fmt.Sprint(idx))[:10])
	}
	return order
}

func (e *Engine) pickRecipe(state M, idx int) M {
	unlocked := strSlice(state["unlocked_machine_ids"])
	for offset := 0; offset < len(e.Data.Recipes); offset++ {
		recipe := e.Data.Recipes[(idx+offset)%len(e.Data.Recipes)]
		if hasString(unlocked, asString(recipe["machine_id"])) {
			return recipe
		}
	}
	return e.Data.Recipes[0]
}

func (e *Engine) pickWeeklyRecipe(state M, idx int) M {
	unlocked := strSlice(state["unlocked_machine_ids"])
	candidates := []M{}
	for _, recipe := range e.Data.Recipes {
		if hasString(unlocked, asString(recipe["machine_id"])) && e.weeklyRecipeAccessible(recipe, state) {
			candidates = append(candidates, recipe)
		}
	}
	if len(candidates) == 0 {
		return e.pickRecipe(state, idx)
	}
	return candidates[idx%len(candidates)]
}

func (e *Engine) pickWeeklyVariant(state M, recipe M, idx int) M {
	candidates := []M{}
	for _, variant := range e.Data.Variants {
		if e.weeklyVariantAccessible(recipe, variant, state) {
			candidates = append(candidates, variant)
		}
	}
	if len(candidates) == 0 {
		return e.Data.Variants[0]
	}
	return candidates[idx%len(candidates)]
}

func (e *Engine) weeklyRecipeAccessible(recipe M, state M) bool {
	for _, item := range asSlice(recipe["inputs"]) {
		if !e.weeklyMaterialAccessible(asString(asMap(item)["material_id"]), state) {
			return false
		}
	}
	return true
}

func (e *Engine) weeklyVariantAccessible(recipe M, variant M, state M) bool {
	if asBool(variant["adds_refined_primary"]) && !e.weeklyMaterialAccessible(asString(recipe["primary_material_id"]), state) {
		return false
	}
	if asBool(variant["adds_collector_accent"]) && !e.weeklyMaterialAccessible(asString(asMap(recipe["collector_accent"])["material_id"]), state) {
		return false
	}
	return true
}

func (e *Engine) weeklyMaterialAccessible(materialID string, state M) bool {
	if materialID == "" {
		return false
	}
	if _, ok := asMap(state["inventory"])[materialID]; ok {
		return true
	}
	baseID := strings.TrimPrefix(materialID, "refined:")
	return hasString(e.accessibleMaterialIDs(state), baseID)
}

func (e *Engine) accessibleMaterialIDs(state M) []string {
	ids := []string{}
	for _, asteroidID := range strSlice(state["unlocked_asteroid_class_ids"]) {
		for _, item := range asSlice(asMap(e.Data.AsteroidByID[asteroidID])["composition"]) {
			ids = uniqueAppend(ids, asString(asMap(item)["material_id"]))
		}
	}
	for materialID := range asMap(state["inventory"]) {
		ids = uniqueAppend(ids, strings.TrimPrefix(materialID, "refined:"))
	}
	return ids
}

func (e *Engine) requiredMaterials(recipe M, variant M, quantity int) M {
	mult := asFloat(variant["material_multiplier"])
	if mult <= 0 {
		mult = 1
	}
	out := M{}
	for _, item := range asSlice(recipe["inputs"]) {
		in := asMap(item)
		qty := int(math.Ceil(float64(asInt(in["quantity"])*quantity) * mult))
		out[asString(in["material_id"])] = asInt(out[asString(in["material_id"])]) + qty
	}
	return out
}

func (e *Engine) orderPayout(required M, recipe M, variant M, buyer M, _ bool, multiplier float64) int {
	total := 0
	for id, qty := range required {
		material := e.Data.MaterialByID[id]
		price := asInt(material["raw_space_bucks"])
		if price <= 0 {
			price = 1
		}
		total += price * asInt(qty)
	}
	if total <= 0 {
		total = 10
	}
	premium := asFloat(variant["payout_multiplier"])
	if premium <= 0 {
		premium = 1.35
	}
	return int(math.Ceil(float64(total) * premium * multiplier))
}

func (e *Engine) FulfillOrderPayload(args M) M {
	orderID := asString(args["order_id"])
	result, _ := e.WithState(func(state M) (any, error) {
		e.refreshOrders(state)
		orders := asSlice(state["orders"])
		for i, item := range orders {
			order := asMap(item)
			if asString(order["order_id"]) != orderID {
				continue
			}
			if product := e.completedProductForOrder(order, state); product != nil {
				e.consumeCompletedProduct(state, product)
				return e.fulfillOrderAt(state, orders, i, order, asString(product["product_key"]), false), nil
			}
			missing := missingMaterials(asMap(order["required_materials"]), asMap(state["inventory"]))
			if len(missing) > 0 {
				return M{"ok": false, "status": "missing_materials", "order_id": orderID, "missing_materials": missing, "order": order, "privacy": PrivacyNotice}, nil
			}
			for id, qty := range asMap(order["required_materials"]) {
				asMap(state["inventory"])[id] = asInt(asMap(state["inventory"])[id]) - asInt(qty)
			}
			return e.fulfillOrderAt(state, orders, i, order, "", false), nil
		}
		return M{"ok": false, "status": "unknown_order", "order_id": orderID, "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) fulfillOrderAt(state M, orders []any, index int, order M, consumedProduct string, weekly bool) M {
	state["space_bucks"] = asInt(state["space_bucks"]) + asInt(order["payout_space_bucks"])
	order["status"] = "fulfilled"
	order["fulfilled_at"] = nowISO()
	if weekly {
		completed := asSlice(state["completed_weekly_contracts"])
		completed = append(completed, order)
		state["completed_weekly_contracts"] = completed
		replacement := e.generateOrder(state, asInt(order["slot"]), true)
		orders[index] = replacement
		state["weekly_contracts"] = orders
		resp := M{"ok": true, "status": "fulfilled", "contract": order, "replacement_contract": replacement, "space_bucks": asInt(state["space_bucks"]), "privacy": PrivacyNotice}
		if consumedProduct != "" {
			resp["consumed_product"] = consumedProduct
		}
		return resp
	}
	completed := asSlice(state["completed_orders"])
	completed = append(completed, order)
	state["completed_orders"] = completed
	replacement := e.generateOrder(state, asInt(order["slot"]), false)
	orders[index] = replacement
	state["orders"] = orders
	resp := M{"ok": true, "status": "fulfilled", "order": order, "replacement_order": replacement, "space_bucks": asInt(state["space_bucks"]), "privacy": PrivacyNotice}
	if consumedProduct != "" {
		resp["consumed_product"] = consumedProduct
	}
	return resp
}

func missingMaterials(required M, inventory M) M {
	missing := M{}
	for id, qty := range required {
		if asInt(inventory[id]) < asInt(qty) {
			missing[id] = asInt(qty) - asInt(inventory[id])
		}
	}
	return missing
}

func (e *Engine) WeeklyContractsPayload() M {
	_, _ = e.WithState(func(state M) (any, error) {
		e.refreshWeeklyContracts(state)
		return nil, nil
	})
	state, _ := e.State()
	return M{"contracts": orderPayloads(asSlice(state["weekly_contracts"])), "missed_contract_penalty": "lost_opportunity_only", "privacy": PrivacyNotice}
}

func (e *Engine) refreshWeeklyContracts(state M) {
	now := time.Now().UTC()
	contracts := []any{}
	for _, item := range asSlice(state["weekly_contracts"]) {
		contract := asMap(item)
		if expires, ok := parseTime(asString(contract["expires_at"])); ok && expires.Before(now) {
			continue
		}
		contracts = append(contracts, contract)
	}
	for len(contracts) < 1 {
		contracts = append(contracts, e.generateOrder(state, len(contracts), true))
	}
	state["weekly_contracts"] = contracts
}

func (e *Engine) CompleteWeeklyContractPayload(args M) M {
	contractID := asString(args["contract_id"])
	result, _ := e.WithState(func(state M) (any, error) {
		e.refreshWeeklyContracts(state)
		contracts := asSlice(state["weekly_contracts"])
		for i, item := range contracts {
			contract := asMap(item)
			if asString(contract["contract_id"]) != contractID {
				continue
			}
			if product := e.completedProductForOrder(contract, state); product != nil {
				e.consumeCompletedProduct(state, product)
				return e.fulfillOrderAt(state, contracts, i, contract, asString(product["product_key"]), true), nil
			}
			missing := missingMaterials(asMap(contract["required_materials"]), asMap(state["inventory"]))
			if len(missing) > 0 {
				return M{"ok": false, "status": "missing_materials", "contract_id": contractID, "missing_materials": missing, "contract": contract, "privacy": PrivacyNotice}, nil
			}
			for id, qty := range asMap(contract["required_materials"]) {
				asMap(state["inventory"])[id] = asInt(asMap(state["inventory"])[id]) - asInt(qty)
			}
			return e.fulfillOrderAt(state, contracts, i, contract, "", true), nil
		}
		return M{"ok": false, "status": "unknown_contract", "contract_id": contractID, "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) FabricationStatusPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	machines := []any{}
	for _, machine := range e.Data.Machines {
		machines = append(machines, e.machineStatus(machine, state))
	}
	return M{"machines": machines, "queue": asSlice(state["fabrication_queue"]), "completed_products": asSlice(state["completed_products"]), "throughput_multiplier": e.upgradeEffectByID("upgrade_fabricator_throughput", asInt(asMap(state["upgrades"])["upgrade_fabricator_throughput"])), "privacy": PrivacyNotice}
}

func (e *Engine) QueueFabricationPayload(args M) M {
	recipeID := asString(args["recipe_id"])
	variantID := asString(args["variant_id"])
	qty := asInt(args["quantity"])
	if qty <= 0 {
		qty = 1
	}
	recipe := e.Data.RecipeByID[recipeID]
	variant := e.Data.VariantByID[variantID]
	if recipe == nil {
		return M{"ok": false, "status": "unknown_recipe", "recipe_id": recipeID, "privacy": PrivacyNotice}
	}
	if variant == nil {
		return M{"ok": false, "status": "unknown_variant", "variant_id": variantID, "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		machine := e.Data.MachineByID[asString(recipe["machine_id"])]
		mStatus := e.machineStatus(machine, state)
		if !asBool(mStatus["unlocked"]) {
			return M{"ok": false, "status": "machine_locked", "machine": mStatus, "privacy": PrivacyNotice}, nil
		}
		if asInt(variant["quality_grade_required"]) > asInt(asMap(machine["quality"])["max_quality_grade"]) {
			return M{"ok": false, "status": "quality_exceeds_machine", "machine": mStatus, "variant": variant, "privacy": PrivacyNotice}, nil
		}
		required := e.requiredMaterials(recipe, variant, qty)
		missing := missingMaterials(required, asMap(state["inventory"]))
		if len(missing) > 0 {
			return M{"ok": false, "status": "missing_materials", "missing_materials": missing, "required_materials": required, "privacy": PrivacyNotice}, nil
		}
		for id, q := range required {
			asMap(state["inventory"])[id] = asInt(asMap(state["inventory"])[id]) - asInt(q)
		}
		seq := asInt(state["fabrication_sequence"]) + 1
		state["fabrication_sequence"] = seq
		item := M{"fabrication_id": fmt.Sprintf("fab_%d_%s", seq, shaHex(fmt.Sprint(seq))[:10]), "recipe_id": recipeID, "variant_id": variantID, "machine_id": asString(machine["id"]), "quantity": qty, "quality_grade": asInt(variant["quality_grade_required"]), "progress": 0, "progress_required": asInt(asMap(machine["throughput"])["base_progress_per_turn"]), "required_materials": required, "queued_at": nowISO()}
		queue := asSlice(state["fabrication_queue"])
		queue = append(queue, item)
		state["fabrication_queue"] = queue
		return M{"ok": true, "status": "queued", "item": item, "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) machineStatus(machine M, state M) M {
	id := asString(machine["id"])
	unlocked := hasString(strSlice(state["unlocked_machine_ids"]), id)
	missingModules := []any{}
	for _, moduleID := range strSlice(asMap(machine["unlock"])["required_base_modules"]) {
		if asInt(asMap(state["base_modules"])[moduleID]) <= 0 {
			missingModules = append(missingModules, moduleID)
		}
	}
	missingUpgrades := []any{}
	for _, item := range asSlice(asMap(machine["unlock"])["required_upgrades"]) {
		for upID, minLevel := range asMap(item) {
			if asInt(asMap(state["upgrades"])[upID]) < asInt(minLevel) {
				missingUpgrades = append(missingUpgrades, M{"upgrade_id": upID, "required_level": asInt(minLevel), "current_level": asInt(asMap(state["upgrades"])[upID])})
			}
		}
	}
	return M{"machine_id": id, "display_name": asString(machine["display_name"]), "unlocked": unlocked, "progression_tier": asInt(machine["progression_tier"]), "unlock": asMap(machine["unlock"]), "throughput": asMap(machine["throughput"]), "quality": asMap(machine["quality"]), "missing_required_base_modules": missingModules, "missing_required_upgrades": missingUpgrades}
}

func (e *Engine) advanceFabrication(state M, eventType string, score float64, timestamp string) {
	queue := asSlice(state["fabrication_queue"])
	if len(queue) == 0 {
		return
	}
	mult := 1.0
	if eventType == "work_fabrication_artifact" {
		mult = 4.0
	}
	remaining := []any{}
	completed := asSlice(state["completed_products"])
	for _, item := range queue {
		job := asMap(item)
		job["progress"] = asInt(job["progress"]) + int(score*mult)
		if asInt(job["progress"]) >= asInt(job["progress_required"]) {
			key := productKey(asString(job["recipe_id"]), asString(job["variant_id"]), asInt(job["quality_grade"]))
			found := false
			for _, existing := range completed {
				product := asMap(existing)
				if asString(product["product_key"]) == key {
					product["quantity"] = asInt(product["quantity"]) + asInt(job["quantity"])
					product["completed_at"] = timestamp
					found = true
				}
			}
			if !found {
				completed = append(completed, M{"product_key": key, "recipe_id": asString(job["recipe_id"]), "variant_id": asString(job["variant_id"]), "product": productName(e.Data.RecipeByID[asString(job["recipe_id"])], e.Data.VariantByID[asString(job["variant_id"])]), "quality_grade": asInt(job["quality_grade"]), "quantity": asInt(job["quantity"]), "completed_at": timestamp})
			}
		} else {
			remaining = append(remaining, job)
		}
	}
	state["fabrication_queue"] = remaining
	state["completed_products"] = completed
}

func productKey(recipeID, variantID string, quality int) string {
	return fmt.Sprintf("product:%s:%s:q%d", recipeID, variantID, quality)
}

func productName(recipe M, variant M) string {
	return fmt.Sprintf("%s %s", asString(variant["display_name"]), asString(recipe["display_name"]))
}

func (e *Engine) completedProductForOrder(order M, state M) M {
	key := productKey(asString(order["recipe_id"]), asString(order["variant_id"]), 0)
	for _, item := range asSlice(state["completed_products"]) {
		product := asMap(item)
		if asString(product["product_key"]) == key && asInt(product["quantity"]) > 0 {
			return product
		}
	}
	return nil
}

func (e *Engine) consumeCompletedProduct(state M, target M) {
	products := []any{}
	for _, item := range asSlice(state["completed_products"]) {
		product := asMap(item)
		if asString(product["product_key"]) == asString(target["product_key"]) {
			product["quantity"] = asInt(product["quantity"]) - 1
		}
		if asInt(product["quantity"]) > 0 {
			products = append(products, product)
		}
	}
	state["completed_products"] = products
}
