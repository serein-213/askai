"use strict";

const PROXY = "http://127.0.0.1:8787";
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

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
  setStatus("读取中…", false);
  try {
    const response = await fetch(`${PROXY}/v1/settings`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    fill(await response.json());
    setStatus("", false);
  } catch (_error) {
    setStatus("连不上本地代理，请确认 askai.service 已启动", true);
  }
}

async function save(event) {
  event.preventDefault();
  let requestOptions;
  try {
    requestOptions = JSON.parse($("request_options").value || "{}");
  } catch (_error) {
    setStatus("request_options 不是合法 JSON", true);
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
  setStatus("保存中…", false);
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
    setStatus("已保存，立即生效", false);
  } catch (error) {
    setStatus(String((error && error.message) || error), true);
  } finally {
    button.disabled = false;
  }
}

$("form").addEventListener("submit", save);
load();
