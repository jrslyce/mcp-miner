package miner

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
)

const protocolVersion = "2024-11-05"

type mcpRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Method  string `json:"method"`
	Params  M      `json:"params"`
}

func RunMCP(engine *Engine, in io.Reader, out io.Writer, errOut io.Writer) error {
	scanner := bufio.NewScanner(in)
	encoder := json.NewEncoder(out)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req mcpRequest
		if err := json.Unmarshal(line, &req); err != nil {
			fmt.Fprintln(errOut, "MCP Miner JSON parse error:", err)
			continue
		}
		resp := handleMCP(engine, req)
		if resp != nil {
			if err := encoder.Encode(resp); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}

func handleMCP(engine *Engine, req mcpRequest) M {
	switch req.Method {
	case "initialize":
		return result(req.ID, M{"protocolVersion": protocolVersion, "serverInfo": M{"name": "mcp-miner", "version": "0.2.0-go"}, "capabilities": M{"tools": M{}}})
	case "notifications/initialized", "initialized":
		return nil
	case "tools/list":
		return result(req.ID, M{"tools": tools()})
	case "tools/call":
		params := asMap(req.Params)
		name := asString(params["name"])
		args := asMap(params["arguments"])
		payload, err := callTool(engine, name, args)
		if err != nil {
			return errorResponse(req.ID, -32602, err.Error())
		}
		text, _ := json.MarshalIndent(payload, "", "  ")
		return result(req.ID, M{"content": []any{M{"type": "text", "text": string(text)}}})
	default:
		return errorResponse(req.ID, -32601, "Unknown method: "+req.Method)
	}
}

func result(id any, payload M) M {
	return M{"jsonrpc": "2.0", "id": id, "result": payload}
}

func errorResponse(id any, code int, message string) M {
	return M{"jsonrpc": "2.0", "id": id, "error": M{"code": code, "message": message}}
}

func tools() []any {
	names := []string{
		"get_player_status", "get_latest_report", "get_profile", "update_profile", "get_inventory",
		"get_asteroid_status", "select_asteroid", "get_fabrication_status", "queue_fabrication",
		"get_active_orders", "get_weekly_contracts", "complete_weekly_contract", "fulfill_order",
		"refine_material", "sell_material", "get_upgrade_status", "purchase_upgrade",
		"get_store_catalog", "purchase_store_item", "get_base_status", "purchase_base_module",
		"get_settings", "get_account_link_status", "start_account_link", "complete_account_link",
		"link_cloud_profile", "unlink_cloud_profile", "disconnect_account", "get_reward_controls",
		"get_milestone_status", "get_catalog_summary", "update_settings", "sync_progress",
		"get_sync_status", "sync_cloud", "preview_sync_payload", "get_backup_status",
		"create_cloud_backup", "restore_cloud_backup", "claim_milestone", "open_dashboard", "open_store",
		"check_for_update", "update_plugin",
	}
	out := []any{}
	for _, name := range names {
		out = append(out, M{"name": name, "description": toolDescription(name), "inputSchema": schemaFor(name)})
	}
	return out
}

func toolDescription(name string) string {
	switch name {
	case "get_player_status":
		return "Return the local MCP Miner player status, inventory summary, settings, and current asteroid."
	case "get_latest_report":
		return "Return the latest compact MCP Miner report."
	case "sync_cloud":
		return "Push queued privacy-safe MCP Miner journal events to the configured Cloud Functions sync API."
	case "check_for_update":
		return "Check whether a newer MCP Miner plugin version is available from the configured Git remote."
	case "update_plugin":
		return "After explicit confirmation, pull, rebuild, and reinstall the local MCP Miner plugin."
	default:
		return "Run MCP Miner tool " + name + "."
	}
}

func schemaFor(name string) M {
	props := M{}
	switch name {
	case "update_profile":
		for _, key := range []string{"display_name", "miner_name", "pronouns", "suit_style", "avatar_concept_prompt", "add_customization_unlock", "generated_asset_ref"} {
			props[key] = M{"type": "string"}
		}
	case "select_asteroid":
		props["asteroid_id"] = M{"type": "string"}
	case "queue_fabrication":
		props["recipe_id"] = M{"type": "string"}
		props["variant_id"] = M{"type": "string"}
		props["quantity"] = M{"type": "integer", "minimum": 1}
	case "complete_weekly_contract":
		props["contract_id"] = M{"type": "string"}
	case "fulfill_order":
		props["order_id"] = M{"type": "string"}
	case "refine_material", "sell_material":
		props["material_id"] = M{"type": "string"}
		props["quantity"] = M{"type": "integer", "minimum": 1}
	case "purchase_upgrade":
		props["upgrade_id"] = M{"type": "string"}
	case "purchase_store_item":
		props["store_item_id"] = M{"type": "string"}
	case "purchase_base_module":
		props["module_id"] = M{"type": "string"}
	case "start_account_link":
		props["functions_origin"] = M{"type": "string"}
		props["dashboard_url"] = M{"type": "string"}
		props["device_name"] = M{"type": "string"}
	case "complete_account_link":
		props["session_id"] = M{"type": "string"}
		props["device_secret"] = M{"type": "string"}
		props["functions_origin"] = M{"type": "string"}
	case "link_cloud_profile":
		props["firebase_uid"] = M{"type": "string"}
		props["display_name"] = M{"type": "string"}
	case "disconnect_account":
		props["revoke"] = M{"type": "boolean"}
		props["functions_origin"] = M{"type": "string"}
	case "update_settings":
		props["report_mode"] = M{"type": "string", "enum": anySlice(validReportModes)}
		props["cloud_sync"] = M{"type": "boolean"}
	case "sync_cloud", "preview_sync_payload", "get_backup_status", "create_cloud_backup":
		props["device_token"] = M{"type": "string"}
		props["id_token"] = M{"type": "string"}
		props["functions_origin"] = M{"type": "string"}
		if name == "sync_cloud" {
			props["force"] = M{"type": "boolean"}
		}
	case "restore_cloud_backup":
		props["confirm"] = M{"type": "boolean"}
		props["allow_overwrite"] = M{"type": "boolean"}
		props["device_token"] = M{"type": "string"}
		props["id_token"] = M{"type": "string"}
		props["functions_origin"] = M{"type": "string"}
	case "claim_milestone":
		props["milestone_id"] = M{"type": "string"}
	case "update_plugin":
		props["confirm"] = M{"type": "boolean"}
	}
	return M{"type": "object", "properties": props, "additionalProperties": false}
}

func callTool(engine *Engine, name string, args M) (M, error) {
	switch name {
	case "get_player_status":
		return engine.PlayerStatus(), nil
	case "get_latest_report":
		state, _ := engine.State()
		return engine.LatestReportPayload(state), nil
	case "get_profile":
		return engine.ProfilePayload(nil), nil
	case "update_profile":
		return engine.UpdateProfilePayload(args), nil
	case "get_inventory":
		return engine.InventoryPayload(nil), nil
	case "get_asteroid_status":
		return engine.AsteroidStatusPayload(nil), nil
	case "select_asteroid":
		return engine.SelectAsteroidPayload(args), nil
	case "get_fabrication_status":
		return engine.FabricationStatusPayload(nil), nil
	case "queue_fabrication":
		return engine.QueueFabricationPayload(args), nil
	case "get_active_orders":
		return engine.ActiveOrdersPayload(), nil
	case "get_weekly_contracts":
		return engine.WeeklyContractsPayload(), nil
	case "complete_weekly_contract":
		return engine.CompleteWeeklyContractPayload(args), nil
	case "fulfill_order":
		return engine.FulfillOrderPayload(args), nil
	case "refine_material":
		return engine.RefineMaterialPayload(args), nil
	case "sell_material":
		return engine.SellMaterialPayload(args), nil
	case "get_upgrade_status":
		return engine.UpgradeStatusPayload(nil), nil
	case "purchase_upgrade":
		return engine.PurchaseUpgradePayload(args), nil
	case "get_store_catalog":
		return engine.StoreCatalogPayload(nil), nil
	case "purchase_store_item":
		return engine.PurchaseStoreItemPayload(args), nil
	case "get_base_status":
		return engine.BaseStatusPayload(nil), nil
	case "purchase_base_module":
		return engine.PurchaseBaseModulePayload(args), nil
	case "get_settings":
		return engine.SettingsPayload(nil), nil
	case "get_account_link_status":
		return engine.AccountLinkStatusPayload(nil), nil
	case "start_account_link":
		return engine.StartAccountLinkPayload(args), nil
	case "complete_account_link":
		return engine.CompleteAccountLinkPayload(args)
	case "link_cloud_profile":
		return engine.LinkCloudProfilePayload(args), nil
	case "unlink_cloud_profile":
		return engine.UnlinkCloudProfilePayload(args), nil
	case "disconnect_account":
		return engine.DisconnectAccountPayload(args), nil
	case "get_reward_controls":
		return engine.RewardControlsPayload(nil), nil
	case "get_milestone_status":
		return engine.MilestoneStatusPayload(nil), nil
	case "get_catalog_summary":
		return engine.CatalogSummary(), nil
	case "update_settings":
		return engine.UpdateSettings(args), nil
	case "sync_progress", "get_sync_status":
		return engine.SyncProgressPayload(nil), nil
	case "sync_cloud":
		return engine.SyncCloudPayload(args), nil
	case "preview_sync_payload":
		return engine.PreviewSyncPayload(args), nil
	case "get_backup_status":
		return engine.BackupStatusPayload(args), nil
	case "create_cloud_backup":
		return engine.CreateCloudBackupPayload(args), nil
	case "restore_cloud_backup":
		return engine.RestoreCloudBackupPayload(args), nil
	case "claim_milestone":
		return engine.ClaimMilestonePayload(args), nil
	case "open_dashboard":
		return engine.OpenDashboard(), nil
	case "open_store":
		return engine.OpenStore(), nil
	case "check_for_update":
		return engine.UpdateNoticePayload(), nil
	case "update_plugin":
		return engine.UpdatePluginPayload(args, io.Discard, io.Discard), nil
	default:
		return nil, fmt.Errorf("Unknown tool: %s", name)
	}
}
