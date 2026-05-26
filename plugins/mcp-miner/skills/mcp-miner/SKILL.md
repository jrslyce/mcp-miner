---
name: "mcp-miner"
description: "Use when the user asks about MCP Miner gameplay, stats, orders, inventory, settings, dashboard/store links, or how Codex work maps to passive asteroid-mining progress."
---

# MCP Miner

MCP Miner is a passive asteroid-mining game for Codex. Users work normally in Codex, and the game turns supported Codex work events into mining progress, Chonks, materials, orders, upgrades, and reports.

## Behavior

- Use MCP Miner MCP tools for player status, latest reports, active orders, inventory, settings, reward-control diagnostics, milestone status, sync state, and catalog summaries.
- Do not invent gameplay data. Gameplay content comes from the validated `data/*.yaml` files.
- Keep reports compact unless the user asks for detail.
- Never include private work details such as prompts, code, file paths, repo names, terminal output, or browser content in game reports.
- Use "Chonks" for mined material and "Space Bucks" for money.

## Useful Tool Intents

- `get_player_status`: current player state and settings.
- `get_latest_report`: latest compact MCP Miner report.
- `get_profile`: inspect local miner persona and avatar workflow fields.
- `update_profile`: update local miner persona, suit style, avatar prompt, unlocks, or asset refs.
- `get_inventory`: current inventory with material names, categories, rarity, and value totals.
- `get_asteroid_status`: inspect unlocked asteroid classes, selection, depletion, hazards, and pity.
- `select_asteroid`: switch mining to an unlocked asteroid class.
- `get_fabrication_status`: inspect fabrication machines, queues, completed products, and throughput.
- `queue_fabrication`: consume recipe materials and queue a fabricated product.
- `get_active_orders`: current generated orders.
- `get_weekly_contracts`: inspect longer-lived weekly contract goals.
- `complete_weekly_contract`: fulfill a weekly contract from materials or completed product stock.
- `fulfill_order`: consume available inventory and complete an active order for Space Bucks.
- `refine_material`: convert refinable raw inventory into refined inventory.
- `sell_material`: sell raw or refined inventory directly for Space Bucks.
- `get_upgrade_status`: inspect upgrade levels, next costs, effects, and affordability.
- `purchase_upgrade`: spend Space Bucks/materials to buy one upgrade level.
- `get_store_catalog`: inspect the earned Space Bucks store across upgrades, machines, recipes, base modules, and cosmetics.
- `purchase_store_item`: buy a store item after local/server-side validation of costs, locks, ownership, and max levels.
- `get_base_status`: inspect base modules, configured effects, and drone automation.
- `purchase_base_module`: spend Space Bucks/materials to build or repair one base module level.
- `get_settings`: report mode, cloud-sync preference, and privacy posture.
- `get_account_link_status`: inspect optional Firebase Auth linking state.
- `start_account_link`: create a short-lived web approval code/URL for connecting this Codex device.
- `complete_account_link`: exchange an approved link session for a local revocable device token.
- `link_cloud_profile`: link local progress to a Firebase Auth UID without storing credentials.
- `unlink_cloud_profile`: return to local-only play.
- `disconnect_account`: remove the local device token and return to local-only play.
- `get_reward_controls`: privacy-safe cooldown, soft-cap, dedupe, and diversity diagnostics for rewarded work.
- `get_milestone_status`: current asteroid milestone progress and claim support status.
- `get_catalog_summary`: counts of loaded materials, recipes, machines, asteroids, upgrades, and hazards.
- `update_settings`: change report mode or cloud sync preference.
- `sync_progress`: local/offline sync state, queued events, account link state, and retry/conflict metadata.
- `get_sync_status`: same intent as `sync_progress`; use when the user asks if cloud sync is connected.
- `sync_cloud`: push queued abstract journal events to the configured Firebase Cloud Functions sync API.
- `claim_milestone`: disabled local stub until milestone rewards are defined.
- `open_dashboard`: return dashboard URL.
- `open_store`: return in-game store URL.
