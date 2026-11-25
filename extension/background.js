/*
 * Pixiv 收藏原图 → OneDrive
 *
 * 监听 pixiv 的“添加收藏”请求，读取作品原图地址，然后交给本地助手保存。
 * 之所以需要本地助手：浏览器扩展无权静默写入 OneDrive 的任意本地目录。
 */

importScripts("config.js");

const CONFIG = self.PIXIV_ONEDRIVE_CONFIG || {};
const DEFAULT_ENDPOINT = String(CONFIG.endpoint || "http://127.0.0.1:39391").replace(/\/+$/, "");
const DEFAULT_TOKEN = String(CONFIG.token || "");
const API_ORIGIN = "https://www.pixiv.net";

const pendingBookmarks = new Map();
const recentlyQueued = new Map();
const MESSAGE_TYPES = new Set([
  "GET_STATE",
  "SET_ENABLED",
  "SAVE_SETTINGS",
  "TEST_HELPER",
  "OPEN_FOLDER",
  "CLEAR_RECENT"
]);

let badgeSequence = 0;
let lastNotificationAt = 0;

/* ------------------------------------------------------------------ */
/* 收藏请求监听                                                        */
/* ------------------------------------------------------------------ */

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      captureBookmarkRequest(details);
    } catch (error) {
      console.error("[Pixiv→OneDrive] capture failed", error);
    }
  },
  { urls: ["*://www.pixiv.net/ajax/illust*"] },
  ["requestBody"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    completeBookmarkRequest(details).catch((error) => {
      console.error("[Pixiv→OneDrive] complete failed", error);
    });
  },
  { urls: ["*://www.pixiv.net/ajax/illust*"] }
);

function captureBookmarkRequest(details) {
  if (details.method !== "POST") {
    return;
  }

  const path = new URL(details.url).pathname;
  const legacyMatch = /^\/ajax\/illust\/(\d+)\/bookmark\/?$/.exec(path);
  const isNewAdd = /^\/ajax\/illusts\/bookmarks\/add\/?$/.test(path);

  if (!legacyMatch && !isNewAdd) {
    return;
  }

  const fields = parseRequestBody(details.requestBody);
  const mode = fields.mode == null ? "" : String(fields.mode).toLowerCase();

  // 旧接口既用于添加也用于删除，删除请求必须忽略。
  if (mode && mode !== "add") {
    return;
  }

  let pid = legacyMatch ? legacyMatch[1] : null;
  if (fields.illust_id != null) {
    const candidate = String(fields.illust_id).trim();
    if (/^\d+$/.test(candidate)) {
      pid = candidate;
    }
  }

  const info = {
    pid,
    tabId: details.tabId,
    createdAt: Date.now()
  };

  pendingBookmarks.set(details.requestId, info);

  // 防止某些请求始终没有 onCompleted 时内存一直增长。
  setTimeout(() => pendingBookmarks.delete(details.requestId), 20000);
}

async function completeBookmarkRequest(details) {
  const info = pendingBookmarks.get(details.requestId);
  if (!info) {
    return;
  }

  pendingBookmarks.delete(details.requestId);

  if (details.statusCode < 200 || details.statusCode >= 300) {
    return;
  }

  if (!(await isEnabled())) {
    return;
  }

  let pid = info.pid;
  if (!pid && info.tabId >= 0) {
    pid = await pidFromTab(info.tabId);
  }

  if (!pid) {
    console.warn("[Pixiv→OneDrive] 收藏成功，但没有解析到作品 ID");
    return;
  }

  const now = Date.now();
  const previous = recentlyQueued.get(pid) || 0;
  if (now - previous < 10000) {
    return;
  }
  recentlyQueued.set(pid, now);

  // 只保留最近 10 分钟的记录，避免 Map 增长。
  for (const [key, timestamp] of recentlyQueued) {
    if (now - timestamp > 600000) {
      recentlyQueued.delete(key);
    }
  }

  await handleBookmark(pid, info.tabId);
}

function parseRequestBody(requestBody) {
  if (!requestBody) {
    return {};
  }

  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const key of Object.keys(requestBody.formData)) {
      const values = requestBody.formData[key];
      for (const value of values) {
        params.append(key, value);
      }
    }
    return Object.fromEntries(params.entries());
  }

  if (Array.isArray(requestBody.raw) && requestBody.raw.length > 0) {
    const chunks = [];
    let total = 0;

    for (const part of requestBody.raw) {
      if (!part || !part.bytes) {
        continue;
      }
      const chunk = new Uint8Array(part.bytes);
      chunks.push(chunk);
      total += chunk.byteLength;
    }

    if (total === 0) {
      return {};
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder("utf-8").decode(merged).trim();
    if (!text) {
      return {};
    }

    if (text.charAt(0) === "{") {
      try {
        const json = JSON.parse(text);
        if (json && typeof json === "object") {
          return json;
        }
      } catch (error) {
        // 继续尝试按表单解析。
      }
    }

    try {
      return Object.fromEntries(new URLSearchParams(text).entries());
    } catch (error) {
      return {};
    }
  }

  return {};
}

async function pidFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) {
      return null;
    }

    const url = new URL(tab.url);
    const match = /\/artworks\/(\d+)/.exec(url.pathname);
    if (match) {
      return match[1];
    }

    const queryMatch = /[?&]illust_id=(\d+)/.exec(url.search);
    return queryMatch ? queryMatch[1] : null;
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 处理一次新收藏                                                      */
/* ------------------------------------------------------------------ */

async function handleBookmark(pid, tabId) {
  let title = "";

  try {
    const data = await getArtworkData(pid, tabId);
    const meta = data.meta && data.meta.body ? data.meta.body : {};
    title = String(meta.illustTitle || "");

    const files = buildFiles(data, pid);
    if (files.length === 0) {
      throw new Error("没有找到原图地址。作品可能受限、已删除，或动图元数据不可用。");
    }

    const payload = {
      pid,
      title,
      artist: String(meta.userName || ""),
      pageUrl: API_ORIGIN + "/artworks/" + pid,
      files
    };

    const result = await helperRequest(
      "/download",
      { method: "POST", body: JSON.stringify(payload) },
      15000
    );

    const queued = Number(result.queued || files.length);
    await recordRecent({
      status: "queued",
      pid,
      title,
      count: queued,
      kind: illustKind(meta.illustType),
      message: "已交给本地助手下载"
    });

    flashBadge("↓", "#0096fa");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    await recordRecent({
      status: "error",
      pid,
      title,
      count: 0,
      kind: "unknown",
      message
    });
    flashBadge("!", "#e5484d");
    notifyError(message);
  }
}

async function getArtworkData(pid, tabId) {
  if (tabId >= 0) {
    try {
      const response = await sendToTab(
        tabId,
        { type: "PIXIV_FETCH_ARTWORK", pid },
        12000
      );
      if (response && response.ok) {
        return response.data;
      }
      console.warn(
        "[Pixiv→OneDrive] 页面内读取失败，改用扩展后台读取",
        response && response.error
      );
    } catch (error) {
      console.warn("[Pixiv→OneDrive] 页面内读取不可用，改用扩展后台读取", error);
    }
  }

  return await fetchArtworkDirect(pid);
}

function sendToTab(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("页面响应超时"));
      }
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function fetchArtworkDirect(pid) {
  const meta = await fetchPixivJson("/ajax/illust/" + pid);
  if (!meta || !meta.body) {
    throw new Error("pixiv 没有返回作品信息");
  }

  let pages = null;
  try {
    pages = await fetchPixivJson("/ajax/illust/" + pid + "/pages");
  } catch (error) {
    console.warn("[Pixiv→OneDrive] 读取 pages 失败", error);
  }

  let ugoira = null;
  if (Number(meta.body.illustType) === 2) {
    try {
      ugoira = await fetchPixivJson("/ajax/illust/" + pid + "/ugoira_meta");
    } catch (error) {
      console.warn("[Pixiv→OneDrive] 读取 ugoira_meta 失败", error);
    }
  }

  return { meta, pages, ugoira };
}

async function fetchPixivJson(path) {
  const response = await fetch(API_ORIGIN + path, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
    referrer: API_ORIGIN + "/"
  });

  if (!response.ok) {
    throw new Error("pixiv 接口返回 HTTP " + response.status + "，请确认已登录。");
  }

  const json = await response.json();
  if (!json || json.error) {
    throw new Error((json && json.message) || "pixiv 接口返回错误");
  }
  return json;
}

function buildFiles(data, pid) {
  const meta = data && data.meta && data.meta.body ? data.meta.body : {};
  const files = [];
  const seen = new Set();

  const push = (url, index) => {
    if (typeof url !== "string" || !isOriginalImageUrl(url)) {
      return;
    }
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    files.push({
      index,
      url,
      ext: extensionFromUrl(url)
    });
  };

  // 动图（ugoira）优先保存原始 zip，文件名仍然是 pid_p0.zip。
  if (Number(meta.illustType) === 2) {
    const ugoira = data.ugoira && data.ugoira.body ? data.ugoira.body : null;
    if (ugoira) {
      push(ugoira.originalSrc || ugoira.src, 0);
    }
    if (files.length === 0 && meta.urls) {
      push(meta.urls.original, 0);
    }
  }

  // 普通插画 / 漫画：pages 的顺序就是 p0、p1、p2……
  if (files.length === 0 && data.pages && Array.isArray(data.pages.body)) {
    data.pages.body.forEach((page, index) => {
      if (page && page.urls) {
        push(page.urls.original, index);
      }
    });
  }

  // 兼容单张作品的旧接口。
  if (files.length === 0 && meta.urls) {
    push(meta.urls.original, 0);
  }

  return files;
}

function isOriginalImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (parsed.hostname !== "i.pximg.net" && !parsed.hostname.endsWith(".pximg.net")) {
      return false;
    }
    return (
      parsed.pathname.startsWith("/img-original/") ||
      parsed.pathname.startsWith("/img-zip-ugoira/")
    );
  } catch (error) {
    return false;
  }
}

function extensionFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const match = /\.([a-z0-9]+)$/i.exec(path);
    const ext = match ? match[1].toLowerCase() : "jpg";
    return ["jpg", "jpeg", "png", "gif", "webp", "zip"].includes(ext)
      ? ext
      : "jpg";
  } catch (error) {
    return "jpg";
  }
}

function illustKind(type) {
  const value = Number(type);
  if (value === 1) {
    return "manga";
  }
  if (value === 2) {
    return "ugoira";
  }
  return "illust";
}

/* ------------------------------------------------------------------ */
/* 本地助手通信                                                        */
/* ------------------------------------------------------------------ */

function normalizeHelperEndpoint(value) {
  const endpoint = String(value || "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (error) {
    throw new Error("本地助手地址格式无效。");
  }

  if (parsed.protocol !== "http:") {
    throw new Error("本地助手地址必须使用 http://。");
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("本地助手地址只能是 127.0.0.1 或 localhost。");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("本地助手地址不能包含路径、参数或锚点。");
  }

  return endpoint;
}

function isConfiguredToken(token) {
  return Boolean(token) && token !== "INSTALL_REQUIRED";
}

async function getHelperConfig() {
  const stored = await chrome.storage.local.get({
    helperEndpoint: "",
    helperToken: ""
  });

  let endpoint = DEFAULT_ENDPOINT;
  if (stored.helperEndpoint) {
    try {
      endpoint = normalizeHelperEndpoint(stored.helperEndpoint);
    } catch (error) {
      endpoint = DEFAULT_ENDPOINT;
    }
  }

  const token = String(stored.helperToken || DEFAULT_TOKEN || "").trim();
  return { endpoint, token };
}

async function helperRequest(path, options, timeoutMs) {
  const helperConfig = await getHelperConfig();

  if (!isConfiguredToken(helperConfig.token)) {
    throw new Error("尚未配置本地助手。请打开扩展设置，填写访问令牌。");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);

  const headers = { "X-Pixiv-Token": helperConfig.token };
  if (options && options.body) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  try {
    const response = await fetch(helperConfig.endpoint + path, {
      method: (options && options.method) || "GET",
      headers,
      body: options && options.body,
      signal: controller.signal,
      cache: "no-store"
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { raw: text };
    }

    if (!response.ok) {
      throw new Error(
        (data && (data.error || data.message)) || "本地助手返回 HTTP " + response.status
      );
    }

    if (data && data.ok === false) {
      throw new Error(data.error || "本地助手返回失败");
    }

    return data || {};
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("本地助手响应超时。");
    }
    if (error instanceof TypeError) {
      throw new Error(
        "无法连接本地助手。请确认 PixivOneDriveHelper 正在运行（重新运行 install.ps1 或重启电脑）。"
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 状态、记录与界面消息                                                */
/* ------------------------------------------------------------------ */

async function isEnabled() {
  const data = await chrome.storage.local.get({ enabled: true });
  return data.enabled !== false;
}

async function recordRecent(entry) {
  try {
    const data = await chrome.storage.local.get({ recent: [] });
    const recent = Array.isArray(data.recent) ? data.recent : [];
    recent.unshift({
      ...entry,
      time: Date.now()
    });
    await chrome.storage.local.set({ recent: recent.slice(0, 30) });
  } catch (error) {
    console.error("[Pixiv→OneDrive] 保存记录失败", error);
  }
}

function flashBadge(text, color) {
  const sequence = ++badgeSequence;
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => {
    if (sequence === badgeSequence) {
      chrome.action.setBadgeText({ text: "" });
    }
  }, 5000);
}

function notifyError(message) {
  const now = Date.now();
  if (now - lastNotificationAt < 15000) {
    return;
  }
  lastNotificationAt = now;

  try {
    chrome.notifications.create(
      "pixiv-onedrive-error-" + now,
      {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Pixiv 收藏原图下载失败",
        message: String(message || "未知错误").slice(0, 220)
      },
      () => {
        // 读取 lastError，避免未处理的回调错误。
        void chrome.runtime.lastError;
      }
    );
  } catch (error) {
    console.warn("[Pixiv→OneDrive] 通知发送失败", error);
  }
}

async function getState() {
  const data = await chrome.storage.local.get({
    enabled: true,
    recent: []
  });
  const helperConfig = await getHelperConfig();
  const configured = isConfiguredToken(helperConfig.token);

  let helper = null;
  let helperError = null;
  if (configured) {
    try {
      helper = await helperRequest("/health", { method: "GET" }, 4000);
    } catch (error) {
      helperError = error && error.message ? error.message : String(error);
    }
  } else {
    helperError = "尚未配置本地助手。请打开扩展设置，填写访问令牌。";
  }

  return {
    ok: true,
    enabled: data.enabled !== false,
    recent: Array.isArray(data.recent) ? data.recent : [],
    endpoint: helperConfig.endpoint,
    configured,
    helper,
    helperError
  };
}

async function handleMessage(message) {
  switch (message.type) {
    case "GET_STATE":
      return await getState();

    case "SET_ENABLED":
      await chrome.storage.local.set({ enabled: Boolean(message.enabled) });
      return { ok: true, enabled: Boolean(message.enabled) };

    case "SAVE_SETTINGS": {
      const endpoint = normalizeHelperEndpoint(message.endpoint);
      const token = String(message.token || "").trim();

      if (!isConfiguredToken(token)) {
        throw new Error("请填写本地助手访问令牌。");
      }
      if (token.length > 256) {
        throw new Error("访问令牌过长。");
      }

      await chrome.storage.local.set({
        helperEndpoint: endpoint,
        helperToken: token
      });
      return { ok: true, endpoint };
    }

    case "TEST_HELPER":
      return { ok: true, helper: await helperRequest("/health", { method: "GET" }, 5000) };

    case "OPEN_FOLDER":
      return await helperRequest("/open-folder", { method: "POST" }, 5000);

    case "CLEAR_RECENT":
      await chrome.storage.local.set({ recent: [] });
      return { ok: true };

    default:
      return { ok: false, error: "未知消息" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !MESSAGE_TYPES.has(message.type)) {
    return false;
  }

  if (sender && sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "来源无效" });
    return false;
  }

  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      })
    );

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ enabled: true }, (data) => {
    chrome.storage.local.set({ enabled: data.enabled !== false, recent: [] });
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
});
