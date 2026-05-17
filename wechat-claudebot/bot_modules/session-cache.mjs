/**
 * 会话缓存 — LRU 去重 + 用户对话历史缓存
 *
 * 特性：
 *  - 消息去重：相同用户+相同文本在 TTL 内不重复处理
 *  - 对话历史：每用户保留最近 N 轮对话
 *  - LRU 淘汰：超过最大条目数时淘汰最旧条目
 *  - TTL 过期：超时自动清理
 */
import config from "./config.mjs";

// ---- 消息去重缓存 ----
class LRUCache {
  constructor(maxSize, ttlMs) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map(); // key → { value, timestamp }
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    // TTL 检查
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }

    // LRU：移到末尾
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    // 已存在则更新
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    // 超出容量则淘汰最旧
    while (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }

    this.map.set(key, { value, timestamp: Date.now() });
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

// ---- 单例 ----
const dedupCache = new LRUCache(config.sessionCacheMaxSize, config.sessionCacheTtlMs);

// 用户对话历史（user_id → messages[]）
const conversationStore = new Map();
const conversationTimestamps = new Map(); // user_id → lastAccessTime

// ---- 消息指纹 ----
function msgFingerprint(fromUser, text) {
  const key = `${fromUser}::${text}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return hash.toString(36);
}

// ---- 公开 API ----
export function isDuplicateMessage(fromUser, text) {
  const fp = msgFingerprint(fromUser, text);
  if (dedupCache.has(fp)) return true;
  dedupCache.set(fp, true);
  return false;
}

export function getConversation(userId) {
  const safeId = userId.replace(/[@/]/g, "_");
  const history = conversationStore.get(safeId);
  conversationTimestamps.set(safeId, Date.now());
  return history || [];
}

export function setConversation(userId, messages) {
  const safeId = userId.replace(/[@/]/g, "_");
  // 只保留最近 N 轮（每轮 = user + assistant）
  const maxMsgs = config.conversationMaxRounds * 2;
  conversationStore.set(safeId, messages.slice(-maxMsgs));
  conversationTimestamps.set(safeId, Date.now());

  // 清理不活跃的对话
  cleanStaleConversations();
}

export function appendConversationMessage(userId, role, content) {
  const history = getConversation(userId);
  history.push({ role, content });
  setConversation(userId, history);
}

// ---- 清理 ----
function cleanStaleConversations() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30分钟不活跃则清理

  for (const [userId, lastAccess] of conversationTimestamps) {
    if (now - lastAccess > maxAge) {
      conversationStore.delete(userId);
      conversationTimestamps.delete(userId);
    }
  }

  // 如果内存占用过多，强制清理
  if (conversationStore.size > 100) {
    const entries = [...conversationTimestamps.entries()]
      .sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, entries.length - 50);
    for (const [userId] of toRemove) {
      conversationStore.delete(userId);
      conversationTimestamps.delete(userId);
    }
  }
}

// 定期清理
setInterval(cleanStaleConversations, 5 * 60 * 1000).unref();

// ---- 缓存统计 ----
export function getCacheStats() {
  return {
    dedupCacheSize: dedupCache.size,
    dedupCacheMax: config.sessionCacheMaxSize,
    activeConversations: conversationStore.size,
  };
}

export function clearAllCaches() {
  dedupCache.clear();
  conversationStore.clear();
  conversationTimestamps.clear();
}
