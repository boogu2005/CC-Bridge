/**
 * 集中配置管理 — 加载 .env，合并默认值，导出统一配置对象
 *
 * 所有可调参数集中在此，方便后续修改。
 * CLI 参数可覆盖 .env 中的值。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// ---- 加载 .env 文件 ----
function loadEnvFile(dir) {
  const envPath = path.join(dir, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(ROOT_DIR);

// ---- CLI 参数解析 ----
function parseCliArgs() {
  const args = {};
  const positional = [];
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = raw[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  args._ = positional;
  return args;
}

const cliArgs = parseCliArgs();

// ---- 导出配置 ----
const config = {
  // 工作目录
  rootDir: ROOT_DIR,

  // 微信 API
  botType: process.env.BOT_TYPE || "3",
  defaultBaseUrl: "https://ilinkai.weixin.qq.com",
  longPollTimeoutMs: parseInt(process.env.LONG_POLL_TIMEOUT_MS || "35000", 10),
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "180000", 10),

  // DeepSeek API
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  deepseekBaseUrl: "https://api.deepseek.com/v1/chat/completions",
  deepseekTimeoutMs: parseInt(process.env.DEEPSEEK_TIMEOUT_MS || "300000", 10),
  deepseekMaxTokens: parseInt(process.env.DEEPSEEK_MAX_TOKENS || "4096", 10),
  deepseekTemperature: parseFloat(process.env.DEEPSEEK_TEMPERATURE || "0.7"),

  // Claude API (备用)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",

  // 消息处理
  maxReplyLen: parseInt(process.env.MAX_REPLY_LEN || "2500", 10),
  messageQueueConcurrency: parseInt(process.env.MSG_QUEUE_CONCURRENCY || "3", 10),
  messageQueueMaxSize: parseInt(process.env.MSG_QUEUE_MAX_SIZE || "100", 10),

  // 会话缓存
  sessionCacheMaxSize: parseInt(process.env.SESSION_CACHE_MAX_SIZE || "500", 10),
  sessionCacheTtlMs: parseInt(process.env.SESSION_CACHE_TTL_MS || "300000", 10),
  conversationMaxRounds: parseInt(process.env.CONVERSATION_MAX_ROUNDS || "20", 10),

  // 进程守护
  pidFile: path.join(ROOT_DIR, ".bot.pid"),
  maxRestartDelayMs: parseInt(process.env.MAX_RESTART_DELAY_MS || "300000", 10),
  minRestartDelayMs: 1000,
  crashResetWindowMs: parseInt(process.env.CRASH_RESET_WINDOW_MS || "60000", 10),
  maxCrashesPerWindow: parseInt(process.env.MAX_CRASHES_PER_WINDOW || "5", 10),

  // 网络守护
  networkCheckIntervalMs: parseInt(process.env.NETWORK_CHECK_INTERVAL_MS || "30000", 10),
  networkCheckTimeoutMs: parseInt(process.env.NETWORK_CHECK_TIMEOUT_MS || "10000", 10),
  backupBaseUrls: (process.env.BACKUP_BASE_URLS || "").split(",").filter(Boolean),

  // 日志
  logDir: path.join(ROOT_DIR, "logs"),
  logMaxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE || "10485760", 10), // 10MB
  logMaxFiles: parseInt(process.env.LOG_MAX_FILES || "5", 10),
  logLevel: process.env.LOG_LEVEL || "info", // debug | info | warn | error
  logToConsole: process.env.LOG_TO_CONSOLE !== "false",

  // 健康检查
  healthPort: parseInt(process.env.HEALTH_PORT || "0", 10), // 0=禁用

  // 告警
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "",
  alertOnCrash: process.env.ALERT_ON_CRASH !== "false",
  alertOnNetworkLoss: process.env.ALERT_ON_NETWORK_LOSS !== "false",

  // 开机自启
  startupShortcutName: "WeChat-ClaudeBot.lnk",

  // CLI 命令（第一个非 --flag 参数）
  cliCommand: cliArgs._?.[0] || cliArgs.command || "start",
  cliArgs,

  // 状态文件
  bufFile: path.join(ROOT_DIR, ".get_updates_buf"),
};

export default config;
