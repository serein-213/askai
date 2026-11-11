选中网页文字 → **✦ AI** → 流式答案。默认 API Key 只保存在本机代理；可选直连模式下 key 存在浏览器扩展存储。

## 1.3.0

- Windows 默认后端：单文件 `askai-proxy.exe`，`--set-key` 无回显录入，配置在 `%APPDATA%\askai\config.json`；GitHub Actions `windows-latest` 构建与健康检查。
- 新增可选直连模式：DeepSeek / OpenAI / OpenRouter；key 存在浏览器扩展存储，仅 background 使用。本机 Ollama 仍走代理模式。
- 新增 `storage` 权限与三家 API 的 host 权限；默认仍是本机代理。
- 实测：Chrome 157 下代理/直连、DeepSeek 401 错误路径、35 秒慢流、设置页与快捷键；Windows 代理由 CI 冒烟。

## 1.2.0

- 界面支持 9 种语言（en、zh_CN、zh_TW、de、es、fr、ja、ko、ru），跟随 Firefox UI 语言。
- 设置页、面板按钮/状态、错误提示全部走 `browser.i18n`；`manifest.json` 使用 `default_locale` 与 `__MSG_*__`。
- 功能与 1.1.0 相同。
- 新增 Chromium/Edge 构建：`./build-chromium.sh` → `dist/askai-1.2.0-chromium.zip`；共享 9 语言 UI 与本机代理。Chrome 157 实测划词流式、设置页、`Alt+Shift+A` 与 35 秒无 token 慢流均通过。

## 1.1.0

- 更换 add-on ID 为 `askai-selection@serein-213`，用于全新提交并选择 listed 渠道。

## 1.0.7

- 与 1.0.6 相同，用于 listed 渠道提交（版本号跨渠道唯一）。

## 1.0.6

- 面板支持常见 Markdown：标题、列表、引用、加粗/斜体/删除线、行内代码、链接；链接经后台在新标签打开。

## 1.0.5

- 新增设置页（面板 ⚙）：模型、思考深度、温度、max_tokens、系统提示词、request_options，保存即生效。

## 1.0.4

- 修复划词按钮、停止/复制/关闭按钮无法点击。

## 1.0.3

- 新增靛蓝对话框星芒图标。

## 1.0.2

- 更新面板样式。

## 安装

1. 下载本页的 `askai-1.0.0.xpi`（已由 addons.mozilla.org 签名）。
2. Firefox 打开 `about:addons` → 齿轮 →「从文件安装附加组件」→ 选择该 XPI。
3. 启动本机代理并写入 key：见 <https://github.com/serein-213/askai#安装>

扩展只访问 `127.0.0.1:8787`；没有代理时会提示连不上。

## 说明

- 这是自发布签名包，可自由分发。
