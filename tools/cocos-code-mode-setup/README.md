# Cocos Code Mode MCP Setup

This folder documents how to connect Cocos Creator 3.8.8 to Codex through
`RomaRogov/cocos-code-mode` and the `@utcp/code-mode-mcp` bridge.

The goal is to let Codex edit Cocos scenes, assets, nodes, components, and
previews through the Cocos editor instead of generating all UI at runtime.

## What Gets Installed

There are two moving parts:

1. Cocos Creator extension: `cocos-code-mode`
   - Runs inside Cocos Creator.
   - Starts a local UTCP HTTP server.
   - Writes `%USERPROFILE%\.utcp_config.json`.
2. Codex MCP bridge: `@utcp/code-mode-mcp`
   - Runs as a stdio MCP server launched by Codex.
   - Reads `%USERPROFILE%\.utcp_config.json`.
   - Bridges Codex MCP calls to the Cocos UTCP HTTP server.

## One-Time Setup On A New Machine

1. Install Node.js 18+.
2. Install Cocos Creator 3.8.8.
3. Import or copy `cocos-code-mode` into the project:

   ```text
   <project>/extensions/cocos-code-mode
   ```

   If you downloaded the GitHub source zip, it is not prebuilt. You must build
   it before Cocos can load it.

4. From the project root, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File tools/cocos-code-mode-setup/setup-cocos-code-mode.ps1
   ```

5. Restart Cocos Creator and open this project.
6. Confirm the Cocos console contains lines like:

   ```text
   [cocos-code-mode] UTCP Server started on port 58084
   [UtcpConfigManager] Saved UTCP config to C:\Users\<you>\.utcp_config.json
   ```

7. Restart Codex so it reloads MCP servers.

## Checks

Check Codex sees the MCP server:

```powershell
codex.cmd mcp list
```

Expected:

```text
code-mode  cmd  /c npx @utcp/code-mode-mcp  enabled
```

Check Cocos UTCP is alive:

```powershell
$utcp = Get-Content "$env:USERPROFILE\.utcp_config.json" -Raw | ConvertFrom-Json
$url = $utcp.manual_call_templates[0].url
Invoke-RestMethod -Uri $url
```

Check a Cocos editor tool works:

```powershell
Invoke-RestMethod -Uri "http://localhost:<port>/tools/assetGetTree?assetPath=assets"
```

Replace `<port>` with the port in `.utcp_config.json`.

## Fixes Applied By The Setup Script

The GitHub source zip currently needs two local fixes for this project:

1. `source/utcp/utcp-server.ts`

   The source imports a singular file name:

   ```ts
   import './tools/set-property-tool';
   ```

   But the actual file is plural:

   ```ts
   import './tools/set-properties-tool';
   ```

2. `source/utcp/tools/asset-tools.ts`

   `sharp` is a native module and can fail to load inside the Cocos Creator
   Electron runtime:

   ```text
   Could not load the "sharp" module using the win32-x64 runtime
   ```

   The setup script makes `sharp` optional and skips it inside Electron. Asset
   previews then fall back to Cocos Creator's own preview panel path.

## Codex Config

The effective Codex Desktop MCP config is user-level:

```text
%USERPROFILE%\.codex\config.toml
```

Add:

```toml
[mcp_servers.code-mode]
type = "stdio"
command = "cmd"
args = ["/c", "npx", "--yes", "@utcp/code-mode-mcp"]
startup_timeout_sec = 120

[mcp_servers.code-mode.env]
UTCP_CONFIG_FILE = "C:\\Users\\<you>\\.utcp_config.json"
```

The project-level `.codex/config.toml` is useful as documentation, but the
current Codex Desktop tooling did not load MCP servers from it during setup.

## Windows `isolated-vm` Fix

`@utcp/code-mode-mcp` depends on `@utcp/code-mode`, which depends on
`isolated-vm`. On Windows with Node 24, the first npx install can fail at MCP
startup with:

```text
No native build was found for platform=win32 arch=x64 runtime=node abi=137
loaded from: ...\node_modules\isolated-vm
```

Fix it by rebuilding the cached native dependency:

```powershell
cd $env:LOCALAPPDATA\npm-cache\_npx\<cache-id>
npm rebuild isolated-vm --build-from-source
```

The setup script tries to locate the npx cache and run this rebuild
automatically if its MCP probe fails.

You can verify the bridge manually with:

```powershell
powershell -ExecutionPolicy Bypass -File tools/cocos-code-mode-setup/setup-cocos-code-mode.ps1 -SkipNpmInstall
```

The successful probe prints MCP tools such as:

```text
register_manual
search_tools
list_tools
tools_info
call_tool_chain
```

## Notes For This Project

- Keep runtime assets under `assets/resources`.
- Prefer prefab/UI assets for the new game UI, with runtime code only binding
  labels, bars, states, and callbacks.
- Avoid shipping `node_modules`, `dist`, or extension source in a release build
  unless intentionally distributing the editor extension with the project.
