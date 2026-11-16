# 生成 Open Graph 分享图（1200x630）：冷灰 · 墨绿深色主题
# 用法：powershell -ExecutionPolicy Bypass -File scripts/make-og.ps1
# 注意：本文件必须以 UTF-8 BOM 保存，否则 PowerShell 5.1 按 ANSI 解析，中文注释会吞掉后续行
Add-Type -AssemblyName System.Drawing

$W = 1200; $H = 630
$out = Join-Path $PSScriptRoot '..\public\assets\og.png'

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'ClearTypeGridFit'

# 背景：深色底 #0f1312
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 15, 19, 18))
$g.FillRectangle($bg, $rect)

# 细网格 #1b2321
$grid = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 27, 35, 33), 1)
for ($x = 0; $x -lt $W; $x += 60) { $g.DrawLine($grid, $x, 0, $x, $H) }
for ($y = 0; $y -lt $H; $y += 60) { $g.DrawLine($grid, 0, $y, $W, $y) }

# 边框 #24312e
$border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 36, 49, 46), 1)
$g.DrawRectangle($border, 24, 24, $W - 48, $H - 48)

$text   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 231, 236, 234))
$muted  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 150, 162, 158))
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 45, 212, 191))

$mono    = New-Object System.Drawing.Font('Consolas', 92, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$cnBig   = New-Object System.Drawing.Font('Microsoft YaHei', 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$cnMid   = New-Object System.Drawing.Font('Microsoft YaHei', 23, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$cnSmall = New-Object System.Drawing.Font('Microsoft YaHei', 19, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

# 品牌 CF + IP
$g.DrawString('CF', $mono, $text, 78, 150)
$cfWidth = $g.MeasureString('CF', $mono).Width
$g.DrawString('IP', $mono, $accent, 78 + $cfWidth - 8, 150)

# 强调下划线
$line = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 45, 212, 191), 4)
$g.DrawLine($line, 84, 285, 208, 285)

# 标题与副标题
$g.DrawString('IP 地址详细信息查询', $cnBig, $text, 80, 316)
$g.DrawString('归属地 · ASN · 原生/广播判定 · DNSBL · 代理识别', $cnMid, $muted, 82, 378)
$g.DrawString('连通性 · WebRTC 泄漏 · 指纹 · 测速', $cnMid, $muted, 82, 414)

# 分隔线
$sep = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 36, 49, 46), 1)
$g.DrawLine($sep, 80, 470, $W - 80, 470)

# 底部标签行
$tags = @('多源聚合', '原生 IP 判定', '网络诊断', '免费 JSON API')
$tx = 82
foreach ($t in $tags) {
  $w = $g.MeasureString($t, $cnSmall).Width
  $pill = New-Object System.Drawing.Rectangle($tx, 500, [int]($w + 32), 40)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 36, 49, 46), 1)
  $g.DrawRectangle($pen, $pill)
  $g.DrawString($t, $cnSmall, $muted, $tx + 16, 509)
  $tx += [int]($w + 32) + 14
}

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved: $out"
