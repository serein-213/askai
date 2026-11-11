"use strict";

(() => {
  if (window.top !== window || window.__askaiInjected) {
    return;
  }
  window.__askaiInjected = true;

  const MAX_SELECTION = 8000;
  const HOST_ID = "__askai_host";

  let host = null;
  let shadow = null;
  let pill = null;
  let panel = null;
  let bodyEl = null;
  let statusEl = null;
  let modelEl = null;
  let stopBtn = null;
  let copyBtn = null;

  let port = null;
  let streaming = false;
  let answer = "";
  let lastSelection = null;
  let mouseDown = false;
  let selectionTimer = 0;
  let statusTimer = 0;
  let renderQueued = false;

  const CSS = `
:host { all: initial; }
.pill {
  position: fixed; display: none; align-items: center; pointer-events: auto;
  height: 26px; padding: 0 9px; border-radius: 13px;
  border: 1px solid #cfcfcf; background: #fff; color: #1b1b1b;
  font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
  box-shadow: 0 2px 10px rgba(0,0,0,.18); cursor: pointer; user-select: none;
  letter-spacing: .02em; white-space: nowrap;
}
.pill:hover { background: #f4f4f4; }
.panel {
  position: fixed; display: none; flex-direction: column; pointer-events: auto;
  background: #fff; color: #111; border: 1px solid #d7d7d7; border-radius: 12px;
  box-shadow: 0 10px 36px rgba(0,0,0,.22); overflow: hidden;
  font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
}
.head {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  padding: 7px 8px 7px 12px; border-bottom: 1px solid #ececec;
}
.title { font-size: 12px; font-weight: 700; letter-spacing: .04em; }
.model {
  max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: #8a8a8a;
}
.spacer { flex: 1 1 auto; }
.icon {
  width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: #777; cursor: pointer;
  font: 13px/1 ui-sans-serif, system-ui, sans-serif;
}
.icon:hover { background: #f0f0f0; color: #222; }
.body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 13px;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.body pre {
  margin: 8px 0; padding: 9px 10px; border: 1px solid #e6e6e6; border-radius: 8px;
  background: #f6f6f6; overflow-x: auto; white-space: pre;
}
.body code {
  padding: 1px 4px; border-radius: 4px; background: #f2f2f2;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.body pre code { padding: 0; background: none; }
.status {
  display: none; flex: 0 0 auto; padding: 0 13px 8px; color: #8a8a8a;
  font: 11px/1.5 ui-sans-serif, system-ui, sans-serif;
}
.status.err { color: #c0392b; }
@media (prefers-color-scheme: dark) {
  .pill { border-color: #3a3a3a; background: #2b2b2b; color: #f0f0f0; }
  .pill:hover { background: #383838; }
  .panel { border-color: #3a3a3a; background: #1f1f1f; color: #ececec; }
  .head { border-bottom-color: #333; }
  .model { color: #9b9b9b; }
  .icon { color: #9b9b9b; }
  .icon:hover { background: #333; color: #fff; }
  .body pre { border-color: #333; background: #171717; }
  .body code { background: #2c2c2c; }
  .status { color: #9b9b9b; }
  .status.err { color: #ff7b6b; }
}`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  function build() {
    if (document.getElementById(HOST_ID)) {
      return false;
    }
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    shadow = host.attachShadow({ mode: "open" });

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (_error) {
      const style = document.createElement("style");
      style.textContent = CSS;
      shadow.appendChild(style);
    }

    pill = el("button", "pill", "✦ AI");
    pill.type = "button";
    pill.title = "询问 AI（Alt+Shift+A）";
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (lastSelection) {
        ask(lastSelection.text, lastSelection.rect);
      }
    });
    shadow.appendChild(pill);

    panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "AskAI");

    const head = el("div", "head");
    const title = el("span", "title", "AI");
    modelEl = el("span", "model", "");
    const spacer = el("span", "spacer");
    stopBtn = el("button", "icon", "■");
    stopBtn.type = "button";
    stopBtn.title = "停止";
    stopBtn.setAttribute("aria-label", "停止");
    stopBtn.addEventListener("click", stop);
    copyBtn = el("button", "icon", "⧉");
    copyBtn.type = "button";
    copyBtn.title = "复制";
    copyBtn.setAttribute("aria-label", "复制");
    copyBtn.addEventListener("click", copyAnswer);
    const closeBtn = el("button", "icon", "✕");
    closeBtn.type = "button";
    closeBtn.title = "关闭";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.addEventListener("click", closePanel);
    head.append(title, modelEl, spacer, stopBtn, copyBtn, closeBtn);

    bodyEl = el("div", "body");
    statusEl = el("div", "status");
    panel.append(head, bodyEl, statusEl);
    shadow.appendChild(panel);

    document.documentElement.appendChild(host);
    return true;
  }

  // ------------------------------------------------------------------ panel
  function setStatus(text, isError) {
    statusEl.textContent = text || "";
    statusEl.className = isError ? "status err" : "status";
    statusEl.style.display = text ? "block" : "none";
  }

  function positionPanel(rect) {
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(400, vw - margin * 2);
    const below = vh - rect.bottom - margin;
    const above = rect.top - margin;
    const placeBelow = below >= 150 || below >= above;
    const maxHeight = Math.max(
      120,
      Math.min(Math.floor(vh * 0.6), (placeBelow ? below : above) - 8)
    );
    const left = Math.max(margin, Math.min(rect.left, vw - width - margin));
    const top = placeBelow
      ? Math.min(rect.bottom + 8, vh - maxHeight - margin)
      : Math.max(margin, rect.top - maxHeight - 8);
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${maxHeight}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function openPanel(rect) {
    positionPanel(rect);
    panel.style.display = "flex";
    hidePill();
  }

  function closePanel() {
    streaming = false;
    disconnectPort();
    panel.style.display = "none";
    bodyEl.textContent = "";
    statusEl.style.display = "none";
    copyBtn.style.display = "none";
    stopBtn.style.display = "";
    answer = "";
  }

  function hidePill() {
    if (pill) {
      pill.style.display = "none";
    }
  }

  // --------------------------------------------------------------- streaming
  function ask(text, rect) {
    const selection = String(text || "").trim().slice(0, MAX_SELECTION);
    if (!selection) {
      return;
    }
    hidePill();
    answer = "";
    bodyEl.textContent = "";
    modelEl.textContent = "";
    streaming = true;
    stopBtn.style.display = "";
    copyBtn.style.display = "none";
    setStatus("生成中…", false);
    openPanel(rect);
    connectAndAsk(selection);
  }

  function connectAndAsk(selection) {
    disconnectPort();
    port = browser.runtime.connect({ name: "ask" });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      if (!streaming) {
        return;
      }
      streaming = false;
      finishButtons();
      setStatus("连接中断", true);
    });
    port.postMessage({ type: "ask", selection });
  }

  function disconnectPort() {
    if (!port) {
      return;
    }
    try {
      port.disconnect();
    } catch (_error) {
      // Already gone.
    }
    port = null;
  }

  function onMessage(event) {
    if (!event || typeof event !== "object") {
      return;
    }
    if (event.type === "delta" && typeof event.text === "string") {
      answer += event.text;
      queueRender();
    } else if (event.type === "meta" && event.model) {
      modelEl.textContent = String(event.model);
    } else if (event.type === "error") {
      streaming = false;
      finishButtons();
      setStatus(String(event.message || "请求失败"), true);
    } else if (event.type === "done") {
      if (!streaming) {
        return;
      }
      streaming = false;
      finishButtons();
      setStatus("", false);
    }
  }

  function finishButtons() {
    stopBtn.style.display = "none";
    copyBtn.style.display = answer ? "" : "none";
  }

  function stop() {
    if (!streaming) {
      return;
    }
    streaming = false;
    disconnectPort();
    finishButtons();
    setStatus("已停止", false);
  }

  // ---------------------------------------------------------------- render
  function queueRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render(answer);
    });
  }

  function render(text) {
    bodyEl.textContent = "";
    const fence = /```[^\n]*\n([\s\S]*?)(?:```|$)/g;
    let last = 0;
    let match;
    while ((match = fence.exec(text))) {
      appendText(text.slice(last, match.index));
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = match[1].replace(/\n+$/, "");
      pre.appendChild(code);
      bodyEl.appendChild(pre);
      last = fence.lastIndex;
    }
    appendText(text.slice(last));
  }

  function appendText(chunk) {
    if (!chunk) {
      return;
    }
    const inline = /`([^`\n]+)`/g;
    let last = 0;
    let match;
    while ((match = inline.exec(chunk))) {
      addText(chunk.slice(last, match.index));
      const code = document.createElement("code");
      code.textContent = match[1];
      bodyEl.appendChild(code);
      last = inline.lastIndex;
    }
    addText(chunk.slice(last));
  }

  function addText(text) {
    if (text) {
      bodyEl.appendChild(document.createTextNode(text));
    }
  }

  async function copyAnswer() {
    if (!answer) {
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(answer);
      copied = true;
    } catch (_error) {
      copied = false;
    }
    if (!copied) {
      const area = document.createElement("textarea");
      area.value = answer;
      area.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch (_error) {
        copied = false;
      }
      area.remove();
    }
    clearTimeout(statusTimer);
    setStatus(copied ? "已复制" : "复制失败", !copied);
    if (copied) {
      statusTimer = setTimeout(() => {
        if (!streaming) {
          setStatus("", false);
        }
      }, 1200);
    }
  }

  // -------------------------------------------------------------- selection
  function selectionInfo() {
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "TEXTAREA" ||
        (active.tagName === "INPUT" && /^(text|search|url|email|tel)$/i.test(active.type)))
    ) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (typeof start === "number" && typeof end === "number" && end > start) {
        const text = active.value.slice(start, end).trim();
        if (text.length >= 2) {
          return { text, rect: active.getBoundingClientRect() };
        }
      }
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    const text = String(selection).trim();
    if (text.length < 2) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (host && range.intersectsNode(host)) {
      return null;
    }
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      return null;
    }
    return { text, rect };
  }

  function showPill(rect) {
    const margin = 6;
    const width = 52;
    const height = 26;
    let left = rect.right - 8;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }
    left = Math.max(margin, left);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - height - 6);
    }
    pill.style.left = `${left}px`;
    pill.style.top = `${top}px`;
    pill.style.display = "inline-flex";
  }

  function maybeShowPill() {
    if (panel && panel.style.display === "flex") {
      hidePill();
      return;
    }
    const info = selectionInfo();
    if (!info) {
      hidePill();
      return;
    }
    lastSelection = info;
    showPill(info.rect);
  }

  // ----------------------------------------------------------------- events
  function onMouseDown(event) {
    if (event.button !== 0) {
      return;
    }
    mouseDown = true;
    if (!event.composedPath().includes(host)) {
      hidePill();
    }
  }

  function onMouseUp(event) {
    if (event.button !== 0) {
      return;
    }
    mouseDown = false;
    if (event.composedPath().includes(host)) {
      return;
    }
    setTimeout(maybeShowPill, 0);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      if (panel && panel.style.display === "flex") {
        closePanel();
        event.preventDefault();
        event.stopPropagation();
      } else {
        hidePill();
      }
      return;
    }
    if (
      event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.code === "KeyA" || String(event.key).toLowerCase() === "a")
    ) {
      const info = selectionInfo();
      if (!info) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      ask(info.text, info.rect);
    }
  }

  function onSelectionChange() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      if (mouseDown || !document.hasFocus()) {
        return;
      }
      if (panel && panel.style.display === "flex") {
        return;
      }
      const info = selectionInfo();
      if (!info) {
        hidePill();
        return;
      }
      lastSelection = info;
      showPill(info.rect);
    }, 250);
  }

  function init() {
    if (!build()) {
      return;
    }
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange, true);
    window.addEventListener("scroll", hidePill, true);
    window.addEventListener("resize", hidePill, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
