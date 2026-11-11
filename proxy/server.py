#!/usr/bin/env python3
"""AskAI local proxy.

Holds the upstream API key and streams answers to the AskAI Firefox extension.
The key never leaves this process: it is read from config/env, used only in the
upstream Authorization header, and redacted from every error message.

HTTP surface (localhost only):
    GET  /health   -> {"ok": true}
    POST /v1/ask   -> text/event-stream of {"type": "meta"|"delta"|"done"|"error", ...}

Security:
    * binds 127.0.0.1 only
    * rejects any request carrying a non-extension Origin header
    * requires Content-Type: application/json (blocks simple cross-site forms)
    * sends no CORS headers, so web pages cannot read responses
    * never logs request bodies, headers, or the key
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, NoReturn

HOST = "127.0.0.1"
PORT = 8787
MAX_BODY = 64 * 1024

CONFIG_PATH = Path(
    os.environ.get(
        "ASKAI_CONFIG",
        Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "askai" / "config.json",
    )
)

DEFAULT_PROMPT = (
    "你是浏览器划词助手。用户会发来网页里选中的一段文本。"
    "请直接、简洁地解答：是问题就回答，是概念就解释，是外文就译成中文，是代码就说明用途和关键点。"
    "不要复述原文，不要客套。"
)

SECRET_RE = re.compile(r"(?i)((?:api[_-]?key|authorization|bearer)\s*[:=]\s*)([^\s,;\"'}]+)")
SETTINGS_LOCK = threading.Lock()


def save_config(cfg: dict[str, Any]) -> None:
    directory = CONFIG_PATH.parent
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".config.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, CONFIG_PATH)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def die(message: str) -> NoReturn:
    print(f"askai: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.is_file():
        die(f"找不到配置文件：{CONFIG_PATH}\n先运行 ./install.sh 生成配置。")
    try:
        cfg = json.loads(CONFIG_PATH.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        die(f"配置读取失败：{exc}")
    if not isinstance(cfg, dict):
        die("配置必须是 JSON 对象")

    upstream = cfg.get("upstream")
    if not isinstance(upstream, dict):
        die("配置缺少 upstream 段")

    upstream["api_key"] = (os.environ.get("ASKAI_API_KEY") or upstream.get("api_key") or "").strip()
    upstream["base_url"] = (
        os.environ.get("ASKAI_BASE_URL") or upstream.get("base_url") or ""
    ).strip().rstrip("/")
    upstream["model"] = (os.environ.get("ASKAI_MODEL") or upstream.get("model") or "").strip()

    if not upstream["api_key"] or upstream["api_key"] == "PASTE_API_KEY_HERE":
        die("未设置 API Key：编辑配置里的 upstream.api_key，或设置环境变量 ASKAI_API_KEY")
    if not upstream["base_url"].startswith(("http://", "https://")):
        die("upstream.base_url 必须以 http:// 或 https:// 开头")
    if not upstream["model"]:
        die("upstream.model 不能为空")

    options = upstream.get("request_options")
    if options is not None and not isinstance(options, dict):
        die("upstream.request_options 必须是 JSON 对象")
    effort = upstream.get("reasoning_effort")
    if effort is not None and not isinstance(effort, str):
        die('upstream.reasoning_effort 必须是字符串，例如 "low"')

    try:
        mode = CONFIG_PATH.stat().st_mode & 0o777
    except OSError:
        mode = 0o600
    if mode & 0o077:
        print(f"askai: 警告：{CONFIG_PATH} 权限为 {mode:o}，建议 chmod 600", file=sys.stderr)

    cfg["system_prompt"] = str(cfg.get("system_prompt") or DEFAULT_PROMPT)
    cfg["max_selection_chars"] = max(200, int(cfg.get("max_selection_chars", 8000)))
    return cfg


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "askai"
    sys_version = ""
    cfg: dict[str, Any] = {}

    def log_message(self, *_args: Any) -> None:
        return

    # ---------------------------------------------------------------- helpers
    def _json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _host_allowed(self) -> bool:
        # Reject DNS-rebinding style requests: only the loopback names we bind.
        host = (self.headers.get("Host") or "").lower()
        return host in {"127.0.0.1:8787", "localhost:8787"}

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        return origin.startswith(("moz-extension://", "chrome-extension://"))

    def _redact(self, text: str) -> str:
        key = str(self.cfg["upstream"].get("api_key") or "")
        if key:
            text = text.replace(key, "***")
        return SECRET_RE.sub(r"\1***", text)

    def _settings(self) -> dict[str, Any]:
        upstream = self.cfg["upstream"]
        return {
            "model": upstream.get("model"),
            "reasoning_effort": upstream.get("reasoning_effort"),
            "temperature": upstream.get("temperature"),
            "max_tokens": upstream.get("max_tokens"),
            "request_options": upstream.get("request_options") or {},
            "system_prompt": self.cfg.get("system_prompt"),
            "max_selection_chars": self.cfg.get("max_selection_chars"),
            "readonly": ["api_key", "base_url", "extra_headers"],
        }

    def _apply_settings(self, body: Any) -> None:
        if not isinstance(body, dict):
            self._json(400, {"error": "body must be a JSON object"})
            return
        with SETTINGS_LOCK:
            try:
                disk = json.loads(CONFIG_PATH.read_text("utf-8"))
            except (OSError, ValueError) as exc:
                self._json(500, {"error": f"读取配置失败：{exc}"})
                return
            if not isinstance(disk, dict):
                self._json(500, {"error": "配置格式错误"})
                return
            upstream = disk.setdefault("upstream", {})
            try:
                for key, value in body.items():
                    if key == "system_prompt":
                        if not isinstance(value, str) or not value.strip():
                            raise ValueError("system_prompt 不能为空")
                        if len(value) > 8000:
                            raise ValueError("system_prompt 过长（上限 8000 字符）")
                        disk["system_prompt"] = value.strip()
                    elif key == "max_selection_chars":
                        if isinstance(value, bool):
                            raise ValueError("max_selection_chars 必须是整数")
                        count = int(value)
                        if not 200 <= count <= 50000:
                            raise ValueError("max_selection_chars 需在 200–50000 之间")
                        disk["max_selection_chars"] = count
                    elif key == "model":
                        if not isinstance(value, str) or not value.strip():
                            raise ValueError("model 不能为空")
                        upstream["model"] = value.strip()
                    elif key == "reasoning_effort":
                        if value in (None, ""):
                            upstream["reasoning_effort"] = None
                        elif isinstance(value, str) and len(value) <= 32:
                            upstream["reasoning_effort"] = value.strip() or None
                        else:
                            raise ValueError("reasoning_effort 必须是字符串或 null")
                    elif key == "temperature":
                        if value is None:
                            upstream["temperature"] = None
                        else:
                            if isinstance(value, bool):
                                raise ValueError("temperature 必须是数字或 null")
                            number = float(value)
                            if not 0 <= number <= 2:
                                raise ValueError("temperature 需在 0–2 之间")
                            upstream["temperature"] = number
                    elif key == "max_tokens":
                        if value in (None, ""):
                            upstream["max_tokens"] = None
                        else:
                            if isinstance(value, bool):
                                raise ValueError("max_tokens 必须是整数或 null")
                            count = int(value)
                            if not 1 <= count <= 32768:
                                raise ValueError("max_tokens 需在 1–32768 之间")
                            upstream["max_tokens"] = count
                    elif key == "request_options":
                        if not isinstance(value, dict):
                            raise ValueError("request_options 必须是 JSON 对象")
                        upstream["request_options"] = value
                    # api_key / base_url / extra_headers 不能通过此接口修改
            except (TypeError, ValueError) as exc:
                self._json(400, {"error": str(exc)})
                return
            try:
                save_config(disk)
                new_cfg = load_config()
            except SystemExit:
                self._json(500, {"error": "配置校验失败，未生效"})
                return
            type(self).cfg = new_cfg
        self._json(200, self._settings())

    # ---------------------------------------------------------------- routes
    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True})
        elif self.path == "/v1/settings":
            if not self._host_allowed():
                self._json(403, {"error": "forbidden host"})
                return
            if not self._origin_allowed():
                self._json(403, {"error": "forbidden origin"})
                return
            self._json(200, self._settings())
        else:
            self._json(404, {"error": "not found"})

    def do_PUT(self) -> None:
        if self.path != "/v1/settings":
            self._json(404, {"error": "not found"})
            return
        if not self._host_allowed():
            self._json(403, {"error": "forbidden host"})
            return
        if not self._origin_allowed():
            self._json(403, {"error": "forbidden origin"})
            return
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self._json(415, {"error": "content-type must be application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length <= 0:
            self._json(400, {"error": "empty body"})
            return
        if length > MAX_BODY:
            self._json(413, {"error": "body too large"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (OSError, ValueError):
            self._json(400, {"error": "invalid JSON"})
            return
        self._apply_settings(body)

    def do_OPTIONS(self) -> None:
        self._json(405, {"error": "method not allowed"})

    def do_POST(self) -> None:
        if self.path != "/v1/ask":
            self._json(404, {"error": "not found"})
            return
        if not self._host_allowed():
            self._json(403, {"error": "forbidden host"})
            return
        if not self._origin_allowed():
            self._json(403, {"error": "forbidden origin"})
            return

        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self._json(415, {"error": "content-type must be application/json"})
            return

        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length <= 0:
            self._json(400, {"error": "empty body"})
            return
        if length > MAX_BODY:
            self._json(413, {"error": "body too large"})
            return

        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (OSError, ValueError):
            self._json(400, {"error": "invalid JSON"})
            return

        selection = body.get("selection") if isinstance(body, dict) else None
        if not isinstance(selection, str) or not selection.strip():
            self._json(400, {"error": "selection is required"})
            return

        selection = selection.strip()[: int(self.cfg["max_selection_chars"])]
        messages = [
            {"role": "system", "content": str(self.cfg["system_prompt"])},
            {"role": "user", "content": f"选中文本：\n<<<\n{selection}\n>>>"},
        ]
        self._stream(messages)

    # ---------------------------------------------------------------- upstream
    def _stream(self, messages: list[dict[str, str]]) -> None:
        upstream_cfg = self.cfg["upstream"]
        payload: dict[str, Any] = {}
        options = upstream_cfg.get("request_options")
        if isinstance(options, dict):
            # Provider-specific knobs (thinking.type, reasoning.effort,
            # enable_thinking, thinking_budget, ...) pass through untouched.
            payload.update(options)
        # Core fields are authoritative: request_options cannot override them.
        payload["model"] = upstream_cfg["model"]
        payload["messages"] = messages
        payload["stream"] = True
        effort = upstream_cfg.get("reasoning_effort")
        if isinstance(effort, str) and effort.strip():
            payload["reasoning_effort"] = effort.strip()
        if upstream_cfg.get("temperature") is not None:
            payload["temperature"] = upstream_cfg["temperature"]
        if upstream_cfg.get("max_tokens"):
            payload["max_tokens"] = int(upstream_cfg["max_tokens"])

        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {upstream_cfg['api_key']}",
            "User-Agent": "askai-proxy/1.0",
        }
        extra = upstream_cfg.get("extra_headers")
        if isinstance(extra, dict):
            headers.update({str(k): str(v) for k, v in extra.items()})

        request = urllib.request.Request(
            f"{upstream_cfg['base_url']}/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            upstream = urllib.request.urlopen(
                request, timeout=int(upstream_cfg.get("timeout_seconds", 120))
            )
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read(4000).decode("utf-8", "replace")
            except OSError:
                pass
            message = self._redact(detail).strip() or f"上游返回 HTTP {exc.code}"
            self._json(exc.code, {"error": message[:2000]})
            return
        except (OSError, ValueError) as exc:
            self._json(502, {"error": f"连接上游失败：{type(exc).__name__}"})
            return

        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(event: dict[str, Any]) -> None:
            chunk = json.dumps(event, ensure_ascii=False).encode("utf-8")
            self.wfile.write(b"data: " + chunk + b"\n\n")
            self.wfile.flush()

        try:
            emit({"type": "meta", "model": upstream_cfg["model"]})
            with upstream:
                content_type = (upstream.headers.get("Content-Type") or "").lower()
                if "text/event-stream" not in content_type:
                    text = self._content_from_json(upstream.read(4_000_000))
                    if text is None:
                        raise ValueError("上游没有返回可用文本")
                    if text:
                        emit({"type": "delta", "text": text})
                else:
                    for raw in upstream:
                        line = raw.strip()
                        if not line.startswith(b"data:"):
                            continue
                        data = line[5:].strip()
                        if data == b"[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except ValueError:
                            continue
                        if isinstance(obj, dict) and obj.get("error"):
                            emit({"type": "error", "message": self._redact(str(obj["error"]))[:2000]})
                            break
                        text = self._content_from_obj(obj)
                        if text:
                            emit({"type": "delta", "text": text})
            emit({"type": "done"})
        except (BrokenPipeError, ConnectionResetError):
            return
        except (OSError, ValueError, urllib.error.URLError) as exc:
            try:
                emit({"type": "error", "message": self._redact(f"流中断：{exc}")[:2000]})
            except (BrokenPipeError, ConnectionResetError):
                return

    # ---------------------------------------------------------------- parsing
    @staticmethod
    def _content_from_obj(obj: Any) -> str | None:
        if not isinstance(obj, dict):
            return None
        choices = obj.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        choice = choices[0]
        if not isinstance(choice, dict):
            return None
        for holder in (choice.get("delta"), choice.get("message")):
            if not isinstance(holder, dict):
                continue
            content = holder.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = [
                    part["text"]
                    for part in content
                    if isinstance(part, dict) and isinstance(part.get("text"), str)
                ]
                return "".join(parts)
        return None

    def _content_from_json(self, data: bytes) -> str | None:
        try:
            obj = json.loads(data)
        except ValueError:
            return None
        if isinstance(obj, dict) and obj.get("error"):
            raise ValueError(self._redact(str(obj["error"])))
        return self._content_from_obj(obj)


def main() -> None:
    cfg = load_config()
    Handler.cfg = cfg
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        die(f"无法监听 {HOST}:{PORT}：{exc}")
    print(
        f"AskAI proxy: http://{HOST}:{PORT}  model={cfg['upstream']['model']}  "
        f"upstream={cfg['upstream']['base_url']}"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
