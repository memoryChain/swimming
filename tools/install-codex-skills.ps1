[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string[]]$SkillNames = @('cocos-ui-asset-pipeline'),
    [string]$TargetRoot = (Join-Path $env:USERPROFILE '.codex\skills')
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Join-Path $PSScriptRoot 'codex-skills'
if (-not (Test-Path -LiteralPath $sourceRoot)) { throw "Skill source root does not exist: $sourceRoot" }
if (-not (Test-Path -LiteralPath $TargetRoot)) { New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null }

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
}

foreach ($skillName in $SkillNames) {
    if ($skillName -notmatch '^[a-z0-9-]+$') { throw "Invalid skill name: $skillName" }
    $source = Join-Path $sourceRoot $skillName
    $target = Join-Path $TargetRoot $skillName
    if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) { throw "Missing source SKILL.md: $source" }
    if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Force -Path $target | Out-Null }

    $copied = 0
    $unchanged = 0
    $planned = 0
    foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
        $relative = $file.FullName.Substring($source.Length).TrimStart('\')
        $destination = Join-Path $target $relative
        $destinationParent = Split-Path -Parent $destination
        $same = (Test-Path -LiteralPath $destination) -and ((Get-Sha256 $file.FullName) -eq (Get-Sha256 $destination))
        if ($same) { $unchanged++; continue }
        if ($PSCmdlet.ShouldProcess($destination, "Install $skillName")) {
            if (-not (Test-Path -LiteralPath $destinationParent)) { New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null }
            Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
            $copied++
        } else {
            $planned++
        }
    }
    Write-Host "$skillName installed at $target (copied=$copied unchanged=$unchanged planned=$planned)"
}
