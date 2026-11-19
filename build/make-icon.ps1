Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-AstralBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [Math]::Max(1.0, $size * 0.02)
  $radius = $size * 0.24
  $rect = New-Object System.Drawing.RectangleF($pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
  $path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
  $path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
  $path.CloseFigure()
  $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 2, 2, 4))
  $g.FillPath($bg, $path)

  $white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
  $ringWidth = [Math]::Max(1.0, $size * 0.042)
  $pen = New-Object System.Drawing.Pen($white, $ringWidth)
  $r = $size * 0.27
  $cx = $size / 2.0
  $cy = $size / 2.0
  $g.DrawEllipse($pen, ($cx - $r), ($cy - $r), (2 * $r), (2 * $r))

  $dot = New-Object System.Drawing.SolidBrush($white)
  $dr = $size * 0.062
  $g.FillEllipse($dot, ($cx - $dr), ($cy - $dr), (2 * $dr), (2 * $dr))

  $spark = [Math]::Max(1.0, $size * 0.022)
  $g.FillEllipse($dot, ($size * 0.20), ($size * 0.20), (2 * $spark), (2 * $spark))
  $g.FillEllipse($dot, ($size * 0.76), ($size * 0.24), (2 * $spark * 0.7), (2 * $spark * 0.7))
  $g.FillEllipse($dot, ($size * 0.24), ($size * 0.74), (2 * $spark * 0.7), (2 * $spark * 0.7))

  $pen.Dispose()
  $dot.Dispose()
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
$writer.Flush()
$writer.Close()
$file.Close()

Write-Host "icon.png и icon.ico готовы: $out"
