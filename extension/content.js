/*
 * 在 pixiv 页面内以同源请求读取作品信息。
 * 这样会自动带上登录 Cookie，也能让 pixiv 收到正常的 Referer。
 */

(() => {
  const API_ORIGIN = "https://www.pixiv.net";

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "PIXIV_FETCH_ARTWORK") {
      return false;
    }

    fetchArtwork(String(message.pid || ""))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error)
        })
      );

    return true;
  });

  async function fetchArtwork(pid) {
    if (!/^\d+$/.test(pid)) {
      throw new Error("作品 ID 无效");
    }

    const meta = await getJson(API_ORIGIN + "/ajax/illust/" + pid);
    if (!meta || !meta.body) {
      throw new Error("pixiv 没有返回作品信息");
    }

    let pages = null;
    let pagesError = null;
    try {
      pages = await getJson(API_ORIGIN + "/ajax/illust/" + pid + "/pages");
    } catch (error) {
      pagesError = error && error.message ? error.message : String(error);
    }

    let ugoira = null;
    if (Number(meta.body.illustType) === 2) {
      try {
        ugoira = await getJson(
          API_ORIGIN + "/ajax/illust/" + pid + "/ugoira_meta"
        );
      } catch (error) {
        // 动图元数据可能需要登录；失败时交给后台再试。
      }
    }

    return { meta, pages, ugoira, pagesError };
  }

  async function getJson(url) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("pixiv 接口返回 HTTP " + response.status);
    }

    const json = await response.json();
    if (!json || json.error) {
      throw new Error((json && json.message) || "pixiv 接口返回错误");
    }
    return json;
  }
})();
