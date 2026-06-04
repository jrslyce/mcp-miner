package miner

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	pluginMarketplaceName = "mcp-miner"
	pluginRef             = "mcp-miner@mcp-miner"
	pluginName            = "MCP Miner"
)

var (
	legacyMarketplaceNames = []string{"diamond-mcp"}
	legacyPluginRefs       = []string{"mcp-miner@diamond-mcp"}
	standaloneMCPHeaders   = []string{"mcp_servers.mcp-miner", `mcp_servers."mcp-miner"`}
)

type installOptions struct {
	config  string
	root    string
	dryRun  bool
	remove  bool
	rebuild bool
}

func RunBuildPlugin(args []string, stdout, stderr io.Writer) error {
	if len(args) > 0 {
		return fmt.Errorf("build-plugin does not accept arguments")
	}
	root, err := LocateRoot()
	if err != nil {
		return err
	}
	binaryPath, err := BuildPluginBinary(root, stdout, stderr)
	if err != nil {
		return err
	}
	fmt.Fprintln(stdout, binaryPath)
	return nil
}

func BuildPluginBinary(root string, stdout, stderr io.Writer) (string, error) {
	binDir := filepath.Join(root, "plugins", "mcp-miner", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return "", err
	}

	binaryName := "mcp-miner"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	binaryPath := filepath.Join(binDir, binaryName)

	goCommand := os.Getenv("GO")
	if goCommand == "" {
		goCommand = "go"
	}
	cmd := exec.Command(goCommand, "build", "-trimpath", "-o", binaryPath, "./cmd/mcp-miner")
	cmd.Dir = root
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("failed to build MCP Miner Go binary with %s: %w", goCommand, err)
	}

	hookBinaryPath := filepath.Join(binDir, "mcp-miner")
	if binaryPath != hookBinaryPath {
		if err := copyFile(binaryPath, hookBinaryPath); err != nil {
			return "", err
		}
	}
	if err := writeHostHooks(root); err != nil {
		return "", err
	}

	return binaryPath, nil
}

type pluginHookDefinition struct {
	Name    string
	Matcher string
	Mode    string
	Status  string
}

type pluginHooksConfig struct {
	Hooks map[string][]pluginHookEntry `json:"hooks"`
}

type pluginHookEntry struct {
	Matcher string              `json:"matcher,omitempty"`
	Hooks   []pluginHookCommand `json:"hooks"`
}

type pluginHookCommand struct {
	Type          string `json:"type"`
	Command       string `json:"command"`
	Timeout       int    `json:"timeout"`
	StatusMessage string `json:"statusMessage"`
}

func writeHostHooks(root string) error {
	prefix := `"$PLUGIN_ROOT/bin/mcp-miner" hook`
	if runtime.GOOS == "windows" {
		prefix = `cmd /d /c call "%PLUGIN_ROOT%\bin\mcp-miner.exe" hook`
	}

	definitions := []pluginHookDefinition{
		{
			Name:    "SessionStart",
			Matcher: "startup|resume|clear|compact",
			Mode:    "session_start",
			Status:  "Powering MCP Miner",
		},
		{
			Name:   "UserPromptSubmit",
			Mode:   "user_prompt_submit",
			Status: "Scanning asteroid work signal",
		},
		{
			Name:   "SubagentStart",
			Mode:   "subagent_start",
			Status: "Tagging MCP Miner agent shift",
		},
		{
			Name:   "SubagentStop",
			Mode:   "subagent_stop",
			Status: "Closing MCP Miner agent shift",
		},
		{
			Name:    "PostToolUse",
			Matcher: ".*",
			Mode:    "post_tool_use",
			Status:  "Mining Codex work",
		},
		{
			Name:   "Stop",
			Mode:   "stop",
			Status: "Preparing MCP Miner report",
		},
	}

	config := pluginHooksConfig{Hooks: map[string][]pluginHookEntry{}}
	for _, definition := range definitions {
		entry := pluginHookEntry{
			Matcher: definition.Matcher,
			Hooks: []pluginHookCommand{{
				Type:          "command",
				Command:       fmt.Sprintf("%s %s", prefix, definition.Mode),
				Timeout:       10,
				StatusMessage: definition.Status,
			}},
		}
		config.Hooks[definition.Name] = []pluginHookEntry{entry}
	}

	bytes, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	bytes = append(bytes, '\n')
	return os.WriteFile(filepath.Join(root, "plugins", "mcp-miner", "hooks", "hooks.json"), bytes, 0o644)
}

func RunInstallCodexPlugin(args []string, stdout, stderr io.Writer) error {
	options, err := parseInstallOptions(args)
	if err != nil {
		return err
	}
	return InstallCodexPlugin(options, stdout, stderr)
}

func parseInstallOptions(args []string) (installOptions, error) {
	home, _ := os.UserHomeDir()
	options := installOptions{
		config:  filepath.Join(home, ".codex", "config.toml"),
		rebuild: true,
	}
	if root, err := LocateRoot(); err == nil {
		options.root = root
	}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--config":
			if i+1 >= len(args) {
				return options, errors.New("--config requires a path")
			}
			i++
			options.config = args[i]
		case "--repo-root":
			if i+1 >= len(args) {
				return options, errors.New("--repo-root requires a path")
			}
			i++
			options.root = args[i]
		case "--dry-run":
			options.dryRun = true
		case "--uninstall":
			options.remove = true
		case "--no-rebuild":
			options.rebuild = false
		default:
			return options, fmt.Errorf("unknown install option %q", args[i])
		}
	}
	if options.root == "" {
		return options, errors.New("could not locate repository root; pass --repo-root")
	}
	return options, nil
}

func InstallCodexPlugin(options installOptions, stdout, stderr io.Writer) error {
	resolvedRoot, err := filepath.Abs(options.root)
	if err != nil {
		return err
	}
	resolvedConfig, err := filepath.Abs(options.config)
	if err != nil {
		return err
	}

	if !options.remove {
		if err := ensurePluginFiles(resolvedRoot, options.rebuild, stdout, stderr); err != nil {
			return err
		}
	}

	currentConfig := ""
	if bytes, err := os.ReadFile(resolvedConfig); err == nil {
		currentConfig = string(bytes)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	updatedConfig := uninstallConfig(currentConfig)
	if !options.remove {
		updatedConfig = installConfig(currentConfig, resolvedRoot)
	}

	if options.dryRun {
		fmt.Fprint(stdout, updatedConfig)
		return nil
	}

	if updatedConfig == currentConfig {
		if options.remove {
			fmt.Fprintf(stdout, "%s is already removed from %s.\n", pluginName, resolvedConfig)
		} else {
			fmt.Fprintf(stdout, "%s is already installed in %s.\n", pluginName, resolvedConfig)
		}
		return nil
	}

	configDir := filepath.Dir(resolvedConfig)
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(resolvedConfig); err == nil {
		backupPath := fmt.Sprintf("%s.backup-%s", resolvedConfig, time.Now().UTC().Format("20060102150405"))
		if err := copyFile(resolvedConfig, backupPath); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "Backed up existing Codex config to %s.\n", backupPath)
	}

	if err := os.WriteFile(resolvedConfig, []byte(updatedConfig), 0o644); err != nil {
		return err
	}

	if options.remove {
		fmt.Fprintf(stdout, "%s entries removed from %s.\n", pluginName, resolvedConfig)
	} else {
		fmt.Fprintf(stdout, "%s installed in %s.\n", pluginName, resolvedConfig)
		fmt.Fprintln(stdout, "This enables the Codex plugin entry, not only the standalone MCP server.")
		fmt.Fprintln(stdout, "Restart Codex, then trust the 6 MCP Miner hooks in the Hooks UI.")
		fmt.Fprintln(stdout, "Verify with: Show my MCP Miner status")
	}
	return nil
}

func ensurePluginFiles(root string, rebuild bool, stdout, stderr io.Writer) error {
	requiredFiles := []string{
		filepath.Join(root, "plugins", "mcp-miner", ".codex-plugin", "plugin.json"),
		filepath.Join(root, ".agents", "plugins", "marketplace.json"),
	}
	for _, path := range requiredFiles {
		if _, err := os.Stat(path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("missing required plugin file: %s", path)
			}
			return err
		}
	}

	binaryPath := filepath.Join(root, "plugins", "mcp-miner", "bin", executableName())
	if _, err := os.Stat(binaryPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if !rebuild {
		return fmt.Errorf("missing MCP Miner Go binary: %s. Run `go run ./cmd/mcp-miner build-plugin` from a source checkout", binaryPath)
	}

	fmt.Fprintln(stdout, "MCP Miner Go binary is missing; rebuilding with go build.")
	_, err := BuildPluginBinary(root, stdout, stderr)
	return err
}

func executableName() string {
	if runtime.GOOS == "windows" {
		return "mcp-miner.exe"
	}
	return "mcp-miner"
}

func installConfig(source, root string) string {
	configText := removeInstallEntries(source)
	if strings.TrimSpace(configText) != "" {
		configText = strings.TrimRight(configText, "\r\n") + "\n\n"
	}

	return configText + fmt.Sprintf(`[marketplaces.%s]
source_type = "local"
source = %s

[plugins.%s]
enabled = true
`, pluginMarketplaceName, tomlString(root), tomlString(pluginRef))
}

func uninstallConfig(source string) string {
	return strings.TrimRight(removeInstallEntries(source), "\r\n") + "\n"
}

func removeInstallEntries(source string) string {
	configText := removeTomlTable(source, "marketplaces."+pluginMarketplaceName)
	for _, name := range legacyMarketplaceNames {
		configText = removeTomlTable(configText, "marketplaces."+name)
	}
	configText = removeTomlTable(configText, `plugins."`+pluginRef+`"`)
	for _, ref := range legacyPluginRefs {
		configText = removeTomlTable(configText, `plugins."`+ref+`"`)
	}
	for _, header := range standaloneMCPHeaders {
		configText = removeTomlTable(configText, header)
	}
	return configText
}

func removeTomlTable(source, header string) string {
	lines := strings.SplitAfter(source, "\n")
	if len(lines) == 1 && lines[0] == "" {
		return ""
	}

	var out []string
	target := "[" + header + "]"
	for i := 0; i < len(lines); {
		if strings.TrimSpace(lines[i]) == target {
			i++
			for i < len(lines) && !isTomlTableHeader(lines[i]) {
				i++
			}
			continue
		}
		out = append(out, lines[i])
		i++
	}
	return strings.Join(out, "")
}

func isTomlTableHeader(line string) bool {
	trimmed := strings.TrimSpace(line)
	return strings.HasPrefix(trimmed, "[") && strings.Contains(trimmed, "]")
}

func tomlString(value string) string {
	bytes, _ := json.Marshal(value)
	return string(bytes)
}

func copyFile(source, destination string) error {
	bytes, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return os.WriteFile(destination, bytes, 0o755)
}
