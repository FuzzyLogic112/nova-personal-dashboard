<img src="assets/icon.svg" alt="NOVA 图标" width="64">

# NOVA 个人工作台

一个本地优先、无需登录、可直接部署到 GitHub Pages 的个人工作台。

[在线体验](https://fuzzylogic112.github.io/nova-personal-dashboard/) · [使用此模板创建自己的 NOVA](https://github.com/new?template_name=nova-personal-dashboard&template_owner=FuzzyLogic112) · [完整部署指南](./DEPLOY.md)

## 部署自己的专属网站

1. 点击“使用此模板创建自己的 NOVA”，在你的 GitHub 账号下创建新仓库；
2. 进入新仓库的 `Settings → Pages`，将 Source 选择为 `GitHub Actions`；
3. 在 `Actions` 页面手动运行一次 `Deploy NOVA to GitHub Pages`；
4. 访问 `https://你的用户名.github.io/你的仓库名/`。

之后每次更新 `main` 分支都会自动重新部署。NOVA 是纯静态站点，不需要数据库或常驻服务。收藏夹与 AI 额度等私密数据不会包含在模板中，只在每位使用者自己的浏览器内保存。

## 功能

- 不对称 Bento 工作台：今日概览、任务、专注计时、天气、快捷入口、便笺、日历与本周节奏；
- `Ctrl/Cmd + K` 命令面板，以及 `D / T / F / N` 键盘快捷操作；
- 深色 / 明亮外观与三套强调色；
- 任务、便笺、快捷入口和个人偏好全部保存在浏览器 `localStorage`；
- JSON 导出 / 导入，方便在设备间手动迁移；
- Open‑Meteo 无密钥天气，可由用户主动授权定位；
- Codex / Claude 额度中心，可在浏览器端解析官方状态文本或 JSON 快照；
- 收藏知识库，可一次导入 NOVA 私有包、Edge/Chrome Bookmarks JSON 或书签 HTML，并在本机完成分类、搜索、分页和点击召回；
- [NOVA 收藏夹同步扩展](https://fuzzylogic112.github.io/nova-personal-dashboard/sync-setup.html)：同一电脑、同一 Edge / Chrome 配置文件内自动同步收藏夹的新增、改名、移动与删除，支持暂停、手动重试和首次同步前备份恢复；
- 响应式布局、移动端 Dock、PWA 与离线壳缓存；
- 无账号、无埋点、无第三方统计。

## 本地运行

### 自动同步收藏夹

打开[扩展安装页](https://fuzzylogic112.github.io/nova-personal-dashboard/sync-setup.html)，下载并解压安装包，在浏览器扩展管理页加载 `nova-bookmark-sync` 目录。刷新工作台后，「收藏知识库」会显示连接状态与同步时间。安装包固定接入本仓库的 GitHub Pages 地址；其他部署需自行调整 `extension/manifest.json` 和 `extension/shared.js` 的目标地址。

数据单向复制到当前浏览器的 IndexedDB，不上传 GitHub，不修改浏览器收藏。首次同步会保存原有工作台收藏的本地备份；同步期间请先暂停再手动导入。仅同步 HTTP/HTTPS 网页，内部页面和脚本书签会跳过。扩展及权限说明见 [extension/README.md](./extension/README.md)。

### 开发与测试

`npm ci && npm test` 运行隔离测试；`python3 scripts/package-site.py` 生成 `dist/` 站点与扩展 ZIP。GitHub Pages 发布前会自动运行测试与打包。

### 运行网页

这是一个无构建步骤的静态站点。不要直接双击 HTML，使用任意本地静态服务器：

```bash
npx serve .
```

然后打开命令行显示的本地网址。

## 设计调研来源

本项目只吸收公开产品的通用交互模式，代码和视觉均为独立实现，没有复制第三方素材：

- [itsP33t/bento](https://github.com/itsP33t/bento)：本地优先、模块化卡片、命令面板与键盘操作；
- [Homepage](https://github.com/gethomepage/homepage)、[Dashy](https://github.com/Lissy93/dashy)：集中式快捷入口与信息聚合；
- [Vibecoding 时代，从看板升级为工作台](https://www.bilibili.com/video/BV1uDGE6NEEo/)：把完整工作流收进同一工作台的中文使用场景；
- [Open‑Meteo](https://open-meteo.com/)：无需 API Key 的开放天气数据。

视觉采用内容优先的 Bento 层级：重要组件获得更大面积，间距保持一致，玻璃效果只用于导航和浮层，数据密集卡片保持近乎不透明以保证可读性。

## 隐私

工作台不会上传任务、便笺、快捷入口或个人设置。收藏网址写入当前浏览器的 IndexedDB；AI 额度快照使用独立的浏览器本地存储。两者都不写入仓库，也不包含在普通工作区导出中；页面不会索取 Cookie、账号凭证或 API Key。天气组件只在请求天气时把所选城市坐标发送给 Open‑Meteo；点击定位按钮前不会请求浏览器位置权限。

## License

[MIT](./LICENSE)
