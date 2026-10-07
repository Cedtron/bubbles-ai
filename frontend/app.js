// ==========================================================================
// Bubbles AI - Frontend Application Controller (Gmail Design & Desktop PWA)
// ==========================================================================

// Non-blocking toast replacement for window.alert (iframe safety)
window.alert = function(msg) {
  showToast(msg);
};

function showToast(msg) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 3500);
}

// Conversation State
let activeConvo = { sessionId: null, messages: [] };

const state = {
  sessions: [],
  tools: {},
  pendingAttachments: [],
  activitySince: 0,
  sessionSearch: "",
  theme: localStorage.getItem("bubbles_theme") || "light",
  accent: localStorage.getItem("bubbles_accent") || "#1a73e8",
  modelsList: [],
  deferredInstallPrompt: null,
};

// ------------------------------------------------------------------
// 1. Splash Loader Screen
// ------------------------------------------------------------------

function hideLoaderScreen() {
  const loader = document.getElementById("app-loader-screen");
  if (loader) {
    setTimeout(() => {
      loader.classList.add("fade-out");
      setTimeout(() => {
        loader.style.display = "none";
      }, 450);
    }, 700);
  }
}

document.getElementById("app-loader-screen")?.addEventListener("click", () => {
  const loader = document.getElementById("app-loader-screen");
  if (loader) {
    loader.classList.add("fade-out");
    setTimeout(() => { loader.style.display = "none"; }, 400);
  }
});

// ------------------------------------------------------------------
// 2. Theme & Accent Customization
// ------------------------------------------------------------------

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("bubbles_theme", theme);

  const iconSpan = document.getElementById("theme-btn-icon");
  if (iconSpan) {
    iconSpan.setAttribute("data-icon", theme === "dark" ? "sun" : "moon");
    renderIconPlaceholders();
  }

  document.querySelectorAll(".theme-card-option").forEach((card) => {
    card.classList.toggle("active", card.dataset.theme === theme);
  });
}

function adjustColor(hex, percent) {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return "#" + (
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 1 ? 0 : B) : 255)
  ).toString(16).slice(1);
}

function applyAccentColor(hex) {
  state.accent = hex;
  localStorage.setItem("bubbles_accent", hex);

  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--accent-hover", adjustColor(hex, -15));
  document.documentElement.style.setProperty("--accent-light", hex + "18");
  document.documentElement.style.setProperty("--accent-subtle", hex + "10");
  document.documentElement.style.setProperty("--accent-ring", hex + "40");

  const picker = document.getElementById("accent-color-picker");
  if (picker) picker.value = hex;
  const quickInput = document.getElementById("quick-color-input");
  if (quickInput) quickInput.value = hex;

  document.querySelectorAll(".swatch-circle").forEach((sw) => {
    sw.classList.toggle("active", (sw.dataset.color || "").toLowerCase() === hex.toLowerCase());
  });
}

function setupThemeAndAccent() {
  setTheme(state.theme);
  applyAccentColor(state.accent);

  document.getElementById("header-theme-btn").addEventListener("click", () => {
    setTheme(state.theme === "dark" ? "light" : "dark");
  });

  document.querySelectorAll(".theme-card-option").forEach((card) => {
    card.addEventListener("click", () => {
      setTheme(card.dataset.theme);
    });
  });

  const paletteBtn = document.getElementById("header-palette-btn");
  const paletteMenu = document.getElementById("palette-popover");
  paletteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    paletteMenu.classList.toggle("open");
    document.getElementById("profile-popover").classList.remove("open");
  });

  const avatarBtn = document.getElementById("header-avatar-btn");
  const profilePopover = document.getElementById("profile-popover");
  avatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    profilePopover.classList.toggle("open");
    paletteMenu.classList.remove("open");
  });

  document.addEventListener("click", (e) => {
    if (!paletteMenu.contains(e.target) && e.target !== paletteBtn) {
      paletteMenu.classList.remove("open");
    }
    if (!profilePopover.contains(e.target) && e.target !== avatarBtn) {
      profilePopover.classList.remove("open");
    }
  });

  document.querySelectorAll(".swatch-circle").forEach((sw) => {
    sw.addEventListener("click", () => {
      applyAccentColor(sw.dataset.color);
    });
  });

  const colorPicker = document.getElementById("accent-color-picker");
  const quickPicker = document.getElementById("quick-color-input");
  [colorPicker, quickPicker].forEach((inp) => {
    if (inp) {
      inp.addEventListener("input", (e) => applyAccentColor(e.target.value));
      inp.addEventListener("change", (e) => applyAccentColor(e.target.value));
    }
  });

  document.getElementById("accent-reset-btn").addEventListener("click", () => {
    applyAccentColor("#1a73e8");
  });

  document.getElementById("profile-settings-btn").addEventListener("click", () => {
    profilePopover.classList.remove("open");
    switchTab("settings");
  });

  document.getElementById("header-brain-chip").addEventListener("click", () => {
    switchTab("brain");
  });

  document.getElementById("brand-home-btn").addEventListener("click", () => {
    switchTab("chats");
  });
}

// ------------------------------------------------------------------
// 3. Navigation Tabs (Gmail Style)
// ------------------------------------------------------------------

const ALL_VIEWS = [
  "view-chat",
  "view-brain",
  "view-tools",
  "view-images",
  "view-code",
  "view-webview",
  "view-terminal",
  "view-desktop",
  "view-api",
  "view-settings",
];

function switchTab(tabName) {
  document.querySelectorAll(".nav-item-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });

  ALL_VIEWS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  let targetId = "view-" + (tabName === "chats" ? "chat" : tabName);
  const targetEl = document.getElementById(targetId);
  if (targetEl) {
    targetEl.style.display = (targetId === "view-chat" || targetId === "view-images" || targetId === "view-code" || targetId === "view-webview") ? "flex" : "block";
  }

  const chatPanel = document.getElementById("sidebar-chat-panel");
  if (chatPanel) {
    chatPanel.style.display = tabName === "chats" ? "flex" : "none";
  }
}

document.querySelectorAll(".nav-item-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
  });
});

document.getElementById("btn-sidebar-toggle").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("collapsed");
});

// ------------------------------------------------------------------
// 4. Markdown Rendering
// ------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderContent(text) {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<div class="code-block-wrapper"><div class="code-block-header"><span>${lang || "code"}</span><button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText); showToast('Code copied to clipboard!');">Copy</button></div><pre><code>${code.trim()}</code></pre></div>`;
  });
  escaped = escaped.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return escaped.split(/\n(?![^<]*<\/pre>)/).join("<br>");
}

// ------------------------------------------------------------------
// 5. Chat Rendering
// ------------------------------------------------------------------

function renderChat(thinking = false) {
  const container = document.getElementById("chat-messages");
  container.innerHTML = "";

  const messages = activeConvo.messages;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icon("brain", "icon-lg")}</div>
        <div class="empty-state-title">Bubbles AI Workspace</div>
        <div class="empty-state-subtitle">
          Powered by Google AI. Ask questions, build features, run code, edit files, execute commands, or manipulate images.
        </div>
        <div class="quick-prompts-row">
          <button class="prompt-chip" data-prompt="Help me debug a Python error">🐞 Debug Python Code</button>
          <button class="prompt-chip" data-prompt="Design architecture for a modern web app">📐 Plan Web Architecture</button>
          <button class="prompt-chip" data-prompt="Write a clean TypeScript REST API endpoint">💻 Write TypeScript API</button>
          <button class="prompt-chip" data-prompt="What files are in this project workspace?">📂 Explore Workspace</button>
        </div>
      </div>
    `;

    container.querySelectorAll(".prompt-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("input-box").value = btn.dataset.prompt;
        sendMessage();
      });
    });
  } else {
    for (const m of messages) {
      const row = document.createElement("div");
      row.className = "msg-row " + (m.role === "user" ? "user" : "assistant");

      const header = document.createElement("div");
      header.className = "msg-header";
      header.innerHTML = `
        <span class="msg-author-badge">${m.role === "user" ? "You" : "Bubbles AI (Google Brain)"}</span>
        <span class="msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      `;

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.innerHTML = renderContent(m.content);

      row.appendChild(header);
      row.appendChild(bubble);

      if (m.images && m.images.length > 0) {
        const imgRow = document.createElement("div");
        imgRow.style.cssText = "display:flex; gap:8px; margin-top:8px;";
        for (const img of m.images) {
          const thumb = document.createElement("img");
          thumb.style.cssText = "width:120px; height:80px; object-fit:cover; border-radius:8px; cursor:pointer; border:1px solid var(--border);";
          thumb.src = img.preview;
          thumb.title = `${img.width} × ${img.height}px - click to open in Images tab`;
          thumb.addEventListener("click", () => {
            switchTab("images");
            applyImageState(img);
          });
          imgRow.appendChild(thumb);
        }
        row.appendChild(imgRow);
      }

      container.appendChild(row);
    }
  }

  if (thinking) {
    const t = document.createElement("div");
    t.className = "thinking-box";
    t.innerHTML = `
      <span data-icon="brain" data-icon-size="sm" style="color:var(--accent);"></span>
      <span>Google AI Brain is thinking</span>
      <span class="thinking-dot">.</span><span class="thinking-dot">.</span><span class="thinking-dot">.</span>
    `;
    container.appendChild(t);
  }

  const scroll = document.getElementById("chat-scroll");
  scroll.scrollTop = scroll.scrollHeight;
}

// ------------------------------------------------------------------
// 6. Attachments
// ------------------------------------------------------------------

document.getElementById("attach-btn").addEventListener("click", () => {
  document.getElementById("file-input").click();
});

document.getElementById("file-input").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.error) {
        showToast("Could not attach " + file.name + ": " + data.error);
        continue;
      }
      state.pendingAttachments.push(data);
      renderAttachments();
    } catch (err) {
      showToast("Could not upload " + file.name + ": " + err);
    }
  }
  e.target.value = "";
});

function renderAttachments() {
  const row = document.getElementById("attachments-row");
  row.innerHTML = "";
  state.pendingAttachments.forEach((att, idx) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    if (att.type === "image") {
      chip.innerHTML = `<img class="chip-thumb" src="${att.preview}"> ${escapeHtml(att.filename)} <span class="remove-chip" data-idx="${idx}">${icon("close", "icon-sm")}</span>`;
    } else {
      chip.innerHTML = `${icon("file", "icon-sm")} ${escapeHtml(att.filename)} <span class="remove-chip" data-idx="${idx}">${icon("close", "icon-sm")}</span>`;
    }
    row.appendChild(chip);
  });
  row.querySelectorAll(".remove-chip").forEach((el) => {
    el.addEventListener("click", () => {
      state.pendingAttachments.splice(Number(el.dataset.idx), 1);
      renderAttachments();
    });
  });
}

function buildMessageWithAttachments(text) {
  if (state.pendingAttachments.length === 0) return text;
  const blocks = state.pendingAttachments.map((att) => {
    if (att.type === "image") {
      return `\n\nAttached image: ${att.filename} (id: ${att.id}, ${att.width}x${att.height}px).`;
    }
    return `\n\nAttached file: ${att.filename}\n\`\`\`\n${att.preview}\n\`\`\``;
  });
  return text + blocks.join("");
}

// ------------------------------------------------------------------
// 7. Messaging & Sessions
// ------------------------------------------------------------------

async function saveConvo(convo) {
  if (convo.messages.length === 0) return { id: convo.sessionId };
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: convo.sessionId, messages: convo.messages }),
  });
  return await res.json();
}

async function sendMessage() {
  const box = document.getElementById("input-box");
  const text = box.value.trim();
  if (!text && state.pendingAttachments.length === 0) return;

  const fullText = buildMessageWithAttachments(text || "See attached file(s).");
  box.value = "";
  box.style.height = "auto";
  state.pendingAttachments = [];
  renderAttachments();

  const convo = activeConvo;
  convo.messages.push({ role: "user", content: fullText });
  if (convo === activeConvo) renderChat(true);

  const sendBtn = document.getElementById("send-btn");
  sendBtn.disabled = true;

  const enabledTools = Object.keys(state.tools).filter((name) => state.tools[name]);
  const agentMode = document.getElementById("agent-mode-select").value;

  let replyText;
  let updatedImages = [];
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: fullText, enabled_tools: enabledTools, agent_mode: agentMode }),
    });
    const data = await res.json();
    replyText = data.reply || data.error || "(no response)";
    updatedImages = data.updated_images || [];
  } catch (e) {
    replyText = "❌ Could not reach Google AI Brain backend: " + e;
  }

  convo.messages.push({ role: "assistant", content: replyText, images: updatedImages });

  const saved = await saveConvo(convo);
  convo.sessionId = saved.id;

  sendBtn.disabled = false;
  if (convo === activeConvo) renderChat(false);
  await refreshSessions();

  if (updatedImages.length > 0 && imgState.id) {
    const openInEditor = updatedImages.find((img) => img.id === imgState.id);
    if (openInEditor) applyImageState(openInEditor);
  }
}

document.getElementById("send-btn").addEventListener("click", sendMessage);
document.getElementById("input-box").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById("input-box").addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 180) + "px";
});

document.getElementById("clear-chat-btn").addEventListener("click", () => {
  activeConvo.messages = [];
  renderChat();
  showToast("Chat cleared.");
});

async function refreshSessions() {
  try {
    const res = await fetch("/api/sessions");
    state.sessions = await res.json();
    renderSessionsList();
    document.getElementById("badge-chat-count").textContent = state.sessions.length;
  } catch (e) {
    // silent
  }
}

function renderSessionsList() {
  const list = document.getElementById("sessions-list");
  list.innerHTML = "";

  const query = state.sessionSearch.trim().toLowerCase();
  const filtered = query
    ? state.sessions.filter((s) => s.title.toLowerCase().includes(query))
    : state.sessions;

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:12px; font-size:12.5px; color:var(--text-muted); text-align:center;";
    empty.textContent = query ? "No matching conversations" : "No saved chats yet";
    list.appendChild(empty);
    return;
  }

  for (const s of filtered) {
    const row = document.createElement("div");
    row.className = "session-row" + (s.id === activeConvo.sessionId ? " active" : "");

    const mainInfo = document.createElement("div");
    mainInfo.className = "session-main-info";
    mainInfo.innerHTML = `
      <span data-icon="chat" data-icon-size="sm" style="color:var(--text-muted);"></span>
      <span class="session-title-text">${escapeHtml(s.title)}</span>
    `;
    mainInfo.addEventListener("click", () => loadSession(s.id));

    const delBtn = document.createElement("button");
    delBtn.className = "session-row-delete-btn";
    delBtn.title = "Delete conversation";
    delBtn.innerHTML = icon("trash", "icon-sm");
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch("/api/sessions/" + encodeURIComponent(s.id), { method: "DELETE" });
      if (s.id === activeConvo.sessionId) {
        activeConvo = { sessionId: null, messages: [] };
        renderChat();
      }
      await refreshSessions();
      showToast("Conversation deleted.");
    });

    row.appendChild(mainInfo);
    row.appendChild(delBtn);
    list.appendChild(row);
  }
  renderIconPlaceholders();
}

async function loadSession(id) {
  const res = await fetch("/api/sessions/" + encodeURIComponent(id));
  if (!res.ok) return;
  const data = await res.json();
  activeConvo = { sessionId: id, messages: data.messages || [] };
  switchTab("chats");
  renderChat();
  renderSessionsList();
}

document.getElementById("new-chat-btn").addEventListener("click", () => {
  activeConvo = { sessionId: null, messages: [] };
  switchTab("chats");
  renderChat();
  renderSessionsList();
  document.getElementById("input-box").focus();
});

document.getElementById("save-chat-btn").addEventListener("click", async () => {
  const saved = await saveConvo(activeConvo);
  activeConvo.sessionId = saved.id;
  await refreshSessions();
  showToast("Conversation saved!");
});

document.getElementById("delete-session-btn").addEventListener("click", async () => {
  if (activeConvo.sessionId) {
    await fetch("/api/sessions/" + encodeURIComponent(activeConvo.sessionId), { method: "DELETE" });
    activeConvo = { sessionId: null, messages: [] };
    renderChat();
    await refreshSessions();
    showToast("Active chat deleted.");
  }
});

const searchInput = document.getElementById("header-search-input");
const searchClearBtn = document.getElementById("search-clear-btn");
const searchBarWrap = document.getElementById("header-search-bar");

searchInput.addEventListener("input", (e) => {
  const val = e.target.value;
  state.sessionSearch = val;
  searchBarWrap.classList.toggle("has-query", Boolean(val));
  renderSessionsList();
});

searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  state.sessionSearch = "";
  searchBarWrap.classList.remove("has-query");
  renderSessionsList();
});

// ------------------------------------------------------------------
// 8. Context Syncing Modal
// ------------------------------------------------------------------

document.getElementById("sync-btn").addEventListener("click", () => {
  document.getElementById("sync-modal-overlay").classList.remove("hidden");
  document.getElementById("sync-search-input").value = "";
  renderSyncModalList("");
  document.getElementById("sync-search-input").focus();
});

document.getElementById("sync-modal-close").addEventListener("click", closeSyncModal);
document.getElementById("sync-modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "sync-modal-overlay") closeSyncModal();
});

function closeSyncModal() {
  document.getElementById("sync-modal-overlay").classList.add("hidden");
}

document.getElementById("sync-search-input").addEventListener("input", (e) => {
  renderSyncModalList(e.target.value);
});

function renderSyncModalList(query) {
  const list = document.getElementById("sync-modal-list");
  list.innerHTML = "";

  const q = query.trim().toLowerCase();
  const others = state.sessions.filter(
    (s) => s.id !== activeConvo.sessionId && (!q || s.title.toLowerCase().includes(q))
  );

  if (others.length === 0) {
    list.innerHTML = `<div style="padding:14px; color:var(--text-muted); font-size:13px; text-align:center;">No matching chats found.</div>`;
    return;
  }

  for (const s of others) {
    const item = document.createElement("div");
    item.className = "session-row";
    item.textContent = s.title;
    item.addEventListener("click", () => confirmSync(s.id, s.title));
    list.appendChild(item);
  }
}

async function confirmSync(sourceId, sourceTitle) {
  const res = await fetch("/api/sessions/" + encodeURIComponent(sourceId));
  if (!res.ok) return;
  const data = await res.json();

  const transcript = (data.messages || [])
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n")
    .slice(0, 3000);

  activeConvo.messages.push({
    role: "assistant",
    content: `🔄 **Synced context from "${sourceTitle}":**\n\n${transcript}`,
  });

  renderChat();
  closeSyncModal();
  const saved = await saveConvo(activeConvo);
  activeConvo.sessionId = saved.id;
  await refreshSessions();
  showToast(`Context pulled from "${sourceTitle}"`);
}

// ------------------------------------------------------------------
// 9. Model Status & Health Matrix (AI Brain)
// ------------------------------------------------------------------

async function loadModelsStatus() {
  const grid = document.getElementById("models-matrix-grid");
  if (!grid) return;

  try {
    const res = await fetch("/api/models/status");
    const data = await res.json();
    state.modelsList = data.models || [];
    renderModelsMatrix(data);
  } catch (err) {
    grid.innerHTML = `<div style="color:#ef4444; font-size:13px;">Error loading model status: ${err}</div>`;
  }
}

function renderModelsMatrix(data) {
  const grid = document.getElementById("models-matrix-grid");
  grid.innerHTML = "";

  const activeGoogleModel = data.activeGoogleModel || "gemma-4-26b-a4b-it";

  for (const m of data.models || []) {
    const card = document.createElement("div");
    const isCurrent = m.id === activeGoogleModel || m.provider === data.activeProvider;
    card.className = "model-card" + (isCurrent ? " active-model" : "");

    let badgeClass = m.status;
    let badgeText = m.status.replace("_", " ");
    if (m.status === "online") badgeText = "● Online";
    else if (m.status === "available") badgeText = "● Ready";
    else if (m.status === "configured") badgeText = "● Configured";
    else if (m.status === "requires_key") badgeText = "○ Key Needed";
    else if (m.status === "local_ready") badgeText = "● Local";

    card.innerHTML = `
      <div class="model-card-header">
        <div class="model-name">
          <span>${escapeHtml(m.name)}</span>
        </div>
        <span class="status-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="model-role-text">${escapeHtml(m.role)}</div>
      <div class="model-specs-row">
        <span><b>Context:</b> ${m.context}</span>
        <span><b>Caps:</b> ${(m.capabilities || []).slice(0, 2).join(", ")}</span>
      </div>
      <div class="model-card-actions">
        <button class="model-test-btn" data-model="${m.id}">Test Model</button>
        ${!isCurrent ? `<button class="model-test-btn select-model-btn" data-model="${m.id}" data-provider="${m.provider}">Activate</button>` : `<span style="font-size:11.5px; font-weight:600; color:var(--accent);">Active</span>`}
      </div>
      <div class="model-test-feedback" id="feedback-${m.id}"></div>
    `;

    // Test button
    const testBtn = card.querySelector(`.model-test-btn[data-model="${m.id}"]`);
    testBtn.addEventListener("click", async () => {
      const fb = card.querySelector(`#feedback-${m.id}`);
      fb.style.display = "block";
      fb.textContent = "Testing connection…";
      testBtn.disabled = true;

      try {
        const res = await fetch("/api/models/test-single", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: m.id }),
        });
        const d = await res.json();
        testBtn.disabled = false;
        if (d.ok) {
          fb.style.color = "#10b981";
          fb.textContent = `⚡ ${d.latencyMs}ms - OK ("${d.response}")`;
          showToast(`Model ${m.name} responded in ${d.latencyMs}ms!`);
        } else {
          fb.style.color = "#ef4444";
          fb.textContent = `Error: ${d.error || "Failed"}`;
        }
      } catch (e) {
        testBtn.disabled = false;
        fb.style.color = "#ef4444";
        fb.textContent = "Request error: " + e;
      }
    });

    // Activate button
    const actBtn = card.querySelector(`.select-model-btn`);
    if (actBtn) {
      actBtn.addEventListener("click", async () => {
        if (m.provider === "google") {
          document.getElementById("google-model-select").value = m.id;
          document.getElementById("provider-select").value = "google";
        } else {
          document.getElementById("provider-select").value = m.provider;
        }
        document.getElementById("save-brain-btn").click();
      });
    }

    grid.appendChild(card);
  }
}

document.getElementById("refresh-models-btn")?.addEventListener("click", loadModelsStatus);

// ------------------------------------------------------------------
// 10. Settings & AI Brain
// ------------------------------------------------------------------

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const s = await res.json();

    const providerSelect = document.getElementById("provider-select");
    providerSelect.innerHTML = "";
    for (const p of s.providers || ["google", "demo"]) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p.toUpperCase() + (p === "google" ? " (Recommended)" : "");
      if (p === s.DEFAULT_PROVIDER) opt.selected = true;
      providerSelect.appendChild(opt);
    }

    const googleModelSelect = document.getElementById("google-model-select");
    if (googleModelSelect && s.google_models) {
      googleModelSelect.innerHTML = "";
      for (const m of s.google_models) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (m === s.GOOGLE_MODEL) opt.selected = true;
        googleModelSelect.appendChild(opt);
      }
    }

    document.getElementById("key-google").value = s.GOOGLE_API_KEY || "";
    document.getElementById("fallback-order-input").value = (s.fallback_order || []).join(",");
    document.getElementById("key-openai").value = s.OPENAI_API_KEY || "";
    document.getElementById("key-anthropic").value = s.ANTHROPIC_API_KEY || "";
    document.getElementById("key-deepseek").value = s.DEEPSEEK_API_KEY || "";
    document.getElementById("key-kimi").value = s.KIMI_API_KEY || "";
    document.getElementById("omniroute-url").value = s.OMNIROUTE_BASE_URL || "";
    document.getElementById("ollama-url").value = s.OLLAMA_BASE_URL || "";
    document.getElementById("ollama-model").value = s.OLLAMA_MODEL || "";
    document.getElementById("workspace-dir").value = s.WORKSPACE_DIR || "";

    const activeModelName = s.GOOGLE_MODEL || "Gemma 4 / Gemini";
    document.getElementById("profile-model-name").textContent = activeModelName;
    document.getElementById("active-model-pill").innerHTML = `<span class="status-dot-emerald"></span> Google AI: ${activeModelName}`;
  } catch (e) {
    // silent
  }
}

document.getElementById("google-test-btn").addEventListener("click", async () => {
  const resultBox = document.getElementById("google-test-result");
  const model = document.getElementById("google-model-select").value;
  const key = document.getElementById("key-google").value.trim();

  resultBox.className = "test-result-box pending";
  resultBox.textContent = "Connecting to Google AI Brain…";

  try {
    const res = await fetch("/api/test-google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, key }),
    });
    const data = await res.json();
    resultBox.className = "test-result-box " + (data.ok ? "ok" : "fail");
    resultBox.textContent = data.message;
    if (data.ok) {
      showToast("Google AI Brain connected successfully!");
      loadModelsStatus();
    }
  } catch (err) {
    resultBox.className = "test-result-box fail";
    resultBox.textContent = "Failed to reach server: " + err;
  }
});

document.getElementById("save-brain-btn").addEventListener("click", async () => {
  const payload = {
    DEFAULT_PROVIDER: document.getElementById("provider-select").value,
    GOOGLE_MODEL: document.getElementById("google-model-select").value,
    GOOGLE_API_KEY: document.getElementById("key-google").value.trim(),
    fallback_order: document.getElementById("fallback-order-input").value,
    OPENAI_API_KEY: document.getElementById("key-openai").value.trim(),
    ANTHROPIC_API_KEY: document.getElementById("key-anthropic").value.trim(),
    DEEPSEEK_API_KEY: document.getElementById("key-deepseek").value.trim(),
    KIMI_API_KEY: document.getElementById("key-kimi").value.trim(),
    OMNIROUTE_BASE_URL: document.getElementById("omniroute-url").value.trim(),
    OLLAMA_BASE_URL: document.getElementById("ollama-url").value.trim(),
    OLLAMA_MODEL: document.getElementById("ollama-model").value.trim(),
    WORKSPACE_DIR: document.getElementById("workspace-dir").value.trim(),
  };

  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  showToast("AI Brain settings saved! Active provider is ready.");
  await loadSettings();
  await loadModelsStatus();
});

document.querySelectorAll(".eye-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = document.getElementById(btn.dataset.target);
    target.type = target.type === "password" ? "text" : "password";
    btn.innerHTML = icon(target.type === "password" ? "eye" : "eyeOff", "icon-sm");
  });
});

document.getElementById("ollama-test-btn").addEventListener("click", async () => {
  const resultBox = document.getElementById("ollama-test-result");
  const url = document.getElementById("ollama-url").value.trim();
  resultBox.className = "test-result-box pending";
  resultBox.textContent = "Testing…";

  try {
    const res = await fetch("/api/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const d = await res.json();
    resultBox.className = "test-result-box " + (d.ok ? "ok" : "fail");
    resultBox.textContent = d.message;
  } catch (e) {
    resultBox.className = "test-result-box fail";
    resultBox.textContent = "Connection error: " + e;
  }
});

document.getElementById("omniroute-test-btn").addEventListener("click", async () => {
  const resultBox = document.getElementById("omniroute-test-result");
  const url = document.getElementById("omniroute-url").value.trim();
  resultBox.className = "test-result-box pending";
  resultBox.textContent = "Testing…";

  try {
    const res = await fetch("/api/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const d = await res.json();
    resultBox.className = "test-result-box " + (d.ok ? "ok" : "fail");
    resultBox.textContent = d.message;
  } catch (e) {
    resultBox.className = "test-result-box fail";
    resultBox.textContent = "Connection error: " + e;
  }
});

// ------------------------------------------------------------------
// 11. PWA & Desktop Installation
// ------------------------------------------------------------------

function setupDesktopInstallation() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const headerInstall = document.getElementById("header-install-btn");
    if (headerInstall) headerInstall.style.display = "flex";
  });

  const triggerInstall = async () => {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      const choice = await state.deferredInstallPrompt.userChoice;
      if (choice.outcome === "accepted") {
        showToast("Installing Bubbles AI on desktop!");
      }
      state.deferredInstallPrompt = null;
    } else {
      switchTab("desktop");
      showToast("To install: use your browser's install icon or the Windows/Linux package!");
    }
  };

  document.getElementById("header-install-btn")?.addEventListener("click", triggerInstall);
  document.getElementById("btn-trigger-pwa-install")?.addEventListener("click", triggerInstall);

  // Register Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

// ------------------------------------------------------------------
// 12. Web View Panel
// ------------------------------------------------------------------

function setupWebView() {
  const input = document.getElementById("webview-url-input");
  const iframe = document.getElementById("webview-frame");
  const goBtn = document.getElementById("webview-go-btn");
  const backBtn = document.getElementById("webview-back-btn");
  const extBtn = document.getElementById("webview-external-btn");

  const loadUrl = (url) => {
    let finalUrl = url.trim();
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://") && !finalUrl.startsWith("/")) {
      finalUrl = "https://" + finalUrl;
    }
    input.value = finalUrl;
    iframe.src = finalUrl;
  };

  goBtn?.addEventListener("click", () => loadUrl(input.value));
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadUrl(input.value);
  });

  backBtn?.addEventListener("click", () => {
    try { iframe.contentWindow?.history.back(); } catch {}
  });

  extBtn?.addEventListener("click", () => {
    window.open(input.value, "_blank");
  });

  // Code editor preview button
  document.getElementById("code-preview-btn")?.addEventListener("click", () => {
    const content = document.getElementById("code-editor").value;
    const path = document.getElementById("code-current-path").value;
    switchTab("webview");
    input.value = path || "preview.html";
    const blob = new Blob([content], { type: "text/html" });
    iframe.src = URL.createObjectURL(blob);
    showToast("Loaded in Web View!");
  });
}

// ------------------------------------------------------------------
// 13. Tools Tab
// ------------------------------------------------------------------

async function loadTools() {
  try {
    const res = await fetch("/api/tools");
    const tools = await res.json();

    const list = document.getElementById("tools-list");
    list.innerHTML = "";
    for (const t of tools) {
      state.tools[t.name] = true;

      const card = document.createElement("div");
      card.className = "tool-card";
      card.innerHTML = `
        <div class="tool-header-row">
          <span class="tool-name-label">${escapeHtml(t.name)}</span>
          <label style="cursor:pointer;"><input type="checkbox" checked data-tool="${escapeHtml(t.name)}"></label>
        </div>
        <div class="tool-desc-text">${escapeHtml(t.description)}</div>
      `;
      card.querySelector("input").addEventListener("change", (e) => {
        state.tools[t.name] = e.target.checked;
      });
      list.appendChild(card);
    }
  } catch (e) {
    // silent
  }
}

// ------------------------------------------------------------------
// 14. Terminal Tab & Activity Feed
// ------------------------------------------------------------------

function appendTerminalLine(cls, text) {
  const out = document.getElementById("terminal-output");
  const line = document.createElement("div");
  line.className = "term-line " + cls;
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

document.getElementById("terminal-run-btn").addEventListener("click", runTerminalCommand);
document.getElementById("terminal-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runTerminalCommand();
});

async function runTerminalCommand() {
  const input = document.getElementById("terminal-input");
  const command = input.value.trim();
  if (!command) return;
  input.value = "";
  appendTerminalLine("cmd", "$ " + command);

  try {
    const res = await fetch("/api/terminal/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    if (data.stdout) appendTerminalLine("out", data.stdout.trimEnd());
    if (data.stderr) appendTerminalLine("err", data.stderr.trimEnd());
    appendTerminalLine("system", `(exit ${data.returncode})`);
  } catch (e) {
    appendTerminalLine("err", "Error: " + e);
  }
}

async function pollActivity() {
  const follow = document.getElementById("terminal-follow-agent").checked;
  if (follow) {
    try {
      const res = await fetch("/api/activity?since=" + state.activitySince);
      const entries = await res.json();
      for (const e of entries) {
        state.activitySince = Math.max(state.activitySince, e.time);
        if (e.kind === "terminal") continue;
        appendTerminalLine(e.kind, `[${e.kind}] ${e.message}`);
      }
    } catch {
      // silent
    }
  }
  setTimeout(pollActivity, 2000);
}

// ------------------------------------------------------------------
// 15. Code Editor View
// ------------------------------------------------------------------

const codeState = { files: [], currentPath: null };

async function loadCodeFileList() {
  try {
    const res = await fetch("/api/code/list");
    const data = await res.json();
    codeState.files = data.files || [];
    renderCodeFileList();
  } catch {
    // silent
  }
}

function renderCodeFileList() {
  const list = document.getElementById("code-file-list");
  list.innerHTML = "";

  const q = (document.getElementById("code-file-search").value || "").trim().toLowerCase();
  const filtered = q ? codeState.files.filter((f) => f.toLowerCase().includes(q)) : codeState.files;

  if (filtered.length === 0) {
    list.innerHTML = `<div style="padding:10px; font-size:12.5px; color:var(--text-muted);">No files match.</div>`;
    return;
  }

  for (const path of filtered) {
    const item = document.createElement("div");
    item.className = "code-file-item" + (path === codeState.currentPath ? " selected" : "");
    item.textContent = path;
    item.addEventListener("click", () => openCodeFile(path));
    list.appendChild(item);
  }
}

document.getElementById("code-file-search").addEventListener("input", renderCodeFileList);
document.getElementById("code-refresh-btn").addEventListener("click", loadCodeFileList);

async function openCodeFile(path) {
  const res = await fetch("/api/code/file?path=" + encodeURIComponent(path));
  const data = await res.json();
  if (data.error) { showToast(data.error); return; }

  codeState.currentPath = path;
  document.getElementById("code-current-path").value = path;
  document.getElementById("code-editor").value = data.content;
  renderCodeFileList();
}

document.getElementById("code-new-btn").addEventListener("click", () => {
  const path = document.getElementById("code-current-path").value.trim();
  if (!path) { showToast("Type a filename above first (e.g. main.ts)"); return; }
  codeState.currentPath = path;
  document.getElementById("code-editor").value = "";
  document.getElementById("code-editor").focus();
});

document.getElementById("code-save-btn").addEventListener("click", async () => {
  const path = document.getElementById("code-current-path").value.trim();
  if (!path) { showToast("Enter a filename first"); return; }
  const content = document.getElementById("code-editor").value;

  const res = await fetch("/api/code/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  const data = await res.json();
  if (data.error) { showToast(data.error); return; }

  showToast(`File "${path}" saved!`);
  await loadCodeFileList();
});

document.getElementById("code-ask-ai-btn").addEventListener("click", () => {
  const path = codeState.currentPath;
  const content = document.getElementById("code-editor").value;
  if (!path) { showToast("Open a file first"); return; }

  switchTab("chats");
  const box = document.getElementById("input-box");
  box.value = `Please review and help me with this file (\`${path}\`):\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\`\n`;
  box.focus();
});

// ------------------------------------------------------------------
// 16. Image Studio View
// ------------------------------------------------------------------

const imgState = { id: null, width: 0, height: 0 };
let cropSelection = null;
let cropStart = null;

const previewEl = document.getElementById("image-preview");
const emptyStateEl = document.getElementById("image-empty-state");
const cropBoxEl = document.getElementById("image-crop-box");

function applyImageState(state) {
  imgState.id = state.id;
  imgState.width = state.width;
  imgState.height = state.height;

  previewEl.src = state.preview;
  previewEl.style.display = "block";
  emptyStateEl.style.display = "none";

  document.getElementById("image-dims").textContent = `${state.width} × ${state.height} px`;
  document.getElementById("image-resize-w").value = state.width;
  document.getElementById("image-resize-h").value = state.height;
}

document.getElementById("image-choose-btn").addEventListener("click", () => {
  document.getElementById("image-file-input").click();
});

document.getElementById("image-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/image/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (data.error) { showToast(data.error); return; }
    applyImageState(data);
    showToast(`Image "${file.name}" loaded!`);
  } catch (err) {
    showToast("Upload failed: " + err);
  }
});

async function applyImageOp(op, params = {}) {
  if (!imgState.id) { showToast("Open an image first."); return; }

  try {
    const res = await fetch(`/api/image/${encodeURIComponent(imgState.id)}/op`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, params }),
    });
    const data = await res.json();
    if (data.error) { showToast(data.error); return; }
    applyImageState(data);
    showToast(`Applied ${op}`);
  } catch (err) {
    showToast("Operation failed: " + err);
  }
}

document.getElementById("image-resize-btn").addEventListener("click", () => {
  const width = parseInt(document.getElementById("image-resize-w").value, 10);
  const height = parseInt(document.getElementById("image-resize-h").value, 10);
  if (width && height) applyImageOp("resize", { width, height });
});

document.getElementById("image-rotate-left").addEventListener("click", () => applyImageOp("rotate", { degrees: 270 }));
document.getElementById("image-rotate-right").addEventListener("click", () => applyImageOp("rotate", { degrees: 90 }));
document.getElementById("image-flip-h").addEventListener("click", () => applyImageOp("flip", { axis: "horizontal" }));
document.getElementById("image-flip-v").addEventListener("click", () => applyImageOp("flip", { axis: "vertical" }));
document.getElementById("image-grayscale-btn").addEventListener("click", () => applyImageOp("grayscale"));
document.getElementById("image-sharpen-btn").addEventListener("click", () => applyImageOp("sharpen"));

document.getElementById("image-watermark-btn").addEventListener("click", () => {
  const text = document.getElementById("image-watermark-text").value.trim();
  const position = document.getElementById("image-watermark-position").value;
  if (!text) { showToast("Enter watermark text"); return; }
  applyImageOp("watermark", { text, position, opacity: 0.7 });
});

document.getElementById("image-reset-btn").addEventListener("click", async () => {
  if (!imgState.id) return;
  const res = await fetch(`/api/image/${encodeURIComponent(imgState.id)}/reset`, { method: "POST" });
  const data = await res.json();
  if (data.error) { showToast(data.error); return; }
  applyImageState(data);
  showToast("Image reset to original.");
});

document.getElementById("image-download-btn").addEventListener("click", () => {
  if (!imgState.id) return;
  window.location.href = `/api/image/${encodeURIComponent(imgState.id)}/download?format=PNG`;
});

// Image Crop selection drag
previewEl.addEventListener("mousedown", (e) => {
  if (!imgState.id) return;
  const rect = previewEl.getBoundingClientRect();
  cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  cropSelection = null;
  cropBoxEl.style.display = "block";
  cropBoxEl.style.left = cropStart.x + "px";
  cropBoxEl.style.top = cropStart.y + "px";
  cropBoxEl.style.width = "0px";
  cropBoxEl.style.height = "0px";
});

window.addEventListener("mousemove", (e) => {
  if (!cropStart) return;
  const rect = previewEl.getBoundingClientRect();
  const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

  const left = Math.min(cropStart.x, curX);
  const top = Math.min(cropStart.y, curY);
  const width = Math.abs(curX - cropStart.x);
  const height = Math.abs(curY - cropStart.y);

  cropBoxEl.style.left = left + "px";
  cropBoxEl.style.top = top + "px";
  cropBoxEl.style.width = width + "px";
  cropBoxEl.style.height = height + "px";

  const scaleX = imgState.width / rect.width;
  const scaleY = imgState.height / rect.height;

  cropSelection = {
    x: Math.round(left * scaleX),
    y: Math.round(top * scaleY),
    width: Math.round(width * scaleX),
    height: Math.round(height * scaleY),
  };
});

window.addEventListener("mouseup", () => {
  cropStart = null;
});

document.getElementById("image-crop-btn").addEventListener("click", () => {
  if (!cropSelection || cropSelection.width < 10 || cropSelection.height < 10) {
    showToast("Click and drag on the image to select a crop area first.");
    return;
  }
  applyImageOp("crop", cropSelection);
  cropBoxEl.style.display = "none";
  cropSelection = null;
});

// ------------------------------------------------------------------
// 17. API Endpoint Tab
// ------------------------------------------------------------------

function setupApiTab() {
  const url = window.location.origin + "/v1";
  document.getElementById("api-endpoint").value = url;
  document.getElementById("copy-endpoint-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(url);
    showToast("API Endpoint URL copied!");
  });
}

// ------------------------------------------------------------------
// 18. App Initialization
// ------------------------------------------------------------------

(async function init() {
  renderIconPlaceholders();
  setupThemeAndAccent();
  setupApiTab();
  setupDesktopInstallation();
  setupWebView();

  try {
    await Promise.all([
      loadSettings(),
      loadTools(),
      refreshSessions(),
      loadCodeFileList(),
      loadModelsStatus(),
    ]);
  } catch (e) {
    // tolerant
  }

  renderChat();
  pollActivity();
  hideLoaderScreen();
})();
