# Sync Spend v0.9.5

Sync Spend 是一个部署在 GitHub Pages 的多人记账 PWA。自 v0.9.0 起不再使用 Cloudflare Worker，浏览器直接调用 GitHub REST API 读取和写入数据分支中的 JSON 文件。

## 1. 架构

```text
GitHub Pages（发布分支，当前 `release1`）
  ├─ 前端 HTML / CSS / JavaScript / PWA
  └─ data/config.json          GitHub API 连接参数 + DES Base64 Token 密文
           │
           ▼
GitHub REST API
           │
           ▼
GitHub data 分支
  ├─ data/data.json            账本和流水
  └─ data/config.json          消费者、币种、汇率等业务配置

浏览器 ───────────────► Frankfurter API（实时汇率）
```

项目没有服务端进程，也没有构建步骤。

## 2. 目录

```text
sync-spend-release/
├─ index.html
├─ 404.html
├─ manifest.webmanifest
├─ service-worker.js
├─ package.json
├─ README.md
├─ GPT_PROJECT_MEMORY.md
├─ tests/
│  ├─ calculator.test.mjs      核心账务回归测试
│  ├─ api.test.mjs             GitHub 保存前校验与写入回归测试
│  ├─ crypto.test.mjs          .NET 兼容 DES 解密回归测试
│  └─ migration.test.mjs       历史重复/缺失 ID 数据迁移回归测试
├─ data/
│  ├─ config.json              Pages 发布分支的 GitHub 连接配置（当前 release1）
│  └─ data.json                发布包占位文件；线上数据来自 data 分支
├─ assets/icons/
└─ src/
   ├─ css/
   └─ js/
      ├─ app.js
      ├─ api.js                GitHub REST API + Frankfurter API 客户端
      ├─ calculator.js
      ├─ crypto.js             DES-CBC/PKCS7 UTF-16LE Token 解密
      ├─ currency.js
      ├─ i18n.js
      ├─ migration.js          旧数据 ID 完整性迁移
      ├─ store.js
      ├─ utils.js
      └─ version.js
```

## 3. GitHub Pages 发布分支 `data/config.json`（当前 `release1`）

这是前端启动时读取的连接配置。v0.9.4 起 **不允许再把 GitHub PAT 明文写进仓库**，`github.token` 必须使用下面的 DES 加密对象：

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

加密规则与用户现有工具保持一致：

- DES CBC
- PKCS7 padding
- 明文按 UTF-16LE 编码后加密
- Key / IV 字符串也按 UTF-16LE 转成 8 字节 DES Key / IV
- 当前 Key=`ELIU`、IV=`ELIU`
- 密文使用 Base64

`src/js/crypto.js` 负责解密；`src/js/api.js` 只把解密后的 Token 保存在当前页面 JavaScript 内存中。v0.9.5 起连接配置也不再使用 localStorage 回退：每次页面启动都实时读取当前发布分支的 `data/config.json`，并清理旧 `syncSpend.githubConfig.v1/v2`。

代码会拒绝 `github.token` 为字符串的旧明文格式，避免以后误把 PAT 再次直接提交到 GitHub。

原 Cloudflare Variables 的其他连接参数仍对应：`GH_OWNER / GH_REPO / GH_BRANCH / GH_DATA / GH_CONFIG`；`APP_PASSWORD` 继续删除，不再存在服务端密码校验。

> DES 密文可以避免 GitHub 文件中直接出现 PAT 明文和 `github_pat_` 前缀，但由于解密 Key 和前端代码同样会发布到浏览器，它属于客户端混淆，不是服务端 Secret 存储。

## 4. data 分支 `data/config.json`

这是业务配置，不是 API 连接配置。示例：

```json
{
  "schemaVersion": 1,
  "app": {
    "name": {
      "zh-CN": "同步记账",
      "en-US": "Sync Spend"
    },
    "defaultLanguage": "zh-CN",
    "baseCurrency": "CNY",
    "imageMaxWidth": 1600,
    "imageQuality": 0.72,
    "timezone": "America/Monterrey"
  },
  "consumers": [],
  "currencies": [
    {
      "code": "CNY",
      "name": {
        "zh-CN": "人民币",
        "en-US": "Chinese Yuan"
      },
      "symbol": "¥"
    }
  ],
  "exchange": {
    "provider": "frankfurter",
    "endpoint": "https://api.frankfurter.dev/v2/rates",
    "base": "CNY",
    "quotes": ["MXN", "TRY"],
    "cacheSeconds": 0
  }
}
```

应用读取旧业务配置时会移除遗留的 `cloudflare` / `github` 字段；下一次保存业务配置时不会再把这些遗留字段写回 data 分支。

## 5. GitHub 读写机制

`src/js/api.js` 直接调用 GitHub Contents API：

- 启动：并行读取 `data/data.json` 与 `data/config.json`
- 刷新汇率：读取远端业务配置，再直接请求 Frankfurter
- 保存账本：PUT `data/data.json`
- 保存业务配置：PUT `data/config.json`
- 每次写入携带当前文件 SHA，保留乐观并发冲突检测
- GitHub 返回 409 时映射为 `GITHUB_CONFLICT`
- 大文件读取时，如果 Contents API 元数据不含 base64 `content`，自动使用 raw media type 再读取文件正文

因此原有数据结构、SHA 并发保护和大于 1MB 数据文件读取兼容逻辑都保留。

## 6. 部署

1. 将本项目代码发布到 GitHub Pages 当前发布分支 `release1`（如以后换分支，代码无需修改）。
2. 用项目约定的 DES-CBC/PKCS7 + UTF-16LE 方式加密新的 GitHub PAT，把 Base64 密文写入 Pages 发布分支的 `data/config.json -> github.token.encrypted`；不要写入 PAT 明文。
3. 确认 `data` 分支存在：
   - `data/data.json`
   - `data/config.json`
4. 打开 GitHub Pages 页面。
5. 进入“配置”页，应看到 `GitHub Direct API` 和目标仓库/分支信息。
6. 新建或修改一条数据，确认 `data` 分支对应 JSON 出现新的提交。

不再需要：

- Cloudflare Worker
- Worker Variables / Secrets
- Wrangler
- `/api/health`
- `/api/bootstrap`
- `/api/save-data`
- `/api/save-config`
- `/api/rates`

## 7. 本地检查

```bash
npm run check
```

该命令会先执行 Service Worker 与全部前端 JavaScript 语法检查，再运行 `tests/*.test.mjs` 的核心回归测试。当前共 26 项：8 项账务/删除引用测试 + 8 项 API/保存/汇率/明文 Token 拒绝测试 + 3 项 DES Token 解密测试 + 4 项历史数据迁移测试 + 3 项无业务缓存策略测试。

也可以分别执行：

```bash
npm run check:syntax
npm test
```

## 8. 数据、删除与结算规则

- 消费记录保存原币金额、当次汇率和固化后的 `amountCny`。
- 分摊支持均摊与指定人民币金额；从 v0.9.1 起，按金额分摊必须完整分配到 `amountCny`，不再允许留下无人承担的余额。
- 余额按“支付额 - 应承担额 + 已结算付出 - 已结算收到”计算。
- 结算记录使用 `type: "settlement"`，与消费记录一起保存在账本 `records` 中，但不计入总消费。
- 消费记录和结算记录删除都采用软删除：写入 `deleted: true` / `deletedAt`，立即退出统计，但原始记录与 history 继续保存在 JSON 中。
- 删除消费时，如果账本已有历史结算，会明确提示历史结算不会自动删除，后续可能出现补差或反向结算。
- 已被账本或历史记录引用的消费者不能物理删除，只能停用；这样不会破坏历史付款人、分摊人与结算人的引用。
- 只有从未被任何账本/记录引用的消费者才允许永久删除。
- 编辑账本参与人时，会先给旧记录补齐 `splitParticipantIds` 历史快照；以后把某人移出当前账本，也不会改变旧消费的分摊结果。旧 amount 分摊如果没有快照，则优先从已有 `splitAmountsCny` 键恢复历史分摊人，而不是错误套用当前参与人。
- 账本汇总会把“当前参与人 + 历史记录实际引用的人”一起纳入余额计算，避免历史参与人被移除后余额消失。
- 已归档账本仍可永久删除；这是账本级硬删除，确认框会同时列出有效记录和已软删除历史记录数量，并明确图片/审计历史也会永久清除。
- 所有数据/配置写操作都在副本上修改，GitHub 保存成功后才提交到页面 state；保存失败或 409 冲突不会再污染本地页面状态。
- v0.9.2 起，加载远端数据时会先做数据完整性迁移：重复或缺失的 ledger/record ID 不再锁死所有保存操作；第一条合法 ID 保持不变，后续冲突项确定性改名，不删除任何记录。record ID 修复会追加 `id_repaired` history，但不会修改业务 `createdAt/updatedAt`。修复后的数据只在下一次真实业务保存成功时一并写回 GitHub，不做无确认的启动即写入。
- 保存依赖文件 SHA，发生并发覆盖时不自动 merge。

## 9. v0.9.5 更新

- **移除全部业务数据 localStorage 缓存。** 启动不再读取或写入 `syncSpend.cache`；旧 key 会在启动时主动清理。
- 每次页面启动都必须完成 GitHub `data/data.json` + `data/config.json` 实时读取后才进入业务页面；GitHub 失败时显示明确加载错误，不再展示旧账本缓存。
- GitHub Contents API 的 GET 统一使用 `fetch(..., { cache: "no-store" })`，不再追加 `_ts` 之类 cache-busting query 参数。
- 发布分支的连接 `data/config.json` 同样不再 localStorage fallback；旧 `syncSpend.githubConfig.v1/v2` 都会清理，连接配置读取失败就直接报错。
- 汇率只保存在当前页面内存，不再跟随账本写入本地缓存。
- localStorage 只保留 UI 偏好：语言、最后打开账本、最后使用币种、iOS 安装提示关闭状态等；这些不参与账务数据来源。
- Service Worker 升级为 `sync-spend-shell-v095`：同源静态 App Shell 在线时 network-first，仅断网时允许静态外壳回退；GitHub / Frankfurter 和 `data/config.json` / `data/data.json` 永远不使用 Cache Storage 兜底。
- Service Worker 注册使用 `updateViaCache: "none"`；浏览器从 BFCache 返回旧页面时会立即重新拉取 GitHub 数据，避免前进/后退恢复出旧账。
- 新增 3 项缓存策略回归测试，验证 GitHub bootstrap 强制 `no-store`、连接配置网络失败不回退 localStorage、`setBootstrap()` 不持久化业务数据；总测试数 26。

## 10. v0.9.4 更新

- release 分支 `data/config.json` 不再保存 GitHub PAT 明文，改为保存用户提供的 DES Base64 密文配置。
- 新增 `src/js/crypto.js`，严格按 `.NET 兼容 DES：CBC + PKCS7；明文/Key/IV UTF-16LE；Base64 输出` 规则解密。
- `src/js/api.js` 启动时校验 Token 配置格式并解密；所有 GitHub API 请求继续统一通过 `githubHeaders()` 使用解密后的内存 Token。
- 明文 `github.token: "..."` 格式会被明确拒绝，防止后续误提交 PAT 明文。
- v0.9.4 当时曾把连接缓存从 `syncSpend.githubConfig.v1` 升级为 `syncSpend.githubConfig.v2` 并只缓存密文；**v0.9.5 已彻底移除此连接缓存与离线回退。**
- 设置页只显示“已加密配置 / 仅内存解密”和算法信息，不显示真实 Token。
- 新增 3 项 DES 回归测试，并验证当前 release 配置可以解密成 PAT 格式但源码中不包含 PAT 明文；总测试数 23。
- PWA App Shell 缓存升级为 `sync-spend-shell-v094`，并把 `src/js/crypto.js` 纳入 App Shell。

## 11. v0.9.3 更新

- 修复 Frankfurter v2 汇率请求失败：旧代码为防缓存追加了未定义的 `_ts` query 参数，而 Frankfurter v2 使用严格参数校验，未知参数会直接返回 HTTP 422。
- Frankfurter 请求现在只发送业务配置定义的 `base` / `quotes` 等合法参数；禁用缓存只使用浏览器 `fetch(..., { cache: "no-store" })`，不再污染 API query string。
- API 非 2xx 时读取并提取响应体中的 `message` / `error`，页面可显示 `Frankfurter HTTP 422: ...` 等真实原因，不再只有笼统的 `api error`。
- 汇率卡在失败时显示具体错误信息；手动“刷新汇率”和新增记录弹窗的实时汇率刷新失败时不再错误提示“已更新”。
- 新增 2 项 Frankfurter 回归测试：校验请求 URL 不包含 `_ts`，并校验 HTTP 错误正文能被正确暴露；总测试数提升到 19。
- PWA App Shell 缓存升级为 `sync-spend-shell-v093`，确保已安装 PWA 不继续使用旧版 `api.js`。

## 12. v0.9.2 更新

- 修复历史 `data.json` 已存在重复 `record.id` 时，任何新增/编辑/删除都会被唯一性校验整体阻断的问题。
- 新增 `src/js/migration.js`：启动和缓存恢复时先在内存中修复重复/缺失 ledger、record ID；不删除历史记录，不改变业务金额、分摊、结算和时间字段。
- 对重复 ID 保留第一条原 ID，后续重复项使用确定性 `__repairN` 后缀，并避开所有已存在 ID；因此在尚未保存前反复刷新也不会不断生成新 ID。
- 被修复的 record 会追加 `history_id_repaired` 审计记录，保留旧 ID → 新 ID 的追踪信息。
- 修复不是启动即自动 PUT；用户下一次新增/编辑/删除时，与该业务操作在同一个 `data.json` GitHub PUT 中一起持久化，仍遵守 SHA 冲突保护和事务式 state 提交。
- 删除按钮因此可以准确命中已迁移后的具体 record；即使同一旧 ID 同时存在软删除历史和有效记录，也不会再因为 `find(id)` 歧义删错对象。
- 新建 ledger、expense、settlement 时又增加一层运行时 ID 占用检查，若候选 ID 已存在则重新生成，作为保存前唯一性校验之外的预防措施。
- API 的严格唯一性校验继续保留：迁移层负责兼容旧脏数据，API 校验负责阻止新脏数据写回，二者职责不混淆。
- 新增 4 项 migration 回归测试，并增加 1 项“旧重复数据迁移后可在同一次删除/保存中成功写入”的 API 集成测试；当前共 17 项测试。
- PWA App Shell 缓存升级为 `sync-spend-shell-v092`。

## 13. v0.9.1 更新

- 修复删除消费者会从所有账本 `participantIds` 中移除、进而改变历史分摊和余额的严重问题。
- 消费者删除改为引用感知：有历史引用时仅停用，无引用时才永久删除。
- 修复编辑账本参与人可能改变历史均摊结果：旧记录在变更参与人前固化分摊参与人快照。
- `calculator.js` 不再用账本当前参与人过滤历史 `splitParticipantIds`，并会把历史付款/分摊/结算引用人纳入余额计算。
- 消费记录与结算记录删除使用更明确的差异化确认文案；软删除新增 `deletedAt`，账本 `updatedAt` 同步更新。
- 数据和配置写入改为事务式 commit：先 clone、在副本上修改、GitHub PUT 成功后再替换 state，失败自动保持原状态。
- 初始远端同步未完成时，新增/编辑操作会先等待同步，避免基于缓存对象提交后被远端 bootstrap 覆盖。
- 增加写操作互斥，避免快速重复点击生成重复结算或并发保存。
- 生成结算前重新基于最新账本计算，并增加最终确认。
- 按金额分摊要求合计等于消费人民币金额，避免“付款额大于承担额但没有债务人”的不可结算状态。
- 消费金额必须大于 0。
- `todayInputValue()` 改用本地日期，避免美洲等时区在 UTC 跨日附近默认日期提前一天；移动端日期分组也改为读取 i18n 当前语言，不再引用不存在的 `state.lang`。
- GitHub 保存前新增 ledger / record / consumer ID 唯一性和货币代码唯一性校验。
- 增加 12 个 Node 内置测试：8 项覆盖分币均摊、历史参与人保留、legacy amount 分摊恢复、删除引用保护、软删除与结算等账务逻辑，4 项覆盖保存前唯一性校验、旧连接字段清理、SHA 写入和调用方对象不被修改。
- 清理未调用的 `renderSettlements`、`settleLedger`、`toCny`、`number2`、`downloadJson` 等废代码。
- Service Worker 只缓存同源 App Shell；GitHub / Frankfurter 等跨域请求直接走网络，避免带时间戳的 API URL 持续堆积无用 Cache Storage。
- localStorage full/lite/minimal 三级缓存全部失败时会正确标记 `cacheMode = "none"`。
- PWA App Shell 缓存升级为 `sync-spend-shell-v091`。

## 14. v0.9.0 更新

- 完全移除 Cloudflare Worker 集成和 `worker.js`。
- 删除 Wrangler 依赖及 Worker 部署脚本。
- 前端改为直接调用 GitHub REST API。
- release 分支的 `data/config.json` 改为 GitHub 连接配置。
- 删除无意义的 `APP_PASSWORD` 客户端兼容逻辑。
- Frankfurter 汇率请求移到浏览器端直接执行。
- 保留 GitHub SHA 乐观锁、大文件 raw 读取和原有错误码处理。
- 设置页改为显示 `GitHub Direct API` 连接信息。
- 清理业务配置里的遗留 Cloudflare 字段。
- PWA App Shell 缓存升级为 `sync-spend-shell-v090`。
