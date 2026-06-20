param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string]$ExtensionPath = '',
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-TextReplacement([string]$Path, [string]$Find, [string]$Replace) {
    if (!(Test-Path $Path)) {
        throw "Missing file: $Path"
    }
    $text = Get-Content -Path $Path -Raw
    if ($text.Contains($Find)) {
        Set-Content -Path $Path -Encoding UTF8 -Value $text.Replace($Find, $Replace)
        Write-Host "Patched $Path"
    } else {
        Write-Host "Already patched or pattern not present: $Path"
    }
}

function Patch-SharpLazyLoad([string]$AssetToolsPath) {
    if (!(Test-Path $AssetToolsPath)) {
        throw "Missing file: $AssetToolsPath"
    }

    $text = Get-Content -Path $AssetToolsPath -Raw

    $text = $text.Replace("import sharp from 'sharp';`r`n", '')
    $text = $text.Replace("import sharp from 'sharp';`n", '')

    if ($text -notmatch 'async function loadSharp') {
        $anchor = "import os from 'os';"
        $helper = @"
import os from 'os';

async function loadSharp() {
    const versions = (globalThis as any).process?.versions;
    if (versions?.electron) {
        return null;
    }
    try {
        const module = await import('sharp');
        return module.default;
    } catch (e) {
        console.warn('Sharp is unavailable in this editor runtime; falling back to Cocos preview generation.', e);
        return null;
    }
}
"@
        if (!$text.Contains($anchor)) {
            throw "Could not find import anchor in $AssetToolsPath"
        }
        $text = $text.Replace($anchor, $helper)
    }

    $needle = "const image = sharp(sourcePath);"
    $replacement = @"
const sharp = await loadSharp();
                if (!sharp) {
                    throw new Error('sharp unavailable');
                }
                const image = sharp(sourcePath);
"@

    if ($text.Contains($needle) -and $text -notmatch 'const sharp = await loadSharp\(\);') {
        $text = $text.Replace($needle, $replacement)
    }

    Set-Content -Path $AssetToolsPath -Encoding UTF8 -Value $text
    Write-Host "Ensured optional sharp loading in $AssetToolsPath"
}

function Ensure-CodexMcpConfig() {
    $configDir = Join-Path $env:USERPROFILE '.codex'
    $configPath = Join-Path $configDir 'config.toml'
    $utcpConfig = Join-Path $env:USERPROFILE '.utcp_config.json'

    if (!(Test-Path $configDir)) {
        New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    }
    if (!(Test-Path $configPath)) {
        New-Item -ItemType File -Force -Path $configPath | Out-Null
    }

    $backupPath = "$configPath.bak-code-mode"
    Copy-Item -Path $configPath -Destination $backupPath -Force

    $text = Get-Content -Path $configPath -Raw
    if ($text -notmatch '\[mcp_servers\.code-mode\]') {
        $escapedUtcp = $utcpConfig.Replace('\', '\\')
        Add-Content -Path $configPath -Value @"

[mcp_servers.code-mode]
type = "stdio"
command = "cmd"
args = ["/c", "npx", "--yes", "@utcp/code-mode-mcp"]
startup_timeout_sec = 120

[mcp_servers.code-mode.env]
UTCP_CONFIG_FILE = "$escapedUtcp"
"@
        Write-Host "Added code-mode MCP config to $configPath"
    } else {
        Write-Host "code-mode MCP config already exists in $configPath"
    }

    Write-Host "Backup saved at $backupPath"
}

function Repair-CodeModeMcpNativeDeps() {
    Write-Host "Priming npx cache for @utcp/code-mode-mcp..."

    cmd /c "npx --yes --package @modelcontextprotocol/sdk --package @utcp/code-mode-mcp echo cached" | Out-Host

    $npxRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
    $bridgePackageJson = Get-ChildItem -Path $npxRoot -Recurse -Filter package.json -ErrorAction SilentlyContinue |
        Where-Object { (Get-Content -Path $_.FullName -Raw -ErrorAction SilentlyContinue) -match '"@utcp/code-mode-mcp"' } |
        Select-Object -First 1

    if (!$bridgePackageJson) {
        throw "Could not locate @utcp/code-mode-mcp in npx cache under $npxRoot"
    }

    $cacheRoot = Split-Path -Parent $bridgePackageJson.FullName
    while ($cacheRoot -and !(Test-Path (Join-Path $cacheRoot 'node_modules\@utcp\code-mode-mcp'))) {
        $parent = Split-Path -Parent $cacheRoot
        if ($parent -eq $cacheRoot) { break }
        $cacheRoot = $parent
    }
    if (!$cacheRoot -or !(Test-Path (Join-Path $cacheRoot 'node_modules\@modelcontextprotocol\sdk'))) {
        throw "Could not locate MCP SDK beside @utcp/code-mode-mcp in npx cache."
    }

    $sdkRoot = (Join-Path $cacheRoot 'node_modules\@modelcontextprotocol\sdk\dist\esm').Replace('\', '/')

    $probe = @"
import { pathToFileURL } from 'node:url';
const root = '$sdkRoot';
const { Client } = await import(pathToFileURL(root + '/client/index.js').href);
const { StdioClientTransport } = await import(pathToFileURL(root + '/client/stdio.js').href);

const transport = new StdioClientTransport({
  command: 'cmd',
  args: ['/c', 'npx', '--yes', '@utcp/code-mode-mcp'],
  env: { ...process.env, UTCP_CONFIG_FILE: process.env.UTCP_CONFIG_FILE }
});
const client = new Client({ name: 'probe', version: '1.0.0' });
await client.connect(transport);
const tools = await client.listTools();
console.log(JSON.stringify(tools.tools.map(t => t.name)));
await client.close();
"@

    $probePath = Join-Path $env:TEMP 'probe-code-mode-mcp.mjs'
    Set-Content -Path $probePath -Encoding UTF8 -Value $probe

    $env:UTCP_CONFIG_FILE = Join-Path $env:USERPROFILE '.utcp_config.json'
    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $result = & node "$probePath" 2>&1
    $probeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldErrorActionPreference
    if ($probeExitCode -eq 0) {
        Write-Host "code-mode MCP probe succeeded."
        Write-Host $result
        return
    }

    Write-Warning "Initial code-mode MCP probe failed. Attempting isolated-vm rebuild in npx cache."
    Write-Host $result

    $packageJsons = Get-ChildItem -Path $npxRoot -Recurse -Filter package.json -ErrorAction SilentlyContinue |
        Where-Object { (Get-Content -Path $_.FullName -Raw -ErrorAction SilentlyContinue) -match '"@utcp/code-mode-mcp"' }

    $roots = @()
    foreach ($packageJson in $packageJsons) {
        $candidate = Split-Path -Parent $packageJson.FullName
        while ($candidate -and !(Test-Path (Join-Path $candidate 'node_modules\isolated-vm'))) {
            $parent = Split-Path -Parent $candidate
            if ($parent -eq $candidate) { break }
            $candidate = $parent
        }
        if ($candidate -and (Test-Path (Join-Path $candidate 'node_modules\isolated-vm'))) {
            $roots += $candidate
        }
    }

    $roots = $roots | Sort-Object -Unique
    foreach ($root in $roots) {
        Write-Host "Rebuilding isolated-vm under $root"
        Push-Location $root
        try {
            cmd /c "npm rebuild isolated-vm --build-from-source"
        } finally {
            Pop-Location
        }
    }

    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $result = & node "$probePath" 2>&1
    $probeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldErrorActionPreference
    if ($probeExitCode -ne 0) {
        Write-Host $result
        throw "code-mode MCP probe still failed after isolated-vm rebuild."
    }

    Write-Host "code-mode MCP probe succeeded after isolated-vm rebuild."
    Write-Host $result
}

if ([string]::IsNullOrWhiteSpace($ExtensionPath)) {
    $ExtensionPath = Join-Path $ProjectRoot 'extensions\cocos-code-mode'
}

Write-Step "Using project root"
Write-Host $ProjectRoot

Write-Step "Using Cocos Code Mode extension"
Write-Host $ExtensionPath

if (!(Test-Path (Join-Path $ExtensionPath 'package.json'))) {
    throw "Could not find cocos-code-mode package.json at $ExtensionPath. Import or copy the extension first."
}

Write-Step "Patching extension source"
Ensure-TextReplacement `
    -Path (Join-Path $ExtensionPath 'source\utcp\utcp-server.ts') `
    -Find "import './tools/set-property-tool';" `
    -Replace "import './tools/set-properties-tool';"

Patch-SharpLazyLoad -AssetToolsPath (Join-Path $ExtensionPath 'source\utcp\tools\asset-tools.ts')

Push-Location $ExtensionPath
try {
    if (!$SkipNpmInstall) {
        Write-Step "Installing extension dependencies"
        npm install
    }

    Write-Step "Building extension"
    npm run build

    Write-Step "Testing extension main module"
    node -e "require('./dist/main.js'); console.log('main loaded')"
}
finally {
    Pop-Location
}

Write-Step "Configuring Codex MCP"
Ensure-CodexMcpConfig

Write-Step "Checking code-mode MCP native dependencies"
Repair-CodeModeMcpNativeDeps

Write-Step "Current Codex MCP list"
try {
    codex.cmd mcp list
} catch {
    Write-Warning "Could not run codex.cmd mcp list. You can verify manually after restarting Codex."
}

Write-Step "Next steps"
Write-Host "1. Restart Cocos Creator and open the project."
Write-Host "2. Confirm %USERPROFILE%\.utcp_config.json exists."
Write-Host "3. Restart Codex so it loads the code-mode MCP server."
