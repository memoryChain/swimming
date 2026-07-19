param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,
    [string]$ProjectRoot = (Get-Location).Path,
    [switch]$RequireCocosMeta,
    [switch]$FailOnError
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$manifest = Get-Content -LiteralPath (Resolve-Path -LiteralPath $ManifestPath) -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { throw "Unsupported schemaVersion: $($manifest.schemaVersion)" }
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$defaults = $manifest.budgets
$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
$rows = @()
$totalBytes = 0L

function Budget-For($asset) {
    if ($asset.maxBytes) { return [long]$asset.maxBytes }
    switch ($asset.category) {
        'background' { return [long]$defaults.backgroundMaxBytes }
        'icon' { return [long]$defaults.iconMaxBytes }
        default { return [long]$defaults.spriteMaxBytes }
    }
}

foreach ($asset in $manifest.assets) {
    $path = Join-Path $root ([string]$asset.outputPath)
    if (-not (Test-Path -LiteralPath $path)) {
        $errors.Add("$($asset.id): missing output $($asset.outputPath)")
        continue
    }
    $file = Get-Item -LiteralPath $path
    $totalBytes += $file.Length
    $expectedFormat = ([string]$asset.format).ToLowerInvariant()
    $actualFormat = $file.Extension.TrimStart('.').ToLowerInvariant()
    if ($actualFormat -eq 'jpeg') { $actualFormat = 'jpg' }
    if ($actualFormat -ne $expectedFormat) { $errors.Add("$($asset.id): expected .$expectedFormat, got .$actualFormat") }

    $bitmap = [Drawing.Bitmap]::new($file.FullName)
    try {
        if ($asset.width -and $bitmap.Width -ne [int]$asset.width) { $errors.Add("$($asset.id): width $($bitmap.Width), expected $($asset.width)") }
        if ($asset.height -and $bitmap.Height -ne [int]$asset.height) { $errors.Add("$($asset.id): height $($bitmap.Height), expected $($asset.height)") }
        $maxEdge = if ($asset.category -eq 'icon') { [int]$defaults.iconMaxEdge } elseif ($asset.category -eq 'sprite') { [int]$defaults.spriteMaxEdge } else { 0 }
        if ($maxEdge -gt 0 -and [Math]::Max($bitmap.Width, $bitmap.Height) -gt $maxEdge) {
            $errors.Add("$($asset.id): maximum edge exceeds $maxEdge px")
        }

        $edgeOpaque = 0
        $hasAlpha = [Drawing.Image]::IsAlphaPixelFormat($bitmap.PixelFormat)
        if ($asset.edgePolicy -eq 'transparent') {
            if (-not $hasAlpha) { $errors.Add("$($asset.id): transparent edge policy requires an alpha channel") }
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                if ($bitmap.GetPixel($x, 0).A -gt 0) { $edgeOpaque++ }
                if ($bitmap.GetPixel($x, $bitmap.Height - 1).A -gt 0) { $edgeOpaque++ }
            }
            for ($y = 0; $y -lt $bitmap.Height; $y++) {
                if ($bitmap.GetPixel(0, $y).A -gt 0) { $edgeOpaque++ }
                if ($bitmap.GetPixel($bitmap.Width - 1, $y).A -gt 0) { $edgeOpaque++ }
            }
            if ($edgeOpaque -gt 0) { $errors.Add("$($asset.id): $edgeOpaque opaque edge pixels; add padding or recrop") }
        }

        $budget = Budget-For $asset
        if ($file.Length -gt $budget) {
            if ($asset.budgetOverride -eq $true -and $asset.budgetReason) {
                $warnings.Add("$($asset.id): budget override $($file.Length)/$budget bytes - $($asset.budgetReason)")
            } else {
                $errors.Add("$($asset.id): $($file.Length) bytes exceeds $budget")
            }
        }
        if ($RequireCocosMeta -and -not (Test-Path -LiteralPath "$path.meta")) { $errors.Add("$($asset.id): missing Cocos meta") }
        $rows += [pscustomobject]@{ Id = $asset.id; Category = $asset.category; Size = "$($bitmap.Width)x$($bitmap.Height)"; KiB = [math]::Round($file.Length / 1KB, 1); BudgetKiB = [math]::Round($budget / 1KB, 1); EdgeOpaque = $edgeOpaque; Status = 'CHECKED' }
    } finally {
        $bitmap.Dispose()
    }
}

$totalBudget = [long]$defaults.totalMaxBytes
if ($totalBytes -gt $totalBudget) { $errors.Add("feature total $totalBytes bytes exceeds $totalBudget") }
$rows | Format-Table -AutoSize
Write-Host "Total: $([math]::Round($totalBytes / 1KB, 1)) KiB / $([math]::Round($totalBudget / 1KB, 1)) KiB"
foreach ($warning in $warnings) { Write-Warning $warning }
foreach ($errorMessage in $errors) { Write-Host "ERROR: $errorMessage" -ForegroundColor Red }
if ($FailOnError -and $errors.Count -gt 0) { exit 1 }
if ($errors.Count -gt 0) { Write-Warning "$($errors.Count) validation error(s)." }
