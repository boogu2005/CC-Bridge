/**
 * 告警通知 — 异常事件时触发自定义通知
 *
 * 当前实现：
 *  - 日志记录（始终启用）
 *  - Webhook 通知（可配置）
 *  - 预留微信/邮件通知接口
 */
import config from "./config.mjs";
import logger from "./logger.mjs";

// ---- Webhook 通知 ----
async function sendWebhook(message) {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[ClaudeBot Alert] ${message}`,
        timestamp: new Date().toISOString(),
        bot: "WeChat-ClaudeBot",
      }),
      timeout: 5000,
    });
  } catch (err) {
    logger.warn(`告警 Webhook 发送失败: ${err.message}`);
  }
}

// ---- 公开 API ----
const alert = {
  /** 崩溃告警 */
  async crash(error, context = {}) {
    const msg = `进程崩溃: ${error.message}\n` +
      `类型: ${context.type || "unknown"}\n` +
      `重试次数: ${context.retryCount ?? "N/A"}\n` +
      `时间: ${new Date().toISOString()}`;

    logger.error(`[ALERT-CRASH] ${msg}`);
    if (config.alertOnCrash) await sendWebhook(msg);
  },

  /** 网络断开告警 */
  async networkDown(baseUrl, consecutiveFailures) {
    const msg = `网络断开: ${baseUrl}\n` +
      `连续失败: ${consecutiveFailures} 次\n` +
      `时间: ${new Date().toISOString()}`;

    logger.error(`[ALERT-NETWORK] ${msg}`);
    if (config.alertOnNetworkLoss) await sendWebhook(msg);
  },

  /** 网络恢复通知 */
  async networkRestore(baseUrl) {
    const msg = `网络恢复: ${baseUrl}\n时间: ${new Date().toISOString()}`;
    logger.info(`[ALERT-NETWORK] ${msg}`);
    await sendWebhook(msg);
  },

  /** API 异常告警 */
  async apiError(endpoint, error, retryCount) {
    const msg = `API 异常: ${endpoint}\n` +
      `错误: ${error.message}\n` +
      `重试: ${retryCount} 次\n` +
      `时间: ${new Date().toISOString()}`;

    logger.error(`[ALERT-API] ${msg}`);
    if (retryCount >= 3) await sendWebhook(msg);
  },

  /** 自定义告警 */
  async custom(title, message, level = "warn") {
    const msg = `${title}: ${message}`;
    if (level === "error") logger.error(`[ALERT] ${msg}`);
    else logger.warn(`[ALERT] ${msg}`);
    await sendWebhook(msg);
  },
};

export default alert;
