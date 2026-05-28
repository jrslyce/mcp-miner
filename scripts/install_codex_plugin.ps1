#Requires -Version 5.1
param(
  [string]$Config = (Join-Path $HOME ".codex\config.toml"),
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$DryRun,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$MarketplaceName = "diamond-mcp"
$PluginRef = "mcp-miner@diamond-mcp"
$PluginName = "MCP Miner"
$StandaloneMcpHeaders = @(
  "mcp_servers.mcp-miner",
  'mcp_servers."mcp-miner"'
)

function ConvertTo-TomlString {
  param([string]$Value)
  return ($Value | ConvertTo-Json -Compress)
}

function Test-TableHeader {
  param([string]$Line)
  return $Line -match '^\s*\[[^\]]+\]\s*(?:#.*)?$'
}

function Remove-TomlTable {
  param(
    [string]$Source,
    [string]$Header
  )

  $lines = @()
  if ($Source.Length -gt 0) {
    $lines = $Source -split "(?<=`n)"
  }
  $output = New-Object System.Collections.Generic.List[string]
  $index = 0
  $target = "[$Header]"

  while ($index -lt $lines.Count) {
    if ($lines[$index].Trim() -eq $target) {
      $index += 1
      while ($index -lt $lines.Count -and -not (Test-TableHeader $lines[$index])) {
        $index += 1
      }
      continue
    }

    $output.Add($lines[$index])
    $index += 1
  }

  return -join $output
}

function Install-Config {
  param(
    [string]$Source,
    [string]$ResolvedRepoRoot
  )

  $configText = Remove-TomlTable $Source "marketplaces.$MarketplaceName"
  $configText = (Remove-TomlTable $configText "plugins.`"$PluginRef`"").TrimEnd()
  foreach ($header in $StandaloneMcpHeaders) {
    $configText = (Remove-TomlTable $configText $header).TrimEnd()
  }
  if ($configText.Length -gt 0) {
    $configText = "$configText`n`n"
  }

  $repoRootToml = ConvertTo-TomlString $ResolvedRepoRoot
  return $configText + @"
[marketplaces.$MarketplaceName]
source_type = "local"
source = $repoRootToml

[plugins."$PluginRef"]
enabled = true
"@
}

function Uninstall-Config {
  param([string]$Source)

  $configText = Remove-TomlTable $Source "marketplaces.$MarketplaceName"
  $configText = (Remove-TomlTable $configText "plugins.`"$PluginRef`"").TrimEnd()
  return "$configText`n"
}

$resolvedRepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$resolvedConfig = [System.IO.Path]::GetFullPath($Config)
$manifestPath = Join-Path $resolvedRepoRoot "plugins\mcp-miner\.codex-plugin\plugin.json"
$marketplacePath = Join-Path $resolvedRepoRoot ".agents\plugins\marketplace.json"

if (-not $Uninstall) {
  if (-not (Get-Command ruby -ErrorAction SilentlyContinue)) {
    throw "Ruby is required because the MCP Miner plugin runs Ruby hooks and MCP tools. Install Ruby for Windows, reopen PowerShell, then rerun this script."
  }
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Missing plugin manifest: $manifestPath"
  }
  if (-not (Test-Path -LiteralPath $marketplacePath -PathType Leaf)) {
    throw "Missing marketplace file: $marketplacePath"
  }
}

$currentConfig = ""
if (Test-Path -LiteralPath $resolvedConfig -PathType Leaf) {
  $currentConfig = Get-Content -LiteralPath $resolvedConfig -Raw
}

if ($Uninstall) {
  $updatedConfig = Uninstall-Config $currentConfig
} else {
  $updatedConfig = Install-Config $currentConfig $resolvedRepoRoot
}

if ($DryRun) {
  Write-Output $updatedConfig
  exit 0
}

if ($updatedConfig -eq $currentConfig) {
  if ($Uninstall) {
    Write-Output "$PluginName is already removed from $resolvedConfig."
  } else {
    Write-Output "$PluginName is already installed in $resolvedConfig."
  }
  exit 0
}

$configDir = Split-Path -Parent $resolvedConfig
if ($configDir -and -not (Test-Path -LiteralPath $configDir -PathType Container)) {
  New-Item -ItemType Directory -Path $configDir | Out-Null
}

if (Test-Path -LiteralPath $resolvedConfig -PathType Leaf) {
  $backupPath = "$resolvedConfig.backup-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
  Copy-Item -LiteralPath $resolvedConfig -Destination $backupPath
  Write-Output "Backed up existing Codex config to $backupPath."
}

Set-Content -LiteralPath $resolvedConfig -Value $updatedConfig -NoNewline -Encoding UTF8

if ($Uninstall) {
  Write-Output "$PluginName entries removed from $resolvedConfig."
} else {
  Write-Output "$PluginName installed in $resolvedConfig."
  Write-Output "This enables the Codex plugin entry, not only the standalone MCP server."
  Write-Output "Restart Codex, then trust the 6 MCP Miner hooks in the Hooks UI."
  Write-Output "Verify with: Show my MCP Miner status"
}
