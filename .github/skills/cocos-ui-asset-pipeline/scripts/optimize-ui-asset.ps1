param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [Parameter(Mandatory = $true)]
    [int]$Width,
    [Parameter(Mandatory = $true)]
    [int]$Height,
    [ValidateSet('png', 'jpg')]
    [string]$Format,
    [ValidateSet('Stretch', 'Contain', 'Cover')]
    [string]$FitMode = 'Contain',
    [ValidateRange(40, 100)]
    [int]$JpegQuality = 78,
    [string]$BackgroundColor = '#000000',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if ($Width -le 0 -or $Height -le 0) { throw 'Width and Height must be positive.' }
$input = (Resolve-Path -LiteralPath $InputPath).Path
$output = [IO.Path]::GetFullPath($OutputPath)
if ((Test-Path -LiteralPath $output) -and -not $Force) {
    throw "Output exists. Pass -Force to replace it: $output"
}
if ([IO.Path]::GetExtension($output).TrimStart('.').ToLowerInvariant() -ne $Format) {
    throw "Output extension must match -Format $Format."
}
$parent = Split-Path -Parent $output
if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }

function Parse-HexColor([string]$value) {
    if ($value -notmatch '^#([0-9a-fA-F]{6})$') { throw "Invalid color: $value" }
    return [Drawing.Color]::FromArgb(
        [Convert]::ToInt32($value.Substring(1, 2), 16),
        [Convert]::ToInt32($value.Substring(3, 2), 16),
        [Convert]::ToInt32($value.Substring(5, 2), 16))
}

$source = [Drawing.Image]::FromFile($input)
try {
    $pixelFormat = if ($Format -eq 'png') { [Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [Drawing.Imaging.PixelFormat]::Format24bppRgb }
    $canvas = [Drawing.Bitmap]::new($Width, $Height, $pixelFormat)
    try {
        $graphics = [Drawing.Graphics]::FromImage($canvas)
        try {
            $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            if ($Format -eq 'png') { $graphics.Clear([Drawing.Color]::Transparent) } else { $graphics.Clear((Parse-HexColor $BackgroundColor)) }

            $sourceRatio = $source.Width / [double]$source.Height
            $targetRatio = $Width / [double]$Height
            $dest = [Drawing.RectangleF]::new(0, 0, $Width, $Height)
            if ($FitMode -eq 'Contain') {
                if ($sourceRatio -gt $targetRatio) {
                    $drawHeight = $Width / $sourceRatio
                    $dest = [Drawing.RectangleF]::new(0, ($Height - $drawHeight) / 2, $Width, $drawHeight)
                } else {
                    $drawWidth = $Height * $sourceRatio
                    $dest = [Drawing.RectangleF]::new(($Width - $drawWidth) / 2, 0, $drawWidth, $Height)
                }
            } elseif ($FitMode -eq 'Cover') {
                if ($sourceRatio -gt $targetRatio) {
                    $drawWidth = $Height * $sourceRatio
                    $dest = [Drawing.RectangleF]::new(($Width - $drawWidth) / 2, 0, $drawWidth, $Height)
                } else {
                    $drawHeight = $Width / $sourceRatio
                    $dest = [Drawing.RectangleF]::new(0, ($Height - $drawHeight) / 2, $Width, $drawHeight)
                }
            }
            $graphics.DrawImage($source, $dest)
        } finally {
            $graphics.Dispose()
        }

        if ($Format -eq 'png') {
            $canvas.Save($output, [Drawing.Imaging.ImageFormat]::Png)
        } else {
            $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
            $parameters = [Drawing.Imaging.EncoderParameters]::new(1)
            try {
                $parameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality, [long]$JpegQuality)
                $canvas.Save($output, $codec, $parameters)
            } finally {
                $parameters.Dispose()
            }
        }
    } finally {
        $canvas.Dispose()
    }
} finally {
    $source.Dispose()
}

$file = Get-Item -LiteralPath $output
[pscustomobject]@{ Path = $file.FullName; Width = $Width; Height = $Height; Format = $Format; Bytes = $file.Length; KiB = [math]::Round($file.Length / 1KB, 1) } | Format-List
