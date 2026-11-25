(() => {
  const enabledInput = document.getElementById("enabled");
  const statusDot = document.getElementById("statusDot");
  const statusTitle = document.getElementById("statusTitle");
  const statusDetail = document.getElementById("statusDetail");
  const testBtn = document.getElementById("testBtn");
  const optionsBtn = document.getElementById("optionsBtn");
  const openBtn = document.getElementById("openBtn");
  const folderPath = document.getElementById("folderPath");
  const recentList = document.getElementById("recentList");
  const clearBtn = document.getElementById("clearBtn");

  let refreshing = false;
  let lastState = null;

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response) {
          reject(new Error("扩展后台没有响应，请重新加载扩展。"));
          return;
        }
        if (response.ok === false) {
          reject(new Error(response.error || "操作失败"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function refresh() {
    if (refreshing) {
      return;
    }
    refreshing = true;
    try {
      const state = await send({ type: "GET_STATE" });
      lastState = state;
      renderState(state);
    } catch (error) {
      renderOffline(error.message || String(error), true);
    } finally {
      refreshing = false;
    }
  }

  function renderState(state) {
    enabledInput.checked = state.enabled !== false;

    const helper = state.helper;
    if (helper && helper.ok !== false) {
      statusDot.className = "status-dot online";
      statusTitle.textContent = "本地助手运行中";

      const parts = [];
      if (Number(helper.queued) > 0) {
        parts.push("队列 " + helper.queued);
      }
      if (Number(helper.active) > 0) {
        parts.push("下载中 " + helper.active);
      }
      parts.push("已保存 " + (Number(helper.done) || 0));
      if (Number(helper.failed) > 0) {
        parts.push("失败 " + helper.failed);
      }
      statusDetail.textContent = parts.join(" · ");
      statusDetail.title = helper.downloadDir || "";

      folderPath.textContent = helper.downloadDir || "—";
      folderPath.title = helper.downloadDir || "";
      openBtn.disabled = !helper.downloadDir;
    } else {
      renderOffline(
        state.helperError ||
          "本地助手未运行。请运行 install.ps1，或重新启动电脑。",
        state.configured !== false
      );
    }

    renderRecent(state.recent);
  }

  function renderOffline(message, configured) {
    statusDot.className = "status-dot offline";
    if (configured === false) {
      statusTitle.textContent = "尚未配置本地助手";
      statusDetail.textContent = "请打开设置，填写助手地址和访问令牌。";
    } else {
      statusTitle.textContent = "本地助手未运行";
      statusDetail.textContent =
        message || "请运行 install.ps1，或重新启动电脑。";
    }
    statusDetail.title = statusDetail.textContent;
    folderPath.textContent = "—";
    folderPath.title = "";
    openBtn.disabled = true;
  }

  function renderRecent(items) {
    recentList.textContent = "";

    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "还没有记录。去 pixiv 收藏一张作品试试。";
      recentList.append(empty);
      clearBtn.disabled = true;
      return;
    }

    clearBtn.disabled = false;

    for (const item of items) {
      const isError = item.status === "error";
      const li = document.createElement("li");
      li.className = "recent-item" + (isError ? " error" : "");
      li.title = item.message || "";

      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = isError ? "!" : "↓";

      const body = document.createElement("div");
      body.className = "body";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.title || "作品 " + (item.pid || "");
      title.title = title.textContent;

      const meta = document.createElement("div");
      meta.className = "meta";
      if (isError) {
        meta.textContent =
          "#" +
          (item.pid || "?") +
          " · " +
          (item.message || "失败") +
          " · " +
          formatTime(item.time);
      } else {
        meta.textContent =
          "#" +
          (item.pid || "?") +
          " · " +
          (Number(item.count) || 0) +
          " 张 · " +
          formatTime(item.time);
      }

      body.append(title, meta);
      li.append(mark, body);
      recentList.append(li);
    }
  }

  function formatTime(timestamp) {
    const value = Number(timestamp);
    if (!value) {
      return "";
    }

    const diffSeconds = Math.max(0, (Date.now() - value) / 1000);
    if (diffSeconds < 10) {
      return "刚刚";
    }
    if (diffSeconds < 60) {
      return Math.floor(diffSeconds) + " 秒前";
    }
    if (diffSeconds < 3600) {
      return Math.floor(diffSeconds / 60) + " 分钟前";
    }
    if (diffSeconds < 86400) {
      return Math.floor(diffSeconds / 3600) + " 小时前";
    }

    return new Date(value).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setBusy(button, busy, label) {
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = label || "处理中";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  enabledInput.addEventListener("change", async () => {
    const value = enabledInput.checked;
    try {
      await send({ type: "SET_ENABLED", enabled: value });
      statusTitle.textContent = value ? "已启用" : "已暂停";
      statusDetail.textContent = value
        ? "收藏作品时会自动保存原图"
        : "收藏作品时不会下载";
      window.setTimeout(refresh, 900);
    } catch (error) {
      enabledInput.checked = !value;
      statusDetail.textContent = error.message || String(error);
      statusDot.className = "status-dot offline";
      statusTitle.textContent = "设置失败";
    }
  });

  optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  testBtn.addEventListener("click", async () => {
    if (lastState && lastState.configured === false) {
      chrome.runtime.openOptionsPage();
      window.close();
      return;
    }

    setBusy(testBtn, true, "测试中");
    try {
      const result = await send({ type: "TEST_HELPER" });
      statusDot.className = "status-dot online";
      statusTitle.textContent = "连接成功";
      statusDetail.textContent =
        "队列 " +
        (Number(result.helper && result.helper.queued) || 0) +
        " · 已保存 " +
        (Number(result.helper && result.helper.done) || 0);
      statusDetail.title = (result.helper && result.helper.downloadDir) || "";
    } catch (error) {
      renderOffline(
        error.message || String(error),
        !(lastState && lastState.configured === false)
      );
    } finally {
      setBusy(testBtn, false);
    }
  });

  openBtn.addEventListener("click", async () => {
    try {
      await send({ type: "OPEN_FOLDER" });
    } catch (error) {
      statusDetail.textContent = error.message || String(error);
      statusTitle.textContent = "无法打开文件夹";
    }
  });

  clearBtn.addEventListener("click", async () => {
    try {
      await send({ type: "CLEAR_RECENT" });
      renderRecent([]);
    } catch (error) {
      statusDetail.textContent = error.message || String(error);
    }
  });

  window.addEventListener("focus", refresh);
  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    window.setInterval(refresh, 5000);
  });
})();
