Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::new(1800,1120)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::White)
function Brush($c) { [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($c)) }
function Label($s,$x,$y,$w,$h,$size,$color,$bold=$false) {
  $style = if($bold){[System.Drawing.FontStyle]::Bold}else{[System.Drawing.FontStyle]::Regular}
  $font = [System.Drawing.Font]::new('Microsoft YaHei',$size,$style,[System.Drawing.GraphicsUnit]::Pixel)
  $fmt = [System.Drawing.StringFormat]::new(); $fmt.Alignment='Center'; $fmt.LineAlignment='Center'
  $b=Brush $color; $g.DrawString($s,$font,$b,[System.Drawing.RectangleF]::new($x,$y,$w,$h),$fmt)
  $font.Dispose();$b.Dispose();$fmt.Dispose()
}
function Box($x,$y,$w,$title,$sub,$fill,$stroke) {
  $b=Brush $fill; $p=[System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($stroke),2)
  $g.FillRectangle($b,$x,$y,$w,92);$g.DrawRectangle($p,$x,$y,$w,92)
  Label $title $x ($y+9) $w 40 27 '#182B49' $true
  Label $sub $x ($y+51) $w 30 19 '#52647D'
  $b.Dispose();$p.Dispose()
}
function Arrow($points,$color='#5B7295') {
  $p=[System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($color),3)
  $p.CustomEndCap=[System.Drawing.Drawing2D.AdjustableArrowCap]::new(5,6)
  $pts=[System.Drawing.PointF[]]@($points | ForEach-Object {[System.Drawing.PointF]::new($_[0],$_[1])})
  $g.DrawLines($p,$pts);$p.Dispose()
}
Label 'EduSkill × Inno Agent' 60 26 1680 54 38 '#152D50' $true
Label '总体架构｜平台控制面、原生执行链路与共享存储' 60 85 1680 38 23 '#61738D'
Label '平台控制面' 480 139 460 32 21 '#3568B0' $true
Label '共享存储' 1210 139 480 32 21 '#806233' $true
Arrow @(@(710,272),@(710,310))
Arrow @(@(710,402),@(710,440))
Arrow @(@(710,532),@(710,570))
Arrow @(@(710,662),@(710,700))
Arrow @(@(710,792),@(710,830))
Arrow @(@(480,486),@(390,486)) '#9AA6B5'
Arrow @(@(940,356),@(1070,356),@(1070,226),@(1210,226))
Arrow @(@(940,356),@(1210,356))
Arrow @(@(940,876),@(1100,876),@(1100,401),@(1210,401)) '#198577'
Arrow @(@(940,876),@(1210,876)) '#198577'
Arrow @(@(1450,922),@(1450,956)) '#198577'
Arrow @(@(1210,1002),@(1050,1002),@(1050,1055),@(940,1055)) '#198577'
Box 480 180 460 'EduSkill Web' '创作 · 验证 · 运行 · 结果查看' '#EDF4FF' '#B4CEF3'
Box 480 310 460 'EduSkill Node 控制面' '权限 · 版本 · 编排 · 发布 · 审计' '#EDF4FF' '#B4CEF3'
Box 480 440 460 'Harness Registry' '按 Profile 选择运行适配器' '#EDF4FF' '#B4CEF3'
Box 60 440 330 'Prompt Adapter' '保留旧运行路径' '#F3F5F8' '#CDD5DF'
Box 480 570 460 'Inno Adapter' '协议转换 · 事件与错误映射' '#EDF4FF' '#B4CEF3'
Box 480 700 460 'Attempt Queue' '独立尝试 · 租约 · 串行会话调度' '#EDF4FF' '#B4CEF3'
Box 480 830 460 '隔离 Runner' '实例管理 · 安全边界 · 产物与清理' '#EAF8F4' '#8BCBBB'
Box 1210 180 480 'PostgreSQL' '状态 · 版本引用 · 租约 · 审计索引' '#FFF8EA' '#E8D19F'
Box 1210 310 480 'S3 / MinIO 对象存储' 'Skill 文件 · Bundle · 报告 · Artifact' '#FFF8EA' '#E8D19F'
Label 'Runner 按受控授权读写同一对象存储' 1130 458 610 36 19 '#198577'
Label '原生执行环境' 1210 755 480 40 21 '#198577' $true
Box 1210 830 480 '原生 Inno Headless Server' '固定版本 · 原生 HTTP / SSE' '#EAF8F4' '#8BCBBB'
Box 1210 956 480 'Pi AgentSession' '真实 Agent 循环与工具执行' '#EAF8F4' '#8BCBBB'
Box 480 1009 460 '专属 Home / Workspace' '测试按 Attempt · 交互按 Conversation' '#EAF8F4' '#8BCBBB'
$dest = Join-Path $PSScriptRoot 'inno-harness-architecture.png'
$bmp.Save($dest,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$bmp.Dispose()
Write-Output $dest
