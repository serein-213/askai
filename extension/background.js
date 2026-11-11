"use strict";

const PROXY = "http://127.0.0.1:8787";

// One port per open panel. The page only ever talks to this background page,
// which in turn only talks to 127.0.0.1:8787.
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "ask") {
    return;
  }

  let controller = null;

  port.onDisconnect.addListener(() => {
    if (controller) {
      controller.abort();
    }
  });

  port.onMessage.addListener(async (message) => {
    if (!message || message.type !== "ask") {
      return;
    }
    if (controller) {
      controller.abort();
    }
    controller = new AbortController();
    const signal = controller.signal;
    const post = (event) => {
      if (!signal.aborted) {
        try {
          port.postMessage(event);
        } catch (_error) {
          // Port went away; the abort below handles the request.
        }
      }
    };

    try {
      const response = await fetch(`${PROXY}/v1/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: String(message.selection || "") }),
        signal,
      });

      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.json();
          detail = body && body.error ? String(body.error) : "";
        } catch (_error) {
          detail = "";
        }
        throw new Error(detail || `本地代理返回 HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error("本地代理没有返回可流式读取的响应");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) {
              continue;
            }
            const raw = line.slice(5).trim();
            if (!raw) {
              continue;
            }
            let event;
            try {
              event = JSON.parse(raw);
            } catch (_error) {
              continue;
            }
            if (event.type === "delta" && typeof event.text === "string") {
              post({ type: "delta", text: event.text });
            } else if (event.type === "meta") {
              post({ type: "meta", model: String(event.model || "") });
            } else if (event.type === "error") {
              post({ type: "error", message: String(event.message || "上游错误") });
            } else if (event.type === "done") {
              post({ type: "done" });
            }
          }
        }
      }
      post({ type: "done" });
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      post({ type: "error", message: friendlyError(error) });
    }
  });
});

function friendlyError(error) {
  const message = error && error.message ? String(error.message) : "请求失败";
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
    return "连不上本地代理 127.0.0.1:8787，请先启动 proxy/server.py";
  }
  return message;
}
