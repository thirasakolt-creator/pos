const STORAGE_BASE = "obs-bridge-api-base";
const STORAGE_TOKEN = "obs-bridge-token";

function bridgeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const bridge = params.get("bridge");
  const token = params.get("token");
  if (bridge) return { bridge: bridge.trim().replace(/\/+$/, ""), token: token || null };
  return null;
}

const apiInput = document.getElementById("apiBase");
const tokenInput = document.getElementById("apiToken");
const statusEl = document.getElementById("status");
const gridEl = document.getElementById("sceneGrid");
const btnTest = document.getElementById("btnTest");
const toastEl = document.getElementById("toast");

let bridgeOk = false;
let toastTimer = null;
let lastSceneKey = "";

function getApiBase() {
  const raw = (apiInput?.value || "http://127.0.0.1:8765").trim().replace(/\/+$/, "");
  return raw || "http://127.0.0.1:8765";
}

function getToken() {
  return (tokenInput?.value || "").trim();
}

function apiHeaders(json = false) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  const t = getToken();
  if (t) h["X-Bridge-Token"] = t;
  return h;
}

async function apiFetch(path, options = {}) {
  const base = getApiBase();
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...apiHeaders(options.body != null), ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
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
  }, 2400);
}

function sceneListKey(scenes) {
  return JSON.stringify((scenes || []).map((s) => s.name));
}

function formatState(state) {
  if (!state) return "";
  const s = String(state).toUpperCase();
  if (s.includes("PLAYING")) return "▶";
  if (s.includes("PAUSED")) return "⏸";
  if (s.includes("STOP")) return "⏹";
  return "";
}

function buildControls(scene) {
  const parts = [];
  const idx = scene.index;

  if (scene.audio) {
    const pct = Math.round((scene.audio.volume_mul ?? 1) * 100);
    parts.push(`
      <div class="ctrl-block" data-ctrl="audio">
        <span class="ctrl-label">เสียง</span>
        <input type="range" class="vol-slider" min="0" max="100" value="${pct}"
          aria-label="ระดับเสียงซีน ${idx}" />
        <span class="vol-val">${pct}%</span>
      </div>
    `);
  }

  if (scene.video) {
    const icon = formatState(scene.video.state);
    parts.push(`
      <div class="ctrl-block" data-ctrl="video">
        <span class="ctrl-label">วิดีโอ ${icon}</span>
        <div class="btn-row">
          <button type="button" class="btn-mini" data-action="media-toggle">เล่น/หยุด</button>
        </div>
      </div>
    `);
  }

  if (scene.slideshow) {
    parts.push(`
      <div class="ctrl-block" data-ctrl="slideshow">
        <span class="ctrl-label">สไลด์</span>
        <div class="btn-row">
          <button type="button" class="btn-mini" data-action="slide-prev">◀</button>
          <button type="button" class="btn-mini" data-action="slide-next">▶</button>
        </div>
      </div>
    `);
  }

  return parts.length ? `<div class="scene-controls">${parts.join("")}</div>` : "";
}

function bindCardEvents(cardEl, scene) {
  const idx = scene.index;

  cardEl.querySelector(".scene-switch")?.addEventListener("click", () => switchScene(idx));

  const slider = cardEl.querySelector(".vol-slider");
  if (slider) {
    const valEl = cardEl.querySelector(".vol-val");
    let debounce;
    slider.addEventListener("input", () => {
      if (valEl) valEl.textContent = `${slider.value}%`;
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          await apiFetch(`/scene/${idx}/volume`, {
            method: "POST",
            body: JSON.stringify({ mul: Number(slider.value) / 100 }),
          });
        } catch (e) {
          showToast(e.message, "err");
        }
      }, 120);
    });
  }

  cardEl.querySelector('[data-action="media-toggle"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await apiFetch(`/scene/${idx}/media/toggle`, { method: "POST" });
      showToast("วิดีโอ — สลับสถานะ", "ok");
      checkHealth();
    } catch (err) {
      showToast(err.message, "err");
    }
  });

  cardEl.querySelector('[data-action="slide-prev"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await apiFetch(`/scene/${idx}/slideshow/previous`, { method: "POST" });
      showToast("สไลด์ — ย้อนกลับ", "ok");
    } catch (err) {
      showToast(err.message, "err");
    }
  });

  cardEl.querySelector('[data-action="slide-next"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await apiFetch(`/scene/${idx}/slideshow/next`, { method: "POST" });
      showToast("สไลด์ — ถัดไป", "ok");
    } catch (err) {
      showToast(err.message, "err");
    }
  });
}

function renderScenes(scenes) {
  gridEl.innerHTML = "";
  if (!scenes?.length) {
    gridEl.innerHTML = '<p class="empty">ไม่มีซีนใน OBS</p>';
    return;
  }

  scenes.forEach((scene) => {
    const card = document.createElement("article");
    card.className = `scene-card${scene.is_current ? " active" : ""}`;
    card.dataset.index = String(scene.index);
    const short =
      scene.name.length > 14 ? `${scene.name.slice(0, 13)}…` : scene.name;
    card.innerHTML = `
      <button type="button" class="scene-switch">
        <span class="num">${scene.index}</span>
        <span class="name">${short}</span>
      </button>
      ${buildControls(scene)}
    `;
    bindCardEvents(card, scene);
    gridEl.appendChild(card);
  });
}

async function checkHealth() {
  try {
    const data = await apiFetch("/health");
    if (!data.ok) throw new Error("Bridge ไม่พร้อม");
    bridgeOk = true;

    const key = sceneListKey(data.scenes);
    if (key !== lastSceneKey) {
      lastSceneKey = key;
      renderScenes(data.scenes);
    } else {
      document.querySelectorAll(".scene-card").forEach((el) => {
        const idx = Number(el.dataset.index);
        const s = data.scenes.find((x) => x.index === idx);
        if (s) el.classList.toggle("active", s.is_current);
      });
    }

    const n = data.scene_count ?? data.scenes?.length ?? 0;
    const obsPart = data.obs_connected
      ? `OBS ✓ — ${n} ซีน`
      : "OBS ไม่เชื่อมต่อ";
    setStatus(`เชื่อมต่อแล้ว — ${obsPart}`, data.obs_connected ? "ok" : "err");
    return true;
  } catch (err) {
    bridgeOk = false;
    lastSceneKey = "";
    gridEl.innerHTML = '<p class="empty">เชื่อมต่อไม่ได้</p>';
    setStatus(err.message?.includes("401") ? "Token ไม่ถูกต้อง" : "ไม่พบ Bridge", "err");
    return false;
  }
}

async function switchScene(index) {
  const card = gridEl.querySelector(`[data-index="${index}"]`);
  card?.classList.add("sending");
  try {
    const data = await apiFetch(`/scene/${index}/switch`, { method: "POST" });
    showToast(`สลับ → ${data.scene}`, "ok");
    await checkHealth();
  } catch (err) {
    showToast(err.message, "err");
  } finally {
    card?.classList.remove("sending");
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_BASE, getApiBase());
  localStorage.setItem(STORAGE_TOKEN, getToken());
}

apiInput?.addEventListener("change", () => {
  saveSettings();
  checkHealth();
});
tokenInput?.addEventListener("change", () => {
  saveSettings();
  checkHealth();
});

btnTest?.addEventListener("click", async () => {
  saveSettings();
  const ok = await checkHealth();
  showToast(ok ? "เชื่อมต่อสำเร็จ" : "เชื่อมต่อไม่ได้", ok ? "ok" : "err");
});

const fromQuery = bridgeFromQuery();
const savedBase = localStorage.getItem(STORAGE_BASE);
const savedToken = localStorage.getItem(STORAGE_TOKEN);
if (fromQuery?.bridge) {
  apiInput.value = fromQuery.bridge;
  if (fromQuery.token) tokenInput.value = fromQuery.token;
  saveSettings();
} else {
  if (savedBase) apiInput.value = savedBase;
  if (savedToken) tokenInput.value = savedToken;
}

checkHealth();
setInterval(checkHealth, 5000);
