# 认证测试说明 / Notes for certification

## 测试环境

- Windows 10/11
- Microsoft Edge Stable
- 需要安装本机助手 `PixivOneDriveHelper`，它负责把图片写入 OneDrive；这是扩展的必要配套程序。

## 安装本地助手

1. 从公开 Release 下载最新 `PixivOneDrive.zip`：

   https://github.com/Kuenice/pixiv-onedrive/releases/latest

2. 完整解压后双击 `Install-Helper.cmd`（只安装本地助手，不安装解压版扩展），或在 PowerShell 中运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -HelperOnly
   ```

3. 安装器不需要管理员权限。它会：
   - 编译/安装本地助手到 `%LOCALAPPDATA%\PixivOneDrive`；
   - 创建并启动 `PixivOneDriveHelper.exe`；
   - 生成 `%LOCALAPPDATA%\PixivOneDrive\config.json`，并把 `token` 复制到剪贴板；
   - 创建保存目录 `%OneDrive%\pixiv`（如果没有 OneDrive，则使用 `%USERPROFILE%\OneDrive\pixiv`）。

4. 检查助手状态：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\status.ps1
   ```

## 在扩展中配置助手

1. 打开扩展的“扩展选项 / Extension options”，即 `本地助手设置` 页面。
2. 助手地址保持默认：`http://127.0.0.1:39391`。
3. 打开 `%LOCALAPPDATA%\PixivOneDrive\config.json`，复制 `token` 字段的值，粘贴到“访问令牌”。
4. 点击“保存并测试连接”。
5. 预期状态：`连接成功 · v1.0.2 · <OneDrive 路径>`。

> 商店版扩展不能读取安装器写入的 `config.js`，因此需要在设置页手动粘贴一次令牌。解压版会自动读取。

## 功能测试

1. 打开一个公开的 pixiv 作品，例如：

   https://www.pixiv.net/artworks/100412238

2. 点击收藏（公开或非公开均可）。
3. 打开扩展弹窗，应看到一条“已交给本地助手下载”的记录。
4. 打开 `%OneDrive%\pixiv`，应出现：

   ```text
   100412238_p0.png
   ```

5. 再次收藏同一作品时，如果文件已存在，助手会跳过，不会覆盖。
6. 多页作品应生成 `pid_p0.ext`、`pid_p1.ext`……；动图应生成 `pid_p0.zip`。

## 说明

- 扩展只监听 pixiv 的收藏请求，不会读取其他网站的浏览记录。
- 扩展不读取或上传 pixiv Cookie。
- 扩展不使用远程代码；所有逻辑都在扩展包内。
- 扩展与助手之间的通信只发生在 `127.0.0.1`，并需要随机令牌。
- 如果测试环境中无法运行本地助手，设置页和错误提示仍可验证；核心下载功能需要助手。
- 本地助手源码在仓库的 `helper/` 目录，安装包包含预编译 exe，并在安装时优先用系统 `csc.exe` 从源码重新编译。
