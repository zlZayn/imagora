param(
    [int]$WindowId = 1
)
<#
窗口主题色 —— 黄金角 137.508 分布 / HSL(色相 55% 42%) → RGB，输出 "R G B"（供 cmd ANSI 24-bit 着色）。

与 frontend/src/accent.ts（浏览器页面 --color-brand）和 main.py accent_for_window（rich 菜单）
是同一算法的三处实现，改色相/饱和/明度必须三处同步，勿单独改动。

用法（供 启动生图工作台.cmd 调用）：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\window_accent.ps1 -WindowId 2
#>
$hue = ((($WindowId - 1) * 137.508) % 360) / 360.0

function F($p, $q, $t) {
    if ($t -lt 0) { $t += 1 }
    if ($t -gt 1) { $t -= 1 }
    if ($t -lt (1 / 6)) { return $p + ($q - $p) * 6 * $t }
    if ($t -lt (1 / 2)) { return $q }
    if ($t -lt (2 / 3)) { return $p + ($q - $p) * (2 / 3 - $t) * 6 }
    return $p
}

$lightness = 0.42
$saturation = 0.55
if ($lightness -lt 0.5) { $q = $lightness * (1 + $saturation) } else { $q = $lightness + $saturation - $lightness * $saturation }
$p = 2 * $lightness - $q

$r = F $p $q ($hue + 1 / 3)
$g = F $p $q $hue
$b = F $p $q ($hue - 1 / 3)

"{0} {1} {2}" -f [int]($r * 255), [int]($g * 255), [int]($b * 255)