"use strict";

const browser = globalThis.browser ?? globalThis.chrome;

const PROXY = "http://127.0.0.1:8787";
const PROVIDERS = {
  deepseek: { base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { base: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat" },
};
const DEFAULT_PROMPT =
  "你是浏览器划词助手。用户会发来网页里选中的一段文本。" +
  "请直接、简洁地解答：是问题就回答，是概念就解释，是外文就译成中文，是代码就说明用途和关键点。" +
  "不要复述原文，不要客套。";

const t = (key, substitutions) => {
  try {
    return browser.i18n.getMessage(key, substitutions) || key;
  } catch (_error) {
    return key;
  }
};

// One port per open panel. The page only ever talks to this background page.
// In proxy mode this background only talks to 127.0.0.1:8787; in direct mode
// it talks to the selected provider and keeps the key in extension storage.
browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "open-options") {
    browser.runtime.openOptionsPage();
    return;
  }
  if (message.type === "open-url" && typeof message.url === "string") {
    try {
      const url = new URL(message.url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        browser.tabs.create({ url: url.href });
      }
    } catch (_error) {
      // Ignore malformed URLs.
    }
  }
});

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

    let mode = "proxy";
    try {
      const stored = await browser.storage.local.get(["mode", "direct"]).catch(() => ({}));
      mode = stored.mode === "direct" ? "direct" : "proxy";
      if (mode === "direct") {
        await runDirect(stored.direct || {}, message, signal, post);
      } else {
        await runProxy(message, signal, post);
      }
      post({ type: "done" });
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      post({ type: "error", message: friendlyError(error, mode) });
    }
  });
});

async function runProxy(message, signal, post) {
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
    throw new Error(detail || t("errHttp", [String(response.status)]));
  }
  if (!response.body) {
    throw new Error(t("errNoStream"));
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
          throw new Error(String(event.message || t("errUpstream")));
        } else if (event.type === "done") {
          return;
        }
      }
    }
  }
}

async function runDirect(cfg, message, signal, post) {
  const provider = PROVIDERS[cfg.provider];
  if (!provider) {
    throw new Error(t("errDirectConfig"));
  }
  const selection = String(message.selection || "").trim();
  if (!selection) {
    throw new Error(t("errEmptySelection"));
  }
  const key = String(cfg.api_key || "").trim();
  if (!key) {
    throw new Error(t("statusNeedKey"));
  }
  const model = String(cfg.model || provider.model).trim();
  if (!model) {
    throw new Error(t("statusNeedModel"));
  }

  const limit = Math.max(200, Number(cfg.max_selection_chars) || 8000);
  const payload = Object.assign(
    {},
    cfg.request_options && typeof cfg.request_options === "object" && !Array.isArray(cfg.request_options)
      ? cfg.request_options
      : {}
  );
  payload.model = model;
  payload.messages = [
    { role: "system", content: String(cfg.system_prompt || DEFAULT_PROMPT) },
    { role: "user", content: `选中文本：\n<<<\n${selection.slice(0, limit)}\n>>>` },
  ];
  payload.stream = true;
  if (typeof cfg.reasoning_effort === "string" && cfg.reasoning_effort.trim()) {
    payload.reasoning_effort = cfg.reasoning_effort.trim();
  }
  if (typeof cfg.temperature === "number" && Number.isFinite(cfg.temperature)) {
    payload.temperature = cfg.temperature;
  }
  if (typeof cfg.max_tokens === "number" && Number.isFinite(cfg.max_tokens)) {
    payload.max_tokens = cfg.max_tokens;
  }

  const headers = { "Content-Type": "application/json" };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  const response = await fetch(`${provider.base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body && body.error ? (body.error.message || body.error) : body.message || "";
    } catch (_error) {
      detail = "";
    }
    throw new Error(redact(String(detail || t("errHttp", [String(response.status)])), key));
  }
  if (!response.body) {
    throw new Error(t("errNoStream"));
  }

  post({ type: "meta", model });

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
        if (raw === "[DONE]") {
          return;
        }
        let event;
        try {
          event = JSON.parse(raw);
        } catch (_error) {
          continue;
        }
        if (event.error) {
          const detail = event.error.message || event.error;
          throw new Error(redact(String(detail || t("errUpstream")), key));
        }
        const text = event.choices && event.choices[0] && event.choices[0].delta
          ? event.choices[0].delta.content
          : undefined;
        if (typeof text === "string" && text) {
          post({ type: "delta", text });
        }
      }
    }
  }
}

function redact(text, key) {
  const value = String(text);
  return key ? value.split(key).join("***") : value;
}

function friendlyError(error, mode) {
  const message = error && error.message ? String(error.message) : t("requestFailed");
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
    return t(mode === "direct" ? "errProviderDown" : "errProxyDown");
  }
  return message;
}
