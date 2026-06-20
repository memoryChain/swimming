param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string[]]$Exclude = @(),
    [switch]$Recurse,
    [switch]$FailOnOpaqueEdge
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolved = (Resolve-Path -LiteralPath $Path).Path
$item = Get-Item -LiteralPath $resolved
$files = if ($item.PSIsContainer) {
    Get-ChildItem -LiteralPath $resolved -File -Filter '*.png' -Recurse:$Recurse
} else {
    @($item)
}

$results = foreach ($file in $files) {
    if ($Exclude -contains $file.Name) { continue }
    $bitmap = [System.Drawing.Bitmap]::new($file.FullName)
    try {
        $hasAlpha = [System.Drawing.Image]::IsAlphaPixelFormat($bitmap.PixelFormat)
        $edgeOpaque = 0
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
            if ($bitmap.GetPixel($x, 0).A -gt 0) { $edgeOpaque++ }
            if ($bitmap.GetPixel($x, $bitmap.Height - 1).A -gt 0) { $edgeOpaque++ }
        }
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            if ($bitmap.GetPixel(0, $y).A -gt 0) { $edgeOpaque++ }
            if ($bitmap.GetPixel($bitmap.Width - 1, $y).A -gt 0) { $edgeOpaque++ }
        }
        [pscustomobject]@{
            Name = $file.Name
            Width = $bitmap.Width
            Height = $bitmap.Height
            HasAlpha = $hasAlpha
            EdgeOpaquePixels = $edgeOpaque
            Status = if ($hasAlpha -and $edgeOpaque -eq 0) { 'OK' } else { 'PAD_OR_FIX_ALPHA' }
        }
    } finally {
        $bitmap.Dispose()
    }
}

$results | Format-Table -AutoSize
$failed = @($results | Where-Object Status -ne 'OK')
if ($FailOnOpaqueEdge -and $failed.Count -gt 0) { exit 1 }
