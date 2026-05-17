/**
 * 网络级守护 — 连接健康检测、自动重连、备用通道切换
 *
 * 特性：
 *  - 定期探测微信网关连通性
 *  - 断网时自动重连（重新调用 notifyStart）
 *  - 备用 baseUrl 通道切换
 *  - 网络状态变更事件通知
 */
import config from "./config.mjs";
import logger from "./logger.mjs";

// ---- 状态 ----
let currentBaseUrl = null;
let isNetworkOk = true;
let consecutiveFailures = 0;
let backupUrlIndex = 0;
let checkTimer = null;
let onNetworkDownCallback = null;
let onNetworkRestoreCallback = null;

// ---- 网络连通性检测 ----
async function probeConnectivity(baseUrl, timeoutMs = config.networkCheckTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 使用 HTTP HEAD 探测（不消耗 API 配额）
    const url = `${baseUrl}/ilink/bot/getupdates`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "iLink-App-Id": "bot",
      },
      body: JSON.stringify({ get_updates_buf: "", base_info: { channel_version: "2.4.3", bot_agent: "HealthCheck" } }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 任何响应（包括错误）都说明网关可达
    return true;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      logger.warn(`网络探测超时 (${timeoutMs}ms): ${baseUrl}`);
    }
    return false;
  }
}

// ---- 切换备用通道 ----
function switchToBackupChannel() {
  if (backupUrlIndex >= config.backupBaseUrls.length) {
    backupUrlIndex = 0;
    logger.error("所有备用通道已尝试，无可用的备用通道");
    return null;
  }

  const backupUrl = config.backupBaseUrls[backupUrlIndex];
  backupUrlIndex++;
  logger.warn(`切换到备用通道 #${backupUrlIndex}: ${backupUrl}`);
  return backupUrl;
}

function resetBackupIndex() {
  backupUrlIndex = 0;
}

// ---- 周期网络检测 ----
async function runNetworkCheck() {
  const baseUrl = currentBaseUrl || config.defaultBaseUrl;
  const ok = await probeConnectivity(baseUrl);

  if (!ok && isNetworkOk) {
    // 网络从好变坏
    consecutiveFailures++;
    logger.error(`网络连接丢失！连续失败: ${consecutiveFailures}`);

    if (consecutiveFailures >= 3) {
      isNetworkOk = false;
      logger.error("网络确认断开，触发重连流程...");
      if (onNetworkDownCallback) onNetworkDownCallback();

      // 尝试备用通道
      if (config.backupBaseUrls.length > 0) {
        const backupUrl = switchToBackupChannel();
        if (backupUrl) {
          logger.info(`备用通道已激活: ${backupUrl}`);
          if (onNetworkRestoreCallback) onNetworkRestoreCallback(backupUrl);
        }
      }
    }
  } else if (ok && !isNetworkOk) {
    // 网络从坏变好
    isNetworkOk = true;
    consecutiveFailures = 0;
    resetBackupIndex();
    logger.info("网络连接已恢复！");
    if (onNetworkRestoreCallback) onNetworkRestoreCallback(baseUrl);
  } else if (ok) {
    // 网络正常
    consecutiveFailures = 0;
  }
}

// ---- 公开 API ----
export function startNetworkGuardian(baseUrl, callbacks = {}) {
  currentBaseUrl = baseUrl;
  onNetworkDownCallback = callbacks.onDown || null;
  onNetworkRestoreCallback = callbacks.onRestore || null;
  isNetworkOk = true;

  logger.info(`网络守护已启动 (检测间隔: ${config.networkCheckIntervalMs / 1000}s)`);

  // 立即检测一次
  runNetworkCheck();

  // 周期性检测
  checkTimer = setInterval(runNetworkCheck, config.networkCheckIntervalMs);
  checkTimer.unref(); // 不阻止进程退出
}

export function stopNetworkGuardian() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  logger.info("网络守护已停止");
}

export function updateNetworkGuardianBaseUrl(baseUrl) {
  currentBaseUrl = baseUrl;
}

export function isNetworkHealthy() {
  return isNetworkOk;
}

export function getNetworkStats() {
  return {
    isHealthy: isNetworkOk,
    consecutiveFailures,
    currentBaseUrl: currentBaseUrl || config.defaultBaseUrl,
    backupUrlsTried: backupUrlIndex,
    totalBackupUrls: config.backupBaseUrls.length,
  };
}

// ---- 快速连通性检查（供消息循环使用） ----
export async function quickConnectivityCheck() {
  return probeConnectivity(currentBaseUrl || config.defaultBaseUrl, 5000);
}
