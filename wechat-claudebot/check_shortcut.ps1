$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\WeChat-ClaudeBot.lnk")
Write-Host "Target: $($sc.TargetPath)"
Write-Host "WorkingDir: $($sc.WorkingDirectory)"
Write-Host "WindowStyle: $($sc.WindowStyle)"
