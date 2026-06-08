package miner

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	updateRemoteDefault = "origin"
	updateCheckTimeout  = 6 * time.Second
	updateRunTimeout    = 2 * time.Minute
)

func (e *Engine) UpdateNoticePayload() M {
	return e.checkUpdateNotice(updateCheckTimeout)
}

func (e *Engine) UpdatePluginPayload(args M, stdout, stderr io.Writer) M {
	if !asBool(args["confirm"]) {
		return M{
			"ok":      false,
			"status":  "confirmation_required",
			"message": "Reply yes to update, then call update_plugin with confirm=true.",
			"privacy": PrivacyNotice,
		}
	}
	if !isGitCheckout(e.Root) {
		return M{"ok": false, "status": "not_git_checkout", "message": "This install is not running from a Git checkout, so automatic update is unavailable.", "privacy": PrivacyNotice}
	}
	if dirty, count := dirtyWorktree(e.Root); dirty {
		return M{"ok": false, "status": "dirty_worktree", "message": fmt.Sprintf("Automatic update paused because this checkout has %d local change(s). Commit, stash, or discard them first.", count), "privacy": PrivacyNotice}
	}

	remote := updateRemote()
	branch := updateBranch(e.Root, remote)
	if branch == "" {
		return M{"ok": false, "status": "unknown_branch", "message": "Could not resolve the remote default branch.", "privacy": PrivacyNotice}
	}
	currentBranch := currentGitBranch(e.Root)
	if currentBranch != "" && currentBranch != branch {
		return M{"ok": false, "status": "wrong_branch", "message": fmt.Sprintf("Automatic update is available only from %s. Current checkout is on a different branch.", branch), "branch": branch, "privacy": PrivacyNotice}
	}
	before := shortGitValue(e.Root, "rev-parse", "--short", "HEAD")

	if _, err := runGit(e.Root, updateRunTimeout, "pull", "--ff-only", remote, branch); err != nil {
		return M{"ok": false, "status": "pull_failed", "message": sanitizeUpdateText(err.Error()), "privacy": PrivacyNotice}
	}
	after := shortGitValue(e.Root, "rev-parse", "--short", "HEAD")

	if _, err := BuildPluginBinary(e.Root, stdout, stderr); err != nil {
		return M{"ok": false, "status": "build_failed", "message": sanitizeUpdateText(err.Error()), "current_commit": after, "privacy": PrivacyNotice}
	}
	if err := InstallCodexPlugin(installOptions{root: e.Root, rebuild: false}, stdout, stderr); err != nil {
		return M{"ok": false, "status": "codex_install_failed", "message": sanitizeUpdateText(err.Error()), "current_commit": after, "privacy": PrivacyNotice}
	}

	return M{
		"ok":               true,
		"status":           "updated",
		"previous_commit":  before,
		"current_commit":   after,
		"remote":           remote,
		"branch":           branch,
		"restart_required": true,
		"codex_plugin":     "rebuilt and installed",
		"other_agent_ide":  "If another IDE points at this checkout's MCP binary, restart that IDE so it loads the rebuilt server.",
		"message":          "Update installed. Restart Codex, then trust hooks again if Codex prompts.",
		"privacy":          PrivacyNotice,
	}
}

func (e *Engine) checkUpdateNotice(timeout time.Duration) M {
	base := M{
		"ok":          true,
		"status":      "current",
		"icon":        "",
		"update_tool": "update_plugin",
		"privacy":     PrivacyNotice,
	}
	version := pluginManifestVersion(e.Root)
	if version != "" {
		base["installed_version"] = version
	}
	if os.Getenv("MCP_MINER_SKIP_UPDATE_CHECK") == "1" || os.Getenv("MCP_MINER_UPDATE_CHECK") == "0" {
		base["status"] = "disabled"
		base["message"] = "Update check disabled."
		return base
	}
	if !isGitCheckout(e.Root) {
		base["ok"] = false
		base["status"] = "unavailable"
		base["message"] = "Update check unavailable because this install is not a Git checkout."
		return base
	}

	remote := updateRemote()
	branch := updateBranch(e.Root, remote)
	base["remote"] = remote
	if branch != "" {
		base["branch"] = branch
	}
	currentFull := strings.TrimSpace(shortGitValue(e.Root, "rev-parse", "HEAD"))
	currentShort := shortCommit(currentFull)
	base["current_commit"] = currentShort
	if currentFull == "" || branch == "" {
		base["ok"] = false
		base["status"] = "unavailable"
		base["message"] = "Update check could not read the local or remote Git revision."
		return base
	}

	if _, err := runGit(e.Root, timeout, "fetch", "--quiet", remote, branch); err != nil {
		base["ok"] = false
		base["status"] = "unavailable"
		base["message"] = "Update check could not reach Git."
		base["error"] = sanitizeUpdateText(err.Error())
		return base
	}
	latestFull := strings.TrimSpace(shortGitValue(e.Root, "rev-parse", "FETCH_HEAD"))
	base["latest_commit"] = shortCommit(latestFull)
	if latestFull == "" || latestFull == currentFull {
		base["message"] = "MCP Miner is up to date."
		return base
	}

	if err := runGitStatus(e.Root, timeout, "merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"); err == nil {
		changes := updateChangeDescriptions(e.Root)
		base["status"] = "update_available"
		base["icon"] = "🔴"
		base["changes"] = changes
		base["message"] = updateAvailableMessage(changes)
		base["prompt"] = "Would you like to update now? Reply yes or no."
		return base
	}
	if err := runGitStatus(e.Root, timeout, "merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD"); err == nil {
		base["status"] = "ahead"
		base["message"] = "This checkout is ahead of the remote default branch."
		return base
	}
	base["status"] = "diverged"
	base["icon"] = "🔴"
	base["message"] = "Remote updates exist, but this checkout has diverged. Manual review is recommended before updating."
	base["prompt"] = "Would you like help reviewing the update? Reply yes or no."
	return base
}

func updateAvailableMessage(changes []any) string {
	message := "🔴 Update available on Git."
	if len(changes) > 0 {
		message += " Latest changes: " + strings.Join(anyStrings(changes), "; ") + "."
	}
	return message + " Would you like to update now? Reply yes or no."
}

func anyStrings(items []any) []string {
	out := []string{}
	for _, item := range items {
		if s := asString(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func updateRemote() string {
	if remote := strings.TrimSpace(os.Getenv("MCP_MINER_UPDATE_REMOTE")); remote != "" {
		return remote
	}
	return updateRemoteDefault
}

func updateBranch(root, remote string) string {
	if branch := strings.TrimSpace(os.Getenv("MCP_MINER_UPDATE_BRANCH")); branch != "" {
		return branch
	}
	out, err := runGit(root, updateCheckTimeout, "ls-remote", "--symref", remote, "HEAD")
	if err == nil {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 3 && fields[0] == "ref:" && fields[2] == "HEAD" {
				return strings.TrimPrefix(fields[1], "refs/heads/")
			}
		}
	}
	if branch := strings.TrimSpace(shortGitValue(root, "rev-parse", "--abbrev-ref", "origin/HEAD")); strings.Contains(branch, "/") {
		parts := strings.SplitN(branch, "/", 2)
		return parts[1]
	}
	return "main"
}

func updateChangeDescriptions(root string) []any {
	out, err := runGit(root, updateCheckTimeout, "log", "--format=%s", "--max-count=5", "HEAD..FETCH_HEAD")
	if err != nil {
		return []any{"New commits are available."}
	}
	changes := []any{}
	for _, line := range strings.Split(out, "\n") {
		item := sanitizeUpdateText(line)
		if item != "" {
			changes = append(changes, item)
		}
	}
	if len(changes) == 0 {
		return []any{"New commits are available."}
	}
	return changes
}

func sanitizeUpdateText(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return ""
	}
	text = privatePattern.ReplaceAllString(text, "update")
	if len(text) > 160 {
		text = strings.TrimSpace(text[:157]) + "..."
	}
	return text
}

func pluginManifestVersion(root string) string {
	path := filepath.Join(root, "plugins", "mcp-miner", ".codex-plugin", "plugin.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var manifest M
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return ""
	}
	return asString(manifest["version"])
}

func isGitCheckout(root string) bool {
	if _, err := os.Stat(filepath.Join(root, ".git")); err == nil {
		return true
	}
	return runGitStatus(root, updateCheckTimeout, "rev-parse", "--is-inside-work-tree") == nil
}

func dirtyWorktree(root string) (bool, int) {
	out, err := runGit(root, updateCheckTimeout, "status", "--porcelain")
	if err != nil {
		return false, 0
	}
	count := 0
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count > 0, count
}

func shortGitValue(root string, args ...string) string {
	out, err := runGit(root, updateCheckTimeout, args...)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

func currentGitBranch(root string) string {
	branch := shortGitValue(root, "branch", "--show-current")
	if branch != "" {
		return branch
	}
	return shortGitValue(root, "rev-parse", "--abbrev-ref", "HEAD")
}

func shortCommit(commit string) string {
	commit = strings.TrimSpace(commit)
	if len(commit) > 12 {
		return commit[:12]
	}
	return commit
}

func runGitStatus(root string, timeout time.Duration, args ...string) error {
	_, err := runGit(root, timeout, args...)
	return err
}

func runGit(root string, timeout time.Duration, args ...string) (string, error) {
	git := os.Getenv("GIT")
	if git == "" {
		git = "git"
	}
	cmd := exec.Command(git, append([]string{"-C", root}, args...)...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return "", err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return stdout.String(), errors.New(msg)
		}
		return stdout.String(), nil
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		<-done
		return stdout.String(), fmt.Errorf("git %s timed out", strings.Join(args, " "))
	}
}
