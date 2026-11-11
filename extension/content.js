"use strict";

(() => {
  if (window.top !== window || window.__askaiInjected) {
    return;
  }
  window.__askaiInjected = true;

  const MAX_SELECTION = 8000;
  const HOST_ID = "__askai_host";
  const SVG_NS = "http://www.w3.org/2000/svg";

  let host = null;
  let shadow = null;
  let pill = null;
  let panel = null;
  let bodyEl = null;
  let statusEl = null;
  let statusText = null;
  let modelEl = null;
  let stopBtn = null;
  let copyBtn = null;
  let caretEl = null;

  let port = null;
  let streaming = false;
  let answer = "";
  let lastSelection = null;
  let mouseDown = false;
  let selectionTimer = 0;
  let copyTimer = 0;
  let renderQueued = false;

  const CSS = `
:host {
  all: initial;
  --bg: #ffffff;
  --fg: #17181c;
  --muted: #6f7480;
  --border: #e4e6eb;
  --surface: #f5f6f8;
  --code-bg: #f4f5f8;
  --accent: #5457d6;
  --accent-soft: #eef0ff;
  --shadow: 0 16px 44px rgba(17, 24, 39, .18), 0 2px 8px rgba(17, 24, 39, .06);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #1c1e24;
    --fg: #e7e9ee;
    --muted: #98a0ad;
    --border: #2f333c;
    --surface: #252830;
    --code-bg: #15171c;
    --accent: #8b8cf8;
    --accent-soft: #272a3c;
    --shadow: 0 18px 48px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .4);
  }
}
.pill {
  position: fixed; display: none; align-items: center; gap: 5px; pointer-events: auto;
  height: 28px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--bg); color: var(--fg);
  font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans SC", "PingFang SC", sans-serif;
  letter-spacing: .02em; white-space: nowrap; cursor: pointer; user-select: none;
  box-shadow: 0 3px 14px rgba(17, 24, 39, .16);
  animation: pillIn .14s ease both;
  transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
}
.pill:hover { background: var(--surface); transform: translateY(-1px); box-shadow: 0 7px 20px rgba(17, 24, 39, .2); }
.pill:active { transform: translateY(0); }
.pill .spark { color: var(--accent); font-size: 13px; line-height: 1; }
.pill:focus-visible, .icon:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.panel {
  position: fixed; display: none; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 14px;
  box-shadow: var(--shadow);
  font: 13.5px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans SC", "PingFang SC", sans-serif;
  animation: panelIn .16s cubic-bezier(.2, .8, .2, 1) both;
}
.head {
  display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
  padding: 9px 9px 9px 11px; border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(127, 127, 127, .035), transparent);
}
.brand {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; flex: 0 0 auto; border-radius: 6px;
  background: var(--accent-soft); color: var(--accent); font-size: 12px; line-height: 1;
}
.title { font-size: 12px; font-weight: 650; letter-spacing: .02em; }
.model {
  max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--surface); color: var(--muted); font-size: 10.5px; line-height: 1.6;
}
.model:empty { display: none; }
.spacer { flex: 1 1 auto; }
.icons { display: flex; gap: 2px; flex: 0 0 auto; }
.icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px;
  background: transparent; color: var(--muted); cursor: pointer;
  transition: background .12s ease, color .12s ease, transform .1s ease;
}
.icon:hover { background: var(--surface); color: var(--fg); }
.icon:active { transform: scale(.94); }
.icon svg { display: block; width: 14px; height: 14px; }
.icon .checkicon { display: none; }
.icon.done { color: var(--accent); }
.icon.done .checkicon { display: block; }
.icon.done .copyicon { display: none; }
.body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: 12px 14px 13px; white-space: pre-wrap; overflow-wrap: anywhere;
  scrollbar-width: thin; scrollbar-color: var(--border) transparent;
}
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.body pre {
  margin: 10px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--code-bg); overflow-x: auto; white-space: pre;
  font: 12.5px/1.6 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  tab-size: 2;
}
.body code {
  padding: 1.5px 5px; border-radius: 5px; background: var(--code-bg);
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.body pre code { padding: 0; background: none; border-radius: 0; }
.caret {
  display: inline-block; width: 5px; height: 13px; margin-left: 2px;
  border-radius: 2px; background: var(--accent); vertical-align: -2px;
  animation: blink 1s steps(2, start) infinite;
}
.status {
  display: none; align-items: center; gap: 6px; flex: 0 0 auto;
  padding: 0 14px 10px; color: var(--muted);
  font: 11px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
}
.status.err { color: #d23b3b; }
.spinner {
  display: none; width: 10px; height: 10px; flex: 0 0 auto;
  border: 1.5px solid var(--border); border-top-color: var(--accent); border-radius: 50%;
  animation: spin .7s linear infinite;
}
.status.busy .spinner { display: inline-block; }
@keyframes pillIn { from { opacity: 0; transform: translateY(3px) scale(.96); } }
@keyframes panelIn { from { opacity: 0; transform: translateY(6px) scale(.985); } }
@keyframes blink { 50% { opacity: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .pill, .panel { animation: none; }
  .caret, .spinner { animation: none; }
  .pill, .icon { transition: none; }
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

  function icon(paths, className) {
    const node = document.createElementNS(SVG_NS, "svg");
    node.setAttribute("viewBox", "0 0 16 16");
    node.setAttribute("aria-hidden", "true");
    if (className) {
      node.setAttribute("class", className);
    }
    for (const spec of paths) {
      const shape = document.createElementNS(SVG_NS, "path");
      shape.setAttribute("d", spec.d);
      if (spec.fill) {
        shape.setAttribute("fill", "currentColor");
      } else {
        shape.setAttribute("fill", "none");
        shape.setAttribute("stroke", "currentColor");
        shape.setAttribute("stroke-width", "1.6");
        shape.setAttribute("stroke-linecap", "round");
        shape.setAttribute("stroke-linejoin", "round");
      }
      node.appendChild(shape);
    }
    return node;
  }

  const COPY_ICON = [
    { d: "M5.5 5.5V3.9c0-.8.6-1.4 1.4-1.4h5.2c.8 0 1.4.6 1.4 1.4v5.2c0 .8-.6 1.4-1.4 1.4H10.5" },
    { d: "M3.9 5.5h5.2c.8 0 1.4.6 1.4 1.4v5.2c0 .8-.6 1.4-1.4 1.4H3.9c-.8 0-1.4-.6-1.4-1.4V6.9c0-.8.6-1.4 1.4-1.4Z" },
  ];

  const SLIDERS_ICON = [
    { d: "M3 4.5h3.1M9.9 4.5H13M3 8h4.6M11.4 8H13M3 11.5h2.1M8.9 11.5H13" },
    { d: "M6.6 3.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z", fill: true },
    { d: "M9.4 6.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z", fill: true },
    { d: "M5.4 10.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z", fill: true },
  ];

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

    pill = el("button", "pill");
    pill.type = "button";
    pill.title = "询问 AI（Alt+Shift+A）";
    pill.append(el("span", "spark", "✦"), el("span", "label", "AI"));
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
    const brand = el("span", "brand", "✦");
    const title = el("span", "title", "AskAI");
    modelEl = el("span", "model");
    const spacer = el("span", "spacer");
    const icons = el("span", "icons");

    const settingsBtn = el("button", "icon");
    settingsBtn.type = "button";
    settingsBtn.title = "设置";
    settingsBtn.setAttribute("aria-label", "设置");
    settingsBtn.appendChild(icon(SLIDERS_ICON));
    settingsBtn.addEventListener("click", () => {
      try {
        browser.runtime.sendMessage({ type: "open-options" });
      } catch (_error) {
        // Background is not available.
      }
    });

    stopBtn = el("button", "icon");
    stopBtn.type = "button";
    stopBtn.title = "停止";
    stopBtn.setAttribute("aria-label", "停止");
    stopBtn.appendChild(
      icon([{ d: "M6 4.75h4A1.25 1.25 0 0 1 11.25 6v4A1.25 1.25 0 0 1 10 11.25H6A1.25 1.25 0 0 1 4.75 10V6A1.25 1.25 0 0 1 6 4.75Z", fill: true }])
    );
    stopBtn.addEventListener("click", stop);

    copyBtn = el("button", "icon");
    copyBtn.type = "button";
    copyBtn.title = "复制";
    copyBtn.setAttribute("aria-label", "复制");
    copyBtn.append(
      icon(COPY_ICON, "copyicon"),
      icon([{ d: "M3.5 8.5l3 3 6-6" }], "checkicon")
    );
    copyBtn.addEventListener("click", copyAnswer);

    const closeBtn = el("button", "icon");
    closeBtn.type = "button";
    closeBtn.title = "关闭";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.appendChild(icon([{ d: "M4.5 4.5l7 7M11.5 4.5l-7 7" }]));
    closeBtn.addEventListener("click", closePanel);

    icons.append(settingsBtn, stopBtn, copyBtn, closeBtn);
    head.append(brand, title, modelEl, spacer, icons);

    bodyEl = el("div", "body");
    caretEl = el("span", "caret");
    caretEl.setAttribute("aria-hidden", "true");

    statusEl = el("div", "status");
    statusEl.setAttribute("role", "status");
    statusText = el("span", "status-text");
    statusEl.append(el("span", "spinner"), statusText);

    panel.append(head, bodyEl, statusEl);
    shadow.appendChild(panel);

    document.documentElement.appendChild(host);
    return true;
  }

  // ------------------------------------------------------------------ panel
  function setStatus(text, isError, busy) {
    statusText.textContent = text || "";
    statusEl.className = "status" + (isError ? " err" : "") + (busy ? " busy" : "");
    statusEl.style.display = text ? "flex" : "none";
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
    copyBtn.classList.remove("done");
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
    bodyEl.scrollTop = 0;
    modelEl.textContent = "";
    streaming = true;
    stopBtn.style.display = "";
    copyBtn.style.display = "none";
    copyBtn.classList.remove("done");
    setStatus("正在生成", false, true);
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
      setStatus("连接中断", true, false);
      caretEl.remove();
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
      setStatus(String(event.message || "请求失败"), true, false);
      caretEl.remove();
    } else if (event.type === "done") {
      if (!streaming) {
        return;
      }
      streaming = false;
      finishButtons();
      setStatus("", false, false);
      caretEl.remove();
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
    setStatus("已停止", false, false);
    caretEl.remove();
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
    const stickToBottom =
      bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 32;
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
    if (streaming) {
      bodyEl.appendChild(caretEl);
    }
    if (stickToBottom) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
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
    if (copied) {
      copyBtn.classList.add("done");
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => copyBtn.classList.remove("done"), 1200);
    } else {
      setStatus("复制失败", true, false);
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
    pill.style.display = "inline-flex";
    const width = pill.offsetWidth || 58;
    const height = pill.offsetHeight || 28;
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
