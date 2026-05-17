/**
 * Windows 开机自启管理 — 检测、启用、禁用启动项
 *
 * 通过 Startup 文件夹快捷方式实现：
 *  - enable:  创建快捷方式到 Startup 文件夹
 *  - disable: 删除快捷方式
 *  - status:  检查是否已启用
 *
 * 启动时使用 WindowStyle=7（最小化），不弹出终端窗口。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import config from "./config.mjs";
import logger from "./logger.mjs";

// Windows Startup 文件夹路径
const STARTUP_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup"
);

const SHORTCUT_PATH = path.join(STARTUP_DIR, config.startupShortcutName);

// ---- 获取启动脚本路径 ----
function getLauncherScript() {
  // 优先使用 .bat 启动脚本
  const batPath = path.join(config.rootDir, "start_wechat_bot.bat");
  if (fs.existsSync(batPath)) return batPath;

  // 备选：直接运行 node
  return null;
}

// ---- 使用 PowerShell 创建快捷方式 ----
function createShortcut(targetPath) {
  const psScript = `
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($env:TEMP + "\\${config.startupShortcutName}")
$sc.TargetPath = "${targetPath.replace(/\\/g, "\\\\")}"
$sc.WorkingDirectory = "${config.rootDir.replace(/\\/g, "\\\\")}"
$sc.WindowStyle = 7
$sc.Description = "WeChat Claude Bot Auto-Start"
$sc.Save()
if (Test-Path "${SHORTCUT_PATH.replace(/\\/g, "\\\\")}") { Remove-Item "${SHORTCUT_PATH.replace(/\\/g, "\\\\")}" -Force }
Move-Item ($env:TEMP + "\\\\${config.startupShortcutName}") "${SHORTCUT_PATH.replace(/\\/g, "\\\\")}" -Force
Write-Output "OK"
`;

  try {
    const result = execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    return result.includes("OK");
  } catch (err) {
    logger.error(`创建快捷方式失败: ${err.message}`);
    return false;
  }
}

function removeShortcut() {
  try {
    if (fs.existsSync(SHORTCUT_PATH)) {
      fs.unlinkSync(SHORTCUT_PATH);
      logger.info(`已删除启动快捷方式: ${SHORTCUT_PATH}`);
      return true;
    }
    return true; // 不存在也算成功
  } catch (err) {
    logger.error(`删除快捷方式失败: ${err.message}`);
    return false;
  }
}

function checkShortcutExists() {
  return fs.existsSync(SHORTCUT_PATH);
}

// ---- 公开 API ----
export function enableAutostart() {
  if (!process.platform.startsWith("win")) {
    logger.warn("开机自启目前仅支持 Windows");
    return false;
  }

  if (checkShortcutExists()) {
    logger.info("开机自启已启用，无需重复操作");
    return true;
  }

  const launcher = getLauncherScript();
  if (!launcher) {
    logger.error("找不到启动脚本，无法创建开机自启");
    return false;
  }

  logger.info(`正在创建开机自启快捷方式: ${SHORTCUT_PATH}`);
  logger.info(`目标: ${launcher}`);
  logger.info(`工作目录: ${config.rootDir}`);

  const ok = createShortcut(launcher);
  if (ok) {
    logger.info("开机自启已启用 ✓");
  } else {
    logger.error("开机自启设置失败 ✗");
  }
  return ok;
}

export function disableAutostart() {
  if (!checkShortcutExists()) {
    logger.info("开机自启未启用");
    return true;
  }

  logger.info("正在移除开机自启...");
  const ok = removeShortcut();
  if (ok) {
    logger.info("开机自启已禁用 ✓");
  } else {
    logger.error("开机自启禁用失败 ✗");
  }
  return ok;
}

export function getAutostartStatus() {
  return {
    enabled: checkShortcutExists(),
    shortcutPath: SHORTCUT_PATH,
    platform: process.platform,
  };
}

// ---- 兼容旧 PowerShell 脚本 ----
export function getPowerShellCommands() {
  return {
    enable: `powershell -File "${path.join(config.rootDir, "create_startup_shortcut.ps1")}"`,
    disable: `powershell -Command "Remove-Item '${SHORTCUT_PATH}' -Force -ErrorAction SilentlyContinue"`,
    status: `powershell -File "${path.join(config.rootDir, "check_shortcut.ps1")}"`,
  };
}
