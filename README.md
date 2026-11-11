# AskAI 划词

Firefox 扩展 + 本机代理：选中网页文字 → 点 **✦ AI**（或 `Alt+Shift+A`）→ 在选区旁流式显示答案。

无侧边栏、无历史、无账号、无遥测、不读取页面其他内容。**API Key 不进入浏览器**：只由本机代理读取，扩展唯一的网络目标是 `127.0.0.1:8787`。

## 结构

```
extension/   Firefox 扩展：manifest.json + background.js + content.js
proxy/       server.py（仅 Python 标准库）+ config.example.json
install.sh   生成 ~/.config/askai/config.json（0600）
```

## 安装

1. 配置代理：

```bash
cd ~/askai
./install.sh
$EDITOR ~/.config/askai/config.json     # 填入 upstream.api_key
```

`upstream` 兼容任意 OpenAI 格式接口：

| 服务 | base_url | model |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | 任意模型名 |
| Ollama 本地 | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` |

不想把 key 写进文件：`export ASKAI_API_KEY=sk-...`；也支持 `ASKAI_BASE_URL`、`ASKAI_MODEL` 覆盖。

2. 启动代理：

```bash
python3 ~/askai/proxy/server.py
# AskAI proxy: http://127.0.0.1:8787  model=deepseek-chat  upstream=https://api.deepseek.com/v1
```

3. 装扩展：Firefox 打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选 `~/askai/extension/manifest.json`。

## 使用

- 选中文字 → 点选区旁的 **✦ AI**，或按 `Alt+Shift+A`。
- `Esc` 关闭，`■` 停止，`⧉` 复制答案。
- 输入框/文本域里选中的文字同样可用。

## 思考深度

标准字段用 `reasoning_effort`（顶层下发）；各家私有参数用 `request_options` 原样合并进请求体。

```json
{
  "upstream": {
    "reasoning_effort": "low",
    "request_options": {}
  }
}
```

| 服务 | 配置 |
| --- | --- |
| OpenAI 推理模型 | `"reasoning_effort": "minimal" / "low" / "medium" / "high"` |
| DeepSeek（chat completions） | `"reasoning_effort": "low" / "high" / "max"`；关闭思考：`"request_options": {"thinking": {"type": "disabled"}}` |
| OpenRouter | `"request_options": {"reasoning": {"effort": "high"}}`，或直接 `"reasoning_effort": "high"` |
| Qwen / DashScope | `"request_options": {"enable_thinking": true, "thinking_budget": 4096}` |
| Ollama | `"reasoning_effort": "low"`（本地模型支持时） |

- 不写或写 `null` 就使用模型默认值。
- 思考 token 也计入 `max_tokens`；开深度思考时把 `max_tokens` 调大（如 `4096`），否则可能只剩思考、没有答案。
- `request_options` 覆盖不了 `model` / `messages` / `stream`，这三项始终由代理控制。
- 思考过程不显示在面板里（只显示最终答案），面板在思考期间保持「生成中…」。
- 改完配置需重启代理。

配置示例见 `proxy/config.example.json`。`request_options` 里可放任意 OpenAI 兼容字段，例如 `verbosity`、`top_p`。

## 常驻运行（systemd user）

```ini
# ~/.config/systemd/user/askai.service
[Unit]
Description=AskAI local proxy
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 %h/askai/proxy/server.py
Environment=ASKAI_API_KEY=sk-...
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now askai
```

key 也可以放进 `~/.config/askai/env`（0600），用 `EnvironmentFile=%h/.config/askai/env` 加载。

## Key 安全设计

- key 只在 `~/.config/askai/config.json`（0600）或环境变量里；扩展源码、扩展存储、页面 DOM 中都没有 key。
- 代理只绑 `127.0.0.1`，并拒绝：非 `127.0.0.1:8787` / `localhost:8787` 的 Host（防 DNS rebinding）、非扩展来源的 `Origin`、非 `application/json` 的请求。
- 不返回任何 CORS 头：网页读不到响应，也发不出 JSON 跨域 POST。
- 上游错误回传前对 key 脱敏；不记录请求体、请求头。
- 扩展只声明 `http://127.0.0.1:8787/*` 一个 host permission；无远程代码、无 `eval`、无 `innerHTML`；答案按纯文本 + 代码块渲染，模型输出无法注入 HTML/脚本。
- manifest 如实声明 `websiteContent`：只有你选中的那段文本会发给你自己配置的接口，不做其他采集。

威胁模型：同机同用户的其他进程可以读配置、也可以调用代理——它们本来就能读你的文件，属于同一权限边界，不在防护范围内。

## 限制

- 仅桌面 Firefox 142+；选区在 iframe 内不弹按钮（扩展只注入顶层文档）。
- 单次最多 8000 字符，超出截断（`max_selection_chars` 可调）。
- release 版 Firefox 重启后需重新「临时载入」。永久安装需签名：
  - 用 AMO 账号 `npx web-ext sign --channel unlisted` 上传并下载签名后的 xpi，或
  - 使用 Developer Edition / Nightly 并将 `xpinstall.signatures.required` 设为 `false`。
- 改端口需同时改 `proxy/server.py` 的 `PORT` 与 Host 白名单、`extension/manifest.json` 的 host permission、`background.js` 的 `PROXY`。

## 排查

| 现象 | 原因 |
| --- | --- |
| 「连不上本地代理」 | 代理没启动，或端口不是 8787 |
| 上游 401 | `upstream.api_key` 无效 |
| 请求被 403 | 调用方不是扩展（Origin/Host 校验） |
| 上游 404 | `base_url` 少了 `/v1`，或多了 `/chat/completions` |
