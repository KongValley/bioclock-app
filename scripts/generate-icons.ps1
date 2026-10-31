#requires -Version 5.1
<#
  生成 BioClock 应用图标（iOS / Android / Web / Splash）。
  设计：单色标记 = 时钟表盘 + 注射器，代表"按时注射"。
  图形用 GDI+ 绘制，输出为 4 倍超采样后缩小的 PNG。

  用法：powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
#>
param(
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\assets\images')
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir | Out-Null }

# 品牌色（与 src/ui/theme.ts 的 primary 对齐）
$BlueTop = [System.Drawing.ColorTranslator]::FromHtml('#3577B9')
$BlueBottom = [System.Drawing.ColorTranslator]::FromHtml('#1F558F')
$Blue = [System.Drawing.ColorTranslator]::FromHtml('#2B6CB0')
$White = [System.Drawing.Color]::White

# 设计画布 1024×1024，标记围绕 (512, 512)
$Design = 1024.0
$CX = 512.0
$CY = 512.0

function New-RoundedPath {
  param([double]$X, [double]$Y, [double]$W, [double]$H, [double]$R)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  if ($R -le 0) {
    $path.AddRectangle([System.Drawing.RectangleF]::new($X, $Y, $W, $H))
    return $path
  }
  $d = $R * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Invoke-Mark {
  param(
    [System.Drawing.Graphics]$G,
    [System.Drawing.Color]$Color,
    [double]$Scale,
    [double]$OffsetX = 0,
    [double]$OffsetY = 0
  )

  $state = $G.Save()
  $G.TranslateTransform([float]($CX + $OffsetX), [float]($CY + $OffsetY))
  $G.ScaleTransform([float]$Scale, [float]$Scale)
  $G.TranslateTransform([float]-$CX, [float]-$CY)

  $brush = [System.Drawing.SolidBrush]::new($Color)

  # 时钟表盘：外圈 300 半径，60 描边
  $pen = [System.Drawing.Pen]::new($Color, [float]60)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $G.DrawEllipse($pen, [float]($CX - 300), [float]($CY - 300), [float]600, [float]600)
  $pen.Dispose()

  # 注射器（垂直居中）：拇指座 / 推杆 / 法兰 / 针筒 / 针座 / 针头
  $parts = @(
    @{ X = 440; Y = 314; W = 144; H = 28; R = 14 },  # 拇指座
    @{ X = 488; Y = 332; W = 48;  H = 64; R = 12 },  # 推杆
    @{ X = 408; Y = 380; W = 208; H = 32; R = 16 },  # 法兰
    @{ X = 456; Y = 404; W = 112; H = 244; R = 30 }, # 针筒
    @{ X = 486; Y = 642; W = 52;  H = 26; R = 10 },  # 针座
    @{ X = 503; Y = 664; W = 18;  H = 60; R = 9 }    # 针头
  )
  foreach ($p in $parts) {
    $path = New-RoundedPath -X $p.X -Y $p.Y -W $p.W -H $p.H -R $p.R
    $G.FillPath($brush, $path)
    $path.Dispose()
  }

  $brush.Dispose()
  $G.Restore($state)
}

function New-Icon {
  param(
    [int]$Size,
    [string]$Path,
    [string]$Background = 'gradient',   # gradient | none
    [System.Drawing.Color]$MarkColor = ([System.Drawing.Color]::White),
    [double]$MarkScale = 1.0
  )

  $ss = 4
  $big = $Size * $ss
  $bmp = [System.Drawing.Bitmap]::new($big, $big, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  if ($Background -eq 'gradient') {
    # 逐行插值，避免 GDI+ 渐变构造在不同 .NET 版本下的重载差异
    $brush = [System.Drawing.SolidBrush]::new($BlueTop)
    for ($y = 0; $y -lt $big; $y++) {
      $t = if ($big -gt 1) { $y / ($big - 1.0) } else { 0 }
      $c = [System.Drawing.Color]::FromArgb(
        255,
        [int][Math]::Round($BlueTop.R + ($BlueBottom.R - $BlueTop.R) * $t),
        [int][Math]::Round($BlueTop.G + ($BlueBottom.G - $BlueTop.G) * $t),
        [int][Math]::Round($BlueTop.B + ($BlueBottom.B - $BlueTop.B) * $t)
      )
      $brush.Color = $c
      $g.FillRectangle($brush, 0, $y, $big, 1)
    }
    $brush.Dispose()
  }

  # 把 1024 设计坐标映射到画布
  $g.ScaleTransform([float]($big / $Design), [float]($big / $Design))
  Invoke-Mark -G $g -Color $MarkColor -Scale $MarkScale

  $g.Dispose()

  $out = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g2.DrawImage($bmp, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size))
  $g2.Dispose()
  $bmp.Dispose()

  $out.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Host ("  {0}  ({1}×{1})" -f [System.IO.Path]::GetFileName($Path), $Size)
}

Write-Host 'Generating BioClock icons ->' $OutputDir

# 主图标（iOS / 通用），不透明满版，系统自行裁圆角
New-Icon -Size 1024 -Path (Join-Path $OutputDir 'icon.png') -MarkScale 1.14

# Android 自适应图标：背景 + 前景（前景保留 66% 安全区）
New-Icon -Size 1024 -Path (Join-Path $OutputDir 'android-icon-background.png')
New-Icon -Size 1024 -Path (Join-Path $OutputDir 'android-icon-foreground.png') -Background 'none' -MarkScale 0.94

# Android 13 主题图标（单色，系统着色）
New-Icon -Size 1024 -Path (Join-Path $OutputDir 'android-icon-monochrome.png') -Background 'none' -MarkScale 0.88

# 启动屏标记：浅色背景上用品牌蓝
New-Icon -Size 512 -Path (Join-Path $OutputDir 'splash-icon.png') -Background 'none' -MarkColor $Blue -MarkScale 1.0

# Web favicon
New-Icon -Size 64 -Path (Join-Path $OutputDir 'favicon.png') -MarkScale 1.04

Write-Host 'Done.'
