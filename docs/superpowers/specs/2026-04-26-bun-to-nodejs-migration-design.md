# Bun API 迁移到 Node.js API 设计文档

## 背景

`swixter ui` 和 `swixter proxy` 命令在 Node.js 环境下运行时抛出 `ReferenceError: Bun is not defined`。

根因：server 和 proxy 代码使用了 Bun 特有的 API（`Bun.serve()`、`Bun.file()`、`ServerWebSocket`），但 swixter 作为 npm 包发布，运行时环境是 Node.js，Bun 全局对象不存在。

## 目标

- `swixter ui` 在 Node.js 18+ 环境下正常启动 Web UI server
- `swixter proxy start` 在 Node.js 18+ 环境下正常启动代理 server
- 构建产物不再依赖 Bun 运行时
- 删除不再需要的 bun-http-bridge 转换层

## 非目标

- 不改变 UI 功能或页面逻辑
- 不改变 proxy handler、router、forwarder 的核心逻辑（它们使用的是 Web API `Request`/`Response`/`fetch`，Node.js 18+ 原生支持）
- 不改变 API handlers、middleware、router 的接口（它们已经是 Node.js `IncomingMessage`/`ServerResponse` 风格）

## 改动清单

### 文件修改

| 文件 | 变更内容 |
|------|---------|
| `src/server/index.ts` | `Bun.serve()` → `http.createServer()`；WebSocket → `ws` 库的 `WebSocketServer`；静态文件 → `serveStaticFile(req, res)`；移除 `bun-http-bridge` 使用 |
| `src/server/bun-static.ts` | `Bun.file()` → `node:fs.readFile()`；函数签名从 `(request: Request, options) => Promise<Response>` 改为 `(req: IncomingMessage, res: ServerResponse, options) => Promise<void>` |
| `src/server/ws-manager.ts` | `ServerWebSocket` (Bun) → `WebSocket` (ws 库)；send/close 方法保持不变 |
| `src/proxy/server.ts` | `Bun.serve()` → `http.createServer()`；入口处增加 Node.js req → Web API Request 转换；Response 结果写回 `ServerResponse` |
| `package.json` | 添加 `"ws": "^8.18.0"` 依赖；构建脚本 `--target bun --standalone` → `--target node` |

### 文件删除

| 文件 | 删除原因 |
|------|---------|
| `src/server/bun-http-bridge.ts` | 不再需要。Node.js `http.createServer()` 直接产出 `IncomingMessage`/`ServerResponse`，router 可以直接消费，不需要从 Web API Request 转换 |

### 新增依赖

- **`ws`** (^8.18.0)：WebSocket 服务器实现，纯 JavaScript，无原生依赖，可被 `bun build --target node` 正确打包

## 架构变化

### Web UI Server

**Before：**
```
Bun.serve() ──Web API Request──┬──→ Bun WebSocket → wsManager
                               ├──→ bun-http-bridge ──Node req/res──→ router ──→ handlers
                               └──→ serveStaticRequest ──Web API Response
```

**After：**
```
http.createServer() ──Node req/res──┬──→ ws.WebSocketServer ──→ wsManager
                                    ├──→ router.handle(req, res) ──→ handlers
                                    └──→ serveStaticFile(req, res)
```

### Proxy Server

**Before：**
```
Bun.serve() ──Web API Request──→ ProxyHandler.handleRequest() ──→ Web API Response
```

**After：**
```
http.createServer() ──Node req/res──→ 轻量转换器 ──Web API Request──→ ProxyHandler.handleRequest()
                                                                         ↓
                                                                    Web API Response ──→ 写回 res
```

Proxy handler 内部使用 `Request`/`Response`/`fetch`/`URLPattern`，均为 Node.js 18+ 原生支持的 Web API，不需要改动。

## 关键实现细节

### 1. WebSocket 处理

使用 `ws` 库的 `WebSocketServer`，挂载到同一个 HTTP server 上：

```typescript
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  wsManager.addClient(ws);
  ws.on("close", () => wsManager.removeClient(ws));
});
```

`WsManager` 的 `clients` 集合类型从 `ServerWebSocket` 改为 `WebSocket`（来自 `ws` 库），`send()` / `close()` 调用保持不变。

### 2. 静态文件服务

从返回 `Response` 改为直接操作 `ServerResponse`：

```typescript
// 签名变化
- export async function serveStaticRequest(request: Request, options: StaticOptions): Promise<Response>
+ export async function serveStaticFile(req: IncomingMessage, res: ServerResponse, options: StaticOptions): Promise<void>

// 实现变化
- const file = Bun.file(filePath);
- return new Response(file, { headers: { "Content-Type": contentType } });
+ const content = await readFile(filePath);
+ res.setHeader("Content-Type", contentType);
+ res.statusCode = 200;
+ res.end(content);
```

### 3. Proxy Server 请求转换

Node.js `http.createServer()` 的 `req` 需要转成 Web API `Request`，供 `ProxyHandler.handleRequest()` 消费：

```typescript
function convertNodeReqToWebRequest(req: IncomingMessage, body: Buffer): Request {
  const url = `http://${req.headers.host}${req.url}`;
  return new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
    body: body.length > 0 ? body : undefined,
  });
}
```

`ProxyHandler.handleRequest()` 返回的 `Response` 需要写回 `ServerResponse`：

```typescript
res.statusCode = response.status;
response.headers.forEach((value, key) => {
  res.setHeader(key, value);
});

if (response.body) {
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
}
res.end();
```

### 4. 构建配置

```json
{
  "scripts": {
    "build": "bun run build:ui && bun build src/cli/index.ts --outdir dist/cli --target node",
    "build:cli": "bun build src/cli/index.ts --outdir dist/cli --target node"
  }
}
```

`--target node` 让 `bun build` 输出纯 Node.js 代码，不使用 Bun 特有 API，产物更小，npm 包更标准。

## 测试验证

- [ ] `bun run build` 成功构建
- [ ] `bun test` 全部通过
- [ ] `swixter ui` 在 Node.js 环境下正常启动，浏览器能打开页面
- [ ] `swixter proxy start` 在 Node.js 环境下正常启动，能接收请求
- [ ] WebSocket 连接正常，proxy 日志实时推送正常
