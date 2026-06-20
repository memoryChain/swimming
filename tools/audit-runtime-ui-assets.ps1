param(
    [switch]$FailOnUnused
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$uiRoot = Join-Path $projectRoot 'assets/resources/ui'
$scanRoot = Join-Path $projectRoot 'assets'
$imageExtensions = '.png', '.jpg', '.jpeg'

if (-not (Test-Path -LiteralPath $uiRoot)) {
    throw "UI resource directory does not exist: $uiRoot"
}

$referenceFiles = Get-ChildItem -LiteralPath $scanRoot -Recurse -File | Where-Object {
    $_.Extension -in '.prefab', '.scene', '.ts', '.json', '.anim', '.mtl'
}
$referenceText = ($referenceFiles | ForEach-Object {
    Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
}) -join "`n"

$results = foreach ($image in Get-ChildItem -LiteralPath $uiRoot -Recurse -File | Where-Object Extension -in $imageExtensions) {
    $metaPath = "$($image.FullName).meta"
    $uuids = @()
    if (Test-Path -LiteralPath $metaPath) {
        $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
        if ($meta.uuid) {
            $uuids += [string]$meta.uuid
        }
        if ($meta.subMetas) {
            $meta.subMetas.PSObject.Properties.Value | ForEach-Object {
                if ($_.uuid) {
                    $uuids += [string]$_.uuid
                }
            }
        }
    }

    $relativePath = (Resolve-Path -LiteralPath $image.FullName -Relative).TrimStart('.', '\').Replace('\', '/')
    $used = $false
    foreach ($uuid in $uuids) {
        if ($referenceText.Contains($uuid)) {
            $used = $true
            break
        }
    }

    [pscustomobject]@{
        Status = if ($used) { 'USED' } else { 'UNUSED' }
        Path = $relativePath
    }
}

$results | Sort-Object Status, Path | Format-Table -AutoSize
$unused = @($results | Where-Object Status -eq 'UNUSED')
Write-Host "UI image files: $($results.Count), unused: $($unused.Count)"

if ($FailOnUnused -and $unused.Count -gt 0) {
    exit 1
}
