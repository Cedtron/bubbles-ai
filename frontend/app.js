// Each conversation is its own object: { sessionId, messages }.
// activeConvo is reassigned (not mutated) whenever the user switches
// or starts a chat - so a reply that's still in flight for a chat the
// user has since navigated away from keeps writing to ITS OWN object,
// never into whatever conversation happens to be on screen now.
let activeConvo = { sessionId: null, messages: [] };

const state = {
  sessions: [],
  tools: {},
  pendingAttachments: [],
  activitySince: 0,
  sessionSearch: "",
};

// ------------------------------------------------------------------
// Tabs

const FULL_PAGE_VIEWS = { images: "view-images", code: "view-code" };

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");

    const tabName = btn.dataset.tab;

    Object.values(FULL_PAGE_VIEWS).forEach((viewId) => {
      document.getElementById(viewId).style.display = "none";
    });

    if (FULL_PAGE_VIEWS[tabName]) {
      document.getElementById("view-chat").style.display = "none";
      document.getElementById(FULL_PAGE_VIEWS[tabName]).style.display = "flex";
    } else {
      document.getElementById("view-chat").style.display = "flex";
      document.getElementById("tab-" + tabName).classList.add("active");
    }
  });
});

// ------------------------------------------------------------------
// Markdown-lite rendering (fenced code blocks, inline code, bold)

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderContent(text) {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre>${code.trim()}</pre>`);
  escaped = escaped.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return escaped.split(/\n(?![^<]*<\/pre>)/).join("<br>");
}

// ------------------------------------------------------------------
// Chat rendering - always renders activeConvo, nothing else

function renderChat(thinking = false) {
  const container = document.getElementById("chat-messages");
  container.innerHTML = "";

  const messages = activeConvo.messages;

  if (messages.length === 0) {
    container.innerHTML = `<div class="empty-state">${icon("bubble", "icon-lg")} Say hello to start chatting with Bubbles AI</div>`;
  } else {
    for (const m of messages) {
      const row = document.createElement("div");
      row.className = "msg-row " + (m.role === "user" ? "user" : "assistant");

      const sender = document.createElement("div");
      sender.className = "sender";
      sender.textContent = m.role === "user" ? "You" : "Bubbles AI";

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.innerHTML = renderContent(m.content);

      row.appendChild(sender);
      row.appendChild(bubble);

      if (m.images && m.images.length > 0) {
        const imgRow = document.createElement("div");
        imgRow.className = "chat-image-row";
        for (const img of m.images) {
          const thumb = document.createElement("img");
          thumb.className = "chat-image-thumb";
          thumb.src = img.preview;
          thumb.title = `${img.width} × ${img.height}px - click to open in Images tab`;
          thumb.addEventListener("click", () => {
            document.querySelector('.tab-btn[data-tab="images"]').click();
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
    t.className = "thinking";
    t.innerHTML = `${icon("bubble", "icon-sm")} Bubbles AI is thinking<span class='dot'>.</span><span class='dot'>.</span><span class='dot'>.</span>`;
    container.appendChild(t);
  }

  const scroll = document.getElementById("chat-scroll");
  scroll.scrollTop = scroll.scrollHeight;
}

// ------------------------------------------------------------------
// Attachments

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
        alert("Could not attach " + file.name + ": " + data.error);
        continue;
      }
      state.pendingAttachments.push(data);
      renderAttachments();
    } catch (err) {
      alert("Could not upload " + file.name + ": " + err);
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
      return `\n\nAttached image: ${att.filename} (id: ${att.id}, ${att.width}x${att.height}px). ` +
        `You can edit it with the image_edit tool - no need to pass an id, it's the active image.`;
    }
    return `\n\nAttached file: ${att.filename}\n\`\`\`\n${att.preview}\n\`\`\``;
  });
  return text + blocks.join("");
}

// ------------------------------------------------------------------
// Saving a conversation to the backend

async function saveConvo(convo) {
  if (convo.messages.length === 0) return { id: convo.sessionId };
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: convo.sessionId, messages: convo.messages }),
  });
  return await res.json();
}

// ------------------------------------------------------------------
// Sending messages
//
// `convo` is captured once at the start - if the user clicks "New
// Chat" or opens a different saved chat while this request is still
// in flight, `activeConvo` gets reassigned to a NEW object, but
// `convo` here keeps pointing at the original one. The reply always
// lands in the chat that actually asked for it, whether or not it's
// still the one on screen when the answer comes back.

async function sendMessage() {
  const box = document.getElementById("input-box");
  const text = box.value.trim();
  if (!text && state.pendingAttachments.length === 0) return;

  const fullText = buildMessageWithAttachments(text || "See attached file(s).");
  box.value = "";
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
    replyText = "❌ Could not reach Bubbles AI backend: " + e;
  }

  convo.messages.push({ role: "assistant", content: replyText, images: updatedImages });

  const saved = await saveConvo(convo);
  convo.sessionId = saved.id;

  sendBtn.disabled = false;
  if (convo === activeConvo) renderChat(false);
  await refreshSessions();

  // If the AI edited the image currently open in the Images tab, refresh it live
  const openInEditor = updatedImages.find((img) => img.id === imgState.id);
  if (openInEditor) applyImageState(openInEditor);
}

document.getElementById("send-btn").addEventListener("click", sendMessage);
document.getElementById("input-box").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ------------------------------------------------------------------
// Sessions (list, search, switch, delete)

async function refreshSessions() {
  const res = await fetch("/api/sessions");
  state.sessions = await res.json();
  renderSessionsList();
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
    empty.className = "muted";
    empty.style.padding = "10px";
    empty.textContent = query ? "No chats match your search." : "No saved chats yet.";
    list.appendChild(empty);
    return;
  }

  for (const s of filtered) {
    const item = document.createElement("div");
    item.className = "session-item" + (s.id === activeConvo.sessionId ? " selected" : "");
    item.textContent = s.title;
    item.dataset.id = s.id;
    item.addEventListener("click", () => loadSession(s.id));
    list.appendChild(item);
  }
}

document.getElementById("session-search").addEventListener("input", (e) => {
  state.sessionSearch = e.target.value;
  renderSessionsList();
});

async function loadSession(id) {
  const res = await fetch("/api/sessions/" + encodeURIComponent(id));
  if (!res.ok) return;
  const data = await res.json();
  activeConvo = { sessionId: id, messages: data.messages || [] };
  renderChat();
  renderSessionsList();
}

document.getElementById("new-chat-btn").addEventListener("click", () => {
  activeConvo = { sessionId: null, messages: [] };
  renderChat();
  renderSessionsList();
});

document.getElementById("save-chat-btn").addEventListener("click", async () => {
  const saved = await saveConvo(activeConvo);
  activeConvo.sessionId = saved.id;
  await refreshSessions();
});

document.getElementById("delete-session-btn").addEventListener("click", async () => {
  const selected = document.querySelector(".session-item.selected");
  if (!selected) return;
  const id = selected.dataset.id;
  await fetch("/api/sessions/" + encodeURIComponent(id), { method: "DELETE" });
  if (id === activeConvo.sessionId) {
    activeConvo = { sessionId: null, messages: [] };
    renderChat();
  }
  await refreshSessions();
});

// ------------------------------------------------------------------
// Sync - explicit, opt-in: pull another saved chat's content into
// THIS chat, on request only. This is deliberately separate from
// switching chats, which never mixes content.

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
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "10px";
    empty.textContent = "No matching chats.";
    list.appendChild(empty);
    return;
  }

  for (const s of others) {
    const item = document.createElement("div");
    item.className = "session-item";
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
    content: `🔄 Synced context from "${sourceTitle}":\n\n${transcript}`,
  });

  renderChat();
  closeSyncModal();

  const saved = await saveConvo(activeConvo);
  activeConvo.sessionId = saved.id;
  await refreshSessions();
}

// ------------------------------------------------------------------
// AI Brain settings

async function loadSettings() {
  const res = await fetch("/api/settings");
  const s = await res.json();

  const providerSelect = document.getElementById("provider-select");
  providerSelect.innerHTML = "";
  for (const p of s.providers) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (p === s.DEFAULT_PROVIDER) opt.selected = true;
    providerSelect.appendChild(opt);
  }

  const agentSelect = document.getElementById("agent-mode-select");
  agentSelect.innerHTML = "";
  for (const a of s.agent_modes) {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    agentSelect.appendChild(opt);
  }

  document.getElementById("fallback-order-input").value = (s.fallback_order || []).join(",");
  document.getElementById("key-openai").value = s.OPENAI_API_KEY || "";
  document.getElementById("key-anthropic").value = s.ANTHROPIC_API_KEY || "";
  document.getElementById("key-deepseek").value = s.DEEPSEEK_API_KEY || "";
  document.getElementById("key-kimi").value = s.KIMI_API_KEY || "";
  document.getElementById("aws-access-key").value = s.AWS_ACCESS_KEY_ID || "";
  document.getElementById("aws-secret-key").value = s.AWS_SECRET_ACCESS_KEY || "";
  document.getElementById("aws-region").value = s.AWS_REGION || "us-east-1";
  document.getElementById("nova-model").value = s.NOVA_MODEL || "amazon.nova-lite-v1:0";
  document.getElementById("key-google").value = s.GOOGLE_API_KEY || "";
  document.getElementById("google-model").value = s.GOOGLE_MODEL || "gemini-2.0-flash";
  document.getElementById("omniroute-url").value = s.OMNIROUTE_BASE_URL || "";
  document.getElementById("omniroute-key").value = s.OMNIROUTE_API_KEY || "";
  document.getElementById("ollama-url").value = s.OLLAMA_BASE_URL || "";
  document.getElementById("ollama-model").value = s.OLLAMA_MODEL || "";
  document.getElementById("local-model-path").value = s.LOCAL_MODEL_PATH || "";
  document.getElementById("workspace-dir").value = s.WORKSPACE_DIR || "";
}

document.getElementById("save-brain-btn").addEventListener("click", async () => {
  const payload = {
    DEFAULT_PROVIDER: document.getElementById("provider-select").value,
    fallback_order: document.getElementById("fallback-order-input").value,
    OPENAI_API_KEY: document.getElementById("key-openai").value,
    ANTHROPIC_API_KEY: document.getElementById("key-anthropic").value,
    DEEPSEEK_API_KEY: document.getElementById("key-deepseek").value,
    KIMI_API_KEY: document.getElementById("key-kimi").value,
    AWS_ACCESS_KEY_ID: document.getElementById("aws-access-key").value,
    AWS_SECRET_ACCESS_KEY: document.getElementById("aws-secret-key").value,
    AWS_REGION: document.getElementById("aws-region").value,
    NOVA_MODEL: document.getElementById("nova-model").value,
    GOOGLE_API_KEY: document.getElementById("key-google").value,
    GOOGLE_MODEL: document.getElementById("google-model").value,
    OMNIROUTE_BASE_URL: document.getElementById("omniroute-url").value,
    OMNIROUTE_API_KEY: document.getElementById("omniroute-key").value,
    OLLAMA_BASE_URL: document.getElementById("ollama-url").value,
    OLLAMA_MODEL: document.getElementById("ollama-model").value,
    LOCAL_MODEL_PATH: document.getElementById("local-model-path").value,
    WORKSPACE_DIR: document.getElementById("workspace-dir").value,
  };
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  alert("Settings saved. New messages will use the updated setup.");
});

async function testConnection(urlInputId, resultElId) {
  const resultEl = document.getElementById(resultElId);
  const url = document.getElementById(urlInputId).value.trim();

  resultEl.className = "test-result pending";
  resultEl.textContent = "Testing…";

  try {
    const res = await fetch("/api/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    resultEl.className = "test-result " + (data.ok ? "ok" : "fail");
    resultEl.textContent = data.message;
  } catch (e) {
    resultEl.className = "test-result fail";
    resultEl.textContent = "Could not reach Bubbles AI's own backend: " + e;
  }
}

document.getElementById("omniroute-test-btn").addEventListener("click", () =>
  testConnection("omniroute-url", "omniroute-test-result"));
document.getElementById("ollama-test-btn").addEventListener("click", () =>
  testConnection("ollama-url", "ollama-test-result"));

// Show/hide key fields
document.querySelectorAll(".eye-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = document.getElementById(btn.dataset.target);
    target.type = target.type === "password" ? "text" : "password";
    btn.innerHTML = icon(target.type === "password" ? "eye" : "eyeOff", "icon-sm");
  });
});

// ------------------------------------------------------------------
// Tools

async function loadTools() {
  const res = await fetch("/api/tools");
  const tools = await res.json();

  const list = document.getElementById("tools-list");
  list.innerHTML = "";
  for (const t of tools) {
    state.tools[t.name] = false;

    const item = document.createElement("div");
    item.className = "tool-item";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => { state.tools[t.name] = checkbox.checked; });
    label.appendChild(checkbox);
    label.append(t.name);

    const desc = document.createElement("div");
    desc.className = "muted";
    desc.textContent = t.description;

    item.appendChild(label);
    item.appendChild(desc);
    list.appendChild(item);
  }
}

// ------------------------------------------------------------------
// Terminal tab

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
  const followAgent = document.getElementById("terminal-follow-agent").checked;
  if (followAgent) {
    try {
      const res = await fetch("/api/activity?since=" + state.activitySince);
      const entries = await res.json();
      for (const e of entries) {
        state.activitySince = Math.max(state.activitySince, e.time);
        if (e.kind === "terminal") continue; // already shown when we ran it
        appendTerminalLine(e.kind, `[${e.kind}] ${e.message}`);
      }
    } catch (e) {
      // silent - polling failure shouldn't be noisy
    }
  }
  setTimeout(pollActivity, 1500);
}

// ------------------------------------------------------------------
// API tab

function setupApiTab() {
  const url = window.location.origin + "/v1";
  document.getElementById("api-endpoint").value = url;
  document.getElementById("copy-endpoint-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(url);
  });
  const pill = document.getElementById("status-pill");
  pill.classList.add("online");
  pill.innerHTML = '<span class="status-dot"></span>Online';
}

// ------------------------------------------------------------------
// Settings tab - accent color + app icon (persisted in localStorage)

const DEFAULT_ACCENT = "#8b5cf6";

function applyAccentColor(color) {
  document.documentElement.style.setProperty("--accent", color);
}

function updateThemeColorMeta(color) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}

function setupSettingsTab() {
  const picker = document.getElementById("accent-color-picker");
  const stored = localStorage.getItem("bubbles_accent");
  if (stored) {
    picker.value = stored;
    applyAccentColor(stored);
    updateThemeColorMeta(stored);
  } else {
    updateThemeColorMeta(DEFAULT_ACCENT);
  }

  const handleAccentChange = () => {
    applyAccentColor(picker.value);
    localStorage.setItem("bubbles_accent", picker.value);
    updateThemeColorMeta(picker.value);
  };
  picker.addEventListener("input", handleAccentChange);
  picker.addEventListener("change", handleAccentChange);

  document.getElementById("accent-reset-btn").addEventListener("click", () => {
    picker.value = DEFAULT_ACCENT;
    applyAccentColor(DEFAULT_ACCENT);
    updateThemeColorMeta(DEFAULT_ACCENT);
    localStorage.removeItem("bubbles_accent");
  });

  const storedIcon = localStorage.getItem("bubbles_icon");
  if (storedIcon) {
    document.getElementById("logo").src = storedIcon;
    document.getElementById("icon-preview").src = storedIcon;
  }

  document.getElementById("icon-upload-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById("logo").src = reader.result;
      document.getElementById("icon-preview").src = reader.result;
      localStorage.setItem("bubbles_icon", reader.result);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("icon-reset-btn").addEventListener("click", () => {
    document.getElementById("logo").src = "/logo.png";
    document.getElementById("icon-preview").src = "/logo.png";
    localStorage.removeItem("bubbles_icon");
  });
}

// ------------------------------------------------------------------
// Image editor (its own page - swapped into #main via the nav)

const imgState = { id: null, naturalWidth: 0, naturalHeight: 0 };
let cropSelection = null;
let cropDragStart = null;

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
    if (data.error) { alert(data.error); return; }
    applyImageState(data);
  } catch (err) {
    alert("Could not open image: " + err);
  }
  e.target.value = "";
});

function applyImageState(data) {
  imgState.id = data.id;
  imgState.naturalWidth = data.width;
  imgState.naturalHeight = data.height;

  const img = document.getElementById("image-preview");
  img.src = data.preview;
  img.style.display = "block";
  document.getElementById("image-empty-state").style.display = "none";
  document.getElementById("image-dims").textContent = `${data.width} × ${data.height}px`;
  document.getElementById("image-resize-w").value = data.width;
  document.getElementById("image-resize-h").value = data.height;
  clearCropSelection();
}

async function applyImageOp(op, params) {
  if (!imgState.id) { alert("Open an image first."); return; }
  try {
    const res = await fetch(`/api/image/${imgState.id}/op`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, params }),
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    applyImageState(data);
  } catch (err) {
    alert("Edit failed: " + err);
  }
}

// Resize (with aspect-lock)
document.getElementById("image-resize-w").addEventListener("input", () => {
  if (!document.getElementById("image-keep-aspect").checked || !imgState.naturalWidth) return;
  const w = parseInt(document.getElementById("image-resize-w").value) || 0;
  if (!w) return;
  const ratio = imgState.naturalHeight / imgState.naturalWidth;
  document.getElementById("image-resize-h").value = Math.round(w * ratio);
});
document.getElementById("image-resize-h").addEventListener("input", () => {
  if (!document.getElementById("image-keep-aspect").checked || !imgState.naturalHeight) return;
  const h = parseInt(document.getElementById("image-resize-h").value) || 0;
  if (!h) return;
  const ratio = imgState.naturalWidth / imgState.naturalHeight;
  document.getElementById("image-resize-w").value = Math.round(h * ratio);
});
document.getElementById("image-resize-btn").addEventListener("click", () => {
  const width = parseInt(document.getElementById("image-resize-w").value);
  const height = parseInt(document.getElementById("image-resize-h").value);
  if (!width || !height) { alert("Enter a width and height."); return; }
  applyImageOp("resize", { width, height });
});

document.getElementById("image-rotate-left").addEventListener("click", () => applyImageOp("rotate", { degrees: -90 }));
document.getElementById("image-rotate-right").addEventListener("click", () => applyImageOp("rotate", { degrees: 90 }));
document.getElementById("image-flip-h").addEventListener("click", () => applyImageOp("flip", { axis: "horizontal" }));
document.getElementById("image-flip-v").addEventListener("click", () => applyImageOp("flip", { axis: "vertical" }));
document.getElementById("image-grayscale-btn").addEventListener("click", () => applyImageOp("grayscale", {}));
document.getElementById("image-sharpen-btn").addEventListener("click", () => applyImageOp("sharpen", {}));

document.getElementById("image-brightness").addEventListener("change", (e) =>
  applyImageOp("brightness", { factor: parseFloat(e.target.value) }));
document.getElementById("image-contrast").addEventListener("change", (e) =>
  applyImageOp("contrast", { factor: parseFloat(e.target.value) }));
document.getElementById("image-saturation").addEventListener("change", (e) =>
  applyImageOp("saturation", { factor: parseFloat(e.target.value) }));

document.getElementById("image-watermark-btn").addEventListener("click", () => {
  const text = document.getElementById("image-watermark-text").value.trim();
  if (!text) { alert("Type some watermark text first."); return; }
  const position = document.getElementById("image-watermark-position").value;
  applyImageOp("watermark", { text, position, opacity: 0.6 });
});

document.getElementById("image-reset-btn").addEventListener("click", async () => {
  if (!imgState.id) return;
  const res = await fetch(`/api/image/${imgState.id}/reset`, { method: "POST" });
  const data = await res.json();
  applyImageState(data);
  document.getElementById("image-brightness").value = 1;
  document.getElementById("image-contrast").value = 1;
  document.getElementById("image-saturation").value = 1;
});

document.getElementById("image-download-btn").addEventListener("click", () => {
  if (!imgState.id) { alert("Open an image first."); return; }
  window.open(`/api/image/${imgState.id}/download?format=PNG`, "_blank");
});

// Crop - drag a selection box directly on the image
const cropWrap = document.getElementById("image-canvas-wrap");
const cropBoxEl = document.getElementById("image-crop-box");

cropWrap.addEventListener("mousedown", (e) => {
  const img = document.getElementById("image-preview");
  if (!imgState.id || img.style.display === "none") return;
  const rect = img.getBoundingClientRect();
  const wrapRect = cropWrap.getBoundingClientRect();
  cropDragStart = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    offsetX: rect.left - wrapRect.left,
    offsetY: rect.top - wrapRect.top,
    rect,
  };
  cropBoxEl.style.display = "block";
  e.preventDefault();
});

cropWrap.addEventListener("mousemove", (e) => {
  if (!cropDragStart) return;
  const { rect, offsetX, offsetY } = cropDragStart;
  const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
  const x = Math.min(curX, cropDragStart.x);
  const y = Math.min(curY, cropDragStart.y);
  const w = Math.abs(curX - cropDragStart.x);
  const h = Math.abs(curY - cropDragStart.y);

  cropBoxEl.style.left = (x + offsetX) + "px";
  cropBoxEl.style.top = (y + offsetY) + "px";
  cropBoxEl.style.width = w + "px";
  cropBoxEl.style.height = h + "px";

  const scaleX = imgState.naturalWidth / rect.width;
  const scaleY = imgState.naturalHeight / rect.height;
  cropSelection = {
    x: Math.round(x * scaleX),
    y: Math.round(y * scaleY),
    width: Math.round(w * scaleX),
    height: Math.round(h * scaleY),
  };
});

window.addEventListener("mouseup", () => { cropDragStart = null; });

function clearCropSelection() {
  cropSelection = null;
  cropBoxEl.style.display = "none";
  cropBoxEl.style.width = "0px";
  cropBoxEl.style.height = "0px";
}

document.getElementById("image-crop-btn").addEventListener("click", () => {
  if (!cropSelection || cropSelection.width < 2 || cropSelection.height < 2) {
    alert("Drag on the image first to select a crop area.");
    return;
  }
  applyImageOp("crop", cropSelection);
});

// ------------------------------------------------------------------
// Custom title bar - only shown when running inside the pywebview
// native window (frameless, so it has no OS title bar of its own).
// In plain-browser fallback mode this stays hidden and the browser's
// own chrome is used instead.

function setupTitleBar() {
  const titlebar = document.getElementById("titlebar");

  const reveal = () => titlebar.classList.remove("hidden");

  if (window.pywebview && window.pywebview.api) {
    reveal();
  } else {
    window.addEventListener("pywebviewready", reveal);
  }

  document.getElementById("titlebar-minimize").addEventListener("click", () => {
    if (window.pywebview) window.pywebview.api.minimize();
  });
  document.getElementById("titlebar-maximize").addEventListener("click", () => {
    if (window.pywebview) window.pywebview.api.toggle_maximize();
  });
  document.getElementById("titlebar-close").addEventListener("click", () => {
    if (window.pywebview) window.pywebview.api.close();
  });
}

// ------------------------------------------------------------------
// Code editor (its own page - browse/edit files in the workspace)

const codeState = { files: [], currentPath: null, dirty: false };

async function loadCodeFileList() {
  const res = await fetch("/api/code/list");
  const data = await res.json();
  codeState.files = data.files || [];
  renderCodeFileList();
}

function renderCodeFileList() {
  const list = document.getElementById("code-file-list");
  list.innerHTML = "";

  const query = document.getElementById("code-file-search").value.trim().toLowerCase();
  const filtered = query
    ? codeState.files.filter((f) => f.toLowerCase().includes(query))
    : codeState.files;

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "8px";
    empty.textContent = query ? "No files match." : "No files in this workspace yet.";
    list.appendChild(empty);
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
  if (data.error) { alert(data.error); return; }

  codeState.currentPath = path;
  codeState.dirty = false;
  document.getElementById("code-current-path").value = path;
  document.getElementById("code-editor").value = data.content;
  renderCodeFileList();
}

document.getElementById("code-editor").addEventListener("input", () => {
  codeState.dirty = true;
});

document.getElementById("code-new-btn").addEventListener("click", () => {
  const path = document.getElementById("code-current-path").value.trim();
  if (!path) { alert("Type a file path first (e.g. notes.md)."); return; }
  codeState.currentPath = path;
  codeState.dirty = true;
  document.getElementById("code-editor").value = "";
  document.getElementById("code-editor").focus();
});

document.getElementById("code-save-btn").addEventListener("click", async () => {
  const path = document.getElementById("code-current-path").value.trim();
  if (!path) { alert("Type a file path first (e.g. notes.md)."); return; }
  const content = document.getElementById("code-editor").value;

  const res = await fetch("/api/code/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }

  codeState.currentPath = path;
  codeState.dirty = false;
  await loadCodeFileList();
});

document.getElementById("code-ask-ai-btn").addEventListener("click", () => {
  const path = codeState.currentPath;
  const content = document.getElementById("code-editor").value;
  if (!path) { alert("Open a file first."); return; }

  document.querySelector('.tab-btn[data-tab="chats"]').click();
  const box = document.getElementById("input-box");
  box.value = `About this file (${path}):\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\`\n\n`;
  box.focus();
});

// ------------------------------------------------------------------
// Init

(async function init() {
  renderIconPlaceholders();
  setupApiTab();
  setupTitleBar();
  setupSettingsTab();
  await Promise.all([loadSettings(), loadTools(), refreshSessions(), loadCodeFileList()]);
  renderChat();
  pollActivity();
})();
