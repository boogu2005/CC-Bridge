@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: ============================================================
:: WeChat ClaudeBot — 启动脚本（崩溃自动重启）
:: 模式：微信 <-> 终端 Claude/DeepSeek 纯双向中转
:: ============================================================

:: 自动检测项目目录（脚本所在目录）
set "WORK=%~dp0"
set "LOG_DIR=%WORK%logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%WORK%"

:: 查找 Node.js — 优先级：PATH 中的 node > 常见安装路径
set "NODE_BIN="

:: 先尝试 PATH 中的 node
where node >nul 2>&1
if !errorlevel! equ 0 set "NODE_BIN=node"

:: 如果 PATH 中找不到，尝试常见安装路径
if "!NODE_BIN!"=="" (
    for %%p in (
        "C:\Program Files\nodejs\node.exe"
        "D:\nodej\node.exe"
        "%APPDATA%\nvm\*.*.*\node.exe"
    ) do (
        if exist %%p (
            set "NODE_BIN=%%~p"
            goto :found_node
        )
    )
)

:found_node
if "!NODE_BIN!"=="" (
    echo [ERROR] Node.js not found. Install Node.js or add to PATH. >> "%LOG_DIR%\launcher.log"
    echo NODE NOT FOUND. Please install Node.js.
    pause
    exit /b 1
)

echo ============================================================ >> "%LOG_DIR%\launcher.log"
echo BOT LAUNCHER STARTED: %date% %time% >> "%LOG_DIR%\launcher.log"
echo Node.js: !NODE_BIN! >> "%LOG_DIR%\launcher.log"
echo Project: %WORK% >> "%LOG_DIR%\launcher.log"
echo ============================================================ >> "%LOG_DIR%\launcher.log"

:loop
echo [%date% %time%] Starting bot... >> "%LOG_DIR%\launcher.log"
"!NODE_BIN!" "%WORK%wechat_bot.mjs" start
set "EC=!ERRORLEVEL!"
echo [%date% %time%] Bot exited (code: !EC!), restarting in 10s... >> "%LOG_DIR%\launcher.log"
timeout /t 10 /nobreak >nul
goto loop
