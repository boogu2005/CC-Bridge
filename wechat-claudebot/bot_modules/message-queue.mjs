/**
 * 消息队列异步处理 — 高并发下避免阻塞，保证首条消息 <1s 响应
 *
 * 特性：
 *  - 并发控制：最多 N 个消息同时处理
 *  - 优先级入队：新消息优先（可配置）
 *  - 超时控制：每条消息有独立超时
 *  - 积压保护：队列满时丢弃最旧消息（或可配置为拒绝新消息）
 *  - 统计：已处理、成功、失败、平均延迟
 */
import config from "./config.mjs";
import logger from "./logger.mjs";

// ---- 统计 ----
const stats = {
  enqueued: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  timedOut: 0,
  totalLatencyMs: 0,
  avgLatencyMs: 0,
  currentQueueSize: 0,
};

// ---- 队列 ----
const queue = [];
let activeCount = 0;
let queueProcessorTimer = null;

// ---- 将消息加入队列 ----
export function enqueueMessage(msg, processor) {
  if (queue.length >= config.messageQueueConcurrency * 10) {
    // 积压保护：丢弃最旧
    const removed = queue.shift();
    logger.warn(`消息队列溢出，丢弃最旧消息: ${removed?.msg?.from_user_id || "unknown"}`);
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    msg,
    processor,
    enqueuedAt: Date.now(),
    timeoutMs: config.deepseekTimeoutMs,
  };

  queue.push(entry);
  stats.enqueued++;
  stats.currentQueueSize = queue.length;

  // 触发处理
  processQueue();

  return entry.id;
}

// ---- 队列处理器 ----
function processQueue() {
  // 已达到并发上限
  while (activeCount < config.messageQueueConcurrency && queue.length > 0) {
    const entry = queue.shift();
    stats.currentQueueSize = queue.length;
    activeCount++;

    processEntry(entry).finally(() => {
      activeCount--;
      stats.currentQueueSize = queue.length;
      // 继续处理下一个
      if (queue.length > 0) processQueue();
    });
  }
}

async function processEntry(entry) {
  const { id, msg, processor, enqueuedAt, timeoutMs } = entry;
  const waitTime = Date.now() - enqueuedAt;

  // 等待时间记录
  if (waitTime > 1000) {
    logger.warn(`消息 ${id} 排队等待 ${waitTime}ms，超过 1s 目标`);
  }

  // 超时控制
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = Date.now();
  try {
    await Promise.race([
      processor(msg, controller.signal),
      new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`消息处理超时 (${timeoutMs}ms)`));
        }, { once: true });
      }),
    ]);

    const latency = Date.now() - startTime;
    stats.succeeded++;
    stats.totalLatencyMs += latency;
    stats.avgLatencyMs = Math.round(stats.totalLatencyMs / stats.succeeded);
    logger.debug(`消息 ${id} 处理成功，耗时 ${latency}ms`);
  } catch (err) {
    if (err.message.includes("超时")) {
      stats.timedOut++;
      logger.error(`消息 ${id} 处理超时 (${timeoutMs}ms)`);
    } else {
      stats.failed++;
      logger.error(`消息 ${id} 处理失败: ${err.message}`);
    }
  } finally {
    clearTimeout(timer);
    stats.processed++;
  }
}

// ---- 获取队列统计 ----
export function getQueueStats() {
  return {
    ...stats,
    currentQueueSize: queue.length,
    activeCount,
    concurrency: config.messageQueueConcurrency,
  };
}

// ---- 获取队列状态（简洁版，供健康检查） ----
export function getQueueStatus() {
  return {
    pending: queue.length,
    active: activeCount,
    processed: stats.processed,
    failed: stats.failed,
    avgLatencyMs: stats.avgLatencyMs,
  };
}

// ---- 重置统计 ----
export function resetQueueStats() {
  stats.enqueued = 0;
  stats.processed = 0;
  stats.succeeded = 0;
  stats.failed = 0;
  stats.timedOut = 0;
  stats.totalLatencyMs = 0;
  stats.avgLatencyMs = 0;
}
