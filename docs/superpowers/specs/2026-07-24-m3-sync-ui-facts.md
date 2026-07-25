# M3 云同步 + 加密 + Web UI 规格事实（TS 版提取，供 Rust 重写参考）

> 来源：`packages/cli/src/{auth,sync,crypto,server}/`、`cli/{auth,sync,ui}.ts`、`utils/daemon.ts`。日期：2026-07-24。
> 云端 API base：`https://api.swixter.com`。

## 1. Crypto（E2E 加密）

- PBKDF2：`PBKDF2_ITERATIONS = 100_000`，salt 16 字节（base64 24 字符），SHA-256；password UTF-8 原始字节 → 派生 AES-GCM 256-bit key（必须可导出 raw 32 字节）。
- AES-256-GCM：IV 12 字节随机；密文布局 `base64( IV[12] || ciphertext || authTag[16] )`（tag 16 字节附尾部，WebCrypto 行为）；无版本号/AAD。
- 字段级加密：只加密 `apiKey`、`authToken`，其余明文上传。
- `auth.json`（`~/.config/swixter/auth.json`，权限 0o600，JSON 缩进 2）：
  ```json
  {
    "accessToken": "...", "refreshToken": "...", "expiresAt": "ISO8601",
    "encryptionSalt": "base64(16B)",
    "encryptionKey": "base64(32B raw key, 可选)",
    "authMethod": "password", "userId": "...", "email": "..."
  }
  ```
- 加密设置：登录/注册后提示设 master password（≥8）→ deriveKey → 可选保存 encryptionKey 供 auto-sync 免密；sync 命令无存储 key 时交互提示。

## 2. Auth HTTP API（auth/client.ts，错误体 `{code,message}`）

| 方法 | 端点 | 请求体 | 响应 |
|---|---|---|---|
| POST | `/api/auth/register/send-code` | `{email}` | `{success, expiresIn, code?}` |
| POST | `/api/auth/register/verify` | `{email, code, password, displayName?}` | AuthApiResponse |
| POST | `/api/auth/register`（legacy） | `{email, password, displayName?}` | AuthApiResponse |
| POST | `/api/auth/login` | `{email, password}` | AuthApiResponse |
| POST | `/api/auth/refresh` | `{refreshToken}` | `{accessToken, expiresAt}` |
| POST | `/api/auth/logout` | `{refreshToken}` | `{success}` |
| POST | `/api/auth/set-password` | `{password}` + Bearer | void |
| DELETE | `/api/auth/account` | Bearer | void |
| POST | `/api/auth/magic-link/send` | `{email}` | `{success, sessionId?, message?}` |
| POST | `/api/auth/magic-link/verify` | `{email, token}` | AuthApiResponse + hasPassword? |
| GET | `/api/auth/magic-link/session/{sessionId}` | — | `{status:"pending"|"completed", ...}` |

`AuthApiResponse = {accessToken, refreshToken, expiresAt, user:{id,email,displayName|null}, encryptionSalt}`。

Token 刷新：`now >= expiresAt - 5min` 视为过期；过期调 refresh 成功更新 auth.json；**刷新失败 → 清除 auth.json 并返回 null**。

Magic-link：轮询 2s × 最多 300 次；无 sessionId → 手动输 token；404 = session 过期。换账号登录时清 syncMeta 并提示 pull/push/skip。logout/delete-account 后 `clearSyncMeta()`。

## 3. Sync

API（均需 Bearer，错误 `SyncError{status,code,message}`）：

| 方法 | 端点 | 说明 |
|---|---|---|
| GET | `/api/sync/status` | → `{statuses:[{dataKey, dataVersion, updatedAt}]}` |
| POST | `/api/sync/push` | `{dataKey, encryptedData, dataVersion, clientTimestamp}` → `{success, dataVersion, updatedAt}`；版本冲突 **409 `{code:"CONFLICT"}`** |
| GET | `/api/sync/pull?dataKey=<key>` | → `{dataKey, encryptedData, dataVersion, clientTimestamp, updatedAt}`；无数据 **404** |
| DELETE | `/api/sync/data[?dataKey=]` | 删全部或单个 |

dataKey 仅 `"config"` 和 `"providers"`。

版本/冲突（sync/merge.ts）：`detectConflict`：local==remote 或任一方为 0 → 无冲突；双方非零且不等 → 冲突。push 的 dataVersion 发**远端当前版本**（无则 0），服务端乐观锁。

dirty 流转：任何配置变更 markDirty（syncMeta.dirty=true）；auto-sync push 成功写回 dirty:false；手动 sync push 写回 syncMeta 时**不带 dirty 字段**（即清除）。auto-sync push 触发条件：`dirty || !syncMeta || localVersion !== remoteVersion`。

Push 流程（手动）：GET status → detectConflict("config")（冲突且非 --force-local → 退出）→ 取加密 key → config 逐 profile `encryptSensitiveFields` → `{profileId: profile}` JSON push → providers 包 `{providers:[...]}` 加密 push → 写回 syncMeta（服务端版本号）；409 → 提示 --force-local。

Pull 流程（手动）：pull config（404 → 提示先 push）→ 冲突检查（非 --force-remote）→ 解密**覆盖写入**同名 profile（本地独有保留）→ pull providers（404 容忍）→ 覆盖 saveUserProviders。

Auto-sync：进程内开关（默认 false，enable/disable 无持久化）；需已登录且存有 encryptionKey 否则静默跳过；isSyncing 互斥；包装器 loadConfigWithSync（先 pull）/ saveConfigWithSync（先写再 push），sync 错误吞掉不阻塞。

## 4. Web UI Server

- `startServer(port?, {noBrowser?})`：host 127.0.0.1，默认 3141 起递增找可用端口；`/api/` 走 Router，其余静态 SPA；启动后自动开浏览器（daemon 跳过，`SWIXTER_UI_DAEMON=1` 抑制）。

### REST 端点

- **Profiles**：`GET /api/profiles`（apiKey/authToken 掩码：首4+星号(≤20)+尾4）；`GET/:name`（404 PROFILE_NOT_FOUND）；`POST`（需 name+providerId；未知 provider 400 UNKNOWN_PROVIDER；重名 409 PROFILE_EXISTS；201）；`PUT /:name`；`DELETE /:name`。
- **Providers**：`GET /api/providers`（presets+user 合并，附 isUser）；`POST`（需 id,name,displayName；重复 409）；`PUT/DELETE /:id` 仅用户 provider（否则 400 NOT_USER_PROVIDER）。
- **Coders**：`GET /api/coders`（含 activeProfile 摘要）；`GET/PUT /api/coders/:coder/active`；`POST /:coder/apply`（wire_api 兼容性检查，不兼容返回 `{success:false,warning:true}` 200）；`GET /:coder/verify`；未知 coder 404 UNKNOWN_CODER。
- **Config**：`GET /api/version` → `{appVersion, configVersion, exportVersion}`（daemon 健康检查用）；`GET /api/config`（ETag `"<mtime秒>-<size>"`，304）；`GET /api/config/export?sanitize=true`（Content-Disposition attachment）；`POST /api/config/import`（body `{config, overwrite?=true}`）；`POST /api/config/reset`。
- **Groups**：`GET /api/groups`（附 profileDetails）、`GET/:id`、`POST`（需 name，201）、`PUT/:id`、`DELETE/:id`、`PUT/:id/active`（广播 group.change）。
- **Proxy**：`GET /api/proxy/status`；`GET /api/proxy/instances`；`POST /api/proxy/start`（body `{host?,port?}`，instanceId 固定 "default"，type "service"，端口 15721 起递增）；`POST /api/proxy/stop`（body `{instanceId?}`）；`GET /api/proxy/logs?instanceId&lines=N`（N 默认 200 上限 1000，NDJSON 逐行解析，最新在前）。
- 错误格式统一：`{error:{code, message, details?}}`。

### WebSocket（路径 `/ws`，同 HTTP server）

- 纯服务端→客户端广播；连接即单发 snapshot：
  - `{type:"snapshot", instances, activeGroupId?, activeGroupName?}`
  - `{type:"log", instanceId, entry}` / `{type:"status", status}` / `{type:"instance.start", status}` / `{type:"instance.stop", instanceId}` / `{type:"group.change", groupId, groupName}`
- `ProxyStatus = {instanceId, type:"service"|"run", running, host, port, groupName?, activeGroup?, activeGroupName?, pid?, requestCount, errorCount, startTime?}`
- `ProxyLogEntry = {ts, level, msg, method?, path?, status?, durationMs?, error?, stack?}`

### 静态资源 / 中间件

- SPA 模式：未命中回退 index.html；MIME 表（html/js/mjs/css/json/png/jpg/gif/svg/ico/woff/woff2/ttf/webp/avif）。
- CORS：仅放行 `http://127.0.0.1:*` / `http://localhost:*`（回显 origin）；OPTIONS 204 + `Max-Age: 86400`。
- JSON body 仅 POST/PUT/PATCH 且 content-type json 时解析。

### UI 守护进程（cli/ui.ts、utils/daemon.ts）

- PID 文件 `~/.config/swixter/ui.pid` → `{pid, port, startTime}`；日志 `ui.log`。
- `--daemon`：已在运行（进程存活 + `GET /api/version` 3s 200）→ 直接开浏览器；否则 spawn 自身 detached（stdio → ui.log，env `SWIXTER_UI_DAEMON=1`）+ 立即写 PID + 200ms×50 轮询健康检查，超时 SIGTERM。
- `--stop`：读 PID → SIGTERM → 100ms×50 等待 → 仍存活 SIGKILL → 删 PID。

## Rust 重写注意

1. SyncMeta 以 `types.ts:163-170` 为准（含 dirty）。
2. `server/static.ts` 是死代码，实际用 bun-static.ts（内存版）。
3. 密文布局需逐字节兼容：aes-gcm crate `Aes256Gcm` + 96-bit nonce 直接对应。
4. auto-sync enable/disable 仅进程内语义。
5. Rust 技术选型：axum + tokio-tungstenite（WS）+ reqwest + rust-embed（静态）。

## 已知继承缺陷（TS 同款，暂未修）

1. **providers 明文上云**：sync push 时 profiles 的敏感字段（apiKey/authToken）有字段级加密，而 providers 的 headers/敏感字段是明文上传云端——TS 端继承下来的不一致，两侧需同修（本轮 Rust 重写保持行为对齐，未动）。
2. **master password 变更后旧数据解不开**：加密 key 由 password+salt PBKDF2 派生，改 master password 后云端已加密数据无法用新 key 解密（无重加密/密钥包裹机制）。
3. **export 默认明文导出**：`GET /api/config/export` 默认（不带 `?sanitize=true`）返回含明文 API key 的导出文件；本地 UI server 无鉴权，安全边界完全依赖 CORS 只放行 `http://127.0.0.1:*` / `http://localhost:*`（host 精确匹配）这道防线。
