# Sync Spend v0.7.9

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

汇率配置在：

```json
{
  "exchange": {
    "provider": "frankfurter",
    "endpoint": "https://api.frankfurter.dev/v2/rates",
    "base": "CNY",
    "quotes": [
      "MXN",
      "TRY"
    ],
    "cacheSeconds": 0
  }
}
```

说明：系统只通过 Frankfurter API 实时获取汇率，不再读取 `manualToCny`，也不把 API 汇率写入 `config.json` 或 `data.json`。新增/编辑记录时仍可以手动修改“本次汇率”。保存记录会保留该记录实际使用的汇率，避免历史金额被未来汇率改变。

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



## 10. V0.6.5 更新点

- 账本详情页“总消费”继续显示人民币总额，同时新增原币合计，例如 MXN/CNY/TRY 各自合计。
- “应收/应付”区域从横向滚动表格改为自适应明细行，已付、分摊、净额完整显示。
- 账本标题区域高度压缩，减少顶部占用，让下面的统计卡片和记账记录露出更多。
- 继续保留 `.nojekyll`，避免 GitHub Pages 走 Jekyll 构建失败。


## 11. V0.6.6 更新点

- 版本号从 `data/config.json` 移除，避免覆盖用户的 Cloudflare 地址、访问密码、消费者等配置。
- 新增 `src/js/version.js` 作为前端版本号来源。以后升级版本只更新代码文件，不要求覆盖 `data/config.json`。
- `data/config.json` 和 `data/data.json` 属于用户数据文件，后续发布默认不覆盖。

## 12. V0.6.7 更新点

- 已归档账本新增“删除账本”按钮。
- 删除已归档账本前会弹出确认提醒，确认后会清空该账本记录并从 `data.json` 中移除该账本。
- 首页展示顺序调整为：进行中账本 → 归档账本 → 汇率。
- 归档账本区域默认折叠，汇率区域继续默认折叠。


## 13. V0.6.8 更新点

- 新增/编辑弹窗顶部标题和关闭按钮固定。
- 新增/编辑弹窗底部取消和保存按钮固定。
- 弹窗中间表单内容独立滚动，移动端长表单操作更稳定。

## 14. V0.6.9 更新点

- PC 端隐藏浏览器右侧滚动条，但仍然可以正常上下滚动。
- 记账记录改成关键信息高亮布局，付款人、原币金额、折合人民币、汇率、分摊方式、参与人和分摊明细更明显。
- 结算建议改成更直观的“谁付给谁多少钱”卡片，移动端和 PC 端都更容易看清。

## 15. V0.7.0 更新点

- 新增记账记录会自动保存 `createdAt` 创建时间和 `updatedAt` 修改时间。
- 编辑记账记录会写入 `history` 修改历史，记录修改前后摘要，便于后续查看。
- 删除记账记录会写入删除历史并保留软删除标记，不直接物理移除。
- 账本详情新增“确认结算”功能：按当前未结算金额生成结算记录，例如“吴恒 向 刘彬 支付了 ¥104.25”。
- 结算记录会进入记账记录列表，但不会计入总消费；后续结算会自动扣除已结算金额，避免重复计算。
- 应收/应付区域新增“已结算付出 / 已结算收到”，净额显示的是扣除历史结算后的未结清金额。
- PC 和移动端记录列表重新设计，消费记录与结算记录采用不同视觉层级，关键信息更直观。

## 16. 用户数据文件升级注意

从 V0.7.0 开始，`data/data.json` 会出现以下新增字段：

```json
{
  "type": "expense",
  "createdAt": "2026-07-05T00:00:00.000Z",
  "updatedAt": "2026-07-05T00:00:00.000Z",
  "history": []
}
```

结算记录示例：

```json
{
  "type": "settlement",
  "fromConsumerId": "consumer_a",
  "toConsumerId": "consumer_b",
  "amountCny": 104.25,
  "currency": "CNY",
  "rateToCny": 1
}
```

不要覆盖线上 `data/data.json` 和 `data/config.json`。升级时只覆盖代码文件和 `worker.js`。


## 16. V0.7.3 更新点

- 仅优化移动端界面，PC 端保持原有布局。
- 移动端顶部栏更紧凑，适合 iOS Safari / 添加到主屏幕后使用。
- 移动端账本首页参考卡片式记账 App：账本标题、统计卡片、结算建议、记录列表显示更轻。
- 记账记录在移动端改成紧凑卡片，突出付款人、原币金额、折合人民币、日期、汇率和分摊信息。
- 移动端记录列表增加日期分组标题，查看流水更直观。
- 移动端新增记账按钮固定到底部，方便单手操作。

## 17. V0.7.3 更新点

- 仅优化移动端记账记录交互，PC 端布局不变。
- 移动端记录卡片隐藏重复信息：卡片内不再显示“日期”和“分摊参与人”，日期保留在分组标题中，分摊明细保留在金额标签中。
- 移动端记录卡片支持左滑显示操作按钮：消费记录左滑显示“编辑 / 删除”，结算记录左滑显示“删除”。


## 18. V0.7.4 更新点

- 仅移动端：账本详情页隐藏“应收/应付”卡片，减少上方信息占用。
- 仅移动端：新增记账按钮改为右下角悬浮图片按钮，保留单手操作体验。
- PC 端布局保持不变。


## 19. V0.7.5 更新点

- 移动端删除账本详情里的返回按钮。
- 移动端把“账本 / 配置 / 多语言切换”放到右侧三点悬浮菜单。
- 移动端新增按钮继续使用右侧悬浮图片按钮。
- “确认结算”文案改为“结算”。
- 账本详情页不再直接展示结算建议卡片；点击“结算”后弹出结算建议界面。
- 结算弹窗下方显示历史结算记录，后续结算只按未结清金额生成结算记录。


## 20. V0.7.9 更新点

- 移动端禁止双击页面缩放，页面固定比例显示。
- 移动端左滑记录时，右侧悬浮按钮自动隐藏，避免遮挡编辑/删除操作。
- 移动端新增/编辑弹窗改为全屏展示，只允许上下滚动，避免页面左右漂移。
- 兼容 iOS Safari 日期输入框宽度，日期框和其他文本框保持一致。
- 移动端“新增”和“三点更多”悬浮按钮统一大小。
- 重新设计结算弹窗样式，当前结算建议和历史结算记录更清晰。
- 取消保存、刷新、结算成功后的普通悬浮提示，只保留错误提示。
- 移除前端登录密码弹窗；前端自动读取 `data/config.json` 中的 `cloudflare.accessPassword` 请求 Worker。
- 启动时会清理旧版本遗留的 `syncSpend.password`，避免新设备乱输密码后本机持续 401。
