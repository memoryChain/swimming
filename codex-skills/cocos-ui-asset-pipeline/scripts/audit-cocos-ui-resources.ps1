param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$UiRoot = 'assets/resources/ui',
    [long]$MaxTotalBytes = 1572864,
    [switch]$FailOnError
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$uiPath = Join-Path $root $UiRoot
if (-not (Test-Path -LiteralPath $uiPath)) { throw "UI root does not exist: $uiPath" }
$extensions = '.png', '.jpg', '.jpeg', '.webp'
$referenceFiles = Get-ChildItem -LiteralPath (Join-Path $root 'assets') -Recurse -File | Where-Object {
    $_.Extension -in '.prefab', '.scene', '.ts', '.json', '.anim', '.mtl', '.material'
}
$referenceText = ($referenceFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue }) -join "`n"
$errors = New-Object System.Collections.Generic.List[string]
$rows = @()
$totalBytes = 0L

foreach ($image in Get-ChildItem -LiteralPath $uiPath -Recurse -File | Where-Object Extension -in $extensions) {
    $totalBytes += $image.Length
    $relative = $image.FullName.Substring($root.Length + 1).Replace('\', '/')
    $metaPath = "$($image.FullName).meta"
    $metaStatus = 'OK'
    $spriteFrameStatus = 'OK'
    $used = $false
    if (-not (Test-Path -LiteralPath $metaPath)) {
        $metaStatus = 'MISSING'
        $spriteFrameStatus = 'UNKNOWN'
        $errors.Add("missing meta: $relative")
    } else {
        try { $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json } catch { $meta = $null; $errors.Add("invalid meta: $relative") }
        if ($meta) {
            $uuids = @()
            if ($meta.uuid) { $uuids += [string]$meta.uuid }
            $hasSpriteFrame = $false
            if ($meta.subMetas) {
                foreach ($subMeta in $meta.subMetas.PSObject.Properties.Value) {
                    if ($subMeta.uuid) { $uuids += [string]$subMeta.uuid }
                    if ($subMeta.importer -eq 'sprite-frame') { $hasSpriteFrame = $true }
                }
            }
            if (-not $hasSpriteFrame) { $spriteFrameStatus = 'MISSING'; $errors.Add("missing SpriteFrame: $relative") }
            foreach ($uuid in $uuids) { if ($referenceText.Contains($uuid)) { $used = $true; break } }
        }
    }

    if (-not $used -and $relative.StartsWith('assets/resources/')) {
        $resourcePath = $relative.Substring('assets/resources/'.Length)
        $resourcePath = $resourcePath.Substring(0, $resourcePath.Length - $image.Extension.Length)
        $resourceDir = $resourcePath.Substring(0, [Math]::Max(0, $resourcePath.LastIndexOf('/')))
        if ($referenceText.Contains($resourcePath) -or ($resourceDir -and $referenceText.Contains($resourceDir))) { $used = $true }
    }
    if (-not $used) { $errors.Add("unused runtime image: $relative") }
    if ($image.BaseName -match '(?i)(source|sheet|contact|preview|raw)') { $errors.Add("source-like artifact under runtime resources: $relative") }

    $rows += [pscustomobject]@{ Status = if ($used -and $metaStatus -eq 'OK' -and $spriteFrameStatus -eq 'OK') { 'OK' } else { 'ERROR' }; KiB = [math]::Round($image.Length / 1KB, 1); Meta = $metaStatus; SpriteFrame = $spriteFrameStatus; Path = $relative }
}

if ($totalBytes -gt $MaxTotalBytes) { $errors.Add("UI runtime images total $totalBytes bytes exceeds $MaxTotalBytes") }
$rows | Sort-Object Status, Path | Format-Table -AutoSize
Write-Host "Runtime UI total: $([math]::Round($totalBytes / 1KB, 1)) KiB / $([math]::Round($MaxTotalBytes / 1KB, 1)) KiB"
foreach ($errorMessage in $errors) { Write-Host "ERROR: $errorMessage" -ForegroundColor Red }
if ($FailOnError -and $errors.Count -gt 0) { exit 1 }
if ($errors.Count -gt 0) { Write-Warning "$($errors.Count) audit error(s)." }
