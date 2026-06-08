package miner

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (e *Engine) AccountLinkStatusPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	auth := asMap(state["cloud_auth"])
	meta := asMap(state["cloud_sync_metadata"])
	return M{"account_link": M{"provider": "firebase", "status": asString(auth["status"]), "uid": auth["uid"], "linked_at": auth["linked_at"], "updated_at": auth["updated_at"], "device_id": meta["device_id"], "link_code": meta["link_code"], "link_url": meta["link_url"], "link_expires_at": meta["link_expires_at"], "privacy": PrivacyNotice}, "privacy": PrivacyNotice}
}

func (e *Engine) LinkCloudProfilePayload(args M) M {
	uid := asString(args["firebase_uid"])
	if uid == "" {
		return M{"ok": false, "status": "missing_uid", "privacy": PrivacyNotice}
	}
	result, _ := e.WithState(func(state M) (any, error) {
		auth := asMap(state["cloud_auth"])
		auth["status"] = "linked"
		auth["uid"] = uid
		auth["linked_at"] = nowISO()
		auth["updated_at"] = nowISO()
		state["cloud_auth"] = auth
		state["cloud_sync"] = true
		profile := asMap(state["profile"])
		if name := asString(args["display_name"]); name != "" {
			profile["display_name"] = name
		}
		profile["cloud_sync"] = true
		state["profile"] = profile
		meta := asMap(state["cloud_sync_metadata"])
		meta["status"] = "linked_sync_pending"
		state["cloud_sync_metadata"] = meta
		return M{"ok": true, "status": "linked", "account_link": asMap(e.AccountLinkStatusPayload(state)["account_link"]), "profile": profile, "firestore_paths": M{"profile": "players/" + uid + "/profile/current", "settings": "players/" + uid + "/settings/current"}, "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) UnlinkCloudProfilePayload(_ M) M {
	result, _ := e.WithState(func(state M) (any, error) {
		state["cloud_auth"] = defaultCloudAuth()
		state["cloud_sync"] = false
		profile := asMap(state["profile"])
		profile["cloud_sync"] = false
		state["profile"] = profile
		meta := asMap(state["cloud_sync_metadata"])
		meta["status"] = "off"
		meta["device_id"] = nil
		state["cloud_sync_metadata"] = meta
		_ = os.Remove(e.AuthPath)
		return M{"ok": true, "status": "unlinked", "account_link": asMap(e.AccountLinkStatusPayload(state)["account_link"]), "privacy": PrivacyNotice}, nil
	})
	return result.(M)
}

func (e *Engine) StartAccountLinkPayload(args M) M {
	origin := configuredOrigin(args)
	dashboardURL := asString(args["dashboard_url"])
	if dashboardURL == "" {
		dashboardURL = os.Getenv("MCP_MINER_DASHBOARD_URL")
	}
	if dashboardURL == "" {
		dashboardURL = DefaultDashboardURL
	}
	payload := M{"data": M{"deviceName": asString(args["device_name"]), "dashboardUrl": dashboardURL, "privacyClass": "abstract"}}
	var out M
	if err := postJSON(origin, "createLinkSession", "", "", payload, &out); err != nil {
		return M{"ok": false, "status": "link_error", "message": err.Error(), "privacy": PrivacyNotice}
	}
	result := asMap(out["result"])
	session := asMap(result["session"])
	deviceSecret := asString(result["deviceSecret"])
	authFile := e.readAuthCredentials()
	authFile["pending_link_session_id"] = asString(session["sessionId"])
	authFile["pending_link_device_secret"] = deviceSecret
	authFile["pending_functions_origin"] = origin
	_ = e.writeAuthCredentials(authFile)
	response, _ := e.WithState(func(state M) (any, error) {
		auth := asMap(state["cloud_auth"])
		auth["status"] = "link_pending"
		auth["updated_at"] = nowISO()
		state["cloud_auth"] = auth
		meta := asMap(state["cloud_sync_metadata"])
		meta["status"] = "link_pending"
		meta["functions_origin"] = origin
		meta["link_session_id"] = asString(session["sessionId"])
		meta["link_code"] = asString(session["code"])
		meta["link_url"] = asString(result["linkUrl"])
		meta["link_expires_at"] = asString(session["expiresAt"])
		state["cloud_sync_metadata"] = meta
		return M{"ok": true, "status": "link_pending", "link": M{"session_id": asString(session["sessionId"]), "code": asString(session["code"]), "url": asString(result["linkUrl"]), "expires_at": asString(session["expiresAt"])}, "account_link": asMap(e.AccountLinkStatusPayload(state)["account_link"]), "privacy": PrivacyNotice}, nil
	})
	return response.(M)
}

func (e *Engine) CompleteAccountLinkPayload(args M) (M, error) {
	authFile := e.readAuthCredentials()
	sessionID := asString(args["session_id"])
	if sessionID == "" {
		sessionID = asString(authFile["pending_link_session_id"])
	}
	secret := asString(args["device_secret"])
	if secret == "" {
		secret = asString(authFile["pending_link_device_secret"])
	}
	origin := configuredOrigin(args)
	if origin == DefaultFunctionsOrigin && asString(authFile["pending_functions_origin"]) != "" {
		origin = asString(authFile["pending_functions_origin"])
	}
	payload := M{"data": M{"sessionId": sessionID, "deviceSecret": secret, "privacyClass": "abstract"}}
	var out M
	if err := postJSON(origin, "exchangeLinkSession", "", "", payload, &out); err != nil {
		return nil, err
	}
	result := asMap(out["result"])
	authFile = M{"device_token": asString(result["deviceToken"]), "device_id": asString(result["deviceId"]), "uid": asString(result["uid"]), "token_type": asString(result["tokenType"]), "scopes": result["scopes"], "updated_at": nowISO()}
	_ = e.writeAuthCredentials(authFile)
	response, _ := e.WithState(func(state M) (any, error) {
		auth := asMap(state["cloud_auth"])
		auth["status"] = "linked"
		auth["uid"] = asString(result["uid"])
		auth["linked_at"] = nowISO()
		auth["updated_at"] = nowISO()
		state["cloud_auth"] = auth
		state["cloud_sync"] = true
		profile := asMap(state["profile"])
		profile["cloud_sync"] = true
		state["profile"] = profile
		meta := asMap(state["cloud_sync_metadata"])
		meta["status"] = "linked_sync_pending"
		meta["device_id"] = asString(result["deviceId"])
		meta["functions_origin"] = origin
		meta["link_session_id"] = nil
		meta["link_code"] = nil
		meta["link_url"] = nil
		meta["link_expires_at"] = nil
		state["cloud_sync_metadata"] = meta
		return M{"ok": true, "status": "linked", "account_link": asMap(e.AccountLinkStatusPayload(state)["account_link"]), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}, nil
	})
	return response.(M), nil
}

func (e *Engine) DisconnectAccountPayload(args M) M {
	creds := e.readAuthCredentials()
	token := asString(creds["device_token"])
	origin := configuredOrigin(args)
	revokeStatus := "not_requested"
	if token != "" {
		var out M
		if err := postJSON(origin, "revokeDeviceToken", "", token, M{"data": M{"privacyClass": "abstract"}}, &out); err == nil {
			revokeStatus = asString(asMap(out["result"])["status"])
			if revokeStatus == "" {
				revokeStatus = "revoked"
			}
		}
	}
	_ = os.Remove(e.AuthPath)
	result := e.UnlinkCloudProfilePayload(M{})
	result["status"] = "unlinked"
	result["revoke_status"] = revokeStatus
	return result
}

func (e *Engine) SyncProgressPayload(state M) M {
	if state == nil {
		state, _ = e.State()
	}
	auth := asMap(state["cloud_auth"])
	meta := asMap(state["cloud_sync_metadata"])
	creds := e.readAuthCredentials()
	status := asString(auth["status"])
	available := false
	if status == "linked" {
		status = "linked_sync_pending"
		available = true
	} else if asBool(state["cloud_sync"]) && status == "off" {
		status = "unauthenticated"
	}
	pending := e.pendingJournalEvents(meta)
	return M{"ok": true, "sync": M{"available": available, "status": status, "cloud_sync_enabled": asBool(state["cloud_sync"]), "state_schema_version": asInt(state["state_schema_version"]), "last_recovery": safeRecovery(state["last_recovery"]), "account_link": asMap(e.AccountLinkStatusPayload(state)["account_link"]), "metadata": M{"status": asString(meta["status"]), "last_pushed_sequence": asInt(meta["last_pushed_sequence"]), "pending_event_count": len(pending), "duplicate_event_ids": meta["duplicate_event_ids"], "rejected_events": meta["rejected_events"], "initial_state_imported_at": meta["initial_state_imported_at"], "last_state_import_at": meta["last_state_import_at"], "state_import_id": meta["state_import_id"], "device_token_present": asString(creds["device_token"]) != "", "functions_origin": meta["functions_origin"]}, "cadence": cadencePayload(meta), "journal": M{"applied_event_count": asInt(asMap(state["journal"])["applied_event_count"]), "last_event_id": asMap(state["journal"])["last_event_id"]}}, "privacy": PrivacyNotice}
}

func safeRecovery(v any) any {
	recovery := asMap(v)
	if len(recovery) == 0 {
		return nil
	}
	out := M{}
	for _, k := range []string{"type", "backup_file", "at"} {
		if value, ok := recovery[k]; ok {
			out[k] = value
		}
	}
	return out
}

func cadencePayload(meta M) M {
	return M{"sync_cadence_seconds": asInt(meta["sync_cadence_seconds"]), "sync_mode": asString(meta["sync_mode"]), "next_eligible_sync_at": meta["next_eligible_sync_at"], "retry_after_seconds": retryAfter(asString(meta["next_eligible_sync_at"]))}
}

func retryAfter(iso string) int {
	t, ok := parseTime(iso)
	if !ok {
		return 0
	}
	secs := int(time.Until(t).Seconds())
	if secs < 0 {
		return 0
	}
	return secs
}

func (e *Engine) PreviewSyncPayload(args M) M {
	state, _ := e.State()
	meta := asMap(state["cloud_sync_metadata"])
	token := asString(args["device_token"])
	idToken := asString(args["id_token"])
	events := e.buildCloudSyncEvents(meta)
	origin := configuredOrigin(args)
	if e.needsInitialStateImport(state, meta) {
		return M{"ok": true, "status": "preview", "sync_type": "initial_state_import", "queued_event_count": len(events), "request": M{"method": "POST", "url": safeURLJoin(origin, "importInitialState"), "headers": redactedHeaders(idToken, token), "body": M{"data": e.buildInitialStateImportPayload(state)}}, "privacy": PrivacyNotice}
	}
	return M{"ok": true, "status": "preview", "queued_event_count": len(events), "request": M{"method": "POST", "url": safeURLJoin(origin, "syncRewardEvents"), "headers": redactedHeaders(idToken, token), "body": M{"data": M{"events": events}}}, "privacy": PrivacyNotice}
}

func (e *Engine) SyncCloudPayload(args M) M {
	state, _ := e.State()
	meta := asMap(state["cloud_sync_metadata"])
	events := e.buildCloudSyncEvents(meta)
	token := asString(args["device_token"])
	idToken := asString(args["id_token"])
	if token == "" {
		token = asString(e.readAuthCredentials()["device_token"])
	}
	if asString(asMap(state["cloud_auth"])["status"]) != "linked" && idToken == "" && token == "" {
		_, _ = e.WithState(func(s M) (any, error) {
			asMap(s["cloud_sync_metadata"])["status"] = "queued_unauthenticated"
			return nil, nil
		})
		state, _ = e.State()
		return M{"ok": false, "status": "unauthenticated", "queued_event_count": len(events), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
	}
	if idToken == "" && token == "" {
		_, _ = e.WithState(func(s M) (any, error) {
			asMap(s["cloud_sync_metadata"])["status"] = "queued_auth_required"
			return nil, nil
		})
		state, _ = e.State()
		return M{"ok": false, "status": "auth_required", "queued_event_count": len(events), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
	}
	if !asBool(args["force"]) && asString(meta["status"]) == "synced" && retryAfter(asString(meta["next_eligible_sync_at"])) > 0 {
		return M{"ok": true, "status": "waiting_for_cadence", "queued_event_count": len(events), "next_eligible_sync_at": meta["next_eligible_sync_at"], "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
	}
	origin := configuredOrigin(args)
	var out M
	if e.needsInitialStateImport(state, meta) {
		err := postJSON(origin, "importInitialState", idToken, token, M{"data": e.buildInitialStateImportPayload(state)}, &out)
		if err != nil {
			return e.recordCloudError(err, events, origin)
		}
		result := asMap(out["result"])
		return e.applyInitialStateImportResult(result, events, origin)
	}
	err := postJSON(origin, "syncRewardEvents", idToken, token, M{"data": M{"events": events}}, &out)
	if err != nil {
		return e.recordCloudError(err, events, origin)
	}
	result := asMap(out["result"])
	return e.applyCloudSyncResult(result, events, origin)
}

func (e *Engine) pendingJournalEvents(meta M) []M {
	entries, err := e.readJournalEntries()
	if err != nil {
		return []M{}
	}
	out := []M{}
	last := asInt(meta["last_pushed_sequence"])
	seq := 0
	for _, entry := range entries {
		if !strings.HasPrefix(asString(entry["event_type"]), "work_") {
			continue
		}
		seq++
		if seq > last {
			out = append(out, entry)
		}
	}
	return out
}

func (e *Engine) buildCloudSyncEvents(meta M) []any {
	pending := e.pendingJournalEvents(meta)
	out := []any{}
	seq := asInt(meta["last_pushed_sequence"])
	for _, entry := range pending {
		seq++
		event := M{"eventId": asString(entry["event_id"]), "eventType": asString(entry["event_type"]), "schemaVersion": 2, "receiptType": "abstract_work", "sequence": seq, "timestamp": asString(entry["timestamp"]), "turnId": asString(entry["turn_id"]), "observedFields": M{"scoreHint": asFloat(entry["score"]), "category": asString(asMap(e.Data.WorkEventByID[asString(entry["event_type"])])["category"]), "rewardControlReasons": asSlice(asMap(entry["reward_control"])["reasons"])}, "privacyClass": "abstract", "source": "codex_hook", "signature": "v2.local-placeholder"}
		event["checksum"] = shaHex(stableJSON(event))
		out = append(out, event)
	}
	return out
}

func (e *Engine) needsInitialStateImport(state M, meta M) bool {
	if asString(meta["initial_state_imported_at"]) != "" || asString(meta["last_state_import_at"]) != "" {
		return false
	}
	if asInt(meta["last_pushed_sequence"]) > 0 {
		return false
	}
	if asString(asMap(state["cloud_auth"])["status"]) != "linked" && !asBool(state["cloud_sync"]) {
		return false
	}
	return true
}

func (e *Engine) buildInitialStateImportPayload(state M) M {
	meta := asMap(state["cloud_sync_metadata"])
	checkpoint := e.currentCloudSyncCheckpoint(state)
	return M{
		"syncType":           "initial_state_import",
		"privacyClass":       "abstract",
		"clientId":           asString(meta["client_id"]),
		"deviceId":           meta["device_id"],
		"stateSchemaVersion": asInt(state["state_schema_version"]),
		"checkpoint":         checkpoint,
		"state":              e.buildBackupPayload(state),
	}
}

func (e *Engine) currentCloudSyncCheckpoint(state M) M {
	entries, err := e.readJournalEntries()
	if err != nil {
		journal := asMap(state["journal"])
		return M{"lastLocalSequence": asInt(journal["applied_event_count"]), "lastLocalEventId": journal["last_event_id"], "localUpdatedAt": nowISO()}
	}
	seq := 0
	var lastEventID any
	for _, entry := range entries {
		if !strings.HasPrefix(asString(entry["event_type"]), "work_") {
			continue
		}
		seq++
		lastEventID = entry["event_id"]
	}
	return M{"lastLocalSequence": seq, "lastLocalEventId": lastEventID, "localUpdatedAt": nowISO()}
}

func (e *Engine) applyInitialStateImportResult(result M, events []any, origin string) M {
	stateResult := asMap(result["state"])
	cursor := asMap(result["syncCursor"])
	lastSeq := asInt(cursor["lastSequence"])
	if lastSeq == 0 {
		lastSeq = asInt(stateResult["lastSequence"])
	}
	importedAt := asString(stateResult["snapshotImportedAt"])
	if importedAt == "" {
		importedAt = nowISO()
	}
	_, _ = e.WithState(func(state M) (any, error) {
		meta := asMap(state["cloud_sync_metadata"])
		meta["functions_origin"] = origin
		meta["last_attempt_at"] = nowISO()
		if asBool(result["ok"]) == false {
			meta["status"] = "sync_error"
			state["cloud_sync_metadata"] = meta
			return nil, nil
		}
		meta["status"] = "synced"
		meta["last_success_at"] = nowISO()
		meta["initial_state_imported_at"] = importedAt
		meta["last_state_import_at"] = importedAt
		meta["state_import_id"] = cursor["stateImportId"]
		meta["state_hash"] = stateResult["snapshotChecksum"]
		meta["last_pushed_sequence"] = lastSeq
		meta["pending_event_ids"] = []any{}
		meta["duplicate_event_ids"] = []any{}
		meta["rejected_events"] = []any{}
		if cadence := asMap(result["syncCadence"]); len(cadence) > 0 {
			meta["sync_cadence_seconds"] = asInt(cadence["cadenceSeconds"])
			meta["sync_mode"] = asString(cadence["mode"])
			meta["next_eligible_sync_at"] = cadence["nextEligibleSyncAt"]
		}
		if ent := asMap(result["entitlement"]); len(ent) > 0 {
			meta["entitlement_plan"] = asString(ent["plan"])
		}
		state["cloud_sync_metadata"] = meta
		return nil, nil
	})
	state, _ := e.State()
	if asBool(result["ok"]) == false {
		return M{"ok": false, "status": "sync_error", "queued_event_count": len(events), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
	}
	return M{"ok": true, "status": "initial_state_imported", "queued_event_count": len(events), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
}

func redactedHeaders(idToken, deviceToken string) M {
	headers := M{"Content-Type": "application/json"}
	if idToken != "" {
		headers["Authorization"] = "<redacted:bearer-token>"
	}
	if deviceToken != "" {
		headers["X-MCP-Miner-Device-Token"] = "<redacted:device-token>"
	}
	return headers
}

func (e *Engine) applyCloudSyncResult(result M, events []any, origin string) M {
	acceptedIDs := normalizeEventIDs(result["accepted"])
	duplicateIDs := normalizeEventIDs(result["duplicates"])
	rejected := asSlice(result["rejected"])
	maxSeq := asInt(asMap(result["state"])["lastSequence"])
	if maxSeq == 0 && (len(acceptedIDs) > 0 || len(duplicateIDs) > 0) {
		maxSeq = maxSequence(events)
	}
	_, _ = e.WithState(func(state M) (any, error) {
		meta := asMap(state["cloud_sync_metadata"])
		meta["functions_origin"] = origin
		meta["last_attempt_at"] = nowISO()
		if len(rejected) > 0 || asBool(result["ok"]) == false {
			meta["status"] = "conflict"
			meta["rejected_events"] = rejected
			auth := asMap(state["cloud_auth"])
			auth["status"] = "sync_error"
			auth["last_error"] = "cloud sync rejected events"
			state["cloud_auth"] = auth
		} else {
			meta["status"] = "synced"
			meta["last_success_at"] = nowISO()
			meta["last_pushed_sequence"] = maxSeq
			meta["pending_event_ids"] = []any{}
			meta["duplicate_event_ids"] = stringAnySlice(duplicateIDs)
			meta["rejected_events"] = []any{}
		}
		if cadence := asMap(result["syncCadence"]); len(cadence) > 0 {
			meta["sync_cadence_seconds"] = asInt(cadence["cadenceSeconds"])
			meta["sync_mode"] = asString(cadence["mode"])
			meta["next_eligible_sync_at"] = cadence["nextEligibleSyncAt"]
		}
		if ent := asMap(result["entitlement"]); len(ent) > 0 {
			meta["entitlement_plan"] = asString(ent["plan"])
		}
		state["cloud_sync_metadata"] = meta
		return nil, nil
	})
	state, _ := e.State()
	if len(rejected) > 0 || asBool(result["ok"]) == false {
		return M{"ok": false, "status": "conflict", "rejected_events": rejected, "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
	}
	status := "synced"
	if len(duplicateIDs) > 0 && len(acceptedIDs) == 0 {
		status = "duplicates"
	}
	return M{"ok": true, "status": status, "accepted_event_ids": stringAnySlice(acceptedIDs), "duplicate_event_ids": stringAnySlice(duplicateIDs), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
}

func normalizeEventIDs(v any) []string {
	out := []string{}
	for _, item := range asSlice(v) {
		if m := asMap(item); len(m) > 0 {
			out = append(out, asString(m["eventId"]))
		} else if s := asString(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func stringAnySlice(items []string) []any {
	out := make([]any, len(items))
	for i, item := range items {
		out[i] = item
	}
	return out
}

func maxSequence(events []any) int {
	max := 0
	for _, item := range events {
		if seq := asInt(asMap(item)["sequence"]); seq > max {
			max = seq
		}
	}
	return max
}

func (e *Engine) recordCloudError(err error, events []any, origin string) M {
	cf, ok := err.(*cloudError)
	status := "sync_error"
	message := err.Error()
	if ok && asString(cf.details["reason"]) == "plan_limit_sync_cadence" {
		status = "plan_limited"
		message = sanitizeErrorMessage(cf.message, cf.details)
	}
	_, _ = e.WithState(func(state M) (any, error) {
		meta := asMap(state["cloud_sync_metadata"])
		meta["status"] = status
		meta["functions_origin"] = origin
		meta["last_error"] = message
		if ok {
			if retry := asInt(cf.details["retryAfterSeconds"]); retry > 0 {
				meta["next_eligible_sync_at"] = cf.details["nextEligibleSyncAt"]
				meta["sync_cadence_seconds"] = asInt(cf.details["cadenceSeconds"])
			}
		}
		state["cloud_sync_metadata"] = meta
		return nil, nil
	})
	state, _ := e.State()
	return M{"ok": false, "status": status, "message": message, "queued_event_count": len(events), "sync": asMap(e.SyncProgressPayload(state)["sync"]), "privacy": PrivacyNotice}
}

type cloudError struct {
	message string
	details M
	status  int
}

func (e *cloudError) Error() string {
	return sanitizeErrorMessage(e.message, e.details)
}

func postJSON(origin, functionName, idToken, deviceToken string, payload M, out *M) error {
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, safeURLJoin(origin, functionName), bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if idToken != "" {
		req.Header.Set("Authorization", "Bearer "+idToken)
	}
	if deviceToken != "" {
		req.Header.Set("X-MCP-Miner-Device-Token", deviceToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return err
	}
	*out = asMap(normalizeJSON(parsed))
	if resp.StatusCode >= 400 {
		errObj := asMap((*out)["error"])
		return &cloudError{message: asString(errObj["message"]), details: asMap(errObj["details"]), status: resp.StatusCode}
	}
	return nil
}

func configuredOrigin(args M) string {
	if origin := asString(args["functions_origin"]); origin != "" {
		return origin
	}
	return DefaultFunctionsOrigin
}

func (e *Engine) readAuthCredentials() M {
	raw, err := os.ReadFile(e.AuthPath)
	if err != nil {
		return M{}
	}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return M{}
	}
	return asMap(normalizeJSON(parsed))
}

func (e *Engine) writeAuthCredentials(creds M) error {
	if err := os.MkdirAll(filepath.Dir(e.AuthPath), 0o700); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(creds, "", "  ")
	return os.WriteFile(e.AuthPath, append(raw, '\n'), 0o600)
}

func (e *Engine) BackupStatusPayload(args M) M {
	var out M
	if err := postJSON(configuredOrigin(args), "getCloudBackupStatus", asString(args["id_token"]), asString(args["device_token"]), M{"data": M{"privacyClass": "abstract"}}, &out); err != nil {
		return M{"ok": false, "status": "backup_error", "message": err.Error(), "privacy": PrivacyNotice}
	}
	result := asMap(out["result"])
	status := "available"
	if asBool(result["eligible"]) == false {
		status = "pro_required"
	}
	return M{"ok": asBool(result["ok"]), "status": status, "eligible": asBool(result["eligible"]), "entitlement": result["entitlement"], "backup": result["backup"], "privacy": PrivacyNotice}
}

func (e *Engine) CreateCloudBackupPayload(args M) M {
	state, _ := e.State()
	backup := e.buildBackupPayload(state)
	var out M
	err := postJSON(configuredOrigin(args), "createCloudBackup", asString(args["id_token"]), asString(args["device_token"]), M{"data": M{"backup": backup}}, &out)
	if err != nil {
		if ce, ok := err.(*cloudError); ok && asString(ce.details["reason"]) == "plan_limit_backup_restore" {
			return M{"ok": false, "status": "pro_required", "message": ce.message, "privacy": PrivacyNotice}
		}
		return M{"ok": false, "status": "backup_error", "message": err.Error(), "privacy": PrivacyNotice}
	}
	result := asMap(out["result"])
	return M{"ok": asBool(result["ok"]), "status": "created", "backup": result["backup"], "privacy": PrivacyNotice}
}

func (e *Engine) RestoreCloudBackupPayload(args M) M {
	if !asBool(args["confirm"]) {
		return M{"ok": false, "status": "confirmation_required", "message": "Pass confirm: true before restore.", "privacy": PrivacyNotice}
	}
	var out M
	if err := postJSON(configuredOrigin(args), "restoreCloudBackup", asString(args["id_token"]), asString(args["device_token"]), M{"data": M{"confirm": true}}, &out); err != nil {
		return M{"ok": false, "status": "restore_error", "message": err.Error(), "privacy": PrivacyNotice}
	}
	result := asMap(out["result"])
	conflict := asMap(result["conflict"])
	if asString(conflict["freshness"]) == "local_newer" && !asBool(args["allow_overwrite"]) {
		return M{"ok": false, "status": "local_newer_conflict", "conflict": conflict, "backup": result["backup"], "privacy": PrivacyNotice}
	}
	payload := asMap(result["payload"])
	backupFile := e.backupBeforeRestore()
	_, _ = e.WithState(func(state M) (any, error) {
		sections := asMap(payload["sections"])
		if len(sections) == 0 {
			sections = payload
		}
		e.applyBackupSections(state, sections)
		return nil, nil
	})
	state, _ := e.State()
	return M{"ok": true, "status": "restored", "backup": result["backup"], "conflict": conflict, "rollback_file": filepath.Base(backupFile), "state": M{"space_bucks": state["space_bucks"], "report_mode": state["report_mode"]}, "privacy": PrivacyNotice}
}

func (e *Engine) backupBeforeRestore() string {
	backup := fmt.Sprintf("%s.backup-before-cloud-restore-%d", e.StatePath, time.Now().UTC().UnixNano())
	if raw, err := os.ReadFile(e.StatePath); err == nil {
		_ = os.WriteFile(backup, raw, 0o600)
	}
	return backup
}

func (e *Engine) buildBackupPayload(state M) M {
	profile := asMap(clone(asMap(state["profile"])))
	delete(profile, "avatar_concept_prompt")
	assets := []any{}
	for _, asset := range asSlice(profile["generated_assets"]) {
		ref := asString(asMap(asset)["asset_ref"])
		if ref != "" && !strings.Contains(ref, "/") && !strings.Contains(ref, "\\") {
			assets = append(assets, asset)
		}
	}
	profile["generated_assets"] = assets
	return M{"profile": profile, "progress": M{"space_bucks": state["space_bucks"], "suit_condition": state["suit_condition"], "current_asteroid_class_id": state["current_asteroid_class_id"], "unlocked_asteroid_class_ids": state["unlocked_asteroid_class_ids"], "unlocked_machine_ids": state["unlocked_machine_ids"], "asteroid_progress": state["asteroid_progress"], "asteroid_progress_by_id": state["asteroid_progress_by_id"], "rare_find_pity_score": state["rare_find_pity_score"], "asteroid_depletions": state["asteroid_depletions"], "hazard_log": state["hazard_log"], "stats": state["stats"]}, "inventory": state["inventory"], "orders": M{"orders": state["orders"], "completed_orders": state["completed_orders"], "order_generation_index": state["order_generation_index"], "weekly_contracts": state["weekly_contracts"], "completed_weekly_contracts": state["completed_weekly_contracts"], "weekly_contract_generation_index": state["weekly_contract_generation_index"], "fabrication_queue": state["fabrication_queue"], "completed_products": state["completed_products"], "fabrication_sequence": state["fabrication_sequence"]}, "upgrades": M{"upgrades": state["upgrades"], "unlocked_machine_ids": state["unlocked_machine_ids"]}, "base": M{"base_modules": state["base_modules"]}, "cosmetics": M{"customization_unlocks": profile["customization_unlocks"], "generated_assets": profile["generated_assets"], "store_transactions": state["store_transactions"]}, "settings": M{"report_mode": state["report_mode"], "cloud_sync": state["cloud_sync"]}, "syncMetadata": M{"state_schema_version": state["state_schema_version"], "status": asMap(state["cloud_sync_metadata"])["status"], "last_pushed_sequence": asMap(state["cloud_sync_metadata"])["last_pushed_sequence"], "last_pulled_version": asMap(state["cloud_sync_metadata"])["last_pulled_version"], "sync_cadence_seconds": asMap(state["cloud_sync_metadata"])["sync_cadence_seconds"], "sync_mode": asMap(state["cloud_sync_metadata"])["sync_mode"], "next_eligible_sync_at": asMap(state["cloud_sync_metadata"])["next_eligible_sync_at"], "entitlement_plan": asMap(state["cloud_sync_metadata"])["entitlement_plan"], "device_id": asMap(state["cloud_sync_metadata"])["device_id"]}}
}

func (e *Engine) applyBackupSections(state M, sections M) {
	if profile := asMap(sections["profile"]); len(profile) > 0 {
		for k, v := range profile {
			asMap(state["profile"])[k] = v
		}
	}
	if progress := asMap(sections["progress"]); len(progress) > 0 {
		for _, key := range []string{"space_bucks", "suit_condition", "current_asteroid_class_id", "unlocked_asteroid_class_ids", "unlocked_machine_ids", "asteroid_progress", "asteroid_progress_by_id", "stats"} {
			if v, ok := progress[key]; ok {
				state[key] = v
			}
		}
	}
	for _, key := range []string{"inventory"} {
		if v, ok := sections[key]; ok {
			state[key] = v
		}
	}
	if orders := asMap(sections["orders"]); len(orders) > 0 {
		for k, v := range orders {
			state[k] = v
		}
	}
	if upgrades := asMap(sections["upgrades"]); len(upgrades) > 0 {
		for k, v := range upgrades {
			state[k] = v
		}
	}
	if base := asMap(sections["base"]); len(base) > 0 {
		for k, v := range base {
			state[k] = v
		}
	}
	if settings := asMap(sections["settings"]); len(settings) > 0 {
		for k, v := range settings {
			state[k] = v
		}
	}
	if meta := asMap(sections["syncMetadata"]); len(meta) > 0 {
		for k, v := range meta {
			asMap(state["cloud_sync_metadata"])[k] = v
		}
	}
}
