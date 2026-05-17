#!/usr/bin/env node
/**
 * WeChat ClaudeBot v5.1 — 纯双向消息管道
 *
 * Copyright (c) 2026 WeChat ClaudeBot Contributors
 * Licensed under the MIT License. See LICENSE file for details.
 *
 * 定位：纯双向消息中转，禁用所有本地 AI 能力
 *   - 微信消息原样转发至终端 Claude/DeepSeek
 *   - 终端返回结果原样推送回微信
 *   - 零本地分类、零本地搜索、零本地兜底
 *
 * 架构：微信 ←ilink→ 本地轮询 → spawn claude CLI → CC-Switch → DeepSeek
 *
 * CLI：
 *   node wechat_bot.mjs start              启动（默认）
 *   node wechat_bot.mjs stop               停止运行中的实例
 *   node wechat_bot.mjs status             查看状态
 *   node wechat_bot.mjs autostart-enable   启用开机自启
 *   node wechat_bot.mjs autostart-disable  禁用开机自启
 *   node wechat_bot.mjs login              仅扫码登录
 *   node wechat_bot.mjs version            查看版本信息
 *   node wechat_bot.mjs cleanup            清理残留进程
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { callClaudeCode, getBridgeStats, forceCleanup } from "./bot_modules/claude-code-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ---- 版本永久锁定 ----
const BOT_VERSION = "5.1.0";
const VERSION_LOCK_FILE = path.join(ROOT, ".version_lock");
const VERSION_LOCK_HASH = "v5.1-permanent-locked-2026-05-17-final";

// 永久禁用功能清单 — env 覆盖无效
const PERMANENTLY_DISABLED = [
  "local_ai", "local_search", "local_classification",
  "local_memory", "conversation_history", "persona",
  "auto_fallback", "smart_reply", "name_recognition",
];

function writeVersionLock() {
  try {
    fs.writeFileSync(VERSION_LOCK_FILE, JSON.stringify({
      version: BOT_VERSION,
      edition: "pure-relay-permanent",
      hash: VERSION_LOCK_HASH,
      locked_at: new Date().toISOString(),
      immutable: true,
      rules: {
        mode: "pure_bidirectional_relay",
        local_ai: "permanently_disabled",
        local_search: "permanently_disabled",
        local_classification: "permanently_disabled",
        local_memory: "permanently_disabled",
        conversation_history: "permanently_disabled",
        persona: "none",
        fallback_message: "已同步指令至电脑终端，等待终端执行输出。",
      },
      reversion: "permanently_blocked",
    }, null, 2), "utf-8");
  } catch {}
}

function verifyVersionLock() {
  try {
    if (fs.existsSync(VERSION_LOCK_FILE)) {
      const data = JSON.parse(fs.readFileSync(VERSION_LOCK_FILE, "utf-8"));
      // 检查是否为旧版锁（含 features 字段 = 旧版，拒绝）
      if (data.features && !data.immutable) {
        log("WARN", "检测到旧版配置锁，正在覆盖为永久锁...");
        writeVersionLock();
        return true;
      }
      if (data.hash === VERSION_LOCK_HASH) return true;
    }
  } catch {}
  writeVersionLock();
  return true;
}

// 强制屏蔽可恢复旧功能的 env 变量
function enforcePermanentLock() {
  const blockKeys = [
    "BOT_PERSONA", "BOT_NAME", "ENABLE_LOCAL_AI",
    "ENABLE_WEB_SEARCH", "ENABLE_SYSTEM_CONTROL",
    "ENABLE_SAFETY_GUARD", "ENABLE_MEMORY",
    "SYSTEM_PROMPT_OVERRIDE", "FALLBACK_MODE",
  ];
  for (const k of blockKeys) {
    if (process.env[k]) {
      log("WARN", `已忽略被永久锁定的环境变量: ${k}`);
      delete process.env[k];
    }
  }
}

// ---- .env 加载 ----
{
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) {
        const k = t.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
      }
    }
  }
}

// ---- 配置（.env 优先，默认值兜底） ----
const CFG = {
  botType:           process.env.BOT_TYPE || "3",
  baseUrl:           "https://ilinkai.weixin.qq.com",
  longPollTimeoutMs: 35_000,
  heartbeatMs:       180_000,
  maxReplyLen:       2500,
  pidFile:           path.join(ROOT, ".bot.pid"),
  bufFile:           path.join(ROOT, ".get_updates_buf"),
  restartDelayMs:    { min: 1000, max: 300_000 },
};

// ---- 简易日志 ----
const LOG_FILE = path.join(ROOT, "logs", "wechat_bot.log");
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function log(level, ...args) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(" ");
  const line = `[${ts}] [${level}] ${msg}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n", "utf-8"); } catch {}
}

// ======================================================================
// 微信 iLink API（自包含，不依赖 weixin-plugin）
// ======================================================================

function buildHeaders(token) {
  const randUin = Math.floor(Math.random() * 0xffffffff).toString(16);
  return {
    "Content-Type": "application/json",
    "AuthorizationType": "ilink_bot_token",
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String(((2 & 0xff) << 16) | ((4 & 0xff) << 8) | (3 & 0xff)),
    "X-WECHAT-UIN": Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString("base64"),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function baseInfo() {
  return { channel_version: "2.4.3", bot_agent: `ClaudeBot/${BOT_VERSION}` };
}

async function apiPost(endpoint, body, token, timeout = 30) {
  const resp = await fetch(`${CFG.baseUrl}/${endpoint}`, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout * 1000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

async function apiGet(endpoint, timeout = 35) {
  const resp = await fetch(`${CFG.baseUrl}/${endpoint}`, {
    headers: {
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": "915",
    },
    signal: AbortSignal.timeout(timeout * 1000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

// ======================================================================
// 登录 & 凭据持久化
// ======================================================================

const TOKEN_FILE = path.join(os.homedir(), ".claude-wechat-bot", "token.json");

function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {}
  return null;
}

function saveToken(info) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  info.saved_at = new Date().toISOString();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(info, null, 2), "utf-8");
}

async function doQrLogin() {
  console.log("=".repeat(56));
  console.log("  WeChat ClaudeBot v5.1 — 微信扫码登录");
  console.log("=".repeat(56));

  process.stdout.write("\n[1/3] 获取登录二维码...\n");
  const qrResp = await apiPost(
    `ilink/bot/get_bot_qrcode?bot_type=${CFG.botType}`,
    { local_token_list: [] },
    null, 15
  );
  const qrcodeStr = qrResp.qrcode;
  const qrcodeUrl = qrResp.qrcode_img_content;

  process.stdout.write("  二维码获取成功！\n\n");
  try {
    const QRCode = (await import("qrcode")).default;
    const termStr = await new Promise(r => QRCode.toString(qrcodeUrl, { type: "terminal", small: true }, (_, s) => r(s)));
    process.stdout.write(termStr + "\n");
  } catch {
    process.stdout.write(`  若二维码显示失败，请访问：\n  ${qrcodeUrl}\n\n`);
  }
  process.stdout.write("请用手机微信扫描二维码...\n");

  process.stdout.write("\n[2/3] 等待扫码确认...\n");
  const statusText = { wait: "等待扫码", scaned: "已扫码，确认中", confirmed: "已确认！", expired: "二维码过期" };
  let lastStatus = "";

  while (true) {
    let statusResp;
    try {
      statusResp = await apiGet(`ilink/bot/get_qrcode_status?qrcode=${qrcodeStr}`, 35);
    } catch { continue; }

    const status = statusResp.status || "wait";
    if (status !== lastStatus) {
      process.stdout.write(`  状态: ${statusText[status] || status}\n`);
      lastStatus = status;
    }

    if (status === "confirmed") {
      const info = {
        bot_token: statusResp.bot_token,
        account_id: statusResp.ilink_bot_id,
        base_url: statusResp.baseurl || CFG.baseUrl,
        user_id: statusResp.ilink_user_id || "",
      };
      if (!info.bot_token) throw new Error("服务器未返回 token");
      process.stdout.write(`\n  ✓ 登录成功！Bot: ${info.account_id}\n`);
      return info;
    }

    if (status === "expired") {
      const newQr = await apiPost(
        `ilink/bot/get_bot_qrcode?bot_type=${CFG.botType}`,
        { local_token_list: [] }, null, 15
      );
      try {
        const QRCode2 = (await import("qrcode")).default;
        const ts2 = await new Promise(r => QRCode2.toString(newQr.qrcode_img_content, { type: "terminal", small: true }, (_, s) => r(s)));
        process.stdout.write(ts2 + "\n");
      } catch {}
      return doQrLogin();
    }

    if (status === "binded_redirect") {
      process.stdout.write("  已连接过此 Bot，使用已有凭据...\n");
      const existing = loadToken();
      if (existing) return existing;
      throw new Error("未找到已有凭据");
    }

    await sleep(1000);
  }
}

// ======================================================================
// 消息中转 — 纯管道：微信 ←→ 终端 Claude/DeepSeek
// Bot 不做任何本地 AI、分类、搜索、兜底 — 只负责双向转发
// ======================================================================

/**
 * 纯消息中转：原样转发用户消息到终端 Claude，原样返回结果
 * 无系统提示词、无人设、无记忆、不做任何本地处理
 */
async function relayToTerminal(userId, userText) {
  const safeText = (userText && typeof userText === "string") ? userText.trim() : "";
  if (!safeText) return "已同步指令至电脑终端，等待终端执行输出。";

  const start = Date.now();
  try {
    const reply = await callClaudeCode(userId, safeText, {});
    log("INFO", `终端回复 (${Date.now() - start}ms, ${reply.length} 字)`);
    return reply;
  } catch (err) {
    log("ERROR", `终端调用失败: ${err.message}`);
    if (err.message && err.message.includes("被新消息中断")) {
      return "";
    }
    return "已同步指令至电脑终端，等待终端执行输出。";
  }
}

// ======================================================================
// 去重（仅防轮询重复，非会话记忆）
// ======================================================================

const dedupKeys = new Map();
const DEDUP_TTL = 5 * 60 * 1000;

function isDuplicate(userId, text) {
  const key = `${userId}::${text}`;
  const ts = dedupKeys.get(key);
  if (ts && Date.now() - ts < DEDUP_TTL) return true;
  dedupKeys.set(key, Date.now());

  if (dedupKeys.size > 500) {
    const now = Date.now();
    for (const [k, v] of dedupKeys) {
      if (now - v > DEDUP_TTL) dedupKeys.delete(k);
    }
  }
  return false;
}

// ======================================================================
// 消息轮询 & 回复
// ======================================================================

function loadBuf() {
  try { return fs.existsSync(CFG.bufFile) ? fs.readFileSync(CFG.bufFile, "utf-8").trim() : ""; } catch { return ""; }
}
function saveBuf(buf) {
  try { fs.writeFileSync(CFG.bufFile, buf, "utf-8"); } catch {}
}

async function sendMessage(toUser, text, token, contextToken) {
  if (!text) return;
  const maxLen = CFG.maxReplyLen;
  const finalText = text.length > maxLen ? text.slice(0, maxLen) + "\n\n...(内容过长，已截断)" : text;
  const clientId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  try {
    await apiPost("ilink/bot/sendmessage", {
      msg: {
        from_user_id: "", to_user_id: toUser, client_id: clientId,
        message_type: 2, message_state: 2,
        item_list: [{ type: 1, text_item: { text: finalText } }],
        context_token: contextToken || "",
      },
      base_info: baseInfo(),
    }, token, 15);
  } catch (err) {
    log("ERROR", `发送失败: ${err.message}`);
  }
}

async function runMessageLoop(account) {
  const { bot_token, base_url } = account;
  if (base_url) CFG.baseUrl = base_url;

  log("INFO", `消息循环启动 — Bot: ${account.account_id} | URL: ${CFG.baseUrl} | 版本: ${BOT_VERSION}`);

  try { await apiPost("ilink/bot/msg/notifystart", { base_info: baseInfo() }, bot_token, 5); } catch {}

  let buf = loadBuf();
  let lastHeartbeat = Date.now();

  while (true) {
    let resp;
    try {
      resp = await apiPost("ilink/bot/getupdates", {
        get_updates_buf: buf,
        base_info: baseInfo(),
      }, bot_token, CFG.longPollTimeoutMs / 1000 + 5);
    } catch (err) {
      log("WARN", `getUpdates 异常: ${err.message}，2s 后重试`);
      await sleep(2000);
      continue;
    }

    const ret = resp.ret ?? 0;
    const errcode = resp.errcode ?? 0;

    if (ret !== 0 || errcode !== 0) {
      log("ERROR", `API 错误: ret=${ret} errcode=${errcode} msg=${resp.errmsg || ""}`);
      if (errcode === -14) return { needRelogin: true };
      await sleep(3000);
      continue;
    }

    if (resp.get_updates_buf) {
      buf = resp.get_updates_buf;
      saveBuf(buf);
    }

    const msgs = resp.msgs || [];
    if (msgs.length > 0) lastHeartbeat = Date.now();

    for (const msg of msgs) {
      const fromUser = msg.from_user_id || "";
      const contextToken = msg.context_token || "";
      const msgType = msg.message_type || 0;

      if (msgType !== 1 || !fromUser) continue;

      const textParts = [];
      for (const item of msg.item_list || []) {
        if (item.type === 1 && item.text_item?.text) textParts.push(item.text_item.text);
        if (item.type === 4 && item.voice_item?.text) textParts.push(item.voice_item.text);
      }
      const userText = textParts.join("").trim();
      if (!userText) continue;

      if (isDuplicate(fromUser, userText)) {
        log("INFO", `跳过重复: ${userText.slice(0, 80)}`);
        continue;
      }

      log("INFO", `收到 [${fromUser.slice(0, 12)}]: ${userText.slice(0, 150)}`);

      // 终端界面展示微信消息
      console.log("\n" + "─".repeat(52));
      console.log(`  [微信 → 终端] ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
      console.log(`  ${userText}`);
      console.log("─".repeat(52));

      // 发送"正在输入"
      let typingTicket = "";
      try {
        const cfgResp = await apiPost("ilink/bot/getconfig", {
          ilink_user_id: fromUser, context_token: contextToken || "", base_info: baseInfo(),
        }, bot_token, 10);
        typingTicket = cfgResp?.typing_ticket || "";
        if (typingTicket) {
          apiPost("ilink/bot/sendtyping", {
            ilink_user_id: fromUser, typing_ticket: typingTicket, status: 1, base_info: baseInfo(),
          }, bot_token, 5).catch(() => {});
        }
      } catch {}

      // ========== 纯中转：原样转发，不附加任何上下文 ==========
      let reply;
      try {
        reply = await relayToTerminal(fromUser, userText);
      } catch (err) {
        log("ERROR", `中转失败: ${err.message}`);
        reply = "等待终端处理中";
      }

      await sendMessage(fromUser, reply, bot_token, contextToken);

      // 终端界面展示回复
      console.log(`  [终端 → 微信] ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
      console.log(`  ${reply.slice(0, 500)}${reply.length > 500 ? "..." : ""}`);
      console.log("─".repeat(52) + "\n");

      log("INFO", `回复 [${fromUser.slice(0, 12)}]: ${reply.slice(0, 120)}`);

      if (typingTicket) {
        apiPost("ilink/bot/sendtyping", {
          ilink_user_id: fromUser, typing_ticket: typingTicket, status: 2, base_info: baseInfo(),
        }, bot_token, 5).catch(() => {});
      }
    }

    const idle = Date.now() - lastHeartbeat;
    if (idle > CFG.heartbeatMs) {
      log("INFO", `心跳: 空闲 ${Math.round(idle / 60000)} 分钟`);
      lastHeartbeat = Date.now();
    }
  }
}

// ======================================================================
// CLI 命令
// ======================================================================

function handleCli() {
  const cmd = process.argv[2] || "start";

  if (cmd === "stop") {
    if (!fs.existsSync(CFG.pidFile)) { process.stdout.write("没有运行中的实例\n"); process.exit(0); }
    const pid = parseInt(fs.readFileSync(CFG.pidFile, "utf-8").trim(), 10);
    try { process.kill(pid, "SIGTERM"); process.stdout.write(`已发送终止信号到 PID ${pid}\n`); }
    catch { process.stdout.write(`PID ${pid} 已不存在\n`); try { fs.unlinkSync(CFG.pidFile); } catch {} }
    process.exit(0);
  }

  if (cmd === "status") {
    if (!fs.existsSync(CFG.pidFile)) { process.stdout.write("状态: 未运行\n"); process.exit(0); }
    const pid = parseInt(fs.readFileSync(CFG.pidFile, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0);
      const stats = getBridgeStats();
      process.stdout.write(`状态: 运行中 (PID ${pid})\n`);
      process.stdout.write(`版本: ${BOT_VERSION}\n`);
      process.stdout.write(`桥接: ${stats.busy ? "忙碌" : "空闲"}\n`);
      process.stdout.write(`最后活动: ${stats.lastActivity}\n`);
    } catch {
      process.stdout.write(`状态: 已停止 (PID ${pid} 残留)\n`);
    }
    process.exit(0);
  }

  if (cmd === "version") {
    process.stdout.write(`WeChat ClaudeBot v${BOT_VERSION}\n`);
    process.stdout.write(`模式: 纯消息管道 — 微信 ←→ 终端 Claude/DeepSeek\n`);
    process.stdout.write(`架构: CC-Switch → DeepSeek | ilink 微信协议\n`);
    process.exit(0);
  }

  if (cmd === "cleanup") {
    const result = forceCleanup();
    process.stdout.write(result.message + "\n");
    process.exit(0);
  }

  if (cmd === "autostart-enable") {
    import("./bot_modules/autostart.mjs").then(m => { m.enableAutostart(); process.exit(0); });
    return "handled";
  }

  if (cmd === "autostart-disable") {
    import("./bot_modules/autostart.mjs").then(m => { m.disableAutostart(); process.exit(0); });
    return "handled";
  }

  if (cmd === "login") return { loginOnly: true };
  return { loginOnly: false };
}

// ======================================================================
// 主入口
// ======================================================================

function acquirePidLock() {
  try {
    if (fs.existsSync(CFG.pidFile)) {
      const oldPid = parseInt(fs.readFileSync(CFG.pidFile, "utf-8").trim(), 10);
      try { process.kill(oldPid, 0); log("WARN", `已有实例运行 (PID ${oldPid})`); return false; } catch {}
    }
    fs.writeFileSync(CFG.pidFile, String(process.pid), "utf-8");
    return true;
  } catch { return true; }
}

function releasePidLock() {
  try {
    if (fs.existsSync(CFG.pidFile)) {
      if (parseInt(fs.readFileSync(CFG.pidFile, "utf-8").trim(), 10) === process.pid) {
        fs.unlinkSync(CFG.pidFile);
      }
    }
  } catch {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const cliResult = handleCli();
  if (cliResult === "handled") return;

  // 验证版本锁并强制应用永久锁定
  verifyVersionLock();
  enforcePermanentLock();

  // 启动时清理残留进程
  log("INFO", "启动时清理残留 Claude 进程...");
  try { forceCleanup(); } catch {}

  if (!acquirePidLock()) process.exit(1);

  process.on("SIGINT", () => { releasePidLock(); process.exit(0); });
  process.on("SIGTERM", () => { releasePidLock(); process.exit(0); });

  console.log("=".repeat(56));
  console.log(`  WeChat ClaudeBot v${BOT_VERSION} — 纯消息管道`);
  console.log("  微信 ←→ 终端 Claude/DeepSeek 双向转发");
  console.log("  零本地 AI | 零本地分类 | 零本地兜底");
  console.log("=".repeat(56));

  if (cliResult.loginOnly) {
    try {
      const info = await doQrLogin();
      saveToken(info);
      console.log(`登录成功: ${info.account_id}`);
    } catch (err) {
      console.error(`登录失败: ${err.message}`);
    }
    releasePidLock();
    process.exit(0);
  }

  let account = loadToken();
  if (!account) {
    log("INFO", "无凭据，开始扫码登录...");
    try {
      account = await doQrLogin();
      saveToken(account);
    } catch (err) {
      log("ERROR", `登录失败: ${err.message}`);
      releasePidLock();
      process.exit(1);
    }
  }

  CFG.baseUrl = account.base_url || CFG.baseUrl;
  log("INFO", `启动 — Bot: ${account.account_id} | URL: ${CFG.baseUrl} | v${BOT_VERSION}`);

  let retryCount = 0;
  while (true) {
    let result;
    try {
      result = await runMessageLoop(account);
    } catch (err) {
      log("ERROR", `消息循环崩溃: ${err.message}`);
      retryCount++;
      const delay = Math.min(CFG.restartDelayMs.min * Math.pow(2, Math.min(retryCount, 10)), CFG.restartDelayMs.max);
      log("INFO", `${Math.round(delay / 1000)}s 后重启 (重试 #${retryCount})`);
      await sleep(delay);
      continue;
    }

    if (result?.needRelogin) {
      log("WARN", "Session 过期，重新登录...");
      account = null;
      retryCount = 0;
      try { fs.unlinkSync(TOKEN_FILE); } catch {}
      try {
        account = await doQrLogin();
        saveToken(account);
        CFG.baseUrl = account.base_url || CFG.baseUrl;
        log("INFO", "重新登录成功");
      } catch (err) {
        log("ERROR", `重新登录失败: ${err.message}`);
        await sleep(30_000);
        continue;
      }
    }

    await sleep(3000);
    retryCount = 0;
  }
}

main().catch(err => {
  log("ERROR", `致命错误: ${err.message}`);
  releasePidLock();
  process.exit(1);
});
