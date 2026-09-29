<#
  Generate the DSH-PX bitmaps the official NSIS installer embeds, from the PX application icon.
  Sizes and backgrounds match apps/desktop/scripts/prepare-windows-installer.ps1 at the pinned commit.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Icon,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$Name = 'DSH-PX Desktop'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $output | Out-Null
$source = [Drawing.Image]::FromFile([IO.Path]::GetFullPath($Icon))
try {
  $layouts = @(
    @{ Name = 'brand'; Width = 600; Height = 196; Dark = $false; Text = $true },
    @{ Name = 'brand-2x'; Width = 1200; Height = 392; Dark = $false; Text = $true },
    @{ Name = 'brand-dark'; Width = 600; Height = 196; Dark = $true; Text = $true },
    @{ Name = 'brand-dark-2x'; Width = 1200; Height = 392; Dark = $true; Text = $true },
    @{ Name = 'uninstaller-sidebar'; Width = 164; Height = 314; Dark = $false; Text = $false }
  )
  foreach ($layout in $layouts) {
    $bitmap = [Drawing.Bitmap]::new($layout.Width, $layout.Height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $background = if ($layout.Dark) { [Drawing.Color]::FromArgb(21, 21, 23) } else { [Drawing.Color]::White }
        $foreground = if ($layout.Dark) { [Drawing.Color]::FromArgb(242, 242, 244) } else { [Drawing.Color]::FromArgb(15, 17, 21) }
        $graphics.Clear($background)
        if ($layout.Text) {
          $size = [int]($layout.Height * 0.62)
          $fontSize = [single]($layout.Height * 0.2)
          $font = [Drawing.Font]::new('Segoe UI Semibold', $fontSize, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
          try {
            $textSize = $graphics.MeasureString($Name, $font)
            $gap = [int]($layout.Height * 0.08)
            $total = $size + $gap + [int]$textSize.Width
            $x = [int](($layout.Width - $total) / 2)
            $y = [int](($layout.Height - $size) / 2)
            $graphics.DrawImage($source, $x, $y, $size, $size)
            $brush = [Drawing.SolidBrush]::new($foreground)
            try {
              $graphics.DrawString($Name, $font, $brush, [single]($x + $size + $gap), [single](($layout.Height - $textSize.Height) / 2))
            } finally { $brush.Dispose() }
          } finally { $font.Dispose() }
        } else {
          $size = [int]($layout.Width * 0.7)
          $graphics.DrawImage($source, [int](($layout.Width - $size) / 2), [int]($layout.Height * 0.12), $size, $size)
        }
      } finally { $graphics.Dispose() }
      $bitmap.Save((Join-Path $output "$($layout.Name).bmp"), [Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $bitmap.Dispose() }
  }
} finally { $source.Dispose() }
Write-Output "Prepared DSH-PX installer bitmaps: $output"
