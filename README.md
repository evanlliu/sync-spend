# Sync Spend v0.9.7

Sync Spend 是一个部署在 GitHub Pages 的多人记账 PWA。浏览器直接调用 GitHub REST Contents API 读写 `data` 分支，不再使用 Cloudflare Worker。

## 1. 当前架构

```text
GitHub Pages（用户当前发布分支：release1）
├─ HTML / CSS / JavaScript / PWA
└─ data/config.json                GitHub 连接参数 + DES Base64 Token 密文
          │
          ├──────────────► Frankfurter API（实时汇率）
          │
          ▼
GitHub REST Contents API
          │
          ▼
data 分支
├─ data/data.json                  账本、消费、结算、附件元数据
├─ data/config.json                消费者、币种、汇率等业务配置
└─ media/<ledger>/<record>/        独立图片文件（WebP/JPEG）
```

项目没有后端进程、没有构建步骤。`data` 分支是唯一业务数据真相源；每次加载都实时从 GitHub 获取最新 `data.json` 和业务 `config.json`，不使用 localStorage 业务缓存兜底。

## 2. Pages 发布分支 `data/config.json`

前端启动时读取这个连接配置。GitHub PAT 不允许明文保存，结构为：

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

解密规则：DES-CBC + PKCS7，明文/Key/IV 都按 UTF-16LE，密文 Base64。`src/js/crypto.js` 解密，真实 PAT 只存在当前页面 JavaScript 内存中。

> 这是客户端混淆，不是服务端 Secret 存储；密文、Key 与解密代码都会下发给浏览器。

## 3. 业务配置

`data` 分支 `data/config.json` 是业务配置，不是上面的连接配置。`app` 中图片参数目前支持：

```json
{
  "imageMaxWidth": 1600,
  "imageQuality": 0.72,
  "imageMaxBytes": 972800
}
```

`imageMaxWidth` 实际作为最长边限制；浏览器会优先压缩为 WebP，必要时回退 JPEG，并尽量控制在约 950KB、硬上限 1MB 内。

## 4. 主页面刷新与操作反馈（v0.9.7）

- PC 账本主页面的操作区新增“刷新数据”，固定放在“结算”按钮之前；点击后重新从 GitHub 读取最新 `data/data.json` 和 `data/config.json`。
- 移动端账本页面的悬浮操作区按“新增 → 刷新 → 更多”从上到下排列，“刷新”固定在“更多”正上方。
- 所有远端写操作统一显示阻塞式操作状态：普通新增/编辑/归档显示“保存中...”，删除显示“删除中...”，生成结算记录显示“结算中...”。
- 删除、停用消费者、永久删除账本、结算等带原生确认框的动作，只在用户确认后显示操作状态；取消不会闪现处理中状态。
- 数据刷新、汇率刷新以及记账弹窗内显式“获取实时汇率”均显示对应刷新状态。
- 操作状态与真实异步请求生命周期绑定，并暂时锁住页面交互，防止重复点击造成并发双写；成功或失败后自动解除。

## 5. 图片存储（v0.9.6）

v0.9.6 起 **图片本体不再写进 `data.json`**。新增/编辑消费时：

```text
选择图片
→ 浏览器内存中缩放/压缩
→ 保存记录时先 PUT 到 data 分支 media/<ledger>/<record>/<imageId>.webp
→ 图片上传成功后再 PUT data/data.json
→ data.json 只保存 attachments 元数据
```

记录示例：

```json
{
  "id": "record_xxx",
  "type": "expense",
  "attachments": [
    {
      "id": "img_xxx",
      "path": "media/ledger_xxx/record_xxx/img_xxx.webp",
      "mime": "image/webp",
      "size": 183421,
      "width": 1600,
      "height": 1200,
      "sha": "<Git blob sha>",
      "createdAt": "2026-08-16T..."
    }
  ]
}
```

规则：

- 图片路径唯一，上传后视为 immutable，不覆盖同名旧文件。
- `data.json` 保存前会删除旧 `record.photo` 字段并拒绝非 `media/` 附件路径，防止 Base64 图片重新进入 JSON。
- 连续快速选图有 selection version 防异步结果乱序；点击保存会等待当前图片压缩完成。
- 图片上传成功但 `data.json` 保存失败/409 时，自动尝试删除刚上传的图片作为回滚。
- 编辑替换图片：先上传新图 → JSON 保存成功 → 再删除旧图；旧图清理失败只产生孤儿文件，不回滚已经成功的账务数据。
- 软删除 expense/settlement 不删除图片，保留历史审计能力。
- 永久删除已归档账本：先成功删除账本 JSON，再逐个清理该账本引用的 media 文件。
- 列表图片通过 `raw.githubusercontent.com` 按路径加载，并设置 `loading="lazy"`；账本 JSON 加载不再携带历史图片内容。

当前没有历史 Base64 图片需要迁移，因此本版本不实现旧图片迁移 UI；保存任何记录时旧 `photo` 字段都会被丢弃。

## 6. GitHub 读写与并发

`src/js/api.js`：

- `bootstrap()` 并行读取 `data/data.json` + `data/config.json`。
- 所有业务 GET 使用 `cache: "no-store"`，不加 `_ts`。
- `saveData()` / `saveConfig()` 使用当前文件 SHA 做乐观锁；409 映射为 `GITHUB_CONFLICT`。
- JSON 大文件读取仍保留 raw media fallback。
- `uploadMediaFile()` 创建独立图片文件，压缩后必须 ≤1MB。
- `deleteMediaFile()` 使用附件保存的 Git blob SHA 删除；没有 SHA 时才重新读取文件 metadata。
- 数据 mutation 使用 clone → GitHub PUT → 成功后替换 state；失败不污染页面内存。

## 7. 删除规则

- expense / settlement：软删除，写 `deleted:true`、`deletedAt`、history；立即退出统计和结算。
- 消费者：只要被账本或历史记录引用就不能物理删除，只能停用；完全未引用才永久删除。
- 账本：只有归档账本可永久删除。
- 删除/移除当前参与人不能改变历史 `splitParticipantIds`、付款、分摊或 settlement 语义。
- 历史重复/缺失 ledger/record ID 由 `migrateDataIntegrity()` 无损修复，API 保存前唯一性校验继续保留。

## 8. 汇率

Frankfurter v2 使用：

```text
https://api.frankfurter.dev/v2/rates?base=CNY&quotes=MXN,TRY
```

禁止追加 `_ts` 等未知参数；禁缓存只使用 `fetch(..., { cache: "no-store" })`。历史 expense 固化当次 `rateToCny` 和 `amountCny`，以后实时汇率变化不会重算历史账。

## 9. PWA 与本地缓存

- Service Worker：`sync-spend-shell-v097`。
- App Shell 在线 network-first，断网时只允许静态外壳回退。
- GitHub / Frankfurter 跨域请求不进入 Service Worker Cache Storage。
- Pages `data/config.json` / `data/data.json` network-only，不回退旧缓存。
- localStorage 只保留语言、最后打开账本、最后币种、安装提示等 UI 偏好。
- 禁止重新把业务 data/config/rates/SHA 放回 localStorage。

## 10. 本地运行与检查

不要直接双击 `index.html`；ES Modules 应通过 HTTP 服务运行，例如：

```bash
py -m http.server 8080
```

然后访问 `http://localhost:8080/`。

完整检查：

```bash
npm run check
```

当前 33 项 `node:test` 回归全部通过：8 calculator + 12 API/media + 3 crypto + 4 migration + 3 cache-policy + 3 UI actions。

## 11. 发布

1. 将完整项目发布到 GitHub Pages 当前分支 `release1` 根目录。
2. `release1/data/config.json` 保持 DES 密文 Token；不要提交 PAT 明文。
3. GitHub Pages Source 指向 `release1 / (root)`。
4. 业务连接配置中的 `"branch": "data"` **不要改成 `release1`**；它指的是账务数据分支。
5. 首次发布新版本后强制刷新一次，确认页面显示 `v0.9.7`。

## 12. 主要文件

```text
src/js/app.js         UI、CRUD、图片事务流程
src/js/api.js         GitHub JSON/media API + Frankfurter
src/js/calculator.js  分摊、余额、结算
src/js/crypto.js      DES Token 解密
src/js/migration.js   历史 ID 数据修复
src/js/store.js       仅内存业务 state
src/js/utils.js       DOM/日期/图片压缩
src/js/i18n.js        中英文文案
GPT_PROJECT_MEMORY.md 下一次新 GPT 对话完整交接记忆
```
