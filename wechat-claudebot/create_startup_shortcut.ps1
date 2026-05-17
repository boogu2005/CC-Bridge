# WeChat ClaudeBot — 创建 Windows 开机自启快捷方式
# 自动检测脚本所在目录，无需修改路径

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetPath = Join-Path $ScriptDir "start_wechat_bot.bat"
$ShortcutName = "WeChat-ClaudeBot.lnk"
$StartupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$ShortcutPath = Join-Path $StartupDir $ShortcutName

if (-not (Test-Path $TargetPath)) {
    Write-Host "ERROR: start_wechat_bot.bat not found at $TargetPath"
    exit 1
}

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($ShortcutPath)
$sc.TargetPath = $TargetPath
$sc.WorkingDirectory = $ScriptDir
$sc.WindowStyle = 7
$sc.Description = "WeChat ClaudeBot Auto-Start"
$sc.Save()

Write-Host "OK - Startup shortcut created"
Write-Host "Target: $TargetPath"
Write-Host "WorkingDir: $ScriptDir"
Write-Host "WindowStyle: Minimized (7)"
