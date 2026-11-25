(() => {
  const CONFIG = self.PIXIV_ONEDRIVE_CONFIG || {};
  const SUPPORT_URL = "https://github.com/Kuenice/pixiv-onedrive/releases/latest";
  const DEFAULT_ENDPOINT = "http://127.0.0.1:39391";

  const endpointInput = document.getElementById("endpoint");
  const tokenInput = document.getElementById("token");
  const toggleTokenBtn = document.getElementById("toggleToken");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const statusBox = document.getElementById("status");
  const downloadLink = document.getElementById("downloadLink");

  let busy = false;

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

  function setStatus(state, message) {
    statusBox.dataset.state = state;
    statusBox.textContent = message;
  }

  function setBusy(value) {
    busy = value;
    saveBtn.disabled = value;
    testBtn.disabled = value;
    toggleTokenBtn.disabled = value;
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get({
      helperEndpoint: "",
      helperToken: ""
    });

    const endpoint =
      stored.helperEndpoint || CONFIG.endpoint || DEFAULT_ENDPOINT;
    let token = stored.helperToken || "";

    // 解压版安装器会把令牌写进 config.js；商店版没有真实令牌。
    if (!token && CONFIG.token && CONFIG.token !== "INSTALL_REQUIRED") {
      token = CONFIG.token;
    }

    endpointInput.value = endpoint;
    tokenInput.value = token;

    if (token) {
      await testConnection();
    } else {
      setStatus(
        "idle",
        "尚未配置访问令牌。请先安装本地助手，再从 config.json 复制 token 填入上方。"
      );
    }
  }

  async function saveSettings() {
    const endpoint = endpointInput.value.trim();
    const token = tokenInput.value.trim();

    if (!endpoint) {
      throw new Error("请填写本地助手地址。");
    }
    if (!token) {
      throw new Error("请填写访问令牌。");
    }

    await send({
      type: "SAVE_SETTINGS",
      endpoint,
      token
    });

    endpointInput.value = endpoint;
    tokenInput.value = token;
  }

  async function testConnection() {
    setBusy(true);
    setStatus("busy", "正在连接本地助手…");

    try {
      const result = await send({ type: "TEST_HELPER" });
      const helper = result.helper || {};
      const folder = helper.downloadDir ? " · " + helper.downloadDir : "";
      const version = helper.version ? " · v" + helper.version : "";
      setStatus("ok", "连接成功" + version + folder);
      return true;
    } catch (error) {
      setStatus("error", error.message || String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndTest() {
    if (busy) {
      return;
    }

    setBusy(true);
    setStatus("busy", "正在保存并连接…");

    try {
      await saveSettings();
      await testConnection();
    } catch (error) {
      setStatus("error", error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  saveBtn.addEventListener("click", saveAndTest);

  testBtn.addEventListener("click", async () => {
    if (busy) {
      return;
    }
    await testConnection();
  });

  toggleTokenBtn.addEventListener("click", () => {
    const show = tokenInput.type === "password";
    tokenInput.type = show ? "text" : "password";
    toggleTokenBtn.textContent = show ? "隐藏" : "显示";
  });

  endpointInput.addEventListener("input", () => {
    setStatus("idle", "配置已修改，点击“保存并测试连接”生效。");
  });

  tokenInput.addEventListener("input", () => {
    setStatus("idle", "配置已修改，点击“保存并测试连接”生效。");
  });

  downloadLink.href = SUPPORT_URL;
  loadSettings().catch((error) => {
    setStatus("error", "读取设置失败：" + (error.message || String(error)));
  });
})();
