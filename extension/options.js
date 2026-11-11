"use strict";

const browser = globalThis.browser ?? globalThis.chrome;

const PROXY = "http://127.0.0.1:8787";
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

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

function fill(settings) {
  $("model").value = settings.model || "";
  $("effort").value = settings.reasoning_effort || "";
  $("temperature").value = settings.temperature ?? "";
  $("max_tokens").value = settings.max_tokens ?? "";
  $("system_prompt").value = settings.system_prompt || "";
  $("request_options").value = JSON.stringify(settings.request_options || {}, null, 2);
}

async function load() {
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

async function save(event) {
  event.preventDefault();
  let requestOptions;
  try {
    requestOptions = JSON.parse($("request_options").value || "{}");
  } catch (_error) {
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
    const response = await fetch(`${PROXY}/v1/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    fill(data);
    setStatus(t("statusSaved"), false);
  } catch (error) {
    setStatus(String((error && error.message) || error), true);
  } finally {
    button.disabled = false;
  }
}

localize();
$("form").addEventListener("submit", save);
load();
