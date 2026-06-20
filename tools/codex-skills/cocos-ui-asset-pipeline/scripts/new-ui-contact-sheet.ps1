param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$OutputPath = '',
    [ValidateRange(1, 8)]
    [int]$Columns = 4
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path -Parent $manifestFile) 'contact-sheet.jpg'
}
$output = [IO.Path]::GetFullPath($OutputPath)
$tileWidth = 280
$tileHeight = 240
$headerHeight = 44
$assets = @($manifest.assets)
$rows = [Math]::Max(1, [Math]::Ceiling($assets.Count / [double]$Columns))
$sheet = [Drawing.Bitmap]::new($tileWidth * $Columns, $headerHeight + $tileHeight * $rows, [Drawing.Imaging.PixelFormat]::Format24bppRgb)

function Draw-Checkerboard($graphics, [Drawing.RectangleF]$rect) {
    $size = 16
    $light = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(238, 238, 238))
    $dark = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(205, 205, 205))
    try {
        for ($y = [int]$rect.Y; $y -lt [int]($rect.Y + $rect.Height); $y += $size) {
            for ($x = [int]$rect.X; $x -lt [int]($rect.X + $rect.Width); $x += $size) {
                $brush = if (((($x - [int]$rect.X) / $size) + (($y - [int]$rect.Y) / $size)) % 2 -eq 0) { $light } else { $dark }
                $graphics.FillRectangle($brush, $x, $y, [Math]::Min($size, $rect.Right - $x), [Math]::Min($size, $rect.Bottom - $y))
            }
        }
    } finally { $light.Dispose(); $dark.Dispose() }
}

try {
    $graphics = [Drawing.Graphics]::FromImage($sheet)
    try {
        $graphics.Clear([Drawing.Color]::FromArgb(28, 31, 38))
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
        $titleFont = [Drawing.Font]::new('Arial', 16, [Drawing.FontStyle]::Bold)
        $labelFont = [Drawing.Font]::new('Arial', 10, [Drawing.FontStyle]::Regular)
        $white = [Drawing.SolidBrush]::new([Drawing.Color]::White)
        $muted = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(205, 215, 230))
        $border = [Drawing.Pen]::new([Drawing.Color]::FromArgb(82, 91, 110), 1)
        try {
            $graphics.DrawString("$($manifest.jobName) - UI contact sheet", $titleFont, $white, 14, 11)
            for ($i = 0; $i -lt $assets.Count; $i++) {
                $asset = $assets[$i]
                $column = $i % $Columns
                $row = [Math]::Floor($i / $Columns)
                $tileX = $column * $tileWidth
                $tileY = $headerHeight + $row * $tileHeight
                $imageRect = [Drawing.RectangleF]::new($tileX + 10, $tileY + 10, $tileWidth - 20, 178)
                Draw-Checkerboard $graphics $imageRect
                $graphics.DrawRectangle($border, $imageRect.X, $imageRect.Y, $imageRect.Width, $imageRect.Height)
                $path = Join-Path $root ([string]$asset.outputPath)
                if (Test-Path -LiteralPath $path) {
                    $image = [Drawing.Image]::FromFile($path)
                    try {
                        $scale = [Math]::Min($imageRect.Width / $image.Width, $imageRect.Height / $image.Height)
                        $drawWidth = $image.Width * $scale
                        $drawHeight = $image.Height * $scale
                        $drawRect = [Drawing.RectangleF]::new($imageRect.X + ($imageRect.Width - $drawWidth) / 2, $imageRect.Y + ($imageRect.Height - $drawHeight) / 2, $drawWidth, $drawHeight)
                        $graphics.DrawImage($image, $drawRect)
                        $file = Get-Item -LiteralPath $path
                        $detail = "$($image.Width)x$($image.Height)  $([math]::Round($file.Length / 1KB, 1)) KiB"
                    } finally { $image.Dispose() }
                } else {
                    $detail = 'MISSING'
                }
                $graphics.DrawString([string]$asset.id, $titleFont, $white, $tileX + 10, $tileY + 193)
                $graphics.DrawString($detail, $labelFont, $muted, $tileX + 10, $tileY + 218)
            }
        } finally { $titleFont.Dispose(); $labelFont.Dispose(); $white.Dispose(); $muted.Dispose(); $border.Dispose() }
    } finally { $graphics.Dispose() }

    $parent = Split-Path -Parent $output
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
    $parameters = [Drawing.Imaging.EncoderParameters]::new(1)
    try {
        $parameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality, [long]88)
        $sheet.Save($output, $codec, $parameters)
    } finally { $parameters.Dispose() }
} finally { $sheet.Dispose() }

Write-Host "Contact sheet: $output"
