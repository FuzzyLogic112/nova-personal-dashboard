# NOVA 个人工作台

一个本地优先、无需登录、可直接部署到 GitHub Pages 的个人工作台。

## 功能

- 不对称 Bento 工作台：今日概览、任务、专注计时、天气、快捷入口、便笺、日历与本周节奏；
- `Ctrl/Cmd + K` 命令面板，以及 `D / T / F / N` 键盘快捷操作；
- 深色 / 明亮外观与三套强调色；
- 任务、便笺、快捷入口和个人偏好全部保存在浏览器 `localStorage`；
- JSON 导出 / 导入，方便在设备间手动迁移；
- Open‑Meteo 无密钥天气，可由用户主动授权定位；
- Codex / Claude 额度中心，可在浏览器端解析官方状态文本或 JSON 快照；
- 收藏知识库，可一次导入 NOVA 私有包、Edge/Chrome Bookmarks JSON 或书签 HTML，并在本机完成分类、搜索、分页和点击召回；
- 响应式布局、移动端 Dock、PWA 与离线壳缓存；
- 无账号、无埋点、无第三方统计。

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
- [Vibecoding 时代，从看板升级为工作台](https://www.bilibili.com/video/BV1uDGE6NEEo/)：把完整工作流收进同一工作台的中文使用场景；
- [Open‑Meteo](https://open-meteo.com/)：无需 API Key 的开放天气数据。

视觉采用内容优先的 Bento 层级：重要组件获得更大面积，间距保持一致，玻璃效果只用于导航和浮层，数据密集卡片保持近乎不透明以保证可读性。

## 隐私

工作台不会上传任务、便笺、快捷入口或个人设置。收藏网址写入当前浏览器的 IndexedDB；AI 额度快照使用独立的浏览器本地存储。两者都不写入仓库，也不包含在普通工作区导出中；页面不会索取 Cookie、账号凭证或 API Key。天气组件只在请求天气时把所选城市坐标发送给 Open‑Meteo；点击定位按钮前不会请求浏览器位置权限。

## License

[MIT](./LICENSE)
