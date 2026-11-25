# Edge 加载项商店资料 / Store listing

## 基本信息

| 字段 | 值 |
| --- | --- |
| Extension name | Pixiv 收藏原图 → OneDrive |
| Category | Productivity |
| Visibility | Hidden（推荐，先只通过链接安装） |
| Website | https://github.com/Kuenice/pixiv-onedrive |
| Support contact | https://github.com/Kuenice/pixiv-onedrive/issues |
| Privacy policy URL | https://github.com/Kuenice/pixiv-onedrive/blob/main/PRIVACY.md |
| Mature content | No |

## Short description

来自 manifest：

> 在 pixiv.net 收藏作品后，自动把原图保存到 OneDrive\pixiv，文件名为 pid_pn.ext（n 从 0 开始）。

## Description（zh-CN）

Pixiv 收藏原图 → OneDrive 让收藏 pixiv 作品后的归档变成自动流程。你在 pixiv.net 点击收藏后，扩展会识别这次收藏，读取作品的原图地址，再通过本机的 PixivOneDriveHelper 把原图保存到 OneDrive\pixiv。

主要功能：

- 支持单张插画、多图作品和漫画，按 pid_p0、pid_p1、pid_p2…… 命名，扩展名跟随原图格式。
- 支持 pixiv 动图（ugoira）的原始 zip。
- 已存在同名文件时自动跳过，不会重复下载。
- 公开收藏和非公开收藏都可以触发；R-18 作品需要先在浏览器登录 pixiv。
- 扩展弹窗可以查看本地助手状态和最近下载记录。

使用前需要安装本机助手。浏览器扩展不能静默写入 OneDrive 的任意本地目录，这是浏览器的安全限制，因此图片保存由本机助手完成。安装助手后，在扩展的“本地助手设置”页填入 config.json 中的访问令牌即可。助手只在本机运行，图片和 URL 不会上传到开发者服务器。

隐私：扩展不会读取或上传 pixiv Cookie，不包含分析、追踪或广告。详细说明见隐私政策。

## Description（en-US，备用）

Pixiv Bookmark to OneDrive automatically saves original images from newly bookmarked pixiv artworks to a user-configured OneDrive folder.

- Supports single images, multi-page artworks, manga, and ugoira original ZIP files.
- Files are named pid_p0.ext, pid_p1.ext, and so on; the extension follows the original image format.
- Existing files are skipped.
- Works with public and private bookmarks. R-18 works require a pixiv login.
- The popup shows helper status and recent downloads.

A companion app is required because browser extensions cannot silently write to arbitrary local folders. Install the helper, then enter the token from config.json in the extension's Helper Settings page. The helper listens only on 127.0.0.1 and never sends data to a developer server.

No pixiv cookies are read or uploaded. No analytics, tracking, or advertising.

## Search terms

pixiv, OneDrive, 原图下载, 收藏, downloader, image, 插画

## Assets

| 用途 | 文件 |
| --- | --- |
| 商店 Logo（300×300） | `store-assets/logo-300.png` |
| 小宣传图（440×280，可选） | `store-assets/promo-440x280.png` |
| 截图（1280×800，可选） | `store-assets/screenshot-options-1280x800.png` |

## 商店包

`dist/PixivOneDrive-store-1.1.0.zip`，manifest.json 位于 zip 根目录。
