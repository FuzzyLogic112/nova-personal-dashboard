# NOVA 收藏夹同步

Manifest V3 扩展，面向 Edge / Chrome 桌面版同一浏览器配置文件。固定目标：
`https://fuzzylogic112.github.io/nova-personal-dashboard/`。

## 安装

从工作台的「安装同步扩展」页面下载 ZIP 并解压。在 `edge://extensions` 或 `chrome://extensions` 开启开发人员模式，加载包含 `manifest.json` 的目录。不要删除或移动这个目录。更新时替换文件，在扩展管理页重新加载，再刷新工作台。

## 行为与权限

- `bookmarks`：代码仅调用 `getTree` 并监听变化，不调用任何书签修改 API。浏览器权限提示可能包含「读取和更改书签」，这是浏览器的权限粒度。
- `storage`：只存启用开关、随机来源 ID、读取时间和数量，不存收藏 URL。
- NOVA 站点权限：浏览器对主机授权；内容脚本进一步限制为上面的工作台根页面或 `index.html`，不运行在其他项目、安装说明页或子框架中。
- 不请求 history、cookies、tabs、downloads、nativeMessaging 或 `<all_urls>` 权限；不发送网络请求。
- 默认启用。书签变化事件读取完整快照，页面不存在时不留后台任务；下次打开页面重新读取即可。打开的页面另有一分钟校验和切回页面时的校验，用于补偿休眠或消息遗漏。
- HTTP/HTTPS 地址逐字保留，包括参数与锚点；文件夹路径用于本地搜索和分类。内部页、file/data/javascript 等链接跳过并计数。
- 第一次接收在同一个 IndexedDB 事务内备份原列表并写入新列表；后续更新不会覆盖首次备份。恢复备份会暂停接收。同步期间要手动导入，请先暂停。
- 同步是浏览器到工作台的单向镜像；页面关闭时无须缓存书签，因为浏览器本身是数据源。支持书签全删后的空快照。用户可从浏览器或首次备份恢复数据。
- 此版本为本机使用，不实现跨设备同步；不支持隐私模式。

## 开发验证

在仓库根目录执行 `npm ci && npm test`，再执行 `python3 scripts/package-site.py`，安装包在 `dist/downloads/nova-bookmark-sync.zip`。
自动化测试使用合成书签和隔离的模拟浏览器存储，不访问个人收藏。

源码中没有注入远程代码、动态执行代码、凭据或上传地址。MIT 许可。
