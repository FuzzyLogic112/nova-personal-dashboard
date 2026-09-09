# 部署自己的 NOVA

NOVA 是纯静态网站，不需要服务器、数据库或本机常驻服务。任务、便笺、收藏夹和 AI 额度快照默认只保存在访问者自己的浏览器中。

## 方式一：使用模板并通过 GitHub Actions 部署

1. 打开 [NOVA 模板创建页](https://github.com/new?template_name=nova-personal-dashboard&template_owner=FuzzyLogic112)。
2. 选择自己的 GitHub 账号，填写仓库名称并创建仓库。
3. 打开新仓库的 `Settings → Pages`。
4. 在 `Build and deployment → Source` 中选择 `GitHub Actions`。
5. 打开 `Actions`，选择 `Deploy NOVA to GitHub Pages`，点击 `Run workflow`。之后每次推送到 `main` 都会自动部署。
6. 部署完成后，访问：

   ```text
   https://你的用户名.github.io/你的仓库名/
   ```

如果仓库名称就是 `你的用户名.github.io`，网址为 `https://你的用户名.github.io/`。

## 方式二：从分支直接发布

不想使用 Actions 时，可进入 `Settings → Pages`，将 Source 设为 `Deploy from a branch`，选择 `main` 和 `/(root)` 后保存。

## 公开仓库与私有仓库

- GitHub Free 可从公开仓库使用 Pages。
- 私有仓库是否可使用 Pages 取决于账号或组织套餐。
- GitHub Pages 网站通常公开可访问；仓库设为私有不等于网站需要登录。

不要把收藏夹导出、AI 账号凭证、Cookie、API Key 或其他私密文件提交到仓库。NOVA 的私有数据包应只通过网页中的“导入私有数据包”按钮写入当前浏览器。

## 自定义

- 页面标题与默认昵称：编辑 `index.html` 和 `app.js`。
- 颜色和布局：编辑 `styles.css`。
- 图标：替换 `assets/icon.svg`。
- 自定义域名：在 `Settings → Pages → Custom domain` 中配置。

修改并推送到 `main` 后，Actions 会重新发布网站。
