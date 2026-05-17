/**
 * 健康检查 HTTP 服务 — 实时查询机器人运行状态
 *
 * 端点：
 *  - GET /health      — 综合健康状态
 *  - GET /health/json — 详细 JSON 状态
 *  - GET /metrics     — Prometheus 风格指标
 *
 * 安全：仅监听 localhost，不暴露到公网。
 */
import http from "node:http";
import config from "./config.mjs";
import logger from "./logger.mjs";

// ---- 状态引用（由主模块注入） ----
let stateProvider = null;

export function setStateProvider(provider) {
  stateProvider = provider;
}

// ---- 构建状态对象 ----
function buildHealthData() {
  const base = {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    memory: process.memoryUsage(),
  };

  if (stateProvider) {
    const s = stateProvider();
    return { ...base, ...s };
  }

  return base;
}

// ---- JSON 响应 ----
function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

// ---- 路由处理 ----
function handleRequest(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${config.healthPort}`);

  switch (url.pathname) {
    case "/health": {
      const data = buildHealthData();
      const isHealthy = data.status === "ok" && data.connection === "connected";
      const text = [
        `Status:   ${isHealthy ? "✓ HEALTHY" : "✗ UNHEALTHY"}`,
        `Uptime:   ${Math.round(data.uptime)}s`,
        `PID:      ${data.pid}`,
        `Messages: ${data.messagesProcessed || 0} processed`,
        `Queue:    ${data.queuePending || 0} pending, ${data.queueActive || 0} active`,
        `Network:  ${data.connection || "unknown"}`,
        `Memory:   ${(data.memory?.heapUsed / 1024 / 1024).toFixed(1)} MB`,
        ``,
      ].join("\n");
      res.writeHead(isHealthy ? 200 : 503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(text);
      return;
    }

    case "/health/json": {
      const data = buildHealthData();
      const isHealthy = data.status === "ok" && data.connection === "connected";
      sendJson(res, data, isHealthy ? 200 : 503);
      return;
    }

    case "/metrics": {
      const data = buildHealthData();
      const metrics = [
        "# HELP bot_uptime_seconds Bot uptime in seconds",
        "# TYPE bot_uptime_seconds gauge",
        `bot_uptime_seconds ${data.uptime}`,
        "# HELP bot_messages_processed_total Total messages processed",
        "# TYPE bot_messages_processed_total counter",
        `bot_messages_processed_total ${data.messagesProcessed || 0}`,
        "# HELP bot_queue_pending Messages waiting in queue",
        "# TYPE bot_queue_pending gauge",
        `bot_queue_pending ${data.queuePending || 0}`,
        "# HELP bot_queue_active Messages being processed",
        "# TYPE bot_queue_active gauge",
        `bot_queue_active ${data.queueActive || 0}`,
        "# HELP bot_network_healthy Network connection status (1=ok, 0=down)",
        "# TYPE bot_network_healthy gauge",
        `bot_network_healthy ${data.connection === "connected" ? 1 : 0}`,
        "",
      ].join("\n");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(metrics);
      return;
    }

    case "/": {
      sendJson(res, {
        service: "WeChat-ClaudeBot",
        version: "2.0",
        endpoints: ["/health", "/health/json", "/metrics"],
      });
      return;
    }

    default:
      sendJson(res, { error: "Not Found" }, 404);
  }
}

// ---- 启动服务 ----
let server = null;

export function startHealthServer() {
  if (config.healthPort <= 0) {
    logger.info("健康检查服务已禁用 (HEALTH_PORT=0)");
    return;
  }

  server = http.createServer(handleRequest);
  server.listen(config.healthPort, "127.0.0.1", () => {
    logger.info(`健康检查服务已启动: http://127.0.0.1:${config.healthPort}/health`);
  });

  server.on("error", (err) => {
    logger.warn(`健康检查服务启动失败: ${err.message}`);
  });
}

export function stopHealthServer() {
  if (server) {
    server.close();
    server = null;
    logger.info("健康检查服务已停止");
  }
}
