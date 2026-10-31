# 生成 Open Graph 分享图（1200x630）：按站点深色主题配色绘制
# 用法：powershell -ExecutionPolicy Bypass -File scripts/make-og.ps1
Add-Type -AssemblyName System.Drawing

$W = 1200; $H = 630
$out = Join-Path $PSScriptRoot '..\public\assets\og.png'

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'ClearTypeGridFit'

# 背景：深色渐变 #0d1117 -> #131922
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 13, 17, 23),
  [System.Drawing.Color]::FromArgb(255, 19, 25, 34),
  [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$g.FillRectangle($bg, $rect)

# 细网格 #161b22
$grid = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 22, 27, 34), 1)
for ($x = 0; $x -lt $W; $x += 60) { $g.DrawLine($grid, $x, 0, $x, $H) }
for ($y = 0; $y -lt $H; $y += 60) { $g.DrawLine($grid, 0, $y, $W, $y) }

# 边框 #30363d
$border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 48, 54, 61), 1)
$g.DrawRectangle($border, 24, 24, $W - 48, $H - 48)

$text    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 230, 237, 243))
$muted   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 139, 148, 158))
$accent  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 88, 166, 255))
$accent2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 188, 140, 255))

$mono    = New-Object System.Drawing.Font('Consolas', 92, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$monoS   = New-Object System.Drawing.Font('Consolas', 22, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$cnBig   = New-Object System.Drawing.Font('Microsoft YaHei', 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$cnMid   = New-Object System.Drawing.Font('Microsoft YaHei', 24, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$cnSmall = New-Object System.Drawing.Font('Microsoft YaHei', 20, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

# 品牌 CF + IP
$g.DrawString('CF', $mono, $text, 78, 150)
$cfWidth = $g.MeasureString('CF', $mono).Width
$g.DrawString('IP', $mono, $accent, 78 + $cfWidth - 8, 150)

# 强调下划线
$line = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 88, 166, 255), 4)
$g.DrawLine($line, 84, 285, 208, 285)

# 标题与副标题
$g.DrawString('IP 地址详细信息查询', $cnBig, $text, 80, 320)
$g.DrawString('归属地 · 运营商 · ASN · 节点归属 · DNSBL 黑名单 · 代理识别', $cnMid, $muted, 82, 385)

# 分隔线
$sep = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 48, 54, 61), 1)
$g.DrawLine($sep, 80, 452, $W - 80, 452)

# 底部标签行
$tags = @('多源聚合', '免费 JSON API', '零外部请求')
$tx = 82
foreach ($t in $tags) {
  $w = $g.MeasureString($t, $cnSmall).Width
  $pill = New-Object System.Drawing.Rectangle($tx, 488, [int]($w + 32), 40)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 48, 54, 61), 1)
  $g.DrawRectangle($pen, $pill)
  $g.DrawString($t, $cnSmall, $muted, $tx + 16, 497)
  $tx += [int]($w + 32) + 14
}

# 右下角保持留白（GDI+ 的 MeasureString 在部分字体上会把右对齐文本算歪，索性不放）

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved: $out"
