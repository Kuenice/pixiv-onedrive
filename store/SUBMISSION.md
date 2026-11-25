# Partner Center 提交清单

## 1. 注册开发者账号

1. 打开 https://partner.microsoft.com/dashboard/microsoftedge/public/login
2. 用 Microsoft 账号登录（建议使用 Kuenice 对应的账号）。
3. 注册 Microsoft Edge 计划；注册免费。
4. 按 Partner Center 提示完成账号验证。

## 2. 创建扩展

1. 进入 **Edge** 工作区。
2. 点击 **Create new extension**。
3. 上传商店包：

   ```text
   dist/PixivOneDrive-store-1.1.0.zip
   ```

   包内 `manifest.json` 必须位于 zip 根目录。

## 3. Availability

| 字段 | 建议值 |
| --- | --- |
| Visibility | **Hidden**（先只通过链接安装，不公开搜索） |
| Markets | 所有市场，或先选中国/美国 |

Hidden 仍然是正式商店扩展，安装后不会出现“开发人员模式扩展”提示；区别只是不在商店搜索中展示。

## 4. Properties

| 字段 | 值 |
| --- | --- |
| Category | Productivity |
| Website | https://github.com/Kuenice/pixiv-onedrive |
| Support contact | https://github.com/Kuenice/pixiv-onedrive/issues |
| Mature content | 否 |

## 5. Privacy

### Single purpose

> 在用户收藏 pixiv 作品时，将作品原图通过本机助手保存到用户指定的 OneDrive 文件夹。

### Permission justification

| 权限 | 说明 |
| --- | --- |
| `webRequest` | 监听 pixiv 的收藏请求，只在收藏成功后触发下载。 |
| `https://www.pixiv.net/*` | 读取作品信息、原图地址和页面登录状态。 |
| `http://127.0.0.1/*` | 与用户电脑上的本地助手通信；只连接本机回环地址。 |
| `storage` | 保存启用状态、最近记录和本地助手配置。 |
| `notifications` | 下载失败时通知用户。 |

### Remote code

选择 **No, I am not using remote code**。

### Data usage

扩展不在开发者服务器收集或存储用户数据。数据只在用户本机处理：

- pixiv 收藏事件、作品 ID、标题、作者、页面 URL、图片 URL；
- 本地助手地址和访问令牌（保存在 `chrome.storage.local`）；
- 最近 30 条本地记录。

这些数据只发送到 `127.0.0.1` 的本地助手，不上传到开发者或第三方。根据实际表单选项选择；隐私政策已说明本地处理方式。

### Privacy policy URL

```text
https://github.com/Kuenice/pixiv-onedrive/blob/main/PRIVACY.md
```

## 6. Store listing

使用 `store/LISTING.md` 中的名称、描述、搜索词和以下素材：

- Logo：`store-assets/logo-300.png`（必需）
- 小宣传图：`store-assets/promo-440x280.png`（可选）
- 截图：`store-assets/screenshot-options-1280x800.png`（可选）

## 7. Certification notes

粘贴 `store/CERTIFICATION.md` 的内容。重点说明：

- 扩展需要本地助手；
- 助手下载地址为公开 Release；
- 安装器不需要管理员权限；
- 令牌在 `%LOCALAPPDATA%\PixivOneDrive\config.json`；
- 测试作品为 `https://www.pixiv.net/artworks/100412238`；
- 预期文件名为 `100412238_p0.png`。

## 8. 提交后

1. 等待认证，官方说明最长约 7 个工作日。
2. 通过后，在 Partner Center 的 **Overview** 页面复制商店安装链接。
3. 把链接发给我，我可以：
   - 更新本地安装器/README 中的商店链接；
   - 让你在 Edge 安装商店版，关闭开发人员模式，提示就会消失。
4. 如果认证被拒，根据反馈修正后重新提交。

## 注意

- 不要为了消除提示而修改 Edge 的开发者模式通知；微软明确不允许关闭。
- 商店版安装后，仍需安装本机助手，否则扩展只能显示“未配置/未运行”，无法写入 OneDrive。
- 目前扩展版本为 `1.1.0`，助手版本为 `1.0.2`。
