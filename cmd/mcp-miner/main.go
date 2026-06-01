package main

import (
	"fmt"
	"os"

	"github.com/jrslyce/mcp-miner/internal/miner"
)

func main() {
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

	args := os.Args[1:]
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
