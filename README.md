# Sync Spend v0.6.2

PWA 多人记账本，前端部署在 GitHub，后端只需要在 Cloudflare 发布一个 `worker.js`。

## 部署结构

```text
GitHub 仓库 evanlliu/sync-spend
├─ index.html                  前端入口
├─ manifest.webmanifest        PWA 配置
├─ service-worker.js           PWA 离线缓存
├─ assets/                     图标资源
├─ src/css/                    样式，含 liquid-glass
├─ src/js/                     前端逻辑
├─ data/config.json            前端配置、消费者、货币配置
├─ data/data.json              记账数据
├─ .github/workflows/pages.yml GitHub Pages 部署流程
├─ .nojekyll                   禁用 Jekyll，按静态文件发布
└─ worker.js                   Cloudflare Worker 后端，复制这一个文件到 Cloudflare
```

Cloudflare 只发布：

```text
worker.js
```

其他文件全部提交到 GitHub 仓库即可。

---

## 1. GitHub 仓库

仓库名称：

```text
sync-spend
```

仓库 owner：

```text
evanlliu
```

把项目全部文件提交到 `main` 分支。

如果你用 GitHub Pages 打开前端，建议设置：

```text
Settings → Pages → Build and deployment → Source → GitHub Actions
```

本项目已经内置：

```text
.github/workflows/pages.yml
.nojekyll
```

这样可以避开默认 `pages-build-deployment` 的部署失败问题，直接用官方 Pages Actions 部署静态文件。

---

## 2. Cloudflare Worker

只需要把根目录的这个文件发布到 Cloudflare Worker：

```text
worker.js
```

可以直接在 Cloudflare Worker 在线编辑器里粘贴 `worker.js` 全部内容。

也可以用命令部署：

```bash
npm install
npm run deploy:worker
```

---

## 3. Cloudflare 变量

在 Worker 的 `Settings → Variables and secrets` 中配置：

```text
APP_PASSWORD    Secret      1123
GH_TOKEN        Secret      GitHub fine-grained token，Contents: Read and write
GH_BRANCH       Plaintext   main
GH_OWNER        Plaintext   evanlliu
GH_REPO         Plaintext   sync-spend
GH_DATA         Plaintext   data/data.json
GH_CONFIG       Plaintext   data/config.json
```

说明：

- `APP_PASSWORD` 是前端访问 Worker 的密码。
- `GH_TOKEN` 只能放 Cloudflare Secret，不要写到 GitHub 文件里。
- `GH_DATA` 指向记账数据文件。
- `GH_CONFIG` 指向配置文件。

---

## 4. config.json

路径：

```text
data/config.json
```

当前只需要配置 Worker 地址和访问密码：

```json
{
  "cloudflare": {
    "projectName": "sync-spend",
    "workerUrl": "https://sync-spend-worker.287418456.workers.dev",
    "accessPassword": "1123"
  }
}
```

汇率备用配置在：

```json
{
  "exchange": {
    "manualToCny": {
      "CNY": 1,
      "MXN": 0.39,
      "TRY": 0.17
    }
  }
}
```

含义：`1 个对应货币 = 多少人民币`。系统新增记录时会实时请求 API 汇率，也可以在记录编辑界面手动修改本次汇率；API 失败时才使用 `manualToCny`。

注意：`config.json` 是前端可见文件，所以这里只能放普通访问密码和 Worker 地址，不能放 `GH_TOKEN`。

---

## 5. 功能

- 多账本新增、编辑、归档、取消归档
- 消费者配置新增、修改、删除、启用/停用
- 记账记录新增、编辑、删除
- 图片上传压缩保存，支持删除图片
- 主列表和编辑界面支持点击图片放大
- 分摊方式：均摊、按金额
- 按金额分摊默认按参与人均摊，可手动改各参与人金额，合计不能大于本次消费折合人民币金额
- 支持 CNY、MXN、TRY
- 汇率显示和保存统一保留 4 位小数
- 主货币 CNY 结算
- 新增记录时实时获取 API 汇率，输入金额/切换货币都会刷新最新汇率，并允许手动修改本次汇率
- 标题中英文切换，并显示版本号
- 手动刷新数据，立即从 GitHub 拉取最新 data.json/config.json
- 主页面汇率块默认折叠，可按需展开
- 中英文切换
- PC + 移动端自适应
- iOS Safari 添加到主屏幕后作为 PWA 使用

---

## 6. API 地址测试

Worker 部署完成后，可以访问：

```text
https://sync-spend-worker.287418456.workers.dev/api/health
```

如果看到类似下面内容，说明 Worker 能运行：

```json
{
  "ok": true,
  "app": "sync-spend",
  "mode": "single-file-worker"
}
```

---

## 7. V0.6 更新点

- 汇率统一显示为小数点后 4 位，例如 `1 MXN = 0.3898 CNY`。
- 新增/编辑记录保存时，`rateToCny` 也统一按 4 位小数固化到 `data.json`。
- 新增记录保存成功后，会记住本次选择的货币；下次新增记录默认选择上一次新增使用的货币。
- 新增记录页面输入金额后，会自动触发实时汇率刷新，避免页面停留太久导致汇率不新。
- 新增记录页面切换货币后，会立即重新获取该货币最新汇率。
- 汇率输入框仍然可以手动修改，避免 API 汇率异常时影响本次记录。

## 8. V0.5 更新点

- App 标题支持多语言：中文显示“同步记账”，英文显示“Sync Spend”。
- 标题后显示版本号，例如 `v0.5.0`，方便部署后确认当前发布版本。
- 去除退出按钮，并删除对应退出逻辑。
- 主页面汇率块默认折叠，需要查看时手动展开。
- 页面每次加载都会通过 Worker 实时读取 GitHub 最新 `data.json` / `config.json`。
- 新增“刷新数据”按钮，可手动立即拉取 GitHub 最新数据。
- 前端 API 请求已增加 `cache: no-store` 和时间戳，Worker 读取 GitHub 时也显式禁用 Cloudflare 缓存。

## 9. V0.4 更新点

- 图片支持删除。
- 主列表和编辑界面图片支持点击放大。
- 新增记账记录支持分摊方式：均摊 / 按金额。
- 按金额分摊支持按参与人录入人民币分摊金额，并校验不能超过本次总额。
- 新增记录时会实时请求汇率接口，不走 Cloudflare 缓存。
- 汇率输入框支持手动修改，避免 API 汇率异常时影响记录。


---

## GitHub Pages 部署报错处理

如果 Actions 里看到默认的 `pages-build-deployment`，并且 `deploy` 步骤报：

```text
Deployment failed, try again later.
```

按下面处理：

1. 确认仓库已经提交 `.github/workflows/pages.yml` 和 `.nojekyll`。
2. 进入 GitHub 仓库：`Settings → Pages`。
3. 将 `Build and deployment → Source` 改成 `GitHub Actions`。
4. 进入 `Actions → Deploy GitHub Pages`，点 `Run workflow`，或者重新提交一次代码。
5. 如果旧的 `pages-build-deployment` 还在失败，不用管；以后看新的 `Deploy GitHub Pages` 工作流即可。

注意：Actions 里的 `Node.js 20 is deprecated` 是 GitHub Actions 运行环境警告，不是这次部署失败的原因。
## 8. V0.6.2 更新点

- 页面刷新后，会自动打开上一次打开过的账本。
- 上一次账本 ID 保存在浏览器本地 `localStorage`，不写入 GitHub 的 `data.json`。
- 如果该账本已不存在，自动回到首页。

