const STORAGE_KEY = "obs-bridge-api-base";
const DEFAULT_BASE = "http://127.0.0.1:8765";

function bridgeFromQuery() {
  const q = new URLSearchParams(window.location.search).get("bridge");
  if (!q) return null;
  return q.trim().replace(/\/+$/, "");
}

const apiInput = document.getElementById("apiBase");
const statusEl = document.getElementById("status");
const gridEl = document.getElementById("sceneGrid");
const btnTest = document.getElementById("btnTest");
const toastEl = document.getElementById("toast");

let bridgeOk = false;
let toastTimer = null;

function getApiBase() {
  const raw = (apiInput.value || DEFAULT_BASE).trim().replace(/\/+$/, "");
  return raw || DEFAULT_BASE;
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status${type ? ` ${type}` : ""}`;
}

function showToast(message, type = "") {
  toastEl.textContent = message;
  toastEl.className = `toast${type ? ` ${type}` : ""}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

function updateButtonsEnabled() {
  gridEl.querySelectorAll(".scene-btn").forEach((btn) => {
    btn.disabled = !bridgeOk;
  });
}

function applySceneLabels(scenes) {
  if (!scenes) return;
  Object.entries(scenes).forEach(([key, name]) => {
    const btn = gridEl.querySelector(`[data-key="${key}"]`);
    if (!btn) return;
    const label = btn.querySelector(".label");
    if (label && name) {
      const short = name.length > 12 ? `${name.slice(0, 11)}…` : name;
      label.textContent = short;
      btn.setAttribute("aria-label", `ซีน ${key}: ${name}`);
    }
  });
}

async function checkHealth() {
  const base = getApiBase();
  try {
    const res = await fetch(`${base}/health`, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error("Bridge ไม่พร้อม");
    bridgeOk = true;
    applySceneLabels(data.scenes);
    const obsPart = data.obs_connected
      ? `OBS ✓ (${data.mode})`
      : `OBS ไม่เชื่อมต่อ — เปิด WebSocket ใน OBS`;
    setStatus(`เชื่อมต่อแล้ว — ${obsPart}`, data.obs_connected ? "ok" : "err");
    updateButtonsEnabled();
    return true;
  } catch {
    bridgeOk = false;
    setStatus("ไม่พบ Bridge — รัน start-server.bat ก่อน", "err");
    updateButtonsEnabled();
    return false;
  }
}

async function triggerScene(key) {
  const base = getApiBase();
  const btn = gridEl.querySelector(`[data-key="${key}"]`);
  if (btn) btn.classList.add("sending");

  try {
    const res = await fetch(`${base}/trigger/${key}`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const msg = data.scene
      ? `สลับ → ${data.scene}`
      : `ส่ง ${data.sent || "ctrl+" + key}`;
    showToast(msg, "ok");
  } catch (err) {
    bridgeOk = false;
    updateButtonsEnabled();
    setStatus("การเชื่อมต่อขาด — ตรวจสอบ Bridge", "err");
    showToast(err.message || "ส่งคำสั่งไม่สำเร็จ", "err");
  } finally {
    if (btn) btn.classList.remove("sending");
  }
}

function buildGrid() {
  gridEl.innerHTML = "";
  for (let i = 1; i <= 9; i += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scene-btn";
    btn.dataset.key = String(i);
    btn.setAttribute("aria-label", `ซีน ${i} — Ctrl+${i}`);
    btn.innerHTML = `
      <span class="num">${i}</span>
      <span class="label">Ctrl+${i}</span>
    `;
    btn.addEventListener("click", () => triggerScene(i));
    gridEl.appendChild(btn);
  }
  updateButtonsEnabled();
}

apiInput.addEventListener("change", () => {
  localStorage.setItem(STORAGE_KEY, getApiBase());
  checkHealth();
});

btnTest.addEventListener("click", async () => {
  localStorage.setItem(STORAGE_KEY, getApiBase());
  const ok = await checkHealth();
  showToast(ok ? "เชื่อมต่อ Bridge สำเร็จ" : "เชื่อมต่อไม่ได้", ok ? "ok" : "err");
});

const fromQuery = bridgeFromQuery();
const saved = localStorage.getItem(STORAGE_KEY);
if (fromQuery) {
  apiInput.value = fromQuery;
  localStorage.setItem(STORAGE_KEY, fromQuery);
} else if (saved) {
  apiInput.value = saved;
}

buildGrid();
checkHealth();
setInterval(checkHealth, 8000);
