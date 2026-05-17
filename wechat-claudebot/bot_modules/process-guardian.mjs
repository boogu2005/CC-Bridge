/**
 * 进程级守护 — PID 锁、崩溃检测、指数退避自动重启
 *
 * 特性：
 *  - PID 文件锁防止重复启动
 *  - 捕获 uncaughtException / unhandledRejection，记录但不退出
 *  - 崩溃计数器 + 时间窗口（窗口内超阈值则延迟更久）
 *  - 指数退避：1s → 2s → 4s → ... → maxRestartDelayMs（默认 5 分钟）
 *  - 支持无限次重试
 */
import fs from "node:fs";
import config from "./config.mjs";
import logger from "./logger.mjs";

// ---- 崩溃追踪 ----
const crashTimestamps = [];

function recordCrash() {
  const now = Date.now();
  crashTimestamps.push(now);
  // 清理窗口外的记录
  while (crashTimestamps.length > 0 && crashTimestamps[0] < now - config.crashResetWindowMs) {
    crashTimestamps.shift();
  }
}

function getRecentCrashCount() {
  const now = Date.now();
  while (crashTimestamps.length > 0 && crashTimestamps[0] < now - config.crashResetWindowMs) {
    crashTimestamps.shift();
  }
  return crashTimestamps.length;
}

// ---- PID 锁 ----
export function acquirePidLock() {
  try {
    if (fs.existsSync(config.pidFile)) {
      const oldPid = parseInt(fs.readFileSync(config.pidFile, "utf-8").trim(), 10);
      if (isProcessAlive(oldPid)) {
        logger.warn(`已有 bot 实例运行 (PID ${oldPid})，当前实例退出`);
        return false;
      }
      logger.info(`旧 PID 文件残留 (PID ${oldPid} 已不存在)，覆盖`);
    }
    fs.writeFileSync(config.pidFile, String(process.pid), "utf-8");
    logger.info(`PID 锁已获取 (PID ${process.pid})`);
    return true;
  } catch (err) {
    logger.warn(`PID 锁检查失败: ${err.message}，继续运行`);
    return true; // 宽容模式
  }
}

export function releasePidLock() {
  try {
    if (fs.existsSync(config.pidFile)) {
      const savedPid = parseInt(fs.readFileSync(config.pidFile, "utf-8").trim(), 10);
      if (savedPid === process.pid) {
        fs.unlinkSync(config.pidFile);
        logger.info("PID 锁已释放");
      }
    }
  } catch {}
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---- 计算退避延迟 ----
export function calcBackoffDelay(retryCount, recentCrashes) {
  // 基础指数退避：1s, 2s, 4s, 8s, 16s, 32s, ...
  let delay = config.minRestartDelayMs * Math.pow(2, Math.min(retryCount, 10));

  // 如果短时间内崩溃过多，延长等待
  if (recentCrashes >= config.maxCrashesPerWindow) {
    delay = Math.max(delay, config.maxRestartDelayMs);
    logger.warn(`短时间内崩溃 ${recentCrashes} 次，延长等待至 ${Math.round(delay / 1000)}s`);
  }

  return Math.min(delay, config.maxRestartDelayMs);
}

// ---- 注册全局异常处理（不退出进程） ----
export function installProcessGuard() {
  process.on("uncaughtException", (err) => {
    recordCrash();
    logger.exception(err, {
      type: "uncaughtException",
      recentCrashes: getRecentCrashCount(),
    });
    // 不退出！让事件循环继续
  });

  process.on("unhandledRejection", (reason) => {
    recordCrash();
    logger.exception(reason instanceof Error ? reason : new Error(String(reason)), {
      type: "unhandledRejection",
      recentCrashes: getRecentCrashCount(),
    });
    // 不退出！
  });

  // 优雅退出
  const gracefulShutdown = (signal) => {
    logger.info(`收到 ${signal} 信号，正在优雅退出...`);
    releasePidLock();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // 退出时清理
  process.on("exit", (code) => {
    if (code !== 0) {
      logger.warn(`进程退出，退出码: ${code}`);
    }
    releasePidLock();
  });

  logger.info("进程守护已安装（uncaughtException/unhandledRejection 已捕获）");
}

// ---- 状态导出（供健康检查） ----
export function getGuardianStats() {
  return {
    pid: process.pid,
    recentCrashes: getRecentCrashCount(),
    crashWindowMs: config.crashResetWindowMs,
    maxRestartDelayMs: config.maxRestartDelayMs,
    uptime: process.uptime(),
  };
}
