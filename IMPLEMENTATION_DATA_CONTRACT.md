# MCP Miner Implementation Data Contract

## Purpose

This document defines the gameplay data that must exist before implementation. Its job is to prevent an engineer agent from inventing missing content, formulas, IDs, or balance values while building MCP Miner.

The Game Design Document explains the product. This contract explains the required data source of truth.

## Non-Negotiable Rules

1. Do not invent gameplay data in code.
2. Do not silently create fallback materials, recipes, machines, upgrades, asteroid classes, buyers, hazards, or orders.
3. Load all tunable gameplay data from versioned data files.
4. Validate all data before the plugin, local game engine, or backend starts.
5. If a required value is missing, fail loudly with the missing file, path, and ID.
6. Code may implement formulas, parsers, validators, and generators. Code may not hardcode content tables except test fixtures.
7. Every gameplay object must have a stable canonical ID.
8. Random generation must be seedable and reproducible for testing.
9. Cloud sync may store computed state, but source gameplay definitions must remain in data files.
10. If the data contract and implementation disagree, the implementation is wrong.

## Required Data Directory

```text
data/
  schema_version.yaml
  ids.yaml
  rarity_tiers.yaml
  materials.yaml
  material_aliases.yaml
  fabrication_machines.yaml
  recipes.yaml
  order_variants.yaml
  order_generator.yaml
  buyers.yaml
  asteroid_classes.yaml
  upgrades.yaml
  work_scoring.yaml
  hazards.yaml
  base_modules.yaml
  player_start.yaml
  report_templates.yaml
  balance_constants.yaml
```

Optional but recommended once the web dashboard exists:

```text
data/ui_copy.yaml
data/tutorial.yaml
data/guilds.yaml
data/achievements.yaml
```

## ID Conventions

IDs are lower snake case with a type prefix.

| Object | Prefix | Example |
| --- | --- | --- |
| Material | `mat_` | `mat_iron` |
| Element | `mat_element_` | `mat_element_fe` |
| Fictional material | `mat_fictional_` | `mat_fictional_sparkglass` |
| Machine | `machine_` | `machine_basic_3d_printer` |
| Recipe | `recipe_` | `recipe_hull_patch_clips` |
| Order variant | `order_variant_` | `order_variant_rush_batch` |
| Buyer | `buyer_` | `buyer_panic_budget` |
| Asteroid class | `asteroid_` | `asteroid_starter_rubble` |
| Upgrade track | `upgrade_` | `upgrade_drill_power` |
| Hazard | `hazard_` | `hazard_micro_meteor_shove` |
| Base module | `base_` | `base_fabrication_bay` |
| Stat | `stat_` | `stat_chonks_mined` |
| Work event | `work_` | `work_apply_patch` |

IDs must never be renamed after release. If display names change, IDs stay fixed.

## Data File Schemas

### `schema_version.yaml`

```yaml
schema_version: 1
game_version: "0.1.0"
data_revision: 1
```

Required validation:

- `schema_version` is an integer.
- `game_version` is semver.
- `data_revision` increments on gameplay data changes.

### `rarity_tiers.yaml`

```yaml
rarities:
  common:
    display_name: Common
    value_multiplier: 1.0
    drop_weight_multiplier: 1.0
  uncommon:
    display_name: Uncommon
    value_multiplier: 1.6
    drop_weight_multiplier: 0.55
  rare:
    display_name: Rare
    value_multiplier: 2.4
    drop_weight_multiplier: 0.22
  dangerous:
    display_name: Dangerous
    value_multiplier: 2.8
    drop_weight_multiplier: 0.12
  fictional_rare:
    display_name: Fictional Rare
    value_multiplier: 3.2
    drop_weight_multiplier: 0.08
  legendary:
    display_name: Legendary
    value_multiplier: 5.0
    drop_weight_multiplier: 0.02
```

Required validation:

- Every material references a known rarity.
- Multipliers are positive.

### `materials.yaml`

Every raw/refined material must be defined here, including all 118 elements, fictional materials, Chonks, scrap, ore, circuits, and fuel cells.

```yaml
materials:
  - id: mat_chonks
    display_name: Chonks
    category: mined
    rarity: common
    state_group: solid_core
    raw_space_bucks: 1
    refined_space_bucks: null
    can_refine: false
    unlock_tier: 1

  - id: mat_element_fe
    symbol: Fe
    atomic_number: 26
    display_name: Iron
    category: element
    rarity: common
    state_group: solid_core
    raw_space_bucks: 5
    refined_space_bucks: 8
    can_refine: true
    unlock_tier: 1

  - id: mat_fictional_sparkglass
    display_name: Sparkglass
    category: fictional
    rarity: uncommon
    state_group: fictional
    raw_space_bucks: 55
    refined_space_bucks: 86
    can_refine: true
    unlock_tier: 2
```

Required fields:

- `id`
- `display_name`
- `category`
- `rarity`
- `state_group`
- `raw_space_bucks`
- `can_refine`
- `unlock_tier`

Required validation:

- All material IDs are unique.
- All atomic numbers are unique for element materials.
- Element symbols are unique for element materials.
- `raw_space_bucks > 0`.
- If `can_refine: true`, `refined_space_bucks > raw_space_bucks`.
- If `can_refine: false`, `refined_space_bucks` must be null.
- All materials referenced anywhere else must exist here.

### `material_aliases.yaml`

Aliases map recipe-friendly names or cryo/compound materials back to canonical materials for pricing.

```yaml
aliases:
  hydrogen_ice:
    display_name: Hydrogen Ice
    material_id: mat_element_h
    state_group_override: cryo_volatile
    price_multiplier: 1.0

  chlorine_salts:
    display_name: Chlorine Salts
    material_id: mat_element_cl
    state_group_override: compound
    price_multiplier: 1.15
```

Required validation:

- Alias keys are unique.
- `material_id` exists in `materials.yaml`.
- `price_multiplier > 0`.

### `fabrication_machines.yaml`

```yaml
machines:
  - id: machine_basic_3d_printer
    display_name: Basic 3D Printer
    progression_tier: 1
    starts_unlocked: true
    unlock:
      space_bucks: 0
      required_base_modules: []
      required_upgrades: []
    throughput:
      base_progress_per_turn: 10
      max_queue_size: 2
    quality:
      max_quality_grade: 1
    allowed_material_bands:
      - mat_chonks
      - mat_element_c
      - mat_element_fe
      - mat_element_ni
      - mat_element_si
      - mat_element_al
      - mat_element_mg
      - mat_element_na
      - mat_element_k
      - mat_element_ca
      - mat_gem_quartz
```

Required validation:

- Machine IDs are unique.
- Unlock references exist.
- `progression_tier >= 1`.
- `base_progress_per_turn > 0`.
- Every `allowed_material_bands` entry exists.

### `recipes.yaml`

Every product base from the GDD must be encoded here.

```yaml
recipes:
  - id: recipe_hull_patch_clips
    display_name: Hull Patch Clips
    machine_id: machine_basic_3d_printer
    progression_tier: 1
    output_quantity: 1
    base_craft_progress: 20
    quality_allowed: true
    primary_material_id: mat_element_fe
    inputs:
      - material_id: mat_chonks
        quantity: 18
      - material_id: mat_element_fe
        quantity: 6
      - material_id: mat_element_ni
        quantity: 2
    collector_accent:
      material_id: mat_gem_quartz
      quantity: 1
```

Required validation:

- Recipe IDs are unique.
- `machine_id` exists.
- `primary_material_id` exists and appears in `inputs`, unless explicitly marked `derived_primary: true`.
- All input material IDs exist.
- Quantities are positive integers.
- All input materials are allowed by the machine tier or material band.
- `collector_accent.material_id` exists and is allowed by the machine tier.
- `base_craft_progress > 0`.
- No recipe has an empty input list.

### `order_variants.yaml`

```yaml
order_variants:
  - id: order_variant_standard_batch
    display_name: Standard Batch
    recipe_quantity_multiplier: 1.0
    payout_multiplier: 1.0
    quality_grade_required: 0
    adds_refined_primary: false
    adds_collector_accent: false
    deadline_multiplier: 1.0

  - id: order_variant_premium_spec
    display_name: Premium Spec
    recipe_quantity_multiplier: 1.25
    payout_multiplier: 1.35
    quality_grade_required: 1
    adds_refined_primary: true
    refined_primary_quantity: 1
    adds_collector_accent: false
    deadline_multiplier: 1.0
```

Required validation:

- Variant IDs are unique.
- Multipliers are positive.
- `quality_grade_required >= 0`.
- If `adds_refined_primary: true`, `refined_primary_quantity > 0`.

### `order_generator.yaml`

```yaml
order_generation:
  active_order_slots: 3
  refresh_cadence_hours: 24
  manual_accept: true
  missed_order_penalty: lost_opportunity_only
  direct_market_sales_enabled: true
  quantity_by_tier:
    1:
      min: 1
      max: 3
    2:
      min: 1
      max: 4
    3:
      min: 1
      max: 5
    4:
      min: 1
      max: 6
    5:
      min: 1
      max: 8
  deadline_days_by_tier:
    1:
      min: 1
      max: 4
    5:
      min: 2
      max: 10
  windfall:
    chance: 0.10
    min_multiplier: 2.25
    max_multiplier: 4.00
  normal_price_variation:
    distribution: triangular
    min: 0.85
    mode: 1.00
    max: 1.18
```

Required validation:

- Slot count is positive.
- Windfall chance is between `0` and `1`.
- Windfall minimum is greater than normal maximum.
- Quantity and deadline ranges are valid.

### `buyers.yaml`

```yaml
buyers:
  - id: buyer_patchy_freighter_union
    display_name: Patchy Freighter Union
    unlock_tier: 1
    reputation_multiplier: 1.0
    preferred_machine_ids:
      - machine_basic_3d_printer
      - machine_microforge
    preferred_material_ids:
      - mat_element_fe
      - mat_element_ni
    flavor_tags:
      - practical
      - repairs
```

Required validation:

- Buyer IDs are unique.
- Preferred machines and materials exist.
- `reputation_multiplier > 0`.

### `asteroid_classes.yaml`

```yaml
asteroid_classes:
  - id: asteroid_starter_rubble
    display_name: Starter Rubble
    unlock_tier: 1
    depletion_size: 1000
    yield_multiplier: 1.0
    hazard_multiplier: 0.8
    base_rare_rate: 0.02
    composition:
      - material_id: mat_chonks
        weight: 0.38
      - material_id: mat_element_fe
        weight: 0.18
      - material_id: mat_element_ni
        weight: 0.13
      - material_id: mat_element_si
        weight: 0.10
      - material_id: mat_element_c
        weight: 0.09
      - material_id: mat_scrap
        weight: 0.08
      - material_id: mat_gem_quartz
        weight: 0.03
      - material_id: mat_fictional_sparkglass
        weight: 0.01
```

Required validation:

- Asteroid class IDs are unique.
- Composition materials exist.
- Composition weights are positive.
- Sum of weights is greater than zero.
- `depletion_size > 0`.
- `base_rare_rate` is between `0` and `1`.
- Materials in the composition must be accessible at or below the asteroid unlock tier unless explicitly marked as rare outliers.

### `upgrades.yaml`

```yaml
upgrades:
  - id: upgrade_drill_power
    display_name: Drill Power
    max_level: 50
    cost:
      base_space_bucks: 120
      growth_rate: 1.19
      phase_formula: phase_multiplier
      rarity_pressure_formula: rarity_pressure
    effect:
      type: multiplier
      target: chonk_output
      formula: "1 + 2.6*(1-e^(-0.045L)) + 0.05*floor(L/10)"
    material_basket:
      base_quantities:
        - material_id: mat_element_fe
          quantity: 4
        - material_id: mat_element_ni
          quantity: 2
      gates:
        - min_level: 5
          add_material_id: mat_element_ti
          base_quantity: 1
        - min_level: 20
          add_material_id: mat_element_w
          base_quantity: 1
```

Required validation:

- Upgrade IDs are unique.
- `max_level > 0`.
- Cost formulas are known formula IDs.
- Effect target is a known stat or system.
- Material IDs exist.
- Gate levels are within max level.

### `work_scoring.yaml`

This file defines how Codex activity becomes work energy. It is one of the most important anti-hallucination files.

```yaml
work_events:
  - id: work_session_start
    category: research
    base_score: 2
    cooldown_seconds: 1800
    daily_soft_cap: 6

  - id: work_file_read
    category: research
    base_score: 1
    cooldown_seconds: 5
    daily_soft_cap: 120

  - id: work_apply_patch
    category: coding
    base_score: 8
    min_changed_lines: 1
    score_per_changed_line: 0.12
    max_score_per_event: 30

  - id: work_test_pass
    category: testing
    base_score: 12
    verification_bonus: 1.2

  - id: work_test_fail
    category: testing
    base_score: 4
    hazard_weight: 1.0
```

Required validation:

- Work event IDs are unique.
- Categories are one of `research`, `coding`, `testing`, `review`, `writing`, `shipping`, `fabrication`.
- Scores are non-negative.
- Caps and cooldowns are non-negative.

Missing design data:

- Exact Codex hook event names and mappings must be defined before implementation.
- If Codex cannot observe a proposed event, remove it or mark it as future.

### `hazards.yaml`

```yaml
hazards:
  - id: hazard_micro_meteor_shove
    display_name: Micro-Meteor Shove
    trigger:
      source: failed_commands
      base_chance: 0.05
    effects:
      suit_damage:
        min: 2
        max: 8
      resource_loss:
        material_id: mat_chonks
        percent_min: 0.01
        percent_max: 0.04
    mitigated_by:
      upgrade_id: upgrade_suit_plating
      mitigation_formula: suit_damage_reduction
    flavor:
      - "A tiny rock voted against your trajectory."
```

Required validation:

- Hazard IDs are unique.
- Trigger sources are known.
- Effects reference known materials, stats, or systems.
- Chance values are between `0` and `1`.
- Damage and loss ranges are valid.

### `base_modules.yaml`

```yaml
base_modules:
  - id: base_order_terminal
    display_name: Order Terminal
    max_level: 5
    unlock:
      space_bucks: 250
      required_modules:
        - base_command_center
    effects:
      - target: active_order_slots
        formula: "3 + L"
    material_costs:
      - material_id: mat_element_si
        base_quantity: 8
      - material_id: mat_element_cu
        base_quantity: 4
```

Required validation:

- Base module IDs are unique.
- Required modules exist and do not form cycles.
- Effects target known systems.
- Material costs reference known materials.

### `player_start.yaml`

```yaml
player_start:
  space_bucks: 0
  inventory:
    mat_chonks: 0
    mat_scrap: 0
  unlocked_machine_ids:
    - machine_basic_3d_printer
  unlocked_asteroid_class_ids:
    - asteroid_starter_rubble
  current_asteroid_class_id: asteroid_starter_rubble
  upgrades:
    upgrade_drill_power: 0
    upgrade_scanner_range: 0
    upgrade_suit_plating: 0
  base_modules:
    base_command_center: 1
  report_mode: meaningful_turns_only
```

Required validation:

- All referenced IDs exist.
- Starting inventory materials exist.
- Starting machine and asteroid are unlocked.
- Starting upgrade levels are within bounds.

### `report_templates.yaml`

```yaml
report_templates:
  compact:
    - "MCP Miner: +{chonks} Chonks, {highlight}, suit {suit_condition}%, {order_summary}."
  no_progress:
    - "MCP Miner: systems humming. No new Chonks this turn."
  order_progress:
    - "MCP Miner: +{chonks} Chonks, order +{order_percent}%, {time_remaining} left."
```

Required validation:

- Template placeholders are known.
- Every report mode has at least one template.
- Templates cannot include private work details.

### `balance_constants.yaml`

```yaml
balance:
  refinement_multiplier:
    raw: 1.0
    refined: 1.55
    high_purity: 2.25
  upgrade_phase:
    interval: 10
    multiplier_per_phase_squared: 0.08
  pity:
    max_score: 3.0
    bonus_per_score: 0.04
    max_final_rare_chance: 0.35
  direct_market:
    min_multiplier: 0.72
    max_multiplier: 0.92
```

Required validation:

- Constants are positive where required.
- Probability constants are between `0` and `1`.
- Formula IDs referenced by other files exist here or in code's formula registry.

## Runtime Data Contracts

### Local State File

The canonical local runtime state is `~/.mcp-miner/state.json`, unless
`MCP_MINER_STATE_PATH` overrides it for tests. Hooks and the MCP server must treat this file as the
materialized local save state. The current MVP uses a lock file and atomic rename when writing.

Representative shape:

```json
{
  "state_schema_version": 1,
  "space_bucks": 0,
  "inventory": {
    "mat_chonks": 0
  },
  "unlocked_machine_ids": ["machine_basic_refinery"],
  "unlocked_asteroid_class_ids": ["asteroid_starter_field"],
  "current_asteroid_class_id": "asteroid_starter_field",
  "upgrades": {
    "upgrade_drill_power": 0
  },
  "base_modules": {},
  "report_mode": "meaningful_turns_only",
  "cloud_sync": false,
  "orders": [],
  "completed_orders": [],
  "orders_generated_at": "2026-05-24T00:00:00Z",
  "orders_refresh_due_at": "2026-05-25T00:00:00Z",
  "order_generation_index": 0,
  "market_sale_index": 0,
  "market_transactions": [],
  "suit_condition": 100,
  "asteroid_progress": {
    "asteroid_class_id": "asteroid_starter_field",
    "mined": 0
  },
  "stats": {
    "turns_seen": 0,
    "tool_events_seen": 0,
    "work_score_total": 0.0,
    "chonks_mined_total": 0,
    "materials_found_total": 0,
    "reports_emitted": 0,
    "work_events": {
      "work_search": 1
    }
  },
  "project_stats": {
    "project_abc123def456": {
      "turns": {
        "turn_def": true
      },
      "work_events": {
        "work_search": 1
      },
      "last_seen_at": "2026-05-24T00:00:00Z"
    }
  },
  "agent_stats": {
    "agent_abc123def456": {
      "agent_type": "research",
      "starts": 1,
      "stops": 1,
      "last_seen_at": "2026-05-24T00:00:00Z"
    }
  },
  "dedupe_keys": ["evt_123"],
  "current_turn": {
    "turn_id": "turn_def",
    "score": 3.0,
    "chonks": 4,
    "materials": {
      "mat_element_fe": 1
    },
    "events": {
      "work_search": 1
    },
    "report_emitted": false,
    "started_at": "2026-05-24T00:00:00Z"
  },
  "latest_report": {
    "text": "MCP Miner: +4 Chonks, scanner swept fresh veins, suit 100%, orders waiting.",
    "turn_id": "turn_def",
    "created_at": "2026-05-24T00:00:00Z"
  },
  "journal": {
    "path": "~/.mcp-miner/journal.jsonl",
    "applied_event_count": 1,
    "last_event_id": "evt_123"
  },
  "last_migration": {
    "from_state_schema_version": 0,
    "to_state_schema_version": 1,
    "backup_file": "state.json.backup-v0-to-v1-20260524000000-12345",
    "created_at": "2026-05-24T00:00:00Z"
  },
  "last_recovery": null,
  "last_session_id": "session_abc",
  "last_seen_at": "2026-05-24T00:00:00Z",
  "created_at": "2026-05-24T00:00:00Z"
}
```

Required runtime validation and normalization:

- `inventory` is a material ID to integer quantity map. Raw material IDs must exist in
  `materials.yaml`; refined inventory uses the stable `refined:<material_id>` key and must resolve
  to a refinable base material before it is displayed, sold, or consumed.
- `state_schema_version` is the local save schema version. It is separate from
  `data/schema_version.yaml`, which tracks gameplay data and economy revisions.
- Legacy or missing local state schema versions are migrated to the current version after writing a
  timestamped `.backup-*` copy of the previous `state.json`.
- `stats` always contains `turns_seen`, `tool_events_seen`, `work_score_total`,
  `chonks_mined_total`, `materials_found_total`, `reports_emitted`, and `work_events`.
- `project_stats` keys are anonymous `project_` fingerprints derived from hook working directories.
  Do not store raw file paths, repository names, or project names.
- `agent_stats` keys are anonymous `agent_` fingerprints derived from agent ID or type. Do not store
  subagent transcript content.
- `current_turn` is either `null` or the active turn ledger with `turn_id`, `score`, `chonks`,
  `materials`, `events`, `report_emitted`, and `started_at`.
- `latest_report` is either `null` or an object with report `text`, `turn_id`, and `created_at`.
- `dedupe_keys` contains recent reward `event_id` values, plus legacy hook-event dedupe strings when
  migrating older state, and is capped to the newest 300 entries.
- `asteroid_progress` contains the selected `asteroid_class_id` and mined counter.
- `suit_condition` is an integer condition percentage, defaulting to 100.
- `report_mode` is one of `off`, `every_turn_compact`, `every_turn_full`,
  `meaningful_turns_only`, `session_summary_only`, or `milestones_only`.
- `last_migration` and `last_recovery` contain only privacy-safe local maintenance metadata such as
  schema version numbers, backup file basenames, and timestamps.
- No prompt text, assistant reply text, source code, terminal output, file path, repo name, browser
  content, app content, or raw transcript is stored by default.

### Local Event Journal

The local hook writes an append-only journal next to the materialized state file:
`~/.mcp-miner/journal.jsonl` by default, or `MCP_MINER_JOURNAL_PATH` when overridden. Each line is a
single JSON object. `state.json` remains the fast materialized view, while the journal is the replay
source for supported reward fields.

Reward events are appended before state reduction:

```json
{
  "event_id": "evt_123",
  "event_type": "work_apply_patch",
  "timestamp": "2026-05-24T00:00:00Z",
  "session_id": "session_abc",
  "turn_id": "turn_def",
  "privacy_class": "abstract",
  "score": 8.5,
  "rewards": {
    "chonks": 10,
    "materials": {
      "mat_element_fe": 1
    },
    "asteroid_class_id": "asteroid_carbonyard",
    "asteroid_mined_delta": 11,
    "suit_damage": 0
  },
  "project_id": "project_abc123",
  "agent_id": "agent_def456"
}
```

Migration-only `state_snapshot` entries may be written when a pre-journal `state.json` is first
loaded or a corrupt journal is backed up. Snapshots contain only the privacy-safe materialized state
fields listed above and omit the local journal path.

Required runtime behavior:

- Reducers ignore duplicate reward events using deterministic `event_id` values.
- Supported reward fields can be rebuilt from journal replay: inventory rewards, suit damage,
  asteroid progress, current turn reward ledger, work-event counters, and anonymous project or agent
  activity attached to reward events.
- Corrupt `state.json` and `journal.jsonl` files are moved to `.corrupt-*` backups. If the journal is
  readable, state is rebuilt from replay; if the state is readable and the journal is corrupt, a new
  abstract migration snapshot is written.
- Journal entries must not include prompts, assistant replies, source code, terminal output, file
  paths, repository names, browser content, app content, or raw transcripts.

### Work Event

This is the privacy-safe event shape cloud sync should use. The current local journal stores the same
abstract event fields plus deterministic reward deltas.

```json
{
  "eventId": "evt_123",
  "eventType": "work_apply_patch",
  "timestamp": "2026-05-24T00:00:00Z",
  "sessionId": "session_abc",
  "turnId": "turn_def",
  "observedFields": {
    "changedLines": 42,
    "filesTouchedCount": 2
  },
  "privacyClass": "abstract",
  "source": "codex_hook"
}
```

Required runtime validation:

- `eventType` exists in `work_scoring.yaml`.
- `privacyClass` is `abstract` unless the user has opted into diagnostics.
- No source code, prompt text, terminal output, file path, repo name, or browser content is included by default.

### Turn Ledger

The current hook ledger is stored at `current_turn` in `state.json`.

```json
{
  "turn_id": "turn_def",
  "score": 18.0,
  "chonks": 16,
  "materials": {
    "mat_element_fe": 2
  },
  "events": {
    "work_apply_patch": 1,
    "work_write_docs": 1
  },
  "report_emitted": false,
  "started_at": "2026-05-24T00:00:00Z"
}
```

Required runtime validation:

- Reward materials exist.
- Work event IDs are known in `work_scoring.yaml`.
- Report templates are from `report_templates.yaml`.

### Refining And Direct Market Sales

Refined inventory is represented as `refined:<material_id>` in the local inventory map.

```json
{
  "action": "sell_material",
  "materialId": "refined:mat_ore",
  "quantity": 2,
  "spaceBucksEach": 7,
  "marketMultiplier": 0.84,
  "payoutSpaceBucks": 12
}
```

Required runtime validation:

- `refine_material` only accepts base materials with `can_refine: true` and positive
  `refined_space_bucks`.
- Refining consumes raw inventory and adds the same quantity to `refined:<material_id>`.
- `sell_material` accepts raw IDs or `refined:<material_id>` IDs, validates available inventory,
  consumes sold inventory, and adds Space Bucks.
- Direct market sales use `balance.direct_market.min_multiplier` and
  `balance.direct_market.max_multiplier`; they remain a lower-value pressure release than orders.

### Order Instance

```json
{
  "orderId": "order_123",
  "recipeId": "recipe_hull_patch_clips",
  "variantId": "order_variant_rush_batch",
  "buyerId": "buyer_patchy_freighter_union",
  "quantity": 2,
  "slot": 0,
  "status": "active",
  "requiredMaterials": {
    "mat_chonks": 42,
    "mat_element_fe": 14,
    "mat_element_ni": 6
  },
  "payoutSpaceBucks": 620,
  "priceMultiplier": 1.08,
  "isWindfall": false,
  "windfallLabel": null,
  "deadlineDays": 2,
  "createdAt": "2026-05-24T00:00:00Z",
  "expiresAt": "2026-05-26T00:00:00Z",
  "canFulfill": false,
  "missingMaterials": {
    "mat_element_ni": 2
  }
}
```

Required runtime validation:

- Recipe, variant, and buyer IDs exist.
- Required materials are computed from recipe and variant data.
- Payout is computed from formula and deterministic price variation, not hand-entered.
- Windfall orders use the configured chance, multiplier range, and labels from `order_generator.yaml`.
- Fulfillment consumes required inventory, adds Space Bucks, archives the completed order, and fills
  the active slot with a replacement order.
- Expired orders are replaced without inventory loss; `missed_order_penalty` remains
  `lost_opportunity_only`.
- Expiration is after creation.

## Validation Test Suite

Before implementation is considered ready, there must be a data validation command, such as:

```bash
npm run validate:data
```

Minimum required checks:

1. All YAML files parse.
2. Schema version is supported.
3. IDs are unique within each file.
4. Cross-file references resolve.
5. Every recipe has a valid machine.
6. Every recipe input material exists.
7. Every recipe only uses materials allowed by its machine tier.
8. Every order variant can produce required materials.
9. Every generated order can compute a Space Bucks payout.
10. Every asteroid class has valid material composition.
11. Every upgrade has valid cost and effect definitions.
12. Every hazard references valid systems and materials.
13. Starting player state references only valid IDs.
14. Report templates use only known placeholders.
15. No gameplay data is missing for the MVP loop.

## Missing Data Policy

When code requests a missing ID:

```text
throw DataContractError(
  code="MISSING_GAMEPLAY_ID",
  file="data/recipes.yaml",
  id="recipe_unknown",
  message="Recipe ID recipe_unknown is not defined. Do not invent recipe data."
)
```

When a formula cannot compute:

```text
throw DataContractError(
  code="UNCOMPUTABLE_FORMULA",
  formula="order_payout",
  inputs={...},
  message="Order payout could not be computed from source data."
)
```

When a generator has no valid candidates:

```text
throw DataContractError(
  code="EMPTY_GENERATOR_POOL",
  generator="order_generator",
  message="No valid recipes for player tier 2 and unlocked machines."
)
```

## MVP Data Completion Checklist

The following must be fully specified before implementation starts:

- All 118 element materials with raw/refined Space Bucks prices.
- All fictional materials with raw/refined Space Bucks prices.
- All material aliases used by recipes.
- 5 fabrication machines with unlocks and throughput.
- 125 recipe bases from the GDD, encoded in `recipes.yaml`.
- 4 order variants from the GDD.
- Order generator settings and windfall rules.
- At least 6 buyers.
- At least 3 asteroid classes for MVP.
- All starting upgrades with cost and effects.
- Work scoring for observable Codex desktop hook events.
- At least 5 hazards with effects and mitigation.
- Starting player state.
- Compact and full report templates.
- A validator that blocks unknown IDs and out-of-tier recipes.

## Engineer Agent Instruction

Use this exact instruction when handing implementation to an engineer agent:

```text
Build MCP Miner using the gameplay data files as the only source of truth.
Do not invent gameplay content, IDs, formulas, prices, recipes, order types,
upgrade costs, asteroid compositions, hazards, or starting values in code.
If data is missing, stop and report the missing field or ID.
Implement validation first, then implement gameplay systems against validated data.
```
