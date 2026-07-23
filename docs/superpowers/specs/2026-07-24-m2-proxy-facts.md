# M2 代理模块规格事实（TS 版提取，供 Rust 重写参考）

> 来源：`packages/cli/src/proxy/`、`cli/proxy.ts`、`utils/daemon.ts`、`constants/proxy.ts`。日期：2026-07-24。

## 端点（handler.ts:51-66，按注册顺序匹配，未匹配 404 纯文本）

| 路径 | 方法 | 处理 |
|---|---|---|
| `/v1/chat/completions` | POST | `forwardToProvider(req, "chat")` |
| `/v1/messages` | POST | `forwardToProvider(req, "anthropic")` |
| `/v1/responses` | POST | `forwardToProvider(req, "anthropic")`（inferClientFormat 识别为 openai_responses） |
| `/anthropic/*` | 任意 | `forwardToProvider(req, "anthropic")` |
| `/health` | GET | 本地应答，免鉴权：`{status:"ok",instanceId,groupName,timestamp,uptime}` |

鉴权：除 `/health` 外必须 `Authorization: Bearer swixter-local-proxy`（`SWIXTER_PROXY_AUTH_TOKEN`），失败 `401 {"error":"Invalid or missing proxy authentication"}`。

错误形状：无 group/profile `503 {"error":"No active group or profiles"}`；profile 找不到 `503`；body 读取失败 `400`；单 profile 上游异常 `502 {"error":msg}`；group 全失败返回最后一个上游失败响应，若无则 `503 {"error":"All providers failed","details":[...]}`；未捕获 `500` 纯文本。

## Forwarder（forwarder.ts）

- URL：`baseURL = (profile.baseURL || preset.baseURL).replace(/\/+$/,"")`；baseURL 以 `/v1` 结尾且 path 以 `/v1/` 开头则 path 去掉前 3 字符；`url = baseURL + path(+query)`。
- Header 剔除（大小写不敏感）：`authorization`、`x-api-key`、`content-length`、`host`。
- 凭据：`credential = profile.authToken || profile.apiKey || ""`；目标格式 anthropic_* → `x-api-key: <credential>`，其他 → `Authorization: Bearer <credential>`。
- 超时默认 3000000ms（50 分钟，长流式有意为之），AbortController，无重试。
- 流式检测：content-type 含 `text/event-stream` 或 `application/x-ndjson` → 流式透传。

## 熔断器（circuit-breaker.ts）

- `FAILURE_THRESHOLD=3`、`RECOVERY_TIMEOUT_MS=60000`；状态 closed/open/half_open，按 profileId 独立。
- closed：连续失败 ≥3 → open；60s 后 → half_open（放行）；half_open 失败 → 回 open 重计时；任意成功 → 完全复位。
- 计入熔断的判定：上游 `status>=500` 或 `==429`，或网络异常。非 2xx 都触发故障转移，但只有这些计入熔断。
- Rust：建议惰性时间戳（`last_open.elapsed()>60s` → half_open）+ DashMap/Mutex。

## Transform（transform/）

格式推断：
- client：含 `/v1/chat/completions`→openai_chat；`/v1/responses`→openai_responses；`/anthropic/`或`/v1/messages`→anthropic_messages；默认 anthropic_messages。
- target：`profile.apiFormat` → baseURL 路径（`/anthropic`→anthropic_messages、`/responses`→anthropic_responses、`/openai`→openai_chat）→ `preset.defaultApiFormat` → `preset.wire_api`（chat→openai_chat、responses→anthropic_messages，默认 openai_chat）。
- 已注册转换器仅 2 对：`anthropic_messages ↔ openai_chat`、`openai_responses ↔ openai_chat`。

### 请求 Anthropic Messages → OpenAI Chat（request/anthropic-to-openai-chat.ts）

- targetEndpoint `/v1/chat/completions`；`system`（字符串或 block 数组，text 用 `\n` 合并）→ 前置 system 消息。
- 透传 model/max_tokens/temperature/top_p/stream；`stop_sequences`→`stop`。
- 消息：text block→text part；image block→`{type:"image_url",image_url:{url:"data:<media_type>;base64,<data>"}}`（仅 base64）；assistant `tool_use`→`tool_calls:[{id,type:"function",function:{name,arguments:JSON.stringify(input)}}]`（无文本时 content=null）；user `tool_result`→拆多条 `{role:"tool",tool_call_id,content}`（非字符串则 JSON 序列化）。
- `tools`→`{type:"function",function:{name,description,parameters:input_schema}}`。
- `tool_choice`：any→required、none→none、auto→auto、`{type:"tool",name}`→`{type:"function",function:{name}}`。
- `thinking.budget_tokens`→`reasoning_effort`：≥32000 high、≥16000 medium、否则 low。

### 请求 OpenAI Responses → OpenAI Chat（request/openai-responses-to-openai-chat.ts）

- `instructions`→system；`input` 字符串→单条 user；数组逐项：message（developer→system，content 拍平文本）、function_call→assistant+tool_calls（id=call_id）、function_call_output→`{role:"tool",tool_call_id:call_id}`；其他丢弃。
- `flattenText`：input_text/output_text/text part 合并；单个 text part 塌缩为字符串；不支持的 part 类型**抛错**。
- `max_output_tokens`→`max_tokens`；透传 temperature/top_p/stream/parallel_tool_calls；`reasoning.effort`→`reasoning_effort`。
- 工具名过滤正则 `/^(?!.*__)[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`；缺 parameters 补 `{type:"object",properties:{}}`。
- `tool_choice`：字符串直通；`{type:"function",name}`→`{type:"function",function:{name}}`。

### 非流式响应 OpenAI Chat → Anthropic（response/openai-chat-to-anthropic.ts）

- 取 choices[0]（无则原样返回）；content 顺序：reasoning_content→thinking block → tool_calls→tool_use block（input=JSON.parse(arguments)）→ 文本→text block。
- usage：prompt_tokens→input_tokens、completion_tokens→output_tokens、cached_tokens→cache_read_input_tokens。
- 输出 `{id: openai.id||"msg_"+Date.now(), type:"message", role:"assistant", model, content, stop_reason, stop_sequence:null, usage}`。
- finish_reason：stop→end_turn、length→max_tokens、tool_calls/function_call→tool_use、content_filter→end_turn、其他直通、null→null。

### 非流式响应 OpenAI Chat → OpenAI Responses（response/openai-chat-to-openai-responses.ts）

- 文本→`{type:"message",id:"msg_0",status:"completed",content:[{type:"output_text",text,annotations:[]}]}`；tool_calls→`{type:"function_call",id:"fc_<i>",call_id,name,arguments,status:"completed"}`。
- id `resp_<chat.id>`；status：finish_reason=="length"→incomplete 否则 completed。
- usage：input/output/total（total 缺省=input+output）。

### SSE 基础设施（streaming/base.ts、utils.ts）

- 解析：按行取 `event:`/`data:`（冒号后剥一个可选空格），空行 flush；`data: [DONE]` 保留为哨兵；JSON 解析失败丢弃该事件。
- 序列化：`event: <name>\ndata: <json>\n\n`（无 event 名时仅 data 行）。
- 流式 UTF-8 decoder，跨 chunk 缓冲到 `\n\n` 边界，convertEvent 返回 null 丢弃/单事件/多事件。

### 流式 OpenAI Chat SSE → Anthropic SSE

1. 首个有 choices 的 chunk → `message_start`（骨架 id 取上游或 `msg_<ts>`，content:[]，usage 全 0）。
2. `delta.content` → 首次 `content_block_start`（text，index 递增）+ 每次 `content_block_delta`（text_delta）。
3. `delta.reasoning_content` → thinking block（thinking_delta）。
4. `delta.tool_calls`：按 OpenAI index 映射独立 block index；凑齐 id+name 才发 `content_block_start`（tool_use，input:{}）；arguments 增量发 `input_json_delta`（用 lastEmittedArgsLength 只发新增片段）。
5. `finish_reason`（仅一次）：先关所有未关 tool block，再关 text/thinking（content_block_stop）→ `message_delta`（stop_reason 映射同非流式，usage output_tokens:0）→ `message_stop`。
6. `[DONE]` 丢弃。

### 流式 OpenAI Chat SSE → OpenAI Responses SSE

- 首 chunk → `response.created`（id `resp_<chat.id>`，status in_progress，output:[]）。
- 文本：首次 `response.output_item.added`（message，id msg_0）+ `response.content_part.added`（output_text），此后 `response.output_text.delta`。**reasoning_content 刻意忽略**。
- 工具：按 index 建 ToolState（itemId `fc_<idx>`，callId 取 tc.id）；有 name 发 `response.output_item.added`（function_call，in_progress）；arguments 增量发 `response.function_call_arguments.delta`。
- finish_reason：文本发 output_text.done → content_part.done → output_item.done；每个已宣布工具发 function_call_arguments.done + output_item.done；最后 `response.completed`（完整 output[] + usage，usage 可从尾部 choices:[] 的 usage-only chunk 捕获）。

### model 改写（handler.ts:146-179）

transform 后、转发前：body.model 是 marker（`SWIXTER_CLAUDE_MODEL`/`_HAIKU_/_SONNET_/_OPUS_MODEL`）→ 按 models 配置解析（HAIKU→defaultHaikuModel||anthropicModel||model，主 marker→anthropicModel||model）；否则若 profile 有 general model（anthropicModel||model）→**强制覆盖** body.model；其余原样。JSON 解析失败 → 原样透传。

## Group 故障转移（handler.ts:306-480）

1. 单 profile 模式：非 2xx 原样返回，无转移。
2. group 模式：groupName 指定或 activeGroup；body 读一次复用。
3. 按 group.profiles 顺序：① 熔断 open 跳过；② profile 不存在跳过；③ 格式不同且无注册转换器跳过；④ transform 请求（失败回退原样透传）；⑤ model 改写；⑥ 转发。
4. 非 2xx →（5xx/429 则 recordFailure）记录并 continue；异常 → recordFailure + continue；2xx → recordSuccess，响应 transform（失败回退原始 body）并返回。
5. 全失败：返回最后一个上游失败响应；无响应则 503。

## Daemon / 实例管理

- 注册表 `<config目录>/proxy-instances.json`：`{instances: Record<instanceId, ProxyStatus>}`，启动写入（含 pid、startTime）；旧格式 proxy-runtime.json 一次性迁移。
- status：先清 stale（pid 不存活条目删除），进程内 map 优先，再查 registry。
- start：`--group/--profile/--port(15721)/--host(127.0.0.1)/--timeout(3000000)/--daemon`；daemon 时 spawn 自身 detached + 轮询 /health（10×100ms）；同端口已有实例则报错。
- stop：`proxy stop [instanceId=default]`。**现状限制**：对 daemon 进程只删 registry 条目，不真正 kill——Rust 版应按 registry 中 pid 发信号 kill（设计决策点）。
- run 模式：`proxy run [--group|--profile|--port] -- <coder>`，instanceId `run-<port>`，可复用已有实例端口；coder 退出即停。给 coder 的 env：claude → `ANTHROPIC_API_BASE=http://127.0.0.1:<port>` + `ANTHROPIC_AUTH_TOKEN=swixter-local-proxy`（删 ANTHROPIC_API_KEY）；qwen → `ANTHROPIC_API_BASE` + `ANTHROPIC_API_KEY=dummy`；codex → `OPENAI_API_BASE` + `OPENAI_API_KEY=dummy`。
- 日志：`<config目录>/proxy-<instanceId>.log`，JSONL，100MB 滚动单代 `.log.1`，字段 `{ts,level:info|warn|error|access,msg|method,path,status,durationMs,instanceId,...}`，写失败静默。

## Rust 要点

- 事件总线（emitInstanceStart/Stop/StatusUpdate/emitLog）属 UI 层，M2 可用 `tokio::sync::broadcast` 占位。
- reqwest 必须显式设置长超时（禁用默认）。
- 流式用 `bytes_stream()` 喂转换器；SSE 解析复刻容错规则。
