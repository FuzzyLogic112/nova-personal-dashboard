# NOVA 个人工作台

一个本地优先、无需登录、可直接部署到 GitHub Pages 的个人操作系统。

## 功能

- 不对称 Bento 工作台：今日概览、任务、专注计时、天气、快捷入口、便笺、日历与本周节奏；
- `Ctrl/Cmd + K` 命令面板，以及 `D / T / F / N` 键盘快捷操作；
- 深色 / 明亮外观与三套强调色；
- 任务、便笺、快捷入口和个人偏好全部保存在浏览器 `localStorage`；
- JSON 导出 / 导入，方便在设备间手动迁移；
- Open‑Meteo 无密钥天气，可由用户主动授权定位；
- 响应式布局、移动端 Dock、PWA 与离线壳缓存；
- 无账号、无埋点、无第三方统计。

## 护城河功能

- **Context Engine**：结合时间、任务、习惯、收藏使用规律和 AI 额度，推荐此刻最值得做的下一步；
- **Private Knowledge Vault**：把 Edge / Chrome 收藏夹存入 IndexedDB，在端侧分类、搜索、标记重复候选，并学习不同时间段的启动偏好；
- **AI Capacity Center**：接受隐私安全的 Codex 额度快照，并从 Claude Code 本地日志中只汇总 token 与调用量，不读取对话内容；
- **Consistency System**：习惯打卡、连续天数和最近 28 天热力图；
- **动态视觉层**：粒子网络、指针光晕、卡片景深，同时完整支持 `prefers-reduced-motion`。

## 导入本机私有数据包

在拥有 Edge 配置和 Claude Code 历史的设备上运行：

```powershell
node .\tools\build-private-pack.mjs --codex-used 20 --codex-window-minutes 10080 --codex-plan Plus
```

把示例中的 `20` 换成本次周期实际已用百分比；若已知重置时间，可再传入 `--codex-resets-at`（Unix 时间戳或 ISO 时间）。

打开 NOVA，点击“导入 Edge 收藏夹”，选择 `private-import/nova-private-pack.json`。整个 `private-import/` 目录已被 Git 忽略，必须留在本机。

私有包包含收藏夹标题/网址和 Claude token 汇总值，不包含提示词、Cookie、API Key、凭证或账号标识。

## 本地运行

这是一个无构建步骤的静态站点。不要直接双击 HTML，使用任意本地静态服务器：

```bash
npx serve .
```

然后打开命令行显示的本地网址。

## 设计调研来源

本项目只吸收公开产品的通用交互模式，代码和视觉均为独立实现，没有复制第三方素材：

- [itsP33t/bento](https://github.com/itsP33t/bento)：本地优先、模块化卡片、命令面板与键盘操作；
- [Homepage](https://github.com/gethomepage/homepage)、[Dashy](https://github.com/Lissy93/dashy)：集中式快捷入口与信息聚合；
- [Karakeep](https://github.com/karakeep-app/karakeep)：自动分类、全文/语义检索和本地优先的知识留存；
- [Linkwarden](https://github.com/linkwarden/linkwarden)、[linkding](https://github.com/sissbruecker/linkding)：收藏归档、集合化管理与低摩擦检索；
- [Vibecoding 时代，从看板升级为工作台](https://www.bilibili.com/video/BV1uDGE6NEEo/)：把完整工作流收进同一工作台的中文使用场景；
- [Open‑Meteo](https://open-meteo.com/)：无需 API Key 的开放天气数据。

视觉采用内容优先的 Bento 层级：重要组件获得更大面积，间距保持一致，玻璃效果只用于导航和浮层，数据密集卡片保持近乎不透明以保证可读性。

## 隐私

工作台不会上传任务、便笺、快捷入口、收藏知识库、AI 额度快照或个人设置。天气组件只在请求天气时把所选城市坐标发送给 Open‑Meteo；点击定位按钮前不会请求浏览器位置权限。

## License

[MIT](./LICENSE)
