# Space Bucks Store

MCP Miner V1 uses earned Space Bucks only. There is no real-money purchase path, payment provider, checkout URL, or paid upgrade integration.

## Local Store API

The MCP server exposes:

- `get_store_catalog`: returns upgrade tracks, fabrication machines, recipes, base modules, and cosmetics with `affordable`, `unaffordable`, `locked`, `maxed`, `owned`, or `available` state.
- `purchase_store_item`: validates and buys store item IDs such as `upgrade:upgrade_drill_power`, `machine:machine_circuit_loom`, `base_module:base_workshop`, and `cosmetic:cosmetic_suit_trim_teal`.

Purchases are validated in the local game engine before state changes are written. The UI state is advisory only.

## Validation

The store rejects:

- insufficient Space Bucks
- missing required materials
- missing base-module or upgrade prerequisites
- max-level upgrade/base-module tracks
- already owned machines or cosmetics

Successful purchases update the same local state shown by dashboard/status tools: Space Bucks, inventory, upgrade levels, base modules, unlocked fabrication machines, and profile customization unlocks.

## Dashboard

The Firebase Hosting dashboard includes a Space Bucks store panel. Signed-out demo mode can preview earned-currency purchases in memory. Authenticated/cloud purchases should use the same validated store payloads once cloud reducers own the full economy state.
