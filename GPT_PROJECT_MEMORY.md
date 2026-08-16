# Sync Spend — GPT 项目长期记忆

> 用途：这是给“下一次全新 GPT 对话”读取的完整项目交接文档。任何后续代码修改完成后，都必须同步更新本文件并重新生成完整项目包，使新对话无需依赖旧聊天记录即可继续开发。
>
> **事实优先级：最新附件源码 > 本文件 > README。** 如果本文件和源码不一致，以源码为准，并在本次修改中同步修正本文件。

## 0. 当前基线

- 项目：Sync Spend
- 当前版本：`0.9.7`
- 本次架构更新时间：2026-08-16
- 原始附件基线 SHA-256：`ab80654846c9c66f1f42b70a82981fa939fb44f1069dbb7958800bbee00be08c`
- 技术栈：Vanilla JavaScript ES Modules + CSS + PWA
- 前端框架：无
- 构建步骤：无
- 静态部署：GitHub Pages，用户当前 Pages 发布分支为 `release1`
- 后端：**无后端服务；Cloudflare Worker 已于 v0.9.0 完全删除**
- 远端读写：浏览器直接调用 GitHub REST Contents API
- 业务数据分支：`data`
- 主数据：data 分支 `data/data.json`
- 业务配置：data 分支 `data/config.json`
- 前端连接配置：当前 Pages 发布分支 `release1/data/config.json`（代码使用相对路径，因此换发布分支无需改业务代码）
- 主货币：CNY
- 汇率：浏览器直接请求 Frankfurter API
- 自动化测试：Node 内置 `node:test`；`npm run check` = Service Worker + 全部前端 JS 语法检查 + `tests/*.test.mjs` 核心回归（当前 33 项）

### v0.9.7 当前开发重点

在 v0.9.6 “图片本体外置到 GitHub media、data.json 只保存附件元数据”的基线上，v0.9.7 的核心要求是：**主页面提供明确的手动刷新入口，并为所有远端操作提供真实、可见、阻塞重复点击的处理中反馈。**

- PC 账本主页面 `hero-actions` 新增“刷新数据”，顺序固定为：刷新数据 → 结算 → 新增记账记录 → 编辑 → 归档/删除。
- 移动端账本悬浮区固定从上到下：新增 FAB → 刷新 FAB → 更多 FAB；刷新必须直接位于“更多”正上方。刷新 FAB 只在账本主页面出现，避免其他页面重复入口。
- `showOperation()/hideOperation()` 提供全局阻塞式操作层，含 spinner 和文案；显示期间 `#app` 与 `#modal-root` 设为 inert，避免重复点击/双提交。
- `commitDataMutation()` / `commitConfigMutation()` 支持 `busyText` 和 `deferBusyUntilMutation`。普通新增/编辑/归档显示“保存中...”；删除显示“删除中...”并在 confirm 确认后才出现；生成结算显示“结算中...”并在 confirm 确认后才出现。
- `refreshData()`、`refreshRates()`、记账弹窗显式“获取实时汇率”显示“刷新中...”/“汇率刷新中...”；操作状态生命周期与真实 Promise 绑定，失败后解除锁定并保留错误 toast。
- `state.saving || state.refreshing` 统一拦截并发远端操作；`operationInProgress` 文案不再只描述“保存”。
- 删除/结算 confirm 取消时不得出现处理中闪烁；因此这些动作使用 `deferBusyUntilMutation: true`，mutator 返回非 false 后才展示 busy。
- PWA App Shell cache bump 到 `sync-spend-shell-v097`，确保发布后旧 app.js/css 不继续运行。
- 新增 `tests/ui-actions.test.mjs` 3 项静态 UI 回归；当前 `npm run check` 共 33 项测试。

v0.9.6 图片存储基线继续完整保留：

- 业务真相源仍是 GitHub data 分支；启动严格 remote-first，不恢复任何 localStorage 账务缓存。
- 新图片在浏览器内存中通过 `compressImageFile()` 缩放压缩：最长边默认 1600，质量读取业务 config `app.imageQuality`，目标大小默认 972800 bytes，硬上限 1MB；优先 WebP，浏览器不支持时回退 JPEG。
- 图片文件路径：`media/<ledgerId>/<recordId>/<imageId>.webp|jpg`；路径组件会清洗，imageId 使用 `uid("img")`，文件上传后视为 immutable，不覆盖旧图片。
- `data.json` 的 expense 使用 `attachments[]` 保存 `id/path/mime/size/width/height/sha/createdAt`；不再保存 `record.photo` Base64。保存前 API 会删除 `photo` 字段并严格校验附件必须位于 `media/`、≤1MB、尺寸/mime 合法、path 不重复。
- 新增/编辑带图片采用媒体事务：先上传新图片，再 PUT `data.json`；如果 JSON 保存失败或 SHA 409，则自动尝试 DELETE 刚上传的图片回滚。
- 替换/删除图片时不先删旧图：新 JSON 成功后才清理旧 media。清理失败只留下孤儿文件，不能把已经成功保存的账务数据回滚。
- expense/settlement 软删除继续保留图片；永久删除已归档 ledger 时先成功从 `data.json` 移除账本，再逐个清理该账本引用的 media。
- 列表展示读取 `attachments[0]`，通过 `raw.githubusercontent.com` URL + `loading=lazy` 按需加载；因此启动下载 `data.json` 时不再携带全部历史图片。
- `data/data.json` schemaVersion 从 1 升为 2；旧 schema 1 仍能读取，下一次真实业务保存自动写为 schema 2。
- GitHub JSON GET 仍保留 raw fallback（不是为了图片，而是防止长期 history/软删除导致 JSON 增大）。
- 删除安全、事务式 state commit、ID 迁移、Frankfurter 严格参数修复、DES Token 解密规则全部继续保留。
- v0.9.6 当时 `npm run check` 共 30 项测试，其中 API/media 12 项；v0.9.7 当前总数为 33。

### v0.9.0 的关键架构变更

原架构：

```text
GitHub Pages -> Cloudflare Worker -> GitHub Contents API
                              -> Frankfurter
```

当前架构：

```text
GitHub Pages 浏览器 -> GitHub Contents API
                   -> Frankfurter API
```

已删除：

- 根目录 `worker.js`
- Cloudflare Worker 部署逻辑
- Wrangler 依赖和 `deploy:worker`
- `APP_PASSWORD` 服务端校验
- `/api/bootstrap`
- `/api/rates`
- `/api/save-data`
- `/api/save-config`
- `/api/health`
- `x-app-password`

### 当前版本相关文件

版本发布时必须统一检查：

- `package.json` -> `0.9.7`
- `src/js/version.js` -> `APP_VERSION = "0.9.7"`
- `index.html` -> title / Apple Web App title
- `404.html` -> title / Apple Web App title
- `manifest.webmanifest` -> name / short_name
- `service-worker.js` -> `CACHE_NAME = "sync-spend-shell-v097"`
- `README.md`
- 本文件 `GPT_PROJECT_MEMORY.md`

## 1. 当前目录和职责

```text
sync-spend-release/
├─ index.html                  GitHub Pages / PWA 入口
├─ 404.html                    GitHub Pages fallback
├─ manifest.webmanifest        PWA manifest
├─ service-worker.js           App Shell network-first 静态缓存；业务数据不缓存
├─ package.json                版本 + JS syntax check
├─ README.md                   当前部署与架构说明
├─ GPT_PROJECT_MEMORY.md       新 GPT 对话完整交接文档
├─ tests/
│  ├─ calculator.test.mjs      核心账务回归测试
│  ├─ api.test.mjs             GitHub 保存前校验与写入回归测试
│  ├─ crypto.test.mjs          .NET 兼容 DES Token 解密回归测试
│  ├─ migration.test.mjs       旧数据 ID 迁移回归测试
│  ├─ cache-policy.test.mjs    GitHub 强制最新 / 无业务缓存回归测试
│  └─ ui-actions.test.mjs      刷新按钮位置 + 全局操作状态回归测试
├─ robots.txt
├─ .nojekyll
├─ assets/icons/               PWA 图标
├─ data/
│  ├─ config.json              Pages 发布分支（当前 release1）：GitHub API 连接参数
│  └─ data.json                发布包占位文件，线上运行不直接使用它作为主数据
└─ src/
   ├─ css/
   │  ├─ liquid.css            玻璃/液态基础视觉
   │  └─ app.css               主界面、PC/移动端样式
   └─ js/
      ├─ app.js                应用入口、UI、CRUD、保存流程
      ├─ api.js                直连 GitHub REST API + Frankfurter
      ├─ calculator.js         分摊、余额、结算算法
      ├─ crypto.js             DES-CBC/PKCS7 UTF-16LE Token 解密
      ├─ currency.js           汇率和金额精度
      ├─ i18n.js               中英文文案
      ├─ migration.js          历史重复/缺失 ID 完整性迁移
      ├─ store.js              全局 state；只清理旧业务缓存，不持久化账务数据
      ├─ utils.js              DOM/日期/图片/归一化工具
      └─ version.js            APP_VERSION
```

## 2. 两个 `data/config.json` 必须区分

项目现在有一个很重要的概念：**路径相同，但分支不同，职责完全不同。**

### 2.1 GitHub Pages 发布分支 `data/config.json`（当前 `release1`）

这是公开静态前端在启动时读取的“连接配置”。v0.9.4 起禁止保存 PAT 明文，结构为：

```json
{
  "github": {
    "owner": "evanlliu",
    "repo": "sync-spend",
    "branch": "data",
    "dataPath": "data/data.json",
    "configPath": "data/config.json",
    "token": {
      "encrypted": "<DES Base64 密文>",
      "algorithm": "DES-CBC-PKCS7",
      "encoding": "UTF-16LE",
      "key": "ELIU",
      "iv": "ELIU"
    }
  }
}
```

当前用户指定规则：.NET 兼容 DES CBC + PKCS7；**明文、Key 和 IV 都按 UTF-16LE**；密文为 Base64；Key/IV 当前均为 `ELIU`。`crypto.js` 解密后再由 `api.js` 使用。

Cloudflare Variables 映射中的 owner/repo/branch/path 保持不变；APP_PASSWORD 已删除。旧明文 token 字符串格式必须拒绝，不能重新引入。

注意：DES Key 和解密代码同样在公开前端中，因此这是避免 PAT 明文直接出现在 Git 文件/Secret Scanning 模式中的客户端混淆，不是真正的服务端 Secret。

### 2.2 data 分支 `data/config.json`

这是“业务配置”，由 App 通过 GitHub API 读取/保存。线上当前历史配置包含：

- `schemaVersion`
- `app`
- `consumers`
- `currencies`
- `exchange`
- 旧版可能还有 `cloudflare`

v0.9.0 中：

- `normalizeConfig()` 会删除业务配置里的遗留 `cloudflare` 和 `github` 字段
- `ApiClient.saveConfig()` 保存前也会删除这两个字段
- 因此下一次业务配置保存后，data 分支不会继续保留旧 Cloudflare 配置

不要把 Pages 发布分支的 GitHub token 自动合并进 data 分支业务配置。

## 3. 启动请求链路

`src/js/app.js -> init()` 当前严格 remote-first：

1. 绑定 online/offline 事件、移动端手势并注册 Service Worker。
2. `clearLegacyDataCache()` 删除旧 `syncSpend.cache`；**不会读取它。**
3. 渲染 Shell + “从 GitHub 拉取最新数据”加载态，不渲染任何旧业务数据。
4. `loadClientConfig()` 每次实时请求当前 Pages 发布分支静态 `data/config.json`，`cache: no-store`。
5. 同时清理旧 `syncSpend.githubConfig.v1/v2`；网络读取失败直接报错，不做 localStorage fallback。
6. `api.applyClientConfig()` 校验 DES 算法/编码并调用 `decryptDotNetDesBase64()`；真实 Token 只进入 `ApiClient` 当前页面内存。
7. `loadRemote()` -> `api.bootstrap()`。
8. `ApiClient.bootstrap()` 并行从 GitHub Contents API 读取 data 分支：
   - `data/data.json`
   - `data/config.json`
9. 每个 GitHub GET 都使用 `cache: no-store`，URL 仅带 GitHub 官方 `ref=<branch>` 参数。
10. 根据本次远端业务配置直接请求 Frankfurter 汇率。
11. `setBootstrap()` 对远端 data 先执行 `migrateDataIntegrity()`，再写入当前内存 state 与 SHA；**不写 localStorage。**
12. 远端完整成功后才进入 dashboard/ledger。失败则保持错误页，不展示旧账。

### 为什么 v0.9.5 彻底移除业务缓存

用户明确要求每次加载必须看到 GitHub 最新账本。v0.9.1-v0.9.4 的 cache-first/离线回退会导致“GitHub 已更新或删除，但浏览器仍显示旧账”的认知冲突，因此当前规则是：

- GitHub data 分支是唯一账务真相源。
- Pages 连接配置也必须实时读取，不允许旧 token/branch 配置 localStorage 兜底。
- 网络失败宁可明确报错，也不展示可能过期的账本。
- UI 偏好 localStorage 可以保留，因为它们不包含金额、记录、消费者业务配置、SHA 或汇率。

## 4. GitHub REST API 实现

核心都在 `src/js/api.js`。

### 4.1 请求头

```text
Accept: application/vnd.github+json
Authorization: Bearer <运行时解密后的 GitHub Token>
```

为了减少浏览器 CORS 预检中的非必要自定义头，v0.9.0 不手动发送 `User-Agent`、`Cache-Control` 或 `X-GitHub-Api-Version`。GitHub 对未指定版本头的 REST 请求默认使用 `2022-11-28`；缓存控制由 `fetch(..., { cache: "no-store" })` 完成。

### 4.2 文件读取

Contents API URL：

```text
https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}
```

正常小文件：

- GitHub 返回 `content` + `encoding: base64`
- `base64ToUtf8()` 解码并 `JSON.parse()`
- 元数据里的 `sha` 保留下来用于后续 PUT

大文件：

- Contents API 对较大文件可能不给 base64 `content`
- `readJsonFile()` 会调用 `readRawGithubFile()`
- 使用 `Accept: application/vnd.github.raw+json`
- SHA 仍来自第一次元数据请求

这个兼容逻辑继续保留。v0.9.6 图片已外置，不再是 JSON 膨胀主因；但长期软删除记录和 history 仍可能让 `data.json` 变大，因此 raw fallback 不能删。

### 4.3 文件写入

使用 GitHub Contents API `PUT`：

```js
{
  message,
  content: "<UTF-8 JSON 的 Base64>",
  sha: currentSha,
  branch: "data"
}
```

- 保留乐观并发控制
- 409 -> `GITHUB_CONFLICT`
- 其他非 2xx -> `GITHUB_WRITE_FAILED`
- 如果调用时没有 SHA，会先读一次当前文件补 SHA

不要删除 SHA 校验，否则多人同时操作容易静默覆盖。

### 4.4 保存前校验

`saveData()`：

- data 必须是 object，`data.ledgers` 必须是 array
- ledger id 必须非空且全局唯一
- 每个 ledger 必须有 `participantIds[]` / `records[]`
- 同一 ledger 内 record id 必须非空且唯一
- 写入 clone，不直接让 API 层修改 state 引用
- 删除旧 `record.photo`，统一把附件写成 `attachments[]` 元数据
- attachment path 必须位于 `media/`；mime 仅允许 WebP/JPEG/PNG；size 必须 `0 < size <= 1MB`；width/height 必须为正；全局 media path 不得重复
- 写入 `schemaVersion: 2`
- 写入新的 `updatedAt`

`saveConfig()`：

- config 必须是 object
- `consumers` / `currencies` 必须是 array
- consumer id 必须非空且唯一
- currency code 必须非空且唯一
- 删除 `cloudflare` / `github`
- 确保 `schemaVersion`

### 4.5 图片文件 API（v0.9.6）

`ApiClient.uploadMediaFile(path, blob)`：

- 只允许 `media/` 路径；拒绝 `..`、反斜杠、换行等危险路径。
- Blob 必须非空且 ≤1MB。
- 浏览器将二进制转 Base64 后使用 GitHub Contents API PUT；新文件不传 SHA，因为 path 必须唯一。
- 返回 Git blob `sha` 并写入 attachment metadata。

`ApiClient.deleteMediaFile(path, sha)`：

- 有 attachment sha 时直接 DELETE；没有 sha 才 GET metadata。
- 404 按已不存在处理，不把清理任务误判为业务保存失败。
- 编辑旧图和硬删账本都在 JSON 成功后才调用。

`ApiClient.mediaUrl(path)` 返回当前 public repo/data branch 的 `raw.githubusercontent.com` URL，用于 `<img loading="lazy">`。当前用户仓库是公开仓库；如果以后改为私有仓库，需要重新设计带认证的图片读取方式，不能继续假设 raw URL 可匿名访问。

## 5. 数据模型

### 5.1 data 分支 `data/data.json`

顶层：

```js
{
  schemaVersion: 2,
  updatedAt: string | null,
  ledgers: Ledger[]
}
```

### Ledger

```js
{
  id: string,
  name: string,
  archived: boolean,
  participantIds: string[],
  records: Record[],
  createdAt: string,
  updatedAt?: string
}
```

- 新建账本默认加入所有 active consumer
- 归档：`archived = true`
- 删除账本：只允许已归档，且会从 `data.ledgers` 物理移除

### 5.2 Expense Record

```js
{
  id: string,
  type: "expense",
  date: "YYYY-MM-DD",
  consumerId: string,
  amount: number,
  currency: string,
  amountCny: number,
  rateToCny: number,
  rateSource: string,
  splitMode: "equal" | "amount",
  splitParticipantIds: string[],
  splitAmountsCny: { [consumerId]: number },
  note: string,
  attachments: Attachment[],
  createdAt: string,
  updatedAt: string,
  history: HistoryItem[],
  deleted?: boolean,
  deletedAt?: string
}
```

### Attachment

```js
{
  id: string,
  path: "media/<ledger>/<record>/<imageId>.webp|jpg",
  mime: "image/webp" | "image/jpeg" | "image/png",
  size: number,
  width: number,
  height: number,
  sha?: string,
  createdAt?: string
}
```

当前 UI 每条 expense 只选择/展示一张图片，但数据结构使用 `attachments[]`，便于以后扩展；不要重新引入 `photo: data:image/...`。

### 5.3 HistoryItem

```js
{
  action: "created" | "updated" | "deleted" | string,
  at: string,
  summary: string
}
```

### 5.4 Settlement Record

```js
{
  id: string,
  type: "settlement",
  date: "YYYY-MM-DD",
  fromConsumerId: string,
  toConsumerId: string,
  amount: number,
  currency: "CNY",
  amountCny: number,
  rateToCny: 1,
  rateSource: "settlement",
  settlementBatchId: string,
  note: string,
  createdAt: string,
  updatedAt: string,
  history: HistoryItem[],
  deleted?: boolean,
  deletedAt?: string
}
```

结算记录：

- 会出现在 records 列表
- 不计入“总消费”
- 会影响未结清余额
- 删除结算记录采用软删除，相当于撤销该次结算效果

## 6. 分摊与结算核心算法

核心：`src/js/calculator.js`。

### 金额精度

- 人民币金额：2 位小数
- 汇率：4 位小数
- `roundMoney()` 处理金额
- `normalizeRate()` / `formatRate()` 处理汇率

### 等额分摊

不能简单让每个人都取同一个四舍五入值，否则会出现总和不等于总额。

当前逻辑按“分”为整数分配余数。例如：

```text
100 / 3 -> 33.34 + 33.33 + 33.33 = 100.00
```

此性质必须保护。

### 指定金额分摊

`splitMode: "amount"` 使用 `splitAmountsCny`。

- 手填金额按人民币存储
- `splitParticipantIds` 是记录创建/编辑当时的历史快照
- `sanitizeSplitParticipants()` 对显式快照只去重/清空值，**不能再按 ledger 当前参与人过滤**
- legacy amount 记录如果没有显式快照但存在 `splitAmountsCny`，优先使用其 keys 作为历史分摊参与人；只有两者都没有才 fallback 到当前 ledger participants
- v0.9.1 起新增/编辑记录时，分摊金额合计必须与该条 `amountCny` 相等（允许 0.01 精度容差）
- `unallocatedCny` 仍保留用于诊断旧数据，但新数据不应产生非 0 未分配金额

### 参与人历史保护

- `ledger.participantIds` 表示当前账本可配置参与人，不再被视为全部历史参与人的唯一来源。
- `ledgerSummary()` 会合并当前 `participantIds`、expense 付款人、expense 分摊快照、settlement from/to。
- 因此历史参与人即使从当前账本移除或 consumer 被停用，余额仍继续计算。
- 编辑 ledger 参与人前，`materializeLegacySplitSnapshots()` 会给没有 `splitParticipantIds` 的旧 expense 固化旧参与人；amount 模式优先取已有 `splitAmountsCny` 的 key。

### 余额公式

对每个未删除 expense：

- 付款人：`+ amountCny`
- 各参与人：`- shareCny`

对每个未删除 settlement：

- `fromConsumerId`：`+ amountCny`
- `toConsumerId`：`- amountCny`

因此余额本质上是：

```text
实际支付 - 实际承担 + 已结算付出 - 已结算收到
```

余额 > 0：应收。
余额 < 0：应付。

### 结算建议

- 正余额 -> creditors
- 负余额 -> debtors
- 双方按金额排序
- 贪心匹配生成 `{ fromId, toId, amount }`
- 金额以分为单位处理，减少浮点误差

点击结算后会把建议生成 `type: "settlement"` 的真实记录写回 ledger，因此不能把历史结算和“展示建议”混为一谈。

### 已验证核心例子

基线已验证：

- `100 / 3 = 33.34 / 33.33 / 33.33`
- A 付 100，A/B 均摊 -> A +50，B -50
- 加一条 B -> A 50 的 settlement 后 -> 双方 0

涉及 calculator 的修改都必须重新验证这些性质。

## 7. 汇率逻辑

v0.9.0 汇率不再经过 Worker。

调用链：

```text
app.js -> api.refreshRates()
       -> 读取 data 分支业务 config.json
       -> getRates(config)
       -> 浏览器直接 fetch Frankfurter
```

默认：

```js
{
  provider: "frankfurter",
  endpoint: "https://api.frankfurter.dev/v2/rates",
  base: "CNY",
  quotes: ["MXN", "TRY"],
  cacheSeconds: 0
}
```

Frankfurter v2 `/rates` 主要返回数组：

```js
[{ date, base: "CNY", quote: "MXN", rate: ... }]
```

当 base 是 CNY 时：

```text
1 CNY = rate MXN
=> 1 MXN = 1 / rate CNY
```

代码同时保留 object-style API 的兼容解析。

v0.9.3 的关键兼容规则：

- `/v2/rates` query 只设置 `base` 和 `quotes`（以及业务配置未来显式支持的 Frankfurter 官方参数）。
- 不得追加 `_ts`。Frankfurter v2 会对未知 query 参数返回 HTTP 422；此前本地汇率获取失败正是 `_ts` 导致。
- `fetch` 使用 `cache: "no-store"` 完成禁用浏览器缓存，不需要 URL cache-busting。
- 非 2xx 时读取响应正文中的 `message` / `error`，便于 UI 显示具体失败原因。

保存 expense 时会固化当次 `rateToCny` 和 `amountCny`，后续实时汇率变化不会重算历史记录。

## 8. 图片逻辑

### 8.1 压缩

`utils.js -> compressImageFile()`：

- 优先 `createImageBitmap`，失败回退 `HTMLImageElement`。
- 以最长边控制尺寸，默认 1600。
- 初始质量来自 `app.imageQuality`，默认 0.72。
- 目标大小来自 `app.imageMaxBytes`，默认 972800 bytes；绝对不能超过 1MB。
- Canvas 优先输出 WebP；不支持 WebP 时回退 JPEG。
- 如果仍过大，先逐步降低质量，再缩小尺寸，最多 8 次。
- 选择图片后只生成内存 Blob + Object URL 预览，不写 JSON、不写 localStorage。`imageSelectionVersion` 防止连续选图时旧异步结果覆盖新图；submit 必须先 `await imageProcessingPromise`，避免压缩尚未结束就保存成无图记录。modal 关闭时递增 selection version 并 revoke preview URL。

### 8.2 保存事务

`showExpenseModal()` 保存带图片 expense：

1. 基于最新内存 data 找到 ledger/record，并为新 record 分配最终唯一 ID。
2. 为图片生成唯一 `img_*` ID 和 `media/<ledger>/<record>/<img>.<ext>`。
3. `api.uploadMediaFile()` 先创建 GitHub media 文件。
4. 注册 rollback：如果后续 `saveData()` 失败，DELETE 刚上传文件。
5. record 只写 `attachments[]` 元数据。
6. `data.json` PUT 成功后，若是替换/删除旧图，再执行 afterCommit DELETE 旧文件。

`commitDataMutation()` v0.9.6 支持两类远程事务 callback：

- `transaction.onRollback(fn)`：主 JSON 保存失败时逆序执行，主要用于删除本次刚上传的 media。
- `transaction.afterCommit(fn)`：主 JSON 成功后执行，主要用于清理不再引用的旧 media。afterCommit 失败只提示 `mediaCleanupFailed`，不能把已成功的 JSON mutation 当作失败。

### 8.3 删除语义

- record 软删除：附件继续存在且 metadata 保留。
- 编辑点“删除图片”：只是在草稿中移除 attachment；JSON 成功后才删旧 media。
- 永久删除 archived ledger：先硬删 ledger JSON，再清理该 ledger 所有 `attachments` 引用。
- 当前无旧 Base64 图片，因此没有迁移流程；`saveData()` 会无条件丢弃旧 `record.photo`，防止 Base64 再进入数据文件。

## 9. 本地存储和 PWA

### 9.1 localStorage 当前允许内容

业务数据缓存已于 v0.9.5 删除。当前只保留 UI 偏好类 key：

- `syncSpend.lang`：语言
- `syncSpend.lastCurrency`：最后一次新增记录使用的货币
- `syncSpend.lastLedgerId`：最后打开账本，仅用于远端数据加载成功后的页面定位
- `syncSpend.installTipClosed`：iOS 安装提示是否关闭

旧 key：

- `syncSpend.cache`：v0.9.5 启动时主动删除，不读取、不写入
- `syncSpend.githubConfig.v1`：旧明文连接配置，启动时删除
- `syncSpend.githubConfig.v2`：v0.9.4 密文连接缓存，v0.9.5 起也删除，不再回退

**禁止重新引入 data/config/rates/SHA 的 localStorage 缓存或失败回退。** 如果未来确实要做离线能力，必须先与用户确认，因为它与“每次加载只认 GitHub 最新数据”的当前产品要求冲突。

### 9.2 Service Worker

`service-worker.js` 当前 cache name：`sync-spend-shell-v097`。

规则：

- GitHub / Frankfurter 等跨域请求：Service Worker 不接管缓存。
- 同源 `data/config.json` / `data/data.json`：network-only + `cache: no-store`，失败不回退。
- HTML/JS/CSS/icon 等 App Shell：在线 network-first，成功后更新静态 Cache Storage；断网仅允许静态外壳回退。
- 即便静态外壳离线打开，业务 bootstrap 仍会因无法访问 GitHub 而显示加载失败，不会出现旧账本。

这保证“代码尽量新 + 业务数据一定实时”。

## 10. 页面和交互

### Dashboard

- 账本列表
- 新建账本
- 归档/取消归档
- 已归档账本删除

### Ledger Detail

- 总消费
- 各币种金额
- 人均
- 未分配金额（主要用于旧数据诊断；v0.9.1 新 amount split 不允许留下未分配）
- 记录列表
- 结算
- 编辑账本

### Record UI

- PC 卡片
- 移动端紧凑卡片
- 日期分组
- 移动端左滑编辑/删除
- 图片点击查看
- expense 和 settlement 有不同展示层级

### Settings

- 消费者新增/编辑；有历史引用时仅停用，完全未引用时才永久删除
- 刷新汇率
- `GitHub Direct API` 连接信息：owner/repo/branch/dataPath/configPath + Token 加密状态/算法；不显示真实 Token
- 汇率信息

设置页不会显示真实 Token，只显示“已加密配置 / 仅内存解密”和算法信息。

## 11. i18n

`src/js/i18n.js`：

- `zh-CN`
- `en-US`

应用语言通过 `getLanguage()/setLanguage()` 管理，并写入 `syncSpend.lang`。

消费者名称和 App 名称支持：

```js
{
  "zh-CN": "...",
  "en-US": "..."
}
```

## 12. 当前已知风险 / 后续需特别注意

### A. DES Token 是客户端混淆，不是真正 Secret

Pages 发布配置不再出现 PAT 明文，但密文、Key=`ELIU` 和解密代码都由 GitHub Pages 下发。任何能读取前端代码的人理论上都能还原 Token。因此不要把该方案描述成密码学意义上的 Secret 存储；它的直接目标是避免 PAT 明文和 `github_pat_` 前缀直接提交进公开仓库。若 Token 已被 GitHub 撤销，仅把旧 Token 加密不能恢复其有效性，必须生成新 PAT 后按同一规则重新加密。

### B. GitHub Contents API / CORS / token 状态是运行时外部依赖

常见错误仍包括：401 token 失效、403/404 权限或路径问题、409 SHA 冲突、大文件 Contents API 响应差异。`readRawGithubFile()` 的 raw fallback、HTTP status 和错误 code 不能删。

### C. GitHub 的 data/config 两个文件不是服务端原子事务

v0.9.1 已避免“删除 consumer 同时写 config+data”的设计：有引用 consumer 只改 config 为 inactive，不再修改所有 ledger。当前 CRUD 绝大多数单次只写一个文件。但未来若新增必须同时改 `data.json` + 业务 `config.json` 的功能，要明确处理半成功问题，不能假设 GitHub 两次 PUT 原子提交。

### D. 软删除/history 仍会持续增大 data.json，但图片已不再放 JSON

expense / settlement 删除仍是 `deleted:true` + history，因此长期运行后 `data.json` 仍会增长；v0.9.6 已把图片本体外置到 `media/`，避免图片导致 JSON 指数式膨胀。未来若做回收站清理，必须明确硬删除不可恢复语义，并同时处理对应 media；不要为了缩小 JSON 擅自删历史记录。

### D2. media 可能产生孤儿文件

上传成功但主 JSON 保存失败时会自动 rollback；JSON 保存成功后旧 media 清理失败时，为保护账务正确性不会回滚 JSON，因此可能留下孤儿 media。当前 UI 会提示清理失败。未来可做显式“扫描孤儿 media / 清理”工具，但不能在启动阶段无确认地删除文件。

### E. pre-v0.9.1 已被旧代码破坏的历史参与人无法自动推断

v0.9.1 能保证未来“移除账本参与人/停用消费者”不再改写历史。如果线上旧版本曾经已经把 consumer 从 ledger.participantIds 删除，且对应老 expense 又没有 `splitParticipantIds` 快照，原始参与人信息可能已经丢失，代码无法凭空恢复。不要自动猜测。

### F. legacy expense 没有 splitParticipantIds 时仍需谨慎

在第一次编辑 ledger 参与人之前，老记录仍以 ledger 当前 participantIds 作为 fallback。v0.9.1 在参与人变更前会 materialize 快照，因此不要删除 `materializeLegacySplitSnapshots()`，也不要把它放到 participantIds 更新之后。

### G. 重复 ID 迁移必须保持“兼容层”和“严格保存校验”分离

`migrateDataIntegrity()` 只用于读取旧脏数据后的运行期兼容，不能通过删除 API 的 `assertUniqueIds()` 来“解决”报错。迁移必须保留全部记录、确定性生成新 ID，并且不能在启动阶段无条件写 GitHub。API 保存前仍必须拒绝重复 ID，防止未来新代码重新写入脏数据。

### H. CSS 有历史叠加

`app.css` 很大，包含多轮移动端优化。改样式前先 grep 选择器，避免只改前面规则却被文件后面覆盖。

## 13. 必须保护的业务不变量

后续任何功能修改都优先保护：

1. 历史 expense 的 `amountCny` / `rateToCny` 不因新汇率变化。
2. 等额分摊各份额总和严格等于总额。
3. 新增/编辑 amount split 的各份额总和必须等于 `amountCny`，不能留下无人承担金额。
4. 显式 `splitParticipantIds` 是历史快照，不得按 ledger 当前 participantIds 过滤。
5. 从 ledger 当前参与人移除某人、或停用 consumer，不得改变已有 expense 的历史分摊/余额。
6. settlement 不计入 total consumption，但必须改变余额。
7. 软删除 record 不参与计算；删除 settlement 后其结算影响必须撤销。
8. 已有历史引用的 consumer 不物理删除，只允许 inactive；未引用 consumer 才能永久删除。
9. 数据/配置 mutation 必须先改 clone，GitHub PUT 成功后才能替换 state；失败/409 时页面 state 保持原值。
10. GitHub 最新数据 bootstrap 未成功完成前，mutation 必须拒绝执行，不能基于空 state 或旧对象写入。
11. 每次写 GitHub 使用 SHA，不能静默覆盖并发修改。
12. 大数据文件必须保留 raw fallback。
13. config 保存不能把 Pages 发布分支 GitHub Token（无论密文或解密值）写进 data 分支业务 config。
14. `todayInputValue()` 使用浏览器本地年月日，不可改回 UTC `toISOString().slice(0,10)`。
15. 代码修改后运行 `npm run check`，并同步更新本 GPT_PROJECT_MEMORY.md。
16. 历史重复/缺失 ledger/record ID 必须先通过 `migrateDataIntegrity()` 无损修复；不能直接删除冲突记录，也不能关闭 `assertUniqueIds()`。
17. record ID 迁移不能修改 `createdAt/updatedAt`，避免仅因数据修复改变记录排序和业务时间。
18. 不写无调用函数、重复兼容层或没有实际用途的配置项；新实现替代旧实现时清掉旧路径。
19. 图片本体禁止进入 `data.json` / localStorage；expense 只能保存 `attachments[]` 元数据，media path 必须位于 `media/`。
20. 带图片 mutation 必须遵守“新 media 先上传 → JSON 保存 → 旧 media 后清理”；JSON 失败必须尝试回滚本次新上传文件。
21. record 软删除不得物理删除附件；只有图片从已成功保存的 record 中解除引用，或 archived ledger 已成功硬删除后，才能清理对应 media。
22. 单个压缩图片必须 ≤1MB；不要提高到 GitHub Contents API 大文件边界来掩盖压缩问题。

## 14. 后续修改标准流程

每次接到代码修改需求：

1. 先读取用户最新附件，不默认旧包仍是最新。
2. 读取本 `GPT_PROJECT_MEMORY.md`。
3. 定位需求涉及的完整调用链，而不是只改 UI 表面。
4. 修改尽量小而完整，避免重复实现。
5. 删除因新实现而失去用途的旧代码/配置/文档。
6. 至少运行：

```bash
npm run check
```

7. 校验所有 JSON 可解析。
8. grep 旧实现关键字，确认没有意外残留运行路径。
9. 涉及 calculator 时做金额/结算回归。
10. 涉及 API 时检查：读取、raw fallback、SHA、409 错误映射。
11. 涉及 PWA 核心 JS 变更时评估是否需要 bump `CACHE_NAME`。
12. 更新版本号（如果是发布级功能变更）并保持所有版本位置一致。
13. **更新本文件的当前基线、架构事实、已知风险和修改记录。**
14. 重新生成完整 zip 交付，确保 zip 内含最新版本文件。

## 15. 代码质量约定

- Vanilla JS ES Modules，不引入框架除非用户明确要求。
- 不为了抽象而抽象。
- 不增加未调用 helper。
- 不保留已失效架构的“备用”代码。
- 业务金额统一走已有 round/normalize 工具。
- 新增 API 行为必须保留明确错误 code。
- 不在 UI、日志、测试输出或文档中展示真实 GitHub Token 明文；Pages 发布 config 只保存 DES Base64 密文。
- 修改前检查调用方和数据模型，避免字段名漂移。
- 对用户线上数据采取兼容性优先策略。

## 16. 当前验证结果（2026-08-16）

v0.9.7 当前交付必须确认：

- `npm run check` 通过：Service Worker + 全部前端 JS syntax check + 33 个 `node:test` 回归用例。
- 测试构成：8 calculator + 12 API/media + 3 crypto + 4 migration + 3 cache-policy + 3 ui-actions。
- API/media 新增覆盖：独立二进制上传 Base64 请求体、media path/branch、stored SHA 删除、旧 `photo` 字段不写回、attachment metadata/schemaVersion 2、非法非-media path 拒绝。
- `data/config.json`、`data/data.json`、`manifest.webmanifest` JSON 可解析；默认 `data/data.json` schemaVersion=2。
- 版本统一为 `0.9.7`：package/version.js/index/404/manifest；PWA cache name=`sync-spend-shell-v097`。
- 源码不再存在 `imageFileToDataUrl()` / Canvas `toDataURL()` / `record.photo` 展示路径；只有保存清理层明确 `delete record.photo`，防止旧 Base64 字段回写。
- 图片上传文件固定在 `media/<ledger>/<record>/...`，压缩 Blob ≤1MB；data JSON 仅 attachment metadata。
- `commitDataMutation()` 继续 clone + SHA PUT + 成功替换 state，并保留 media rollback/afterCommit cleanup 事务 callback；v0.9.7 增加 busyText/deferBusyUntilMutation。
- PC ledger hero 的 `ledger-refresh-btn` 必须位于 settle 按钮之前；移动端 FAB 顺序必须为 add(order 1) → refresh(order 2) → more(order 3)。
- 所有用户主动远端操作必须显示全局 operation overlay；删除/结算 confirm 取消不能显示处理中状态；处理中必须阻止重复保存/刷新。
- record 软删除不清理 media；永久删除 archived ledger JSON 成功后才清理引用 media。
- 启动仍严格 GitHub remote-first；localStorage 只保存 UI 偏好，业务 data/config/rates/SHA 不缓存。
- Service Worker 对 GitHub / Frankfurter 不缓存；同源连接 config/data 占位 network-only；App Shell network-first。
- `release1` 仍是用户当前 GitHub Pages 发布分支；业务 `branch: data` 不随 Pages 分支改变。
- Frankfurter URL 不包含 `_ts`；DES Token 规则仍为 CBC/PKCS7/UTF-16LE/ELIU。

## 17. 修改记录

### 2026-08-16 — v0.9.7：主页面刷新入口 + 全局操作中反馈

用户要求 PC 主页面在“结算”前增加刷新按钮，移动端在悬浮“更多”正上方增加刷新，并让删除/修改等所有操作在确认后明确显示处理中状态。完成：

- PC ledger hero 新增 `ledger-refresh-btn`，固定放在 `settleNow` 前，直接调用 `refreshData()` 从 GitHub 重新 bootstrap。
- 移动端新增 `mobile-refresh-fab`，FAB 顺序明确改为 add=1、refresh=2、more=3，因此“刷新”直接在“更多”上方。
- 新增全局 `operation-overlay`、spinner、message；操作期间 inert 锁定 app/modal，防止重复点击和双写。
- `commitDataMutation()` / `commitConfigMutation()` 新增 `busyText` 与 `deferBusyUntilMutation`；普通写入“保存中...”，删除“删除中...”，结算“结算中...”。
- delete record / delete archived ledger / consumer delete-or-deactivate / settle 使用 defer 模式：只有原生 confirm 返回 true 后才展示 busy，取消不闪烁。
- `refreshData()` / `refreshRates()` / 记账弹窗显式实时汇率刷新均加入真实 Promise 生命周期的刷新状态；`state.refreshing` 与 `state.saving` 互斥。
- 中英文新增 refreshing/refreshingRates/deleting/settling/processing 文案，`saving` 中文改为“保存中...”，并发提示改为通用“已有操作正在进行”。
- CSS 增加 PC/移动端刷新位置规则和 operation overlay；PWA cache bump 为 `sync-spend-shell-v097`。
- 新增 `tests/ui-actions.test.mjs` 3 项；`npm run check` 当前 33/33 通过。

### 2026-08-16 — v0.9.6：图片外置到 GitHub media，data.json 只存元数据

用户确认当前没有历史上传图片，要求直接改变图片存储方式，不做旧 Base64 迁移。完成：

- 删除 `imageFileToDataUrl()`，新增 `compressImageFile()`：最长边缩放、WebP 优先/JPEG fallback、质量+尺寸迭代压缩、目标 950KB/硬上限 1MB。
- expense 数据由 `photo` 改为 `attachments[]`；`data.json` schemaVersion 升为 2。
- `ApiClient` 新增 `uploadMediaFile()` / `deleteMediaFile()` / `readContentMetadata()` / `mediaUrl()`；独立文件放 data 分支 `media/<ledger>/<record>/<imageId>.<ext>`。
- `saveData()` 保存前丢弃任何旧 `record.photo`，严格校验 attachment id/path/mime/size/dimensions，禁止 Base64 图片继续进入 JSON。
- 新增/编辑保存先上传 media；主 JSON 失败时自动 rollback 刚上传 media。替换/删除旧图片时主 JSON 成功后再清旧 media。
- `commitDataMutation()` 增加 `onRollback` 与 `afterCommit` 远程事务 callback；清旧 media 失败只提示，不回滚成功账务数据。
- 软删除 record 保留图片；永久删除 archived ledger 时先删除账本 JSON，再清理其所有引用 media。
- 图片展示从 attachment path 生成 raw GitHub URL，并使用 `loading=lazy` / `decoding=async`。
- preview 使用 Object URL，modal 关闭时 revoke；连续选图使用 selection version 防异步乱序，保存会等待当前图片压缩 promise；不写 localStorage。
- PWA cache bump 为 `sync-spend-shell-v096`；版本统一 0.9.6。
- API/media 新增 4 项测试，当前 `npm run check` 30/30。

### 2026-08-16 — v0.9.5：业务数据强制 GitHub 最新、移除本地缓存

用户要求每次加载都必须从 GitHub 获取最新数据，不再使用缓存。完成：

- `app.js` 启动删除 cache-first 路径，不再 `loadCache()`；先显示 loading，再等待 GitHub bootstrap 完成。
- `store.js` 删除 full/lite/minimal 缓存体系、`cacheMode`、`updateCache()`；保留 `clearLegacyDataCache()` 只用于删除旧 `syncSpend.cache`。
- `setBootstrap()` 不再持久化 data/config/rates/SHA 到 localStorage。
- `api.js -> loadClientConfig()` 取消 `syncSpend.githubConfig.v2` 的读写和失败回退；每次实时读取 Pages `data/config.json`，同时清理 v1/v2 旧 key。
- GitHub Contents GET 统一 `cache: no-store`，删除 `_ts` cache-busting 参数，只保留 `ref`。
- 汇率刷新只更新当前页面 state，不写本地业务缓存。
- GitHub 初始加载失败时不再展示旧账，错误页要求重新联网/重试。
- Service Worker 升级 `sync-spend-shell-v095`，App Shell 在线 network-first；业务配置、占位 data、跨域 GitHub/Frankfurter 不做缓存兜底；注册使用 `updateViaCache:none`。
- BFCache 恢复页面时监听 `pageshow.persisted` 并重新 `refreshData()`，避免浏览器前进/后退恢复旧账。
- localStorage 只保留 UI 偏好；不能重新把账务 data/config/rates/SHA 放回本地缓存。
- 新增 `tests/cache-policy.test.mjs` 3 项；`npm run check` 当前 26/26 通过。
- 用户当前 GitHub Pages 发布分支是 `release1`；代码路径全部相对，因此发布分支从 release 换到 release1 不需要改业务代码。

### 2026-08-16 — v0.9.4：GitHub Token DES 密文配置

用户提供自己的 DES 加密工具和规则，要求 release 配置以后只保存加密后的 GitHub Token，并在运行时统一解密。完成：

- `data/config.json -> github.token` 从明文字符串改为 `encrypted / algorithm / encoding / key / iv` 对象；当前 Key/IV=`ELIU`，算法 `DES-CBC-PKCS7`，编码 `UTF-16LE`。
- 新增 `src/js/crypto.js` 纯 JavaScript BigInt DES 解密，实现 CBC、反向 round keys、PKCS7 校验、UTF-16LE 与 Base64 处理，并用 .NET/OpenSSL 兼容向量验证。
- `api.js` 严格拒绝明文 token 字符串，统一在 `applyClientConfig()` 解密；GitHub headers 只读取内存中的解密值。
- client config localStorage 从 v1 升级为 v2，只缓存密文对象；成功加载新静态配置时删除 v1，避免继续使用旧的明文/已撤销 Token 缓存。
- 设置页显示 Token 已加密和算法信息，不显示真实明文。
- 新增 3 项 crypto tests，并增加 1 项明文 token 配置拒绝测试；总测试 23/23；版本升到 0.9.4，PWA cache bump 为 `sync-spend-shell-v094` 并缓存 crypto.js。
- 重要运行事实：当前密文对应用户之前已经出现 `Bad credentials` 的那枚 PAT；如果 GitHub 已撤销它，必须由用户新建 PAT 后用相同规则重新加密并替换 `encrypted`，代码修改本身不会让被撤销的 PAT 恢复。

### 2026-08-16 — v0.9.3：Frankfurter v2 严格参数兼容与错误诊断

用户本地运行时汇率卡显示 Frankfurter 获取失败，但浏览器直接访问 `https://api.frankfurter.dev/v2/rates?base=CNY&quotes=MXN,TRY` 可以正常返回。复核代码和 Frankfurter v2 变更后确认：旧 `getRates()` 为 cache busting 给 URL 追加 `_ts`，而 Frankfurter v2 已启用严格 query 参数校验，任何未知参数都会返回 422。完成：

- `src/js/api.js -> getRates()` 删除 `_ts` 参数；仍设置官方 `base` / `quotes`。
- 禁缓存统一使用浏览器 `fetch(..., { cache: "no-store" })`，不再修改 Frankfurter query string。
- 非 2xx 读取响应正文，优先解析 `message` / `error`，错误对象例如 `Frankfurter HTTP 422: Invalid request`。
- 汇率卡在 `rates.error` 存在时展示详细错误；手动刷新与新增记录弹窗实时刷新失败时不再提示成功。
- API 回归新增 2 项：验证 Frankfurter URL 无 `_ts`、验证 HTTP 错误正文透出。测试总数 19/19。
- 版本升到 0.9.3，PWA cache bump 为 `sync-spend-shell-v093`，避免已安装客户端继续加载旧 `api.js`。

### 2026-08-16 — v0.9.2：历史重复 ID 兼容迁移与删除解锁

用户在删除记录时遇到 `duplicate record in ledger ... id: ...`。根因是 v0.9.1 的严格唯一性校验正确发现线上旧 `data.json` 已经存在重复 record ID，但当时缺少旧脏数据迁移层，导致任何后续保存都被整体阻断。完成：

- 新增 `src/js/migration.js`，bootstrap 和 localStorage cache 恢复时对 data 做 clone 后的完整性迁移。
- duplicate/missing ledger、record ID 都可修复；第一条合法 ID 不动，后续冲突项使用确定性 `__repairN`，并避开原数据中已存在的同名后缀。
- migration 永远不删除记录；active/deleted 状态、金额、图片、分摊、结算、createdAt/updatedAt 均保留。
- 被改 ID 的 record 追加 `id_repaired` history，记录旧 ID → 新 ID；新增中英文历史动作标签“数据修复 / Data Repair”。
- setBootstrap 使用本次 GitHub bootstrap 的迁移后运行期数据；不在启动阶段自动写 GitHub，下一次正常 data mutation 时与业务操作一次 PUT 落盘。
- 因此用户升级后直接刷新并再次点“删除”即可：当前目标 record 已有唯一运行期 ID，删除和 ID 修复同一提交完成，不再触发 duplicate 校验。
- 新建 ledger、expense、settlement 增加 `allocateEntityId()` 占用检查，作为 `uid()` 随机 ID 和 API `assertUniqueIds()` 之间的额外防线。
- API 严格唯一性校验不删除；旧脏数据由 migration 兼容，新写入仍必须 clean。
- 新增 `tests/migration.test.mjs` 4 项，API 增加迁移后同次删除/保存测试；当前 `npm run check` 共 17 项测试。
- 版本升到 0.9.2，PWA cache bump 为 `sync-spend-shell-v092`。

### 2026-08-16 — v0.9.1：删除语义、历史分摊和写入一致性修复

用户要求整体重新检查逻辑并重点优化删除。完成：

- 发现并修复旧 `deleteConsumer()` 会物理删 consumer + 从所有 ledger.participantIds 移除，从而让历史分摊重算的严重问题。
- consumer 设置页展示历史引用数量；有引用时按钮语义变为“停用”，只有完全未使用才显示永久“删除”。
- calculator 保留显式历史 split participant，不再被当前 ledger participant 列表过滤；余额参与人改为当前+历史引用并集。
- ledger participant 编辑前物化 legacy record split 快照，支持安全移出当前参与人。
- expense / settlement 删除使用差异化确认；有历史 settlement 时删除 expense 明确提示可能产生补差/反向结算。
- soft delete 增加 `deletedAt`，同时更新 ledger.updatedAt。
- archived ledger 仍是唯一账本级硬删除；确认时显示有效记录/已软删除历史记录数量并说明图片、审计历史一并删除；GitHub 保存成功后才更新本地选择状态。
- CRUD 写入改为 `commitDataMutation` / `commitConfigMutation` 事务式副本提交，409/网络失败不会残留本地 mutation。
- 保存操作加互斥；refresh 在保存期间阻止；结算保存前基于最新数据重新计算并确认，避免快速重复生成。
- 新增/编辑/结算弹窗在打开前等待初始远端同步并重新按 id 解析对象，避免 cache object 被 bootstrap 替换。
- amount split 必须完整等于 amountCny；金额必须 > 0；legacy amount 无 splitParticipantIds 时从 splitAmountsCny keys 恢复参与人。
- API 保存前增加 ID / currency code 唯一性结构校验。
- 日期默认值改为本地年月日；修复移动端日期分组读取不存在的 `state.lang`。
- 新增 `tests/calculator.test.mjs` 8 项账务/删除引用回归和 `tests/api.test.mjs` 4 项保存/校验回归，`npm run check` 当前共执行 12 项测试。
- 删除未调用的 renderSettlements / settleLedger / toCny / number2 / downloadJson。
- Service Worker 改为只缓存同源 App Shell，跨域 GitHub / Frankfurter 请求不再写 Cache Storage；三级 localStorage 缓存全失败时正确回退 cacheMode=none。
- 版本升到 0.9.1，PWA cache bump 为 `sync-spend-shell-v091`。

### 2026-08-16 — v0.9.0：移除 Cloudflare，浏览器直连 GitHub

用户要求彻底去掉 Cloudflare 集成，并把原 Cloudflare Variables 中 GitHub 连接信息改放 release 分支 `data/config.json`。

完成：

- 删除 `worker.js`
- `api.js` 重写为浏览器直连 GitHub Contents API
- 保留小文件 base64 / 大文件 raw fallback
- 保留 SHA 乐观锁和 `GITHUB_CONFLICT`
- Frankfurter 改为浏览器直接请求
- release `data/config.json` 写入截图中可见的 GitHub owner/repo/branch/path
- GH_TOKEN 因截图加密不可读取，使用必须替换的占位符
- APP_PASSWORD 不迁移，因为没有 Worker 后没有真实服务端鉴权作用
- 删除 Wrangler 和 Worker 部署脚本
- 设置页改为 `GitHub Direct API`
- 业务 config 归一化/保存时移除遗留 cloudflare/github 字段
- client config 改为网络优先、缓存仅做失败回退
- PWA cache bump 到 `sync-spend-shell-v090`
- 版本升至 `0.9.0`
- README 重写为新架构说明

### 2026-08-16 — 建立 GPT 长期项目记忆

对 v0.8.8 原始附件完成项目结构、数据模型、分摊/结算、缓存、Worker/GitHub 链路的基线梳理，并建立本文件。该条作为历史来源保留；架构事实以 v0.9.7 当前章节为准。
