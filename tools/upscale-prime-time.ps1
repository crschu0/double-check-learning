param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDir,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$targets = @(
  "1.2-cover.png",
  "1.2-answer-cover.png",
  "1.2.1.png",
  "1.2.2.png"
)

foreach ($name in $targets) {
  $sourcePath = Join-Path $SourceDir $name
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    Write-Warning "Missing source: $sourcePath"
    continue
  }

  $image = [System.Drawing.Image]::FromFile($sourcePath)
  try {
    $canvas = New-Object System.Drawing.Bitmap 4250, 5500
    $canvas.SetResolution(500, 500)

    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($image, 0, 0, 4250, 5500)
    }
    finally {
      $graphics.Dispose()
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($name)
    $outPath = Join-Path $OutputDir "$baseName-upscaled-500dpi.png"
    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $outPath
  }
  finally {
    if ($null -ne $canvas) { $canvas.Dispose() }
    $image.Dispose()
  }
}
