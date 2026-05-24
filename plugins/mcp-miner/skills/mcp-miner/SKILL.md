---
name: "mcp-miner"
description: "Use when the user asks about MCP Miner gameplay, stats, orders, inventory, settings, dashboard/store links, or how Codex work maps to passive asteroid-mining progress."
---

# MCP Miner

MCP Miner is a passive asteroid-mining game for Codex. Users work normally in Codex, and the game turns supported Codex work events into mining progress, Chonks, materials, orders, upgrades, and reports.

## Behavior

- Use MCP Miner MCP tools for player status, latest reports, active orders, inventory, settings, milestone status, sync state, and catalog summaries.
- Do not invent gameplay data. Gameplay content comes from the validated `data/*.yaml` files.
- Keep reports compact unless the user asks for detail.
- Never include private work details such as prompts, code, file paths, repo names, terminal output, or browser content in game reports.
- Use "Chonks" for mined material and "Space Bucks" for money.

## Useful Tool Intents

- `get_player_status`: current player state and settings.
- `get_latest_report`: latest compact MCP Miner report.
- `get_inventory`: current inventory with material names, categories, rarity, and value totals.
- `get_active_orders`: current generated orders.
- `fulfill_order`: consume available inventory and complete an active order for Space Bucks.
- `refine_material`: convert refinable raw inventory into refined inventory.
- `sell_material`: sell raw or refined inventory directly for Space Bucks.
- `get_settings`: report mode, cloud-sync preference, and privacy posture.
- `get_milestone_status`: current asteroid milestone progress and claim support status.
- `get_catalog_summary`: counts of loaded materials, recipes, machines, asteroids, upgrades, and hazards.
- `update_settings`: change report mode or cloud sync preference.
- `sync_progress`: local/offline sync-state stub until cloud sync exists.
- `claim_milestone`: disabled local stub until milestone rewards are defined.
- `open_dashboard`: return dashboard URL.
- `open_store`: return in-game store URL.
