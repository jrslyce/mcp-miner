package miner

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Data struct {
	Materials      []M
	Machines       []M
	Recipes        []M
	Variants       []M
	Buyers         []M
	Asteroids      []M
	Upgrades       []M
	Hazards        []M
	BaseModules    []M
	WorkEvents     []M
	PlayerStart    M
	Balance        M
	Reports        M
	OrderGenerator M

	MaterialByID   map[string]M
	MachineByID    map[string]M
	RecipeByID     map[string]M
	VariantByID    map[string]M
	BuyerByID      map[string]M
	AsteroidByID   map[string]M
	UpgradeByID    map[string]M
	HazardByID     map[string]M
	BaseModuleByID map[string]M
	WorkEventByID  map[string]M
}

func loadData(root string) (*Data, error) {
	d := &Data{
		MaterialByID:   map[string]M{},
		MachineByID:    map[string]M{},
		RecipeByID:     map[string]M{},
		VariantByID:    map[string]M{},
		BuyerByID:      map[string]M{},
		AsteroidByID:   map[string]M{},
		UpgradeByID:    map[string]M{},
		HazardByID:     map[string]M{},
		BaseModuleByID: map[string]M{},
		WorkEventByID:  map[string]M{},
	}
	load := func(file, key string) (any, error) {
		raw, err := os.ReadFile(filepath.Join(root, "data", file))
		if err != nil {
			return nil, err
		}
		var parsed map[string]any
		if err := yaml.Unmarshal(raw, &parsed); err != nil {
			return nil, fmt.Errorf("%s: %w", file, err)
		}
		return normalizeYAML(parsed[key]), nil
	}
	list := func(file, key string) ([]M, error) {
		v, err := load(file, key)
		if err != nil {
			return nil, err
		}
		out := []M{}
		for _, item := range asSlice(v) {
			out = append(out, asMap(item))
		}
		return out, nil
	}
	var err error
	if d.Materials, err = list("materials.yaml", "materials"); err != nil {
		return nil, err
	}
	if d.Machines, err = list("fabrication_machines.yaml", "machines"); err != nil {
		return nil, err
	}
	if d.Recipes, err = list("recipes.yaml", "recipes"); err != nil {
		return nil, err
	}
	if d.Variants, err = list("order_variants.yaml", "order_variants"); err != nil {
		return nil, err
	}
	if d.Buyers, err = list("buyers.yaml", "buyers"); err != nil {
		return nil, err
	}
	if d.Asteroids, err = list("asteroid_classes.yaml", "asteroid_classes"); err != nil {
		return nil, err
	}
	if d.Upgrades, err = list("upgrades.yaml", "upgrades"); err != nil {
		return nil, err
	}
	if d.Hazards, err = list("hazards.yaml", "hazards"); err != nil {
		return nil, err
	}
	if d.BaseModules, err = list("base_modules.yaml", "base_modules"); err != nil {
		return nil, err
	}
	if d.WorkEvents, err = list("work_scoring.yaml", "work_events"); err != nil {
		return nil, err
	}
	if v, err := load("player_start.yaml", "player_start"); err != nil {
		return nil, err
	} else {
		d.PlayerStart = asMap(v)
	}
	if v, err := load("balance_constants.yaml", "balance"); err != nil {
		return nil, err
	} else {
		d.Balance = asMap(v)
	}
	if v, err := load("report_templates.yaml", "report_templates"); err != nil {
		return nil, err
	} else {
		d.Reports = asMap(v)
	}
	if v, err := load("order_generator.yaml", "order_generation"); err != nil {
		return nil, err
	} else {
		d.OrderGenerator = asMap(v)
	}
	for _, item := range d.Materials {
		d.MaterialByID[asString(item["id"])] = item
	}
	for _, item := range d.Machines {
		d.MachineByID[asString(item["id"])] = item
	}
	for _, item := range d.Recipes {
		d.RecipeByID[asString(item["id"])] = item
	}
	for _, item := range d.Variants {
		d.VariantByID[asString(item["id"])] = item
	}
	for _, item := range d.Buyers {
		d.BuyerByID[asString(item["id"])] = item
	}
	for _, item := range d.Asteroids {
		d.AsteroidByID[asString(item["id"])] = item
	}
	for _, item := range d.Upgrades {
		d.UpgradeByID[asString(item["id"])] = item
	}
	for _, item := range d.Hazards {
		d.HazardByID[asString(item["id"])] = item
	}
	for _, item := range d.BaseModules {
		d.BaseModuleByID[asString(item["id"])] = item
	}
	for _, item := range d.WorkEvents {
		d.WorkEventByID[asString(item["id"])] = item
	}
	return d, nil
}
