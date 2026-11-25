# 隐私政策 / Privacy Policy

**扩展：Pixiv 收藏原图 → OneDrive**  
**生效日期：2026-11-25**

## 中文

### 1. 这个扩展做什么

Pixiv 收藏原图 → OneDrive 会在你收藏 pixiv 作品时，读取该作品的原图地址，并通过你电脑上的本地助手把图片保存到你指定的 OneDrive 文件夹。

### 2. 处理哪些数据

- 当你在 `pixiv.net` 收藏作品时，扩展会读取该作品的 ID、标题、作者、页面地址和图片地址。
- 扩展不会读取或上传你的 pixiv Cookie；页面请求由浏览器自身携带登录状态发出。
- 扩展会在本机浏览器存储中保存：启用状态、最近 30 条下载记录（作品 ID、标题、时间、状态），以及本地助手的地址和访问令牌。
- 本地助手会在本机保存令牌、日志和下载记录，并将图片写入你配置的 OneDrive 文件夹。

### 3. 数据如何使用和共享

- 上述数据只会发送到 `127.0.0.1` 上运行的本机助手，用于下载图片和显示状态。
- 不会发送到开发者服务器、广告平台或任何第三方。
- 不包含分析、追踪、广告或出售数据的行为。
- 图片从 pixiv 的图片 CDN（`*.pximg.net`）下载。

### 4. 数据保留与删除

- 扩展的“最近记录”可在弹窗中清空。
- 卸载扩展会删除扩展在浏览器中的本地存储。
- 本地助手的配置和日志位于 `%LOCALAPPDATA%\PixivOneDrive`，可手动删除。
- 已下载的图片位于你配置的 OneDrive 文件夹，由你自行管理。

### 5. 权限说明

- `webRequest`：识别 pixiv 收藏请求，只在收藏成功后触发下载。
- `https://www.pixiv.net/*`：读取作品信息和原图地址。
- `http://127.0.0.1/*`：连接本机助手。
- `storage`：保存开关、最近记录和本地助手配置。
- `notifications`：下载失败时提醒你。

### 6. 安全

本地助手只监听 `127.0.0.1`，请求必须携带随机访问令牌，并且只允许下载 `*.pximg.net` 下的原图地址。

### 7. 联系方式

如有隐私问题，请在项目仓库提交 Issue：

https://github.com/Kuenice/pixiv-onedrive/issues

---

## English

**Extension: Pixiv Bookmark to OneDrive**

This extension saves original images from newly bookmarked pixiv artworks to a user-configured OneDrive folder through a companion app running on the user's computer.

### Data processed

When you bookmark an artwork on `pixiv.net`, the extension reads the artwork ID, title, artist, page URL and image URLs. It does not read or upload your pixiv cookies. The extension stores the enabled state, the last 30 local records, and the local helper endpoint/token in browser storage.

### Use and sharing

The data is sent only to the companion app on `127.0.0.1` to download images and show status. It is not sent to the developer, ad networks, or other third parties. There is no analytics, tracking, advertising, or sale of data. Images are downloaded from pixiv's image CDN (`*.pximg.net`).

### Retention and deletion

You can clear recent records from the popup. Uninstalling the extension removes its browser storage. The companion app's configuration and logs are stored in `%LOCALAPPDATA%\PixivOneDrive` and can be deleted manually. Downloaded images are stored in your chosen OneDrive folder and are managed by you.

### Permissions

- `webRequest`: detect successful pixiv bookmark requests.
- `https://www.pixiv.net/*`: read artwork metadata and original image URLs.
- `http://127.0.0.1/*`: connect to the local companion app.
- `storage`: save settings, recent records, and helper configuration.
- `notifications`: notify about download errors.

### Security

The companion app listens only on `127.0.0.1`, requires a random token, and only downloads original image URLs under `*.pximg.net`.

### Contact

https://github.com/Kuenice/pixiv-onedrive/issues
