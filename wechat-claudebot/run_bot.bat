@echo off
chcp 65001 >nul 2>&1

:: ============================================================
:: WeChat ClaudeBot — 单次启动
:: 模式：微信 <-> 终端 Claude/DeepSeek 纯双向中转
:: ============================================================

:: 自动检测项目目录（脚本所在目录）
set "WORK=%~dp0"

:: 查找 Node.js
set "NODE_BIN="
where node >nul 2>&1
if not errorlevel 1 set "NODE_BIN=node"

:: 尝试常见安装路径
if "%NODE_BIN%"=="" (
    for %%p in (
        "C:\Program Files\nodejs\node.exe"
        "D:\nodej\node.exe"
    ) do (
        if exist %%p set "NODE_BIN=%%~p"
    )
)

if "%NODE_BIN%"=="" (
    echo Node.js not found. Please install Node.js or add to PATH.
    pause
    exit /b 1
)

cd /d "%WORK%"

if "%~1"=="" (
    "%NODE_BIN%" wechat_bot.mjs start
) else (
    "%NODE_BIN%" wechat_bot.mjs %*
)
