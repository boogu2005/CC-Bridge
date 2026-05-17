/**
 * Claude Code Bridge v4.2 — CLI 桥接模块
 *
 * Copyright (c) 2026 WeChat ClaudeBot Contributors
 * Licensed under the MIT License. See LICENSE file for details.
 *
 * 功能：spawn claude CLI → CC-Switch → DeepSeek，管理进程生命周期
 *
 * 修复内容：
 *   - 移除固定 session-id，每次独立调用，避免 "already in use" 冲突
 *   - killCurrent() 异步等待旧进程彻底退出后再启动新进程
 *   - 重试机制：遇到 "already in use" 或进程崩溃时自动重试
 *   - Windows SIGKILL 退出码 0xFFFFFFFF 特殊处理
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MODEL = process.env.CLAUDE_MODEL || process.env.DEEPSEEK_MODEL || "sonnet";
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || "300000", 10);
const KILL_WAIT_MS = 5000; // 等待旧进程退出的最长时间
const MAX_RETRIES = 2;     // "already in use" 等临时错误的重试次数
const IDLE_CLEANUP_MS = 600_000; // 10分钟自动清理闲置进程

// ---- 进程锁 ----
const LOCK_FILE = path.join(os.tmpdir(), "claude-bridge-wechat.lock");
let lockFd = null;

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stalePid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      try { process.kill(stalePid, 0); } catch {
        // 锁是旧的，清理它
        try { fs.unlinkSync(LOCK_FILE); } catch {}
      }
      // 如果进程还活着，等待一小段时间
      if (stalePid && stalePid !== process.pid) {
        try { process.kill(stalePid, 0); return false; } catch {}
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), "utf-8");
    return true;
  } catch {
    return true;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      if (pid === process.pid) fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
}

// ---- 闲置清理 ----
let lastActivity = Date.now();
let cleanupTimer = null;

function scheduleCleanup() {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    const idle = Date.now() - lastActivity;
    if (idle > IDLE_CLEANUP_MS) {
      cleanupStaleClaudeProcesses();
    }
    scheduleCleanup();
  }, IDLE_CLEANUP_MS);
}

function cleanupStaleClaudeProcesses() {
  try {
    // 清理所有 zombie claude 进程（超过30分钟）
    const psScript = `
      Get-Process -Name "node","claude","claude-cli" -ErrorAction SilentlyContinue |
      Where-Object { $_.StartTime -lt (Get-Date).AddMinutes(-30) } |
      ForEach-Object {
        try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
      }
    `;
    execSync(`powershell -NoProfile -Command "${psScript}"`, {
      timeout: 10000, windowsHide: true, stdio: "ignore"
    });
  } catch {}
}

scheduleCleanup();

// ---- 全局状态 ----
let currentProc = null;
let currentResolve = null;
let currentReject = null;
let currentTimer = null;
let isCleaningUp = false;

function safeKill(proc) {
  if (!proc || proc.exitCode !== null) return;
  try { proc.kill("SIGTERM"); } catch {}
  // 给 2 秒优雅退出，然后强制杀
  setTimeout(() => {
    try { if (proc.exitCode === null) proc.kill("SIGKILL"); } catch {}
  }, 2000);
}

/**
 * 终止当前进程并等待其彻底退出
 * 返回 Promise，resolve 后保证旧进程已死
 */
function killCurrent() {
  if (isCleaningUp) return Promise.resolve();
  isCleaningUp = true;

  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }

  const oldProc = currentProc;
  currentProc = null;

  if (currentReject) {
    const r = currentReject;
    currentReject = null;
    currentResolve = null;
    try { r(new Error("被新消息中断")); } catch {}
  }

  if (!oldProc || oldProc.exitCode !== null) {
    isCleaningUp = false;
    return Promise.resolve();
  }

  // 等待旧进程退出
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallback);
      isCleaningUp = false;
      resolve();
    };

    oldProc.on("close", done);
    oldProc.on("error", done);

    // 最多等 KILL_WAIT_MS，超时也继续
    const fallback = setTimeout(() => {
      try { if (oldProc.exitCode === null) oldProc.kill("SIGKILL"); } catch {}
      done();
    }, KILL_WAIT_MS);

    safeKill(oldProc);
  });
}

/**
 * 核心调用函数 — 修复版
 * 每条消息独立调用，bot 自行管理对话历史
 */
export async function callClaudeCode(userId, userMessage, opts = {}) {
  const { model = MODEL, systemPrompt, timeoutMs = TIMEOUT_MS } = opts;

  const safeUserId = (userId && typeof userId === "string") ? userId.slice(0, 64) : "unknown";
  const safeMessage = (userMessage && typeof userMessage === "string") ? userMessage : String(userMessage || "");

  if (!safeMessage) {
    return "（收到空消息，请重试）";
  }

  lastActivity = Date.now();

  // 等待上一个进程彻底退出
  await killCurrent();

  // 构建参数（不使用 --session-id，避免 "already in use" 冲突）
  const args = ["-p", `--model=${model}`];
  if (systemPrompt && typeof systemPrompt === "string") {
    args.push(`--system-prompt=${systemPrompt.replace(/"/g, '\\"')}`);
  }
  args.push(safeMessage);

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // 重试前等待，时间递增
      await new Promise(r => setTimeout(r, 2000 * attempt));
      await killCurrent();
    }

    try {
      const result = await spawnOnce(args, timeoutMs);
      return result;
    } catch (err) {
      lastError = err;
      const msg = err.message || "";

      // "already in use" 或进程崩溃 → 重试
      if (msg.includes("already in use") || msg.includes("Session ID") ||
          msg.includes("退出码 4294967295") || msg.includes("退出码 -1")) {
        continue;
      }
      // 其他错误直接抛出
      throw err;
    }
  }

  throw lastError || new Error("Claude Code 调用失败（已重试）");
}

/**
 * 单次 spawn 调用
 */
function spawnOnce(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    currentResolve = safeResolve;
    currentReject = safeReject;

    let proc;
    try {
      proc = spawn(CLAUDE_BIN, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        shell: true,
      });
    } catch (err) {
      currentResolve = null;
      currentReject = null;
      safeReject(new Error(`无法启动 Claude Code: ${err.message}`));
      return;
    }

    currentProc = proc;

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (c) => {
      try { stdout += (c && typeof c.toString === "function") ? c.toString("utf-8") : ""; } catch {}
    });

    proc.stderr.on("data", (c) => {
      try { stderr += (c && typeof c.toString === "function") ? c.toString("utf-8") : ""; } catch {}
    });

    currentTimer = setTimeout(() => {
      currentTimer = null;
      safeKill(proc);
      currentProc = null;
      currentResolve = null;
      currentReject = null;
      safeReject(new Error(`Claude Code 超时 (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(currentTimer);
      currentTimer = null;
      currentProc = null;
      currentResolve = null;
      currentReject = null;

      if (code !== 0) {
        const detail = (stderr || stdout || "").slice(0, 300) || "(无输出)";
        safeReject(new Error(`Claude Code 退出码 ${code}: ${detail}`));
        return;
      }

      let output = "";
      try { output = (stdout || "").trim(); } catch { output = ""; }

      if (!output) {
        output = "Claude 已完成（无文本输出）";
      }

      safeResolve(output);
    });

    proc.on("error", (err) => {
      clearTimeout(currentTimer);
      currentTimer = null;
      currentProc = null;
      currentResolve = null;
      currentReject = null;
      safeReject(new Error(`无法启动 Claude Code: ${err.message || "未知错误"}`));
    });
  });
}

/**
 * 重置用户会话 — 清理所有状态
 */
export function resetUserSession(_userId) {
  killCurrent();
  lastActivity = 0; // 标记为可清理
}

/**
 * 获取桥接状态
 */
export function getBridgeStats() {
  return {
    busy: currentProc !== null,
    lastActivity: new Date(lastActivity).toISOString(),
  };
}

/**
 * 强制清理所有 Claude 进程（用于维护）
 */
export function forceCleanup() {
  killCurrent(); // fire-and-forget，不阻塞
  cleanupStaleClaudeProcesses();
  releaseLock();
  return { ok: true, message: "已清理所有 Claude 进程" };
}

// 进程退出时清理
process.on("exit", () => {
  killCurrent();
  releaseLock();
  if (cleanupTimer) clearTimeout(cleanupTimer);
});

process.on("SIGINT", () => {
  killCurrent();
  releaseLock();
  if (cleanupTimer) clearTimeout(cleanupTimer);
});

process.on("SIGTERM", () => {
  killCurrent();
  releaseLock();
  if (cleanupTimer) clearTimeout(cleanupTimer);
});

export default { callClaudeCode, resetUserSession, getBridgeStats, forceCleanup };
