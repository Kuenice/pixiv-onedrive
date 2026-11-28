# Pixiv 收藏原图 → OneDrive

在 **Edge** 里收藏 pixiv 作品后，自动把该作品的**原图**保存到 OneDrive 的 `pixiv` 文件夹。

默认保存目录：`%OneDrive%\pixiv`（安装脚本会自动检测 OneDrive 路径）。

> 安装包也可以从本仓库的 **Releases** 页面下载。

## 文件命名

| 作品类型 | 保存结果 |
| --- | --- |
| 单张插画 | `12345678_p0.png` |
| 多张插画 / 漫画 | `12345678_p0.png`、`12345678_p1.png`、`12345678_p2.png` …… |
| 动图（ugoira） | `12345678_p0.zip`（pixiv 提供的原始帧 zip） |

> 表中的 `.png` 仅为示例，实际按原图格式保存。

- `pid` 是作品 ID，`p` 是固定字母，`n` 从 **0** 开始：第一张图是 `_p0`，第二张是 `_p1`。
- **按原图格式保存**：原图是什么格式，就用什么后缀（如 `.png`、`.jpg`、`.gif`、`.webp`）。
- 已存在的同名文件会跳过，不会重复下载。
- 只处理**新添加的收藏**；收藏前就存在的旧作品不会自动补下。

## 为什么需要“扩展 + 本地助手”

浏览器扩展出于安全限制，**不能静默写入 OneDrive 的任意本地目录**，只能写入 Edge 的默认下载目录。因此本方案由两部分组成：

```
Edge 扩展（监听收藏、读取原图地址）
        │  HTTP + 随机令牌，仅 127.0.0.1
        ▼
Windows 本地助手（下载图片并写入 OneDrive\pixiv）
```

本地助手是一个很小的 .NET 程序，监听 `127.0.0.1`，只接受带令牌的请求，并且只允许下载 `*.pximg.net/img-original/` 或 `*.pximg.net/img-zip-ugoira/` 的地址。

## 安装

### 1. 运行安装脚本

把压缩包完整解压，然后**双击 `Install.cmd`**。

也可以在本目录打开 PowerShell 执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会：

1. 读取 `%OneDrive%` 并创建 `pixiv` 子目录；
2. 编译并安装本地助手到 `%LOCALAPPDATA%\PixivOneDrive`；
3. 创建开机自启动快捷方式并立即启动助手（加 `-OnDemand` 则改为按需启动）；
4. 把扩展文件安装到 `%LOCALAPPDATA%\PixivOneDrive\extension`；
5. 注册 Native Messaging 本地宿主，让扩展能在需要时拉起助手；
6. 打开 Edge 扩展页和扩展目录。

如果需要指定其他目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DownloadDir "D:\OneDrive\pixiv"
```

### 2. 在 Edge 中加载扩展（只需一次）

1. 打开 `edge://extensions/`；
2. 开启左下角的 **开发人员模式**；
3. 点击 **加载解压缩的扩展**；
4. 选择目录：

   ```text
   %LOCALAPPDATA%\PixivOneDrive\extension
   ```

5. 把 **Pixiv 收藏原图 → OneDrive** 固定到工具栏。

> Edge 可能会在启动时提示“请停用开发人员模式扩展”。这是未上架商店的扩展的正常提示，选择保留即可。

### 商店版配置

如果通过 **Microsoft Edge 加载项商店**安装，扩展目录是只读的，安装器无法自动写入 `config.js`。首次使用时：

1. 下载 `PixivOneDrive.zip`，解压后双击 `Install-Helper.cmd`（只安装本地助手）；
2. 安装器会把访问令牌复制到剪贴板；
3. 打开扩展的 **扩展选项**（“本地助手设置”）；
4. 助手地址保持默认 `http://127.0.0.1:39391`，粘贴访问令牌；
5. 点击“保存并测试连接”。

解压版扩展会自动读取安装器写入的令牌，不需要手动填写。

### 按需启动（不想开机常驻）

默认行为是**开机就启动助手**，它会一直占着约 100 MB 内存。如果只在收藏时用一下，可以改成“需要时才拉起”：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -OnDemand
```

这会：

1. 删除开机自启动快捷方式；
2. 安装 `PixivOneDriveLauncher.exe`（约 10 KB 的 Native Messaging 宿主）；
3. 注册 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.kuenice.pixiv_onedrive_launcher`；
4. 把 `idleExitMinutes` 设为 15。

之后的时序：

```text
开机             -> 0 个相关进程
打开 Edge         -> 0 个相关进程
收藏作品 / 点插件  -> 扩展调用宿主 -> 宿主拉起助手（约 0.5-1 秒）-> 下载
助手空闲 15 分钟   -> 自行退出
```

> **必须用解压版扩展**：商店版扩展没有 `nativeMessaging` 权限，无法调用宿主。切到按需启动前，先在 `edge://extensions/` 删掉旧扩展，再“加载解压缩的扩展”。`manifest.json` 里的 `key` 把 ID 固定为 `fiikgpfcmommnnfahgnikomdkfohkcdn`，所以本地宿主注册对开发版和商店版都有效。

想换空闲时长：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -OnDemand -IdleExitMinutes 30
```

`-IdleExitMinutes 0` 表示不自动退出（配合 `-OnDemand` 就是“被拉起一次后常驻”）。

### 3. 验证

1. 打开 pixiv 的任意作品页；
2. 点击收藏（公开或非公开都行）；
3. 点击工具栏上的扩展图标，查看“最近记录”和“已保存”数量；
4. 打开 OneDrive 的 `pixiv` 文件夹，应该出现 `pid_p0.扩展名` 文件。

也可以先运行状态脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\status.ps1
```

## 常用选项

安装脚本参数：

| 参数 | 作用 |
| --- | --- |
| `-DownloadDir "D:\OneDrive\pixiv"` | 指定保存目录 |
| `-NoStartup` | 不创建开机自启动快捷方式 |
| `-NoOpen` | 安装完成后不自动打开 Edge 和资源管理器 |
| `-HelperOnly` | 只安装本地助手，不安装解压版扩展（商店版使用） |
| `-OnDemand` | 不开机自启，改由扩展在需要时拉起助手（Native Messaging） |
| `-IdleExitMinutes 15` | 助手空闲多少分钟后自动退出（0 = 不退出；`-OnDemand` 默认 15） |

重新运行 `install.ps1` 会保留原来的令牌，并重新生成扩展配置。修改端口或保存目录后，请在 `edge://extensions/` 中点击扩展的 **重新加载**。

## 工作方式

- 扩展通过 `webRequest` 监听 pixiv 的收藏请求：
  - 新接口 `POST /ajax/illusts/bookmarks/add`
  - 兼容旧接口 `POST /ajax/illust/{id}/bookmark`（`mode=add`）
- 收藏成功后，扩展在 pixiv 页面内以同源请求读取：
  - `/ajax/illust/{pid}`：标题、类型、作者
  - `/ajax/illust/{pid}/pages`：每页原图地址
  - `/ajax/illust/{pid}/ugoira_meta`：动图原始 zip 地址
- 原图地址和作品 ID 发送给本地助手；
- 助手带上 `Referer: https://www.pixiv.net/...` 下载，先写 `.part` 临时文件，校验文件头后再改名，避免半截文件。

## 注意事项

- **只在 Edge 中收藏时触发**。在手机或其他浏览器收藏不会触发。
- Edge 可以关闭，本地助手会继续完成已经提交的下载；但关闭 Edge 后新的收藏不会被捕获。
- 原图可能很大（例如 6 MB、10 MB 一张），OneDrive 需要一点时间同步。
- R-18 作品需要先在 Edge 中登录 pixiv 并完成年龄确认。
- 小说（novel）没有插画原图，不会处理。
- 动图保存的是 pixiv 原始 `.zip`，不是 GIF/MP4。需要动画文件可以再用其他工具转换。
- 文件名后缀按原图格式保存（如 `.png`、`.jpg`、`.gif`、`.webp`）。
- 文件名严格为 `pid_pn.ext`，不包含标题、作者或页数前缀。
- 按需模式下助手空闲 15 分钟会自行退出，下次收藏时由扩展自动拉起，不需要手动启动。

## 故障排查

### 扩展显示“本地助手未运行”

在 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\status.ps1
```

如果助手确实没运行，重新运行 `install.ps1`，或直接启动：

```text
%LOCALAPPDATA%\PixivOneDrive\PixivOneDriveHelper.exe
```

日志在：

```text
%LOCALAPPDATA%\PixivOneDrive\helper.log
```

### 收藏后没有文件

1. 看扩展弹窗的“最近记录”是否有红色错误；
2. 看 `helper.log` 是否有 `下载失败`；
3. 确认作品页能正常看到原图（R-18 需要登录）；
4. 确认 `D:\OneDrive\pixiv` 有写入权限。

### 按需启动时提示“无法连接本地助手，自动启动也没有成功”

1. 确认扩展是**解压版**（商店版没有 `nativeMessaging` 权限，永远无法拉起助手）；
2. 确认注册表项存在：

   ```text
   HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.kuenice.pixiv_onedrive_launcher
   ```

3. 查看 `%LOCALAPPDATA%\PixivOneDrive\launcher.log` 里最后一次 `ensure` 记录；
4. 重新运行 `install.ps1 -OnDemand` 重新注册宿主。

### 端口被占用

安装脚本会自动尝试后续端口，并同步写入扩展配置。如果手动改过 `config.json`，改完需要重新运行 `install.ps1` 让扩展配置保持一致，然后在 Edge 中重新加载扩展。

### 想换保存目录

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DownloadDir "E:\OneDrive\pixiv"
```

然后在 `edge://extensions/` 重新加载扩展。

## 发布到 Edge 加载项

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\pack.ps1
```

生成两个包：

| 包 | 用途 |
| --- | --- |
| `dist\PixivOneDrive-dev-<版本>.zip` | 保留 `key`，用于本地“加载解压缩的扩展”，ID 稳定 |
| `dist\PixivOneDrive-store-<版本>.zip` | 已剥离 `key`，上传商店用 |

发布前注意：

1. 先改 `extension\manifest.json` 的 `version`；
2. 1.2.0 起新增 `nativeMessaging` 权限，已安装用户更新后会看到“扩展需要重新启用”，更新说明里要写清楚；
3. 商店扩展 ID 与开发版相同（同一把密钥），同一份本地宿主注册对两个版本都有效；
4. 商店版用户仍需运行一次 `Install-Helper.cmd` 安装助手和宿主。

## 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

这会停止本地助手、删除开机自启动项和 `%LOCALAPPDATA%\PixivOneDrive`。**不会删除** `OneDrive\pixiv` 里已经下载的图片。

最后在 `edge://extensions/` 中手动删除扩展。

## 文件结构

```text
pixiv-onedrive\
  Install.cmd                  双击安装（解压版扩展 + 助手）
  Install-Helper.cmd           只安装本地助手（商店版）
  install.ps1                  安装脚本
  pack.ps1                     打包（开发版 / 商店版）
  uninstall.ps1                卸载脚本
  status.ps1                   查看助手状态和日志
  PRIVACY.md                   隐私政策
  extension\                   Edge MV3 扩展
    manifest.json
    background.js              收藏监听、元数据读取、助手通信
    content.js                 在 pixiv 页面内读取作品信息
    popup.html / popup.css / popup.js
    options.html / options.css / options.js
    config.js                  安装时写入端口和令牌
    icons\
  helper\
    PixivOneDriveHelper.cs     本地助手源码（C# 5 / .NET Framework）
    PixivOneDriveHelper.exe    预编译版本
  launcher\
    PixivOneDriveLauncher.cs   Native Messaging 宿主源码
    PixivOneDriveLauncher.exe  预编译版本
  store\                       商店提交资料（说明、审核备注）
  store-assets\                商店 Logo、宣传图和截图
  dist\PixivOneDrive.zip       可直接分发的压缩包
```

## 安全说明

- 助手只监听 `127.0.0.1`，不对局域网开放。
- 每次安装生成随机令牌，扩展请求必须携带该令牌。
- 助手只允许 `https://*.pximg.net/img-original/` 和 `https://*.pximg.net/img-zip-ugoira/` 地址，防止被当成任意 URL 下载器。
- 助手不读取、不保存 pixiv Cookie；Cookie 只在扩展的页面请求中使用。
- 所有源码都在本目录，可自行审查后再运行。
- 完整隐私政策见 [PRIVACY.md](PRIVACY.md)。
