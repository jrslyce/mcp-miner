package main

import (
	"fmt"
	"os"

	"github.com/jrslyce/mcp-miner/internal/miner"
)

func main() {
	args := os.Args[1:]
	if len(args) > 0 {
		switch args[0] {
		case "build-plugin":
			if err := miner.RunBuildPlugin(args[1:], os.Stdout, os.Stderr); err != nil {
				fmt.Fprintln(os.Stderr, "MCP Miner:", err)
				os.Exit(1)
			}
			return
		case "install-codex-plugin":
			if err := miner.RunInstallCodexPlugin(args[1:], os.Stdout, os.Stderr); err != nil {
				fmt.Fprintln(os.Stderr, "MCP Miner:", err)
				os.Exit(1)
			}
			return
		case "update-plugin":
			root, err := miner.LocateRoot()
			if err != nil {
				fmt.Fprintln(os.Stderr, "MCP Miner:", err)
				os.Exit(1)
			}
			engine, err := miner.NewEngine(root)
			if err != nil {
				fmt.Fprintln(os.Stderr, "MCP Miner:", err)
				os.Exit(1)
			}
			payload := engine.UpdatePluginPayload(miner.M{"confirm": true}, os.Stdout, os.Stderr)
			if ok, _ := payload["ok"].(bool); !ok {
				fmt.Fprintln(os.Stderr, "MCP Miner:", payload["message"])
				os.Exit(1)
			}
			fmt.Println(payload["message"])
			return
		}
	}

	root, err := miner.LocateRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "MCP Miner:", err)
		os.Exit(1)
	}
	engine, err := miner.NewEngine(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "MCP Miner:", err)
		os.Exit(1)
	}

	if len(args) == 0 || args[0] == "mcp" {
		if err := miner.RunMCP(engine, os.Stdin, os.Stdout, os.Stderr); err != nil {
			fmt.Fprintln(os.Stderr, "MCP Miner:", err)
			os.Exit(1)
		}
		return
	}

	if args[0] == "hook" {
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "MCP Miner: missing hook mode")
			os.Exit(1)
		}
		if err := miner.RunHook(engine, args[1], os.Stdin, os.Stdout, os.Stderr); err != nil {
			fmt.Fprintln(os.Stderr, "MCP Miner:", err)
			os.Exit(1)
		}
		return
	}

	if args[0] == "validate-data" {
		fmt.Println(`{"ok":true}`)
		return
	}

	fmt.Fprintf(os.Stderr, "MCP Miner: unknown command %q\n", args[0])
	os.Exit(1)
}
