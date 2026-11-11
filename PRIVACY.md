# 隐私政策 / Privacy Policy

AskAI 划词（Firefox 扩展）不收集、不上传任何浏览数据。

## 数据流

- 只有当你选中文字并点击「✦ AI」或按 `Alt+Shift+A` 时，扩展才会把**你选中的那段文本**发送到你自己配置的本机代理（默认 `http://127.0.0.1:8787`）。
- 代理再把这段文本转发到你**自己配置的 AI 接口**（例如 DeepSeek、OpenAI、本地 Ollama），用于生成答案。
- 不读取页面其他内容，不记录历史，无账号，无遥测，无开发者服务器。

## 数据保存在哪里

- API Key 只保存在本机 `~/.config/askai/config.json`（权限 `0600`），不进入浏览器，也不发送给扩展。
- 扩展没有 `storage` 权限，不保存任何数据。
- 选中文本与答案只在当前页面的内存中短暂存在。

## 联系

GitHub Issues: <https://github.com/serein-213/askai/issues>
