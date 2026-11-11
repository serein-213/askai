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
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const modeRadios = [...document.querySelectorAll('input[name="mode"]')];
const directBox = $("directBox");
const hintEl = $("hint");
const footEl = $("foot");

const t = (key) => {
  try {
    return browser.i18n.getMessage(key) || key;
  } catch (_error) {
    return key;
  }
};

function localize() {
  document.title = t("optionsTitle");
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const message = t(node.getAttribute("data-i18n"));
    if (message) {
      node.textContent = message;
    }
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    const message = t(node.getAttribute("data-i18n-placeholder"));
    if (message) {
      node.placeholder = message;
    }
  }
}

function setStatus(text, isError) {
  statusEl.textContent = text || "";
  statusEl.className = isError ? "err" : "";
}

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : "proxy";
}

function setMode(mode) {
  for (const radio of modeRadios) {
    radio.checked = radio.value === mode;
  }
}

function setModeUI() {
  const mode = currentMode();
  directBox.hidden = mode !== "direct";
  hintEl.textContent = t(mode === "direct" ? "directWarning" : "optionsHint");
  footEl.textContent = t(mode === "direct" ? "directFoot" : "optionsFoot");
}

function fillDirect(direct) {
  const provider = PROVIDERS[direct.provider] ? direct.provider : "deepseek";
  $("provider").value = provider;
  $("direct_key").value = direct.api_key || "";
  fill({
    model: direct.model || PROVIDERS[provider].model,
    reasoning_effort: direct.reasoning_effort ?? null,
    temperature: direct.temperature ?? 0.3,
    max_tokens: direct.max_tokens ?? 1200,
    system_prompt: direct.system_prompt || DEFAULT_PROMPT,
    request_options: direct.request_options || {},
  });
}

function fill(settings) {
  $("model").value = settings.model || "";
  $("effort").value = settings.reasoning_effort || "";
  $("temperature").value = settings.temperature ?? "";
  $("max_tokens").value = settings.max_tokens ?? "";
  $("system_prompt").value = settings.system_prompt || "";
  $("request_options").value = JSON.stringify(settings.request_options || {}, null, 2);
}

async function loadProxy() {
  setStatus(t("statusReading"), false);
  try {
    const response = await fetch(`${PROXY}/v1/settings`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    fill(await response.json());
    setStatus("", false);
  } catch (_error) {
    setStatus(t("statusProxyDown"), true);
  }
}

async function load() {
  const stored = await browser.storage.local.get(["mode", "direct"]).catch(() => ({}));
  const mode = stored.mode === "direct" ? "direct" : "proxy";
  setMode(mode);
  setModeUI();
  if (mode === "direct") {
    setStatus(t("statusReading"), false);
    fillDirect(stored.direct || {});
    setStatus("", false);
  } else {
    await loadProxy();
  }
}

async function save(event) {
  event.preventDefault();
  let requestOptions;
  try {
    requestOptions = JSON.parse($("request_options").value || "{}");
  } catch (_error) {
    setStatus(t("statusInvalidJson"), true);
    return;
  }
  if (!requestOptions || typeof requestOptions !== "object" || Array.isArray(requestOptions)) {
    setStatus(t("statusInvalidJson"), true);
    return;
  }

  const payload = {
    model: $("model").value.trim(),
    reasoning_effort: $("effort").value.trim() || null,
    temperature: $("temperature").value === "" ? null : Number($("temperature").value),
    max_tokens: $("max_tokens").value === "" ? null : Number($("max_tokens").value),
    system_prompt: $("system_prompt").value,
    request_options: requestOptions,
  };

  const button = $("save");
  button.disabled = true;
  setStatus(t("statusSaving"), false);
  try {
    if (currentMode() === "direct") {
      const provider = $("provider").value;
      const key = $("direct_key").value.trim();
      if (!key) {
        setStatus(t("statusNeedKey"), true);
        return;
      }
      if (!payload.model) {
        setStatus(t("statusNeedModel"), true);
        return;
      }
      await browser.storage.local.set({
        mode: "direct",
        direct: {
          provider,
          api_key: key,
          model: payload.model,
          reasoning_effort: payload.reasoning_effort,
          temperature: Number.isFinite(payload.temperature) ? payload.temperature : null,
          max_tokens: Number.isFinite(payload.max_tokens) ? payload.max_tokens : null,
          system_prompt: payload.system_prompt.trim() || DEFAULT_PROMPT,
          request_options: payload.request_options,
          max_selection_chars: 8000,
        },
      });
      setStatus(t("statusDirectSaved"), false);
      return;
    }

    const response = await fetch(`${PROXY}/v1/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await browser.storage.local.set({ mode: "proxy" });
    fill(data);
    setStatus(t("statusSaved"), false);
  } catch (error) {
    setStatus(String((error && error.message) || error), true);
  } finally {
    button.disabled = false;
  }
}

localize();
setModeUI();
for (const radio of modeRadios) {
  radio.addEventListener("change", async () => {
    setModeUI();
    if (currentMode() === "direct") {
      const stored = await browser.storage.local.get("direct").catch(() => ({}));
      fillDirect(stored.direct || {});
      setStatus("", false);
    } else {
      await loadProxy();
    }
  });
}
$("provider").addEventListener("change", () => {
  const provider = $("provider").value;
  if (!$("model").value.trim()) {
    $("model").value = PROVIDERS[provider].model;
  }
});
$("form").addEventListener("submit", save);
load();
