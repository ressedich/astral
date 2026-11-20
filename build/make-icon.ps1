Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-AstralBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # Tile
  $pad = [Math]::Max(0.5, $size * 0.015)
  $radius = $size * 0.23
  $rect = New-Object System.Drawing.RectangleF($pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
  $path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
  $path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
  $path.CloseFigure()

  $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 6, 6, 8))
  $g.FillPath($bg, $path)

  $edge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(30, 255, 255, 255), [Math]::Max(1.0, $size * 0.005))
  $g.DrawPath($edge, $path)
  $edge.Dispose()

  $cx = $size / 2.0
  $cy = $size / 2.0

  # Orbit behind the mark
  if ($size -ge 40) {
    $state = $g.Save()
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform(-22)
    $ow = $size * 0.64
    $oh = $size * 0.22
    $orbit = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(78, 255, 255, 255), [Math]::Max(1.0, $size * 0.011))
    $g.DrawEllipse($orbit, (-$ow / 2), (-$oh / 2), $ow, $oh)
    $orbit.Dispose()
    $g.Restore($state)
  }

  # Monogram "A"
  $white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
  $stroke = $size * 0.105
  $pen = New-Object System.Drawing.Pen($white, $stroke)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $apex = New-Object System.Drawing.PointF(($size * 0.5), ($size * 0.235))
  $left = New-Object System.Drawing.PointF(($size * 0.285), ($size * 0.775))
  $right = New-Object System.Drawing.PointF(($size * 0.715), ($size * 0.775))
  $g.DrawLine($pen, $apex, $left)
  $g.DrawLine($pen, $apex, $right)

  $barY = $size * 0.585
  $g.DrawLine($pen, (New-Object System.Drawing.PointF(($size * 0.386), $barY)), (New-Object System.Drawing.PointF(($size * 0.614), $barY)))

  $pen.Dispose()
  $bg.Dispose()
  $path.Dispose()
  $g.Dispose()
  return $bmp
}

$png512 = New-AstralBitmap 512
$png512.Save((Join-Path $out 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$png512.Dispose()

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bmp = New-AstralBitmap $size
  $stream = New-Object System.IO.MemoryStream
  $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,@($size, $stream.ToArray())
  $stream.Dispose()
  $bmp.Dispose()
}

$icoPath = Join-Path $out 'icon.ico'
$file = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($file)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($image in $images) {
  $size = $image[0]
  $bytes = $image[1]
  $dim = if ($size -ge 256) { 0 } else { $size }
  $writer.Write([Byte]$dim)
  $writer.Write([Byte]$dim)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $bytes.Length
}
foreach ($image in $images) {
  $writer.Write([Byte[]]$image[1])
}
$writer.Close()
$file.Close()
Write-Output "icon.png / icon.ico updated in $out"
