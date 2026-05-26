# MCP Miner Data Pack

This directory is the source of truth for MVP gameplay data. Implementation code should load these files and must not invent missing gameplay content.

Run validation:

```bash
npm run validate:data
```

Validated contents:

- `materials.yaml`: core resources, fictional materials, cryo/compound materials, gems, and all 118 elements with raw/refined Space Bucks prices.
- `fabrication_machines.yaml`: the 5 fabrication machines, unlock requirements, throughput, quality caps, and allowed material bands.
- `recipes.yaml`: 125 recipe bases. Combined with 4 order variants, this creates 500 fabricated product order types.
- `order_variants.yaml`: Standard Batch, Rush Batch, Premium Spec, and Collector Grade.
- `order_generator.yaml`: order slots, refresh cadence, quantities, deadlines, and 10% windfall payout rules.
- `asteroid_classes.yaml`: 7 asteroid classes with composition weights, yield, hazard, depletion, and rare-rate values.
- `upgrades.yaml`: 8 upgrade tracks with Space Bucks costs, effects, and material gates.
- `work_scoring.yaml`: abstract Codex work events and score weights.
- `hazards.yaml`: 5 hazards with triggers, effects, mitigation, and flavor.
- `base_modules.yaml`: starting base modules and unlockable base systems.
- `player_start.yaml`: starting inventory, unlocked machine, starting asteroid, upgrades, and report mode.
- `report_templates.yaml`: compact, full, no-progress, order-progress, and milestone report text.
- `subscription_plans.yaml`: Free, Pro Monthly, and Pro Annual pricing, provider price references, entitlements, copy, and downgrade behavior.
- `cosmetics.yaml`: portal/profile cosmetic categories, entitlement requirements, downgrade retention rules, and the no-progression-effect guarantee.

Implementation rule:

```text
If a required ID, formula, price, recipe, order, machine, material, asteroid, hazard, or starting value is missing, fail validation and report the missing value. Do not guess.
```
