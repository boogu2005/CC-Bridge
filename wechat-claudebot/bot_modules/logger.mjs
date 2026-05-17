/**
 * 三级日志系统 — info / warn / error，带时间戳、文件轮转
 *
 * 特性：
 *  - 同时输出到控制台和文件
 *  - 按文件大小自动轮转（保留最近 N 个文件）
 *  - debug 级别仅在 LOG_LEVEL=debug 时输出
 *  - 异常事件自动包含调用栈
 */
import fs from "node:fs";
import path from "node:path";
import config from "./config.mjs";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_LABELS = { debug: "DEBUG", info: "INFO", warn: "WARN", error: "ERROR" };

const minLevel = LEVELS[config.logLevel] ?? LEVELS.info;

// 确保日志目录存在
if (!fs.existsSync(config.logDir)) {
  fs.mkdirSync(config.logDir, { recursive: true });
}

const LOG_FILE = path.join(config.logDir, "wechat_bot.log");

// ---- 核心写入 ----
function formatLine(level, args) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  const label = LEVEL_LABELS[level] || "INFO";
  const msg = args.map((a) => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ""}`;
    if (typeof a === "object") {
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }
    return String(a);
  }).join(" ");
  return `[${ts}] [${label}] ${msg}`;
}

function writeLine(line) {
  // 控制台
  if (config.logToConsole) {
    if (line.includes("[ERROR]")) console.error(line);
    else if (line.includes("[WARN]")) console.warn(line);
    else console.log(line);
  }

  // 文件（同步追加，避免丢失崩溃前的日志）
  try {
    fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
  } catch {}

  // 检查是否需要轮转
  rotateIfNeeded();
}

// ---- 日志轮转 ----
function rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < config.logMaxFileSize) return;
  } catch {
    return;
  }

  // 轮转：wechat_bot.log → wechat_bot.1.log → wechat_bot.2.log ...
  for (let i = config.logMaxFiles - 1; i >= 1; i--) {
    const oldFile = path.join(config.logDir, `wechat_bot.${i}.log`);
    const newFile = path.join(config.logDir, `wechat_bot.${i + 1}.log`);
    try { if (fs.existsSync(oldFile)) fs.renameSync(oldFile, newFile); } catch {}
  }

  // 重命名当前文件
  const rotFile = path.join(config.logDir, "wechat_bot.1.log");
  try {
    fs.renameSync(LOG_FILE, rotFile);
  } catch {}

  // 删除超出数量的旧文件
  for (let i = config.logMaxFiles + 1; i <= config.logMaxFiles + 5; i++) {
    const old = path.join(config.logDir, `wechat_bot.${i}.log`);
    try { if (fs.existsSync(old)) fs.unlinkSync(old); } catch {}
  }
}

// ---- 公开 API ----
const logger = {
  debug(...args) {
    if (minLevel > LEVELS.debug) return;
    writeLine(formatLine("debug", args));
  },

  info(...args) {
    if (minLevel > LEVELS.info) return;
    writeLine(formatLine("info", args));
  },

  warn(...args) {
    if (minLevel > LEVELS.warn) return;
    writeLine(formatLine("warn", args));
  },

  error(...args) {
    writeLine(formatLine("error", args));
  },

  /** 记录异常事件（含时间戳、异常类型、上下文） */
  exception(err, context = {}) {
    const ctxStr = Object.entries(context)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    writeLine(formatLine("error", [
      `[EXCEPTION] type=${err?.name || "Error"} message=${err?.message || String(err)} ${ctxStr}`,
      err,
    ]));
  },

  /** 获取日志文件路径（供健康检查使用） */
  getLogFilePath() {
    return LOG_FILE;
  },

  /** 读取最近的日志行（供健康检查使用） */
  getRecentLogs(lineCount = 50) {
    try {
      if (!fs.existsSync(LOG_FILE)) return [];
      const content = fs.readFileSync(LOG_FILE, "utf-8");
      const lines = content.trim().split("\n");
      return lines.slice(-lineCount);
    } catch {
      return [];
    }
  },
};

export default logger;
