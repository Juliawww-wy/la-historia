# La Historia 划词导入扩展

在任意网页选中西班牙语文本，右键点「用 La Historia 查词」，自动打开/切到 La Historia 并把选中内容导入输入框——不经过 URL 查询参数，不受长文本截断、隐私插件清理参数等问题影响。

## 安装（Chrome / Edge 通用，未上架商店）

1. 打开 `chrome://extensions`（Edge 则是 `edge://extensions`）。
2. 右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选择本仓库的 `extension/` 文件夹。
4. 完成，图标会出现在扩展栏（无自定义图标，用的是默认占位图标）。

## 使用

1. 在任意网页选中一段西班牙语文本。
2. 右键 → 「用 La Historia 查词 "..."」。
3. 自动打开（或切换到已打开的）La Historia 标签页，选中内容直接填入输入框并开始翻译。

## 域名配置

目前写死指向 `https://la-historia.vercel.app` 和 `http://localhost:3000`（本地开发用）。如果正式域名变更，需要同步修改：

- `manifest.json` 里的 `host_permissions` 和 `content_scripts.matches`
- `background.js` 里的 `SITE_PATTERNS` / `SITE_URL`

## 原理

- `background.js`：注册右键菜单，拿到 `info.selectionText` 后写入 `chrome.storage.local`，再打开/激活 La Historia 标签页。
- `content-script.js`：只在 La Historia 域名下运行，读取/监听 `chrome.storage.local` 里的待导入文本，通过 `CustomEvent('la-historia:import')` 派发给页面。
- `app/page.tsx` 监听该事件，复用原有的 `?text=`（书签方案）导入逻辑。
