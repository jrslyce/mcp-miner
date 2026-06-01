package miner

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	CurrentStateSchemaVersion = 1
	DefaultDashboardURL       = "https://mcp-miner.web.app"
	DefaultFunctionsOrigin    = "https://us-central1-mcp-miner.cloudfunctions.net"
	DefaultSyncCadenceSeconds = 60
	DefaultJournalFilename    = "journal.jsonl"
	ReportPrefix              = "MCP Miner:"
	MeaningfulScore           = 3.0
	MilestoneInterval         = 250
	PrivacyNotice             = "No prompts, code, file paths, repo names, terminal output, browser content, app content, or raw transcripts included."
)

var (
	validReportModes = []string{"off", "every_turn_compact", "every_turn_full", "meaningful_turns_only", "session_summary_only", "milestones_only"}
	validAuthStates  = []string{"off", "unauthenticated", "link_pending", "linked", "sync_error"}
	privatePattern   = regexp.MustCompile(`(?i)(prompt|assistant|source.?code|terminal|command|file.?path|working.?director|repo|repository|browser|transcript|token|secret|api.?key|email)`)
)

type M map[string]any

func LocateRoot() (string, error) {
	candidates := []string{}
	for _, key := range []string{"MCP_MINER_REPO_ROOT", "PLUGIN_ROOT"} {
		if v := os.Getenv(key); v != "" {
			if key == "PLUGIN_ROOT" {
				candidates = append(candidates, filepath.Clean(filepath.Join(v, "..", "..")))
			}
			candidates = append(candidates, v)
		}
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, wd)
		candidates = append(candidates, filepath.Clean(filepath.Join(wd, "..", "..")))
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates, dir, filepath.Clean(filepath.Join(dir, "..", "..", "..")))
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		root, _ := filepath.Abs(c)
		if _, err := os.Stat(filepath.Join(root, "data", "materials.yaml")); err == nil {
			return root, nil
		}
	}
	return "", fmt.Errorf("could not locate data/materials.yaml")
}

func homeStatePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".mcp-miner", "state.json")
}

func asMap(v any) M {
	switch t := v.(type) {
	case M:
		return t
	case map[string]any:
		return M(t)
	case map[any]any:
		out := M{}
		for k, v := range t {
			out[fmt.Sprint(k)] = normalizeYAML(v)
		}
		return out
	default:
		return M{}
	}
}

func asSlice(v any) []any {
	switch t := v.(type) {
	case []any:
		return t
	case []M:
		out := make([]any, len(t))
		for i := range t {
			out[i] = t[i]
		}
		return out
	default:
		return []any{}
	}
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		return fmt.Sprint(t)
	}
}

func asInt(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	case json.Number:
		i, _ := t.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(t)
		return i
	default:
		return 0
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(t, 64)
		return f
	default:
		return 0
	}
}

func asBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return t == "true" || t == "1"
	default:
		return false
	}
}

func strSlice(v any) []string {
	out := []string{}
	for _, item := range asSlice(v) {
		if s := asString(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func hasString(items []string, needle string) bool {
	for _, item := range items {
		if item == needle {
			return true
		}
	}
	return false
}

func uniqueAppend(items []string, value string) []string {
	if value == "" || hasString(items, value) {
		return items
	}
	return append(items, value)
}

func clone(v any) any {
	b, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(b, &out)
	return normalizeJSON(out)
}

func normalizeYAML(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := M{}
		for k, v := range t {
			out[k] = normalizeYAML(v)
		}
		return out
	case map[any]any:
		out := M{}
		for k, v := range t {
			out[fmt.Sprint(k)] = normalizeYAML(v)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, v := range t {
			out[i] = normalizeYAML(v)
		}
		return out
	default:
		return v
	}
}

func normalizeJSON(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := M{}
		for k, v := range t {
			out[k] = normalizeJSON(v)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, v := range t {
			out[i] = normalizeJSON(v)
		}
		return out
	default:
		return v
	}
}

func shaHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func eventID(seed string) string {
	return "evt_" + shaHex(seed)[:16]
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func parseTime(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func round(v float64, places int) float64 {
	m := math.Pow10(places)
	return math.Round(v*m) / m
}

func stableJSON(v any) string {
	b, _ := json.Marshal(canonical(v))
	return string(b)
}

func canonical(v any) any {
	switch t := v.(type) {
	case M:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(t))
		for _, k := range keys {
			out[k] = canonical(t[k])
		}
		return out
	case map[string]any:
		return canonical(M(t))
	case []any:
		out := make([]any, len(t))
		for i, v := range t {
			out[i] = canonical(v)
		}
		return out
	default:
		return t
	}
}

func safeURLJoin(origin, fn string) string {
	origin = strings.TrimRight(origin, "/")
	if _, err := url.Parse(origin); err != nil {
		return origin + "/" + fn
	}
	return origin + "/" + fn
}

func sanitizeErrorMessage(message string, details M) string {
	reason := asString(details["reason"])
	if reason == "plan_limit_device_count" {
		maxDevices := asInt(details["maxDevices"])
		if maxDevices <= 0 {
			maxDevices = 1
		}
		return fmt.Sprintf("%s (plan_limit_device_count: Free supports %d device).", message, maxDevices)
	}
	if reason == "plan_limit_sync_cadence" {
		retry := asInt(details["retryAfterSeconds"])
		if retry > 0 {
			return fmt.Sprintf("%s Try again in %d seconds.", message, retry)
		}
	}
	if reason != "" {
		return message + " (" + reason + ")"
	}
	return message
}

func containsPrivateValue(v any) bool {
	switch t := v.(type) {
	case string:
		if strings.Contains(t, "\\") || strings.Contains(t, "/") {
			if strings.Contains(strings.ToLower(t), "mcp miner") || strings.Contains(strings.ToLower(t), "users") {
				return true
			}
		}
		return false
	case M:
		for k, v := range t {
			if privatePattern.MatchString(k) || containsPrivateValue(v) {
				return true
			}
		}
	case map[string]any:
		return containsPrivateValue(M(t))
	case []any:
		for _, item := range t {
			if containsPrivateValue(item) {
				return true
			}
		}
	}
	return false
}
