package miner

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func RunHook(engine *Engine, mode string, in io.Reader, out io.Writer, errOut io.Writer) error {
	raw, _ := io.ReadAll(in)
	engine.recordHookHeartbeat(mode, len(strings.TrimSpace(string(raw))) > 0)
	var payload any
	if len(strings.TrimSpace(string(raw))) > 0 {
		_ = json.Unmarshal(raw, &payload)
	}
	input := asMap(normalizeJSON(payload))
	var response M
	switch mode {
	case "session_start":
		response = engine.hookSessionStart(input)
	case "user_prompt_submit":
		response = engine.hookUserPrompt(input)
	case "post_tool_use":
		response = engine.hookPostTool(input)
	case "subagent_start":
		response = engine.hookSubagent(input, "starts")
	case "subagent_stop":
		response = engine.hookSubagent(input, "stops")
	case "stop":
		response = engine.hookStop(input)
	default:
		fmt.Fprintln(errOut, "Unknown MCP Miner hook mode:", mode)
		response = M{"continue": true}
	}
	enc := json.NewEncoder(out)
	return enc.Encode(response)
}

func (e *Engine) recordHookHeartbeat(mode string, payloadPresent bool) {
	path := filepath.Join(filepath.Dir(e.StatePath), "hook-heartbeat.jsonl")
	entry := M{
		"timestamp":       nowISO(),
		"mode":            mode,
		"payload_present": payloadPresent,
		"privacy_class":   "abstract",
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(append(raw, '\n'))
}

func (e *Engine) hookSessionStart(input M) M {
	_, _ = e.WithState(func(state M) (any, error) {
		e.AddStatEvent(state, "work_session_start", 0)
		state["last_session_id"] = asString(input["session_id"])
		state["last_seen_at"] = nowISO()
		return nil, nil
	})
	return M{"hookSpecificOutput": M{"hookEventName": "SessionStart", "additionalContext": "MCP Miner passive hooks are active. Track only abstract work-event rewards; do not expose prompts, code, file paths, repo names, or terminal output in game reports."}}
}

func (e *Engine) hookUserPrompt(input M) M {
	turnID := hookTurnID(input)
	_, _ = e.WithState(func(state M) (any, error) {
		e.EnsureTurn(state, turnID)
		e.AddEventReward(state, "work_user_prompt", turnID, "UserPromptSubmit", 0, "prompt", asString(input["session_id"]), "", "")
		state["last_seen_at"] = nowISO()
		return nil, nil
	})
	return M{"hookSpecificOutput": M{"hookEventName": "UserPromptSubmit", "additionalContext": "MCP Miner is tracking abstract work progress only. Do not mention it unless asked or a Stop hook report is requested."}}
}

func (e *Engine) hookPostTool(input M) M {
	eventType, lineCount, suffix := classifyTool(input)
	if eventType == "" {
		return M{"continue": true}
	}
	turnID := hookTurnID(input)
	projectID := ""
	if cwd := asString(input["cwd"]); cwd != "" {
		projectID = "project_" + shaHex(cwd)[:12]
	}
	_, _ = e.WithState(func(state M) (any, error) {
		e.EnsureTurn(state, turnID)
		e.AddEventReward(state, eventType, turnID, "PostToolUse", lineCount, suffix, asString(input["session_id"]), projectID, "")
		return nil, nil
	})
	return M{"continue": true}
}

func (e *Engine) hookSubagent(input M, counter string) M {
	_, _ = e.WithState(func(state M) (any, error) {
		agentID := "agent_" + shaHex(firstNonEmpty(asString(input["agent_id"]), asString(input["agent_type"]), "unknown-agent"))[:12]
		agent := asMap(asMap(state["agent_stats"])[agentID])
		if len(agent) == 0 {
			agent = M{"agent_type": firstNonEmpty(asString(input["agent_type"]), "unknown"), "starts": 0, "stops": 0, "last_seen_at": nil}
		}
		agent[counter] = asInt(agent[counter]) + 1
		agent["last_seen_at"] = nowISO()
		asMap(state["agent_stats"])[agentID] = agent
		return nil, nil
	})
	return M{"continue": true}
}

func (e *Engine) hookStop(input M) M {
	turnID := hookTurnID(input)
	var report string
	var should bool
	var visible bool
	_, _ = e.WithState(func(state M) (any, error) {
		e.EnsureTurn(state, turnID)
		if e.ShouldEmitReport(state) && !strings.Contains(asString(input["last_assistant_message"]), ReportPrefix) {
			report = e.BuildReport(state)
			e.RecordReport(state, report, turnID)
			should = true
			visible = shouldRequestVisibleReport(state, input)
		}
		return nil, nil
	})
	if should {
		response := M{"continue": true, "systemMessage": e.DisplayReport(report)}
		if visible {
			response["decision"] = "block"
			response["reason"] = visibleReportReason(report)
		}
		return response
	}
	return M{"continue": true}
}

func shouldRequestVisibleReport(state, input M) bool {
	if asBool(input["stop_hook_active"]) {
		return false
	}
	return asString(state["report_mode"]) == "every_turn_full"
}

func visibleReportReason(report string) string {
	return "Append this privacy-safe MCP Miner footer to the previous answer. Do not include prompts, code, commands, file paths, repository names, browser content, terminal output, or any other private work details.\n\n" + report
}

func hookTurnID(input M) string {
	return firstNonEmpty(asString(input["turn_id"]), "turn_local")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func classifyTool(input M) (string, int, string) {
	toolName := canonicalToolName(asString(input["tool_name"]))
	toolInput := input["tool_input"]
	if toolName == "multi_tool_use.parallel" {
		best := ""
		bestScore := -1
		bestLines := 0
		bestSuffix := asString(input["tool_use_id"])
		for _, child := range asSlice(asMap(toolInput)["tool_uses"]) {
			c := asMap(child)
			childInput := M{"tool_name": c["recipient_name"], "tool_input": asMap(c["parameters"]), "tool_response": input["tool_response"], "tool_use_id": input["tool_use_id"]}
			event, lines, suffix := classifyTool(childInput)
			if p := eventPriority(event); p > bestScore {
				best, bestScore, bestLines, bestSuffix = event, p, lines, suffix
			}
		}
		return best, bestLines, bestSuffix
	}
	if strings.Contains(toolName, "mcp-miner") {
		return "", 0, ""
	}
	if strings.Contains(toolName, "apply_patch") {
		patch := asString(toolInput)
		if patch == "" {
			patch = asString(input["command"])
		}
		return classifyPatch(patch), changedLines(patch), asString(input["tool_use_id"])
	}
	command := commandFromInput(toolInput)
	if command == "" {
		command = asString(input["command"])
	}
	if toolName == "bash" || strings.Contains(toolName, "exec_command") || command != "" {
		return classifyCommand(command, successful(input)), changedLines(command), asString(input["tool_use_id"])
	}
	if strings.Contains(toolName, "browser") || strings.Contains(toolName, "web") || strings.Contains(toolName, "search") {
		return "work_search", 0, asString(input["tool_use_id"])
	}
	return "", 0, ""
}

func canonicalToolName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.TrimPrefix(name, "functions.")
	return strings.ToLower(name)
}

func commandFromInput(v any) string {
	if s := asString(v); s != "" {
		return s
	}
	m := asMap(v)
	for _, key := range []string{"command", "cmd", "script"} {
		if s := asString(m[key]); s != "" {
			return s
		}
	}
	return ""
}

func classifyCommand(command string, ok bool) string {
	lower := strings.ToLower(command)
	if testCommand(lower) {
		if ok {
			return "work_test_pass"
		}
		return "work_test_fail"
	}
	if strings.Contains(lower, "git commit") || strings.Contains(lower, "git push") || strings.Contains(lower, "gh pr") {
		return "work_commit_or_pr"
	}
	if strings.Contains(lower, "rg ") || strings.Contains(lower, "grep ") || strings.Contains(lower, "findstr") {
		return "work_search"
	}
	if strings.Contains(lower, "get-content") || strings.Contains(lower, " cat ") || strings.HasPrefix(lower, "cat ") || strings.Contains(lower, "sed ") {
		return "work_file_read"
	}
	if strings.Contains(lower, "review") || strings.Contains(lower, "audit") || strings.Contains(lower, "inspect") {
		return "work_review"
	}
	return "work_review"
}

func classifyPatch(patch string) string {
	lower := strings.ToLower(patch)
	if strings.Contains(lower, ".md") || strings.Contains(lower, "docs/") {
		return "work_write_docs"
	}
	return "work_apply_patch"
}

func testCommand(command string) bool {
	return strings.Contains(command, "npm test") || strings.Contains(command, "npm run check") || strings.Contains(command, "go test") || strings.Contains(command, "ruby scripts/test") || strings.Contains(command, "pytest")
}

func successful(input M) bool {
	resp := asMap(input["tool_response"])
	if _, ok := resp["exit_code"]; ok {
		return asInt(resp["exit_code"]) == 0
	}
	status := strings.ToLower(asString(resp["status"]))
	return status == "" || status == "success" || status == "ok"
}

var diffLineRE = regexp.MustCompile(`(?m)^[+-][^+-]`)

func changedLines(text string) int {
	return len(diffLineRE.FindAllString(text, -1))
}

func eventPriority(event string) int {
	switch event {
	case "work_test_pass":
		return 100
	case "work_apply_patch":
		return 90
	case "work_test_fail":
		return 80
	case "work_commit_or_pr":
		return 70
	case "work_write_docs":
		return 60
	case "work_search":
		return 50
	case "work_file_read":
		return 40
	case "work_review":
		return 30
	default:
		return 0
	}
}
