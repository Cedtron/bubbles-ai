import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import multer from "multer";
import sharp from "sharp";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";
const FRONTEND_DIR = path.join(process.cwd(), "frontend");
const ASSETS_DIR = path.join(process.cwd(), "assets");

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Upload handler using in-memory storage
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ------------------------------------------------------------------
// Configuration & State
// ------------------------------------------------------------------

const config = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",
  KIMI_API_KEY: process.env.KIMI_API_KEY || "",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  NOVA_MODEL: process.env.NOVA_MODEL || "amazon.nova-lite-v1:0",
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "",
  GOOGLE_MODEL: process.env.GOOGLE_MODEL === "Gemma4" ? "gemma-4-26b-a4b-it" : (process.env.GOOGLE_MODEL || "gemma-4-26b-a4b-it"),
  OMNIROUTE_BASE_URL: process.env.OMNIROUTE_BASE_URL || "http://localhost:20128/v1",
  OMNIROUTE_API_KEY: process.env.OMNIROUTE_API_KEY || "",
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llama3",
  LOCAL_MODEL_PATH: process.env.LOCAL_MODEL_PATH || "",
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || process.cwd(),
  DEFAULT_PROVIDER: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ? "google" : (process.env.DEFAULT_PROVIDER || "google"),
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || "gpt-4o-mini",
  PROVIDER_FALLBACK_ORDER: (
    process.env.PROVIDER_FALLBACK_ORDER || "google,demo,openai,anthropic,deepseek,kimi,omniroute"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  MAX_TOKENS: parseInt(process.env.MAX_TOKENS || "2000", 10),
  TEMPERATURE: parseFloat(process.env.TEMPERATURE || "0.7"),
  MEMORY_DIR: process.env.MEMORY_DIR || path.join(process.cwd(), ".agent_memory"),
};

const PROVIDERS = ["google", "demo", "openai", "anthropic", "deepseek", "kimi", "omniroute", "ollama", "local", "nova"];
const AGENT_MODES = ["auto", "coding", "debug", "planning", "research"];
const GOOGLE_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
];

// Activity Log
interface ActivityItem {
  time: number;
  kind: string;
  message: string;
}
const activityLog: ActivityItem[] = [];

function logActivity(kind: string, message: string) {
  const item: ActivityItem = { time: Date.now() / 1000, kind, message };
  activityLog.push(item);
  if (activityLog.length > 500) activityLog.shift();
}

// Image Store
interface ImageEntry {
  original: Buffer;
  current: Buffer;
  mime: string;
}
const imageStore: Map<string, ImageEntry> = new Map();
let activeImageId: string | null = null;
let touchedImageIds: string[] = [];

function markImageTouched(id: string) {
  activeImageId = id;
  if (!touchedImageIds.includes(id)) {
    touchedImageIds.push(id);
  }
}

function popTouchedImages(): string[] {
  const copy = [...touchedImageIds];
  touchedImageIds = [];
  return copy;
}

async function getImageState(id: string) {
  const entry = imageStore.get(id);
  if (!entry) throw new Error("Unknown image id");
  const meta = await sharp(entry.current).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const base64 = entry.current.toString("base64");
  return {
    id,
    width,
    height,
    preview: `data:${entry.mime};base64,${base64}`,
  };
}

async function listImages() {
  const list = [];
  for (const id of imageStore.keys()) {
    try {
      const state = await getImageState(id);
      list.push({ ...state, active: id === activeImageId });
    } catch {
      // skip
    }
  }
  return list;
}

// ------------------------------------------------------------------
// System Prompts & Agents
// ------------------------------------------------------------------

const PROMPTS: Record<string, string> = {
  coding: `You are an expert senior software engineer.

Rules:
- Always write clean, production-ready code
- Use best practices
- Add comments where necessary
- Keep responses structured
- If needed, explain briefly before code

Output format:
1. Explanation (short)
2. Code block`,

  debug: `You are an expert debugging assistant.

Rules:
- Carefully analyze the error message, traceback, or symptom described
- Identify the most likely root cause before suggesting a fix
- Prefer the smallest change that correctly fixes the issue
- Call out any assumptions you had to make
- If more information is needed to diagnose the bug, ask for it

Output format:
1. Likely root cause (short)
2. Fix (code block or precise steps)
3. How to verify the fix`,

  planning: `You are an expert software architect and technical planner.

Rules:
- Break the request down into clear, ordered steps or milestones
- Call out key technical decisions and trade-offs
- Flag risks, unknowns, or missing requirements
- Keep the plan actionable, not just theoretical
- Avoid writing full implementation code - this is a plan, not code

Output format:
1. Summary of the goal (1-2 sentences)
2. Step-by-step plan
3. Risks / open questions`,

  research: `You are a thorough technical research assistant.

Rules:
- Compare options objectively (libraries, tools, approaches, patterns)
- Note trade-offs, maturity, and maintenance status where relevant
- Be explicit when you're uncertain rather than guessing confidently
- Keep the summary skimmable, then give supporting detail

Output format:
1. Direct answer / recommendation (short)
2. Comparison or supporting detail
3. Caveats / things worth double-checking`,
};

function autoDetectAgent(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("error") || lower.includes("bug") || lower.includes("fix") || lower.includes("traceback")) {
    return "debug";
  }
  if (lower.includes("plan") || lower.includes("architecture") || lower.includes("design")) {
    return "planning";
  }
  if (lower.includes("research") || lower.includes("find") || lower.includes("compare")) {
    return "research";
  }
  return "coding";
}

// ------------------------------------------------------------------
// AI Generation Providers & Fallback
// ------------------------------------------------------------------

async function generateDemo(prompt: string): Promise<string> {
  const lastLine = prompt.trim().split("\n").pop() || "";
  const snippet = lastLine.length > 120 ? lastLine.slice(0, 120) + "…" : lastLine;
  return (
    "🫧 **Demo mode** - Bubbles AI is ready!\n\n" +
    `You said: "${snippet}"\n\n` +
    "To connect real AI models, open the **AI Brain** tab and configure your API key (Google Gemini, OpenAI, Anthropic, DeepSeek, Kimi) or local Ollama server, then click Save."
  );
}

async function generateGoogle(prompt: string, system?: string): Promise<string> {
  const apiKey = (config.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) throw new Error("No Google API key configured. Provide one in the AI Brain tab.");

  // Candidates in priority order
  const userChoice = config.GOOGLE_MODEL || "gemma-4-26b-a4b-it";
  const candidates = Array.from(new Set([
    userChoice,
    "gemma-4-26b-a4b-it",
    "gemini-3.8-flash",
  ]));

  let lastErr: any = null;
  for (const model of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);

      const promptWithSystem = system ? `[System Instructions:\n${system}]\n\n[User Request:\n${prompt}]` : prompt;

      const payload: any = {
        contents: [{ role: "user", parts: [{ text: promptWithSystem }] }],
        generationConfig: {
          temperature: config.TEMPERATURE,
          maxOutputTokens: config.MAX_TOKENS,
        },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }
      );
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status} (${model}): ${errText.slice(0, 160)}`);
      }

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      if (!parts.length) {
        throw new Error(`Model ${model} returned empty response`);
      }

      const cleanText = parts
        .filter((p: any) => !p.thought)
        .map((p: any) => p.text)
        .join("")
        .trim();
      const finalText = cleanText || parts.map((p: any) => p.text).join("").trim();

      if (finalText) {
        config.GOOGLE_MODEL = model;
        return finalText;
      }
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr || new Error("Google AI generation failed");
}

async function generateOpenAI(prompt: string, system?: string): Promise<string> {
  if (!config.OPENAI_API_KEY) throw new Error("No OpenAI API key");
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.DEFAULT_MODEL || "gpt-4o-mini",
      messages,
      temperature: config.TEMPERATURE,
      max_tokens: config.MAX_TOKENS,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.statusText}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generateAnthropic(prompt: string, system?: string): Promise<string> {
  if (!config.ANTHROPIC_API_KEY) throw new Error("No Anthropic API key");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: config.MAX_TOKENS,
      system: system || undefined,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.statusText}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function generateDeepSeek(prompt: string, system?: string): Promise<string> {
  if (!config.DEEPSEEK_API_KEY) throw new Error("No DeepSeek API key");
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: config.TEMPERATURE,
      max_tokens: config.MAX_TOKENS,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek error: ${res.statusText}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generateOllama(prompt: string, system?: string): Promise<string> {
  const url = `${config.OLLAMA_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.OLLAMA_MODEL || "llama3",
      messages,
      temperature: config.TEMPERATURE,
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generateWithFallback(prompt: string, system?: string, preferred?: string): Promise<{ provider: string; response: string }> {
  const pref = (preferred || config.DEFAULT_PROVIDER || "demo").toLowerCase();
  const rawChain = [pref, ...config.PROVIDER_FALLBACK_ORDER.filter((p) => p !== pref)];
  const chain = Array.from(new Set(rawChain));

  let lastError: any = null;
  for (const name of chain) {
    try {
      logActivity("provider", `trying ${name}…`);
      let reply = "";
      if (name === "demo") {
        reply = await generateDemo(prompt);
      } else if (name === "google") {
        reply = await generateGoogle(prompt, system);
      } else if (name === "openai") {
        reply = await generateOpenAI(prompt, system);
      } else if (name === "anthropic") {
        reply = await generateAnthropic(prompt, system);
      } else if (name === "deepseek") {
        reply = await generateDeepSeek(prompt, system);
      } else if (name === "ollama") {
        reply = await generateOllama(prompt, system);
      } else {
        // Fallback for omniroute/local/nova
        throw new Error(`Provider ${name} not configured`);
      }
      logActivity("provider", `${name} responded`);
      return { provider: name, response: reply };
    } catch (err: any) {
      logActivity("provider", `${name} failed: ${err?.message || err}`);
      lastError = err;
      continue;
    }
  }

  // Final fallback to demo mode so user always gets a working experience
  const demoReply = await generateDemo(prompt);
  return { provider: "demo", response: demoReply };
}

// ------------------------------------------------------------------
// Tools Execution
// ------------------------------------------------------------------

const TOOL_REGISTRY: Record<string, { description: string; fn: (args: any) => Promise<string> }> = {
  read_file: {
    description: 'Read a text file. args: {"path": "relative/path.txt"}',
    fn: async (args) => {
      const fullPath = path.resolve(config.WORKSPACE_DIR, args.path || "");
      if (!fs.existsSync(fullPath)) return `File not found: ${args.path}`;
      return fs.readFileSync(fullPath, "utf-8");
    },
  },
  list_files: {
    description: 'List files in a directory. args: {"path": ".", "recursive": false}',
    fn: async (args) => {
      const dir = path.resolve(config.WORKSPACE_DIR, args.path || ".");
      if (!fs.existsSync(dir)) return "Directory not found";
      const recursive = !!args.recursive;

      function walk(current: string, prefix = ""): string[] {
        let results: string[] = [];
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) {
            results.push(rel + "/");
            if (recursive) results = results.concat(walk(path.join(current, e.name), rel));
          } else {
            results.push(rel);
          }
        }
        return results;
      }
      return walk(dir).join("\n") || "(empty directory)";
    },
  },
  write_file: {
    description: 'Write content to a file (creates/overwrites). args: {"path": "...", "content": "..."}',
    fn: async (args) => {
      const fullPath = path.resolve(config.WORKSPACE_DIR, args.path || "");
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, args.content || "", "utf-8");
      return `Wrote ${args.path}`;
    },
  },
  run_command: {
    description: 'Run a shell command. args: {"command": "ls -la"}',
    fn: async (args) => {
      return new Promise((resolve) => {
        exec(args.command || "", { cwd: config.WORKSPACE_DIR }, (err, stdout, stderr) => {
          const code = err ? err.code || 1 : 0;
          resolve(`exit code: ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        });
      });
    },
  },
  run_python: {
    description: 'Run a python or node snippet in a subprocess. args: {"code": "console.log(1+1)"}',
    fn: async (args) => {
      return new Promise((resolve) => {
        exec(`node -e ${JSON.stringify(args.code || "")}`, { cwd: config.WORKSPACE_DIR }, (err, stdout, stderr) => {
          resolve(`exit code: ${err ? 1 : 0}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        });
      });
    },
  },
  git_status: {
    description: "Show git status. args: {}",
    fn: async () => {
      return new Promise((resolve) => {
        exec("git status", { cwd: config.WORKSPACE_DIR }, (err, stdout, stderr) => {
          resolve(stdout || stderr || "No git output");
        });
      });
    },
  },
  git_diff: {
    description: "Show git diff. args: {}",
    fn: async () => {
      return new Promise((resolve) => {
        exec("git diff", { cwd: config.WORKSPACE_DIR }, (err, stdout, stderr) => {
          resolve(stdout || stderr || "No diff");
        });
      });
    },
  },
  web_search: {
    description: 'Search the web. args: {"query": "..."}',
    fn: async (args) => {
      return `Web search result for "${args.query}": Search capability simulated in dev workstation.`;
    },
  },
  fetch_page: {
    description: 'Fetch a webpage and return readable text. args: {"url": "https://..."}',
    fn: async (args) => {
      try {
        const res = await fetch(args.url);
        const text = await res.text();
        return text.slice(0, 3000);
      } catch (e: any) {
        return `Failed to fetch: ${e.message}`;
      }
    },
  },
  image_list: {
    description: "List images open in this session with id and dimensions. args: {}",
    fn: async () => {
      const list = await listImages();
      if (!list.length) return "No images open. Attach one in chat or open one in Images tab.";
      return list.map((img) => `- ${img.id}: ${img.width}x${img.height}${img.active ? " (active)" : ""}`).join("\n");
    },
  },
  image_edit: {
    description: 'Edit an image. args: {"id": "<optional>", "op": "resize|rotate|flip|grayscale|brightness|contrast|saturation|blur|sharpen|crop|watermark", "params": {...}}',
    fn: async (args) => {
      const id = args.id || activeImageId;
      if (!id) return "No image open to edit.";
      try {
        const state = await applyImageOp(id, args.op, args.params || {});
        return `Applied ${args.op} to image ${state.id}. New size: ${state.width}x${state.height}.`;
      } catch (e: any) {
        return `Error applying ${args.op}: ${e.message}`;
      }
    },
  },
};

function buildToolPrompt(enabledTools: string[]): string {
  const lines = [
    "You have access to the following tools. To use one, respond with ONLY a fenced block in this exact format (no other text in that reply):",
    "```tool",
    '{"name": "<tool_name>", "args": {...}}',
    "```",
    "If you don't need a tool, just answer normally.",
    "",
    "Available tools:",
  ];
  for (const name of enabledTools) {
    if (TOOL_REGISTRY[name]) {
      lines.push(`- ${name}: ${TOOL_REGISTRY[name].description}`);
    }
  }
  return lines.join("\n");
}

function parseToolCall(response: string): { name: string; args: any } | null {
  const match = /```tool\s*(\{[\s\S]*?\})\s*```/.exec(response || "");
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    if (data.name) {
      data.args = data.args || {};
      return data;
    }
  } catch {
    // Malformed JSON
  }
  return null;
}

// ------------------------------------------------------------------
// Image Operations (Sharp)
// ------------------------------------------------------------------

async function applyImageOp(imageId: string, op: string, params: any) {
  const entry = imageStore.get(imageId);
  if (!entry) throw new Error("Unknown image id");

  let img = sharp(entry.current);
  const meta = await img.metadata();
  const currentWidth = meta.width || 800;
  const currentHeight = meta.height || 600;

  if (op === "resize") {
    const w = Math.min(4000, Math.max(1, parseInt(params.width || currentWidth, 10)));
    const h = Math.min(4000, Math.max(1, parseInt(params.height || currentHeight, 10)));
    entry.current = await img.resize(w, h).toBuffer();
  } else if (op === "rotate") {
    const deg = parseFloat(params.degrees || 90);
    entry.current = await img.rotate(deg, { background: { r: 255, g: 255, b: 255, alpha: 0 } }).toBuffer();
  } else if (op === "flip") {
    const axis = params.axis || "horizontal";
    if (axis === "horizontal") {
      entry.current = await img.flop().toBuffer();
    } else {
      entry.current = await img.flip().toBuffer();
    }
  } else if (op === "grayscale") {
    entry.current = await img.grayscale().toBuffer();
  } else if (op === "brightness") {
    const factor = parseFloat(params.factor || 1.0);
    entry.current = await img.modulate({ brightness: factor }).toBuffer();
  } else if (op === "contrast") {
    const factor = parseFloat(params.factor || 1.0);
    entry.current = await img.linear(factor, -(128 * factor) + 128).toBuffer();
  } else if (op === "saturation") {
    const factor = parseFloat(params.factor || 1.0);
    entry.current = await img.modulate({ saturation: factor }).toBuffer();
  } else if (op === "blur") {
    const radius = Math.max(0.3, Math.min(100, parseFloat(params.radius || 2)));
    entry.current = await img.blur(radius).toBuffer();
  } else if (op === "sharpen") {
    entry.current = await img.sharpen().toBuffer();
  } else if (op === "crop") {
    const x = Math.max(0, parseInt(params.x || 0, 10));
    const y = Math.max(0, parseInt(params.y || 0, 10));
    const w = Math.min(currentWidth - x, Math.max(1, parseInt(params.width || currentWidth, 10)));
    const h = Math.min(currentHeight - y, Math.max(1, parseInt(params.height || currentHeight, 10)));
    entry.current = await img.extract({ left: x, top: y, width: w, height: h }).toBuffer();
  } else if (op === "watermark") {
    const text = String(params.text || "Bubbles AI")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const opacity = parseFloat(params.opacity || 0.6);
    const fontSize = Math.max(16, Math.floor(currentWidth / 20));
    const pad = 20;

    let posX = currentWidth - pad - text.length * fontSize * 0.6;
    let posY = currentHeight - pad;
    const pos = params.position || "bottom-right";

    if (pos === "bottom-left") {
      posX = pad;
      posY = currentHeight - pad;
    } else if (pos === "top-right") {
      posX = currentWidth - pad - text.length * fontSize * 0.6;
      posY = pad + fontSize;
    } else if (pos === "top-left") {
      posX = pad;
      posY = pad + fontSize;
    } else if (pos === "center") {
      posX = currentWidth / 2 - (text.length * fontSize * 0.3);
      posY = currentHeight / 2;
    }

    const svg = `
      <svg width="${currentWidth}" height="${currentHeight}">
        <text x="${Math.max(10, posX)}" y="${posY}" font-size="${fontSize}" font-family="sans-serif" font-weight="bold" fill="rgba(255,255,255,${opacity})">${text}</text>
      </svg>
    `;
    entry.current = await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toBuffer();
  } else {
    throw new Error(`Unknown image op: ${op}`);
  }

  markImageTouched(imageId);
  return getImageState(imageId);
}

// ------------------------------------------------------------------
// Sessions Management
// ------------------------------------------------------------------

const SESSIONS_DIR = path.join(config.MEMORY_DIR, "chat_sessions");
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function listSessionsFromDisk() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  const sessions = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8"));
      sessions.push({
        id: data.id,
        title: data.title || "Untitled chat",
        updated_at: data.updated_at || 0,
      });
    } catch {
      // ignore
    }
  }
  sessions.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return sessions;
}

function autoTitle(messages: any[]): string {
  for (const m of messages) {
    if (m.role === "user" && m.content) {
      const firstLine = m.content.split("\n")[0].trim();
      return firstLine.slice(0, 40) || "Chat";
    }
  }
  return "New Chat";
}

// ------------------------------------------------------------------
// API Routes
// ------------------------------------------------------------------

// 1. Chat API
app.post("/api/chat", async (req, res) => {
  const { message = "", enabled_tools = [], agent_mode = "auto" } = req.body;
  const text = String(message).trim();

  if (!text) {
    return res.status(400).json({ error: "Empty message" });
  }

  popTouchedImages();

  let agentType = agent_mode;
  let cleanedText = text;

  if (text.startsWith("/")) {
    const parts = text.split(" ");
    const cmd = parts[0].slice(1);
    if (AGENT_MODES.includes(cmd)) {
      agentType = cmd;
      cleanedText = parts.slice(1).join(" ");
    }
  }

  if (agentType === "auto") {
    agentType = autoDetectAgent(cleanedText);
  }

  let systemPrompt = PROMPTS[agentType] || PROMPTS.coding;
  if (enabled_tools.length > 0) {
    systemPrompt += "\n\n" + buildToolPrompt(enabled_tools);
  }

  logActivity("system", `Routing to: ${agentType}`);

  let reply = "";
  let transcript = "";
  const maxIterations = enabled_tools.length > 0 ? 4 : 1;

  try {
    for (let i = 0; i < maxIterations; i++) {
      const { response } = await generateWithFallback(cleanedText + transcript, systemPrompt);
      reply = response;

      if (!enabled_tools.length) break;

      const call = parseToolCall(response);
      if (!call) break;

      logActivity("tool", `call: ${call.name}`);
      const toolDef = TOOL_REGISTRY[call.name];
      let result = "";
      if (!toolDef || !enabled_tools.includes(call.name)) {
        result = `Error: tool '${call.name}' is not enabled or unknown.`;
      } else {
        try {
          result = await toolDef.fn(call.args);
        } catch (e: any) {
          result = `Error running tool: ${e.message}`;
        }
      }

      transcript += `\n\nTool Call: ${JSON.stringify(call)}\nTool Result:\n${result.slice(0, 3000)}`;
    }
  } catch (err: any) {
    reply = `❌ Something went wrong: ${err.message || err}`;
  }

  const updatedImages = [];
  for (const imgId of popTouchedImages()) {
    try {
      updatedImages.push(await getImageState(imgId));
    } catch {
      // skip
    }
  }

  res.json({ reply, updated_images: updatedImages });
});

// 2. Sessions API
app.get("/api/sessions", (req, res) => {
  res.json(listSessionsFromDisk());
});

app.get("/api/sessions/search", (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const all = listSessionsFromDisk();
  const filtered = q ? all.filter((s) => s.title.toLowerCase().includes(q)) : all;
  res.json(filtered);
});

app.post("/api/sessions", (req, res) => {
  const { messages = [], id } = req.body;
  if (!messages.length) {
    return res.status(400).json({ error: "No messages to save" });
  }

  const title = autoTitle(messages);
  const sessionId = id || `chat-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  const data = {
    id: sessionId,
    title,
    updated_at: Date.now() / 1000,
    messages,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  logActivity("system", `Saved chat session: ${sessionId}`);
  res.json({ id: sessionId, title });
});

app.get("/api/sessions/:id", (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Session not found" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/sessions/:id", (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${req.params.id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  res.json({ ok: true });
});

// 3. Settings API
app.get("/api/settings", (req, res) => {
  res.json({
    ...config,
    providers: PROVIDERS,
    agent_modes: AGENT_MODES,
    fallback_order: config.PROVIDER_FALLBACK_ORDER,
    google_models: GOOGLE_MODELS,
  });
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};
  for (const [key, val] of Object.entries(body)) {
    if (key === "fallback_order") {
      if (typeof val === "string") {
        config.PROVIDER_FALLBACK_ORDER = val.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (Array.isArray(val)) {
        config.PROVIDER_FALLBACK_ORDER = val;
      }
    } else if (key in config) {
      (config as any)[key] = val;
      process.env[key] = String(val);
    }
  }
  logActivity("system", "Settings updated");
  res.json({ ok: true });
});

// 4. Tools API
app.get("/api/tools", (req, res) => {
  res.json(
    Object.entries(TOOL_REGISTRY).map(([name, meta]) => ({
      name,
      description: meta.description,
    }))
  );
});

// 5. OpenAI Compatible Endpoints
app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [{ id: "bubbles-ai", object: "model", owned_by: "bubbles-ai" }],
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  const { messages = [] } = req.body;
  let userText = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userText = messages[i].content;
      break;
    }
  }

  if (!userText) {
    return res.status(400).json({ error: { message: "No user message found" } });
  }

  try {
    const { response } = await generateWithFallback(userText);
    res.json({
      id: "bubbles-ai-response",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.body.model || "bubbles-ai",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: response },
          finish_reason: "stop",
        },
      ],
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// 6. Terminal Execution & Activity Log
app.post("/api/terminal/run", (req, res) => {
  const command = String(req.body.command || "").trim();
  if (!command) return res.status(400).json({ error: "Empty command" });

  logActivity("terminal", `$ ${command}`);
  exec(command, { cwd: config.WORKSPACE_DIR }, (err, stdout, stderr) => {
    const returncode = err ? err.code || 1 : 0;
    logActivity("terminal", `exit ${returncode}`);
    res.json({ returncode, stdout, stderr });
  });
});

app.get("/api/activity", (req, res) => {
  const since = parseFloat(String(req.query.since || "0"));
  const entries = activityLog.filter((item) => item.time > since);
  res.json(entries);
});

// 7. Connection Testing
app.post("/api/test-connection", async (req, res) => {
  const url = String(req.body.url || "").trim().replace(/\/+$/, "");
  if (!url) return res.json({ ok: false, message: "No URL set." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const probe = `${url}/models`;
    const resp = await fetch(probe, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      let extra = "";
      try {
        const data = await resp.json();
        if (data.data) extra = ` (${data.data.length} model(s) listed)`;
      } catch {
        // ignore
      }
      return res.json({ ok: true, message: `Connected${extra}.` });
    }
    return res.json({ ok: false, message: `Got HTTP ${resp.status} from ${probe}` });
  } catch (e: any) {
    clearTimeout(timeout);
    return res.json({ ok: false, message: `Connection failed: ${e.message}` });
  }
});

app.post("/api/test-google", async (req, res) => {
  const model = (req.body?.model || config.GOOGLE_MODEL || "gemma-4-26b-a4b-it").trim();
  if (req.body?.key) {
    config.GOOGLE_API_KEY = req.body.key;
  }
  if (model) {
    config.GOOGLE_MODEL = model;
  }

  try {
    const reply = await generateGoogle("Respond with 'Google AI Brain is online and ready!' in 7 words.");
    return res.json({
      ok: true,
      message: `Connected to Google AI successfully! (${config.GOOGLE_MODEL})\nResponse: "${reply}"`,
      model: config.GOOGLE_MODEL,
    });
  } catch (err: any) {
    return res.json({
      ok: false,
      message: `Google AI test failed: ${err.message}`,
    });
  }
});

// Model Status & Testing Dashboard
app.get("/api/models/status", async (req, res) => {
  const hasGoogleKey = Boolean(config.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  const models = [
    {
      id: "gemma-4-26b-a4b-it",
      name: "Google Gemma 4",
      provider: "google",
      status: hasGoogleKey ? "online" : "requires_key",
      role: "Primary Built-in Intelligence (Multi-Agent)",
      context: "128k tokens",
      isDefault: config.GOOGLE_MODEL === "gemma-4-26b-a4b-it",
      category: "google",
      capabilities: ["Reasoning", "Code Analysis", "Tool Calling", "System Prompts"],
    },
    {
      id: "gemini-3.8-flash",
      name: "Google Gemini 3.8 Flash",
      provider: "google",
      status: hasGoogleKey ? "available" : "requires_key",
      role: "High-Speed Multimodal Cloud Model",
      context: "1M tokens",
      isDefault: config.GOOGLE_MODEL === "gemini-3.8-flash",
      category: "google",
      capabilities: ["Ultra Low Latency", "Large Context", "Multimodal", "Vision"],
    },
    {
      id: "gemini-flash-latest",
      name: "Google Gemini Flash (Latest)",
      provider: "google",
      status: hasGoogleKey ? "available" : "requires_key",
      role: "Production Cloud Flash Alias",
      context: "1M tokens",
      isDefault: config.GOOGLE_MODEL === "gemini-flash-latest",
      category: "google",
      capabilities: ["General Text", "Code Generation", "Fast Summary"],
    },
    {
      id: "gemini-3.1-pro-preview",
      name: "Google Gemini 3.1 Pro",
      provider: "google",
      status: hasGoogleKey ? "available" : "requires_key",
      role: "Advanced STEM & Deep Reasoning",
      context: "2M tokens",
      isDefault: config.GOOGLE_MODEL === "gemini-3.1-pro-preview",
      category: "google",
      capabilities: ["Complex Logic", "Architecture", "Deep Debugging"],
    },
    {
      id: "gpt-4o-mini",
      name: "OpenAI GPT-4o Mini",
      provider: "openai",
      status: config.OPENAI_API_KEY ? "configured" : "requires_key",
      role: "Cloud Alternative Provider",
      context: "128k tokens",
      isDefault: config.DEFAULT_PROVIDER === "openai",
      category: "cloud",
      capabilities: ["Chat", "Tool Calling"],
    },
    {
      id: "claude-3-5-sonnet",
      name: "Anthropic Claude 3.5 Sonnet",
      provider: "anthropic",
      status: config.ANTHROPIC_API_KEY ? "configured" : "requires_key",
      role: "Cloud Alternative Provider",
      context: "200k tokens",
      isDefault: config.DEFAULT_PROVIDER === "anthropic",
      category: "cloud",
      capabilities: ["Nuanced Writing", "Coding"],
    },
    {
      id: "deepseek-chat",
      name: "DeepSeek V3",
      provider: "deepseek",
      status: config.DEEPSEEK_API_KEY ? "configured" : "requires_key",
      role: "Cloud Alternative Provider",
      context: "64k tokens",
      isDefault: config.DEFAULT_PROVIDER === "deepseek",
      category: "cloud",
      capabilities: ["Code Generation", "Math"],
    },
    {
      id: "moonshot-v1",
      name: "Kimi Moonshot",
      provider: "kimi",
      status: config.KIMI_API_KEY ? "configured" : "requires_key",
      role: "Long-Context Cloud Alternative",
      context: "128k tokens",
      isDefault: config.DEFAULT_PROVIDER === "kimi",
      category: "cloud",
      capabilities: ["Long Document Comprehension"],
    },
    {
      id: "ollama-local",
      name: `Ollama (${config.OLLAMA_MODEL || "llama3"})`,
      provider: "ollama",
      status: "local_ready",
      role: "Local Offline Inference",
      context: "8k tokens",
      isDefault: config.DEFAULT_PROVIDER === "ollama",
      category: "local",
      capabilities: ["100% Offline", "Zero Cloud Telemetry"],
    },
  ];

  res.json({
    activeProvider: config.DEFAULT_PROVIDER,
    activeGoogleModel: config.GOOGLE_MODEL,
    models,
  });
});

app.post("/api/models/test-single", async (req, res) => {
  const modelId = String(req.body?.modelId || "gemma-4-26b-a4b-it");
  const startTime = Date.now();

  try {
    if (modelId.startsWith("gemini") || modelId.startsWith("gemma")) {
      const oldModel = config.GOOGLE_MODEL;
      config.GOOGLE_MODEL = modelId;
      const resp = await generateGoogle("Hello! Reply with 'Operational' in one word.");
      config.GOOGLE_MODEL = oldModel;
      const latencyMs = Date.now() - startTime;
      return res.json({ ok: true, latencyMs, response: resp.slice(0, 100), modelId });
    } else if (modelId.startsWith("gpt")) {
      const resp = await generateOpenAI("Hello! Reply with 'Operational' in one word.");
      const latencyMs = Date.now() - startTime;
      return res.json({ ok: true, latencyMs, response: resp.slice(0, 100), modelId });
    } else if (modelId.startsWith("claude")) {
      const resp = await generateAnthropic("Hello! Reply with 'Operational' in one word.");
      const latencyMs = Date.now() - startTime;
      return res.json({ ok: true, latencyMs, response: resp.slice(0, 100), modelId });
    } else if (modelId.startsWith("deepseek")) {
      const resp = await generateDeepSeek("Hello! Reply with 'Operational' in one word.");
      const latencyMs = Date.now() - startTime;
      return res.json({ ok: true, latencyMs, response: resp.slice(0, 100), modelId });
    } else if (modelId === "ollama-local") {
      const resp = await generateOllama("Hello! Reply with 'Operational' in one word.");
      const latencyMs = Date.now() - startTime;
      return res.json({ ok: true, latencyMs, response: resp.slice(0, 100), modelId });
    } else {
      return res.json({ ok: false, error: "Unsupported test model" });
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return res.json({ ok: false, error: err.message, latencyMs, modelId });
  }
});

// Desktop Launcher Downloads
app.get("/api/desktop/files/:file", (req, res) => {
  const fileName = path.basename(req.params.file);
  const filePath = path.join(process.cwd(), "desktop", fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }
  res.download(filePath, fileName);
});

// 8. Workspace & Code Editor API
app.get("/api/workspace/files", (req, res) => {
  try {
    const entries = fs.readdirSync(config.WORKSPACE_DIR, { withFileTypes: true });
    const files = entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name);
    res.json({ path: config.WORKSPACE_DIR, files });
  } catch (err: any) {
    res.json({ path: config.WORKSPACE_DIR, files: [], error: err.message });
  }
});

app.get("/api/code/list", (req, res) => {
  try {
    function walk(dir: string, prefix = ""): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of list) {
        if (item.name.startsWith(".") || item.name === "node_modules" || item.name === "dist") continue;
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          results = results.concat(walk(path.join(dir, item.name), rel));
        } else {
          results.push(rel);
        }
      }
      return results;
    }
    const files = walk(config.WORKSPACE_DIR);
    res.json({ path: config.WORKSPACE_DIR, files });
  } catch (err: any) {
    res.json({ path: config.WORKSPACE_DIR, files: [], error: err.message });
  }
});

app.get("/api/code/file", (req, res) => {
  const relPath = String(req.query.path || "");
  if (!relPath) return res.status(400).json({ error: "path is required" });
  const full = path.resolve(config.WORKSPACE_DIR, relPath);
  if (!fs.existsSync(full)) return res.status(404).json({ error: `Not found: ${relPath}` });

  try {
    const content = fs.readFileSync(full, "utf-8");
    res.json({ path: relPath, content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/code/file", (req, res) => {
  const { path: relPath, content = "" } = req.body;
  if (!relPath) return res.status(400).json({ error: "path is required" });
  const full = path.resolve(config.WORKSPACE_DIR, relPath);

  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
    logActivity("system", `code editor saved: ${relPath}`);
    res.json({ ok: true, path: relPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. File & Image Uploads
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file in request" });
  const filename = req.file.originalname || "upload.txt";
  const ext = path.extname(filename).toLowerCase();
  const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext);

  if (isImage) {
    try {
      const id = Math.random().toString(36).substring(2, 10);
      const mime = req.file.mimetype || "image/png";
      const buffer = req.file.buffer;

      imageStore.set(id, { original: buffer, current: buffer, mime });
      markImageTouched(id);
      logActivity("system", `image attached in chat: ${filename} (${id})`);
      const state = await getImageState(id);
      return res.json({
        filename,
        type: "image",
        id: state.id,
        width: state.width,
        height: state.height,
        preview: state.preview,
      });
    } catch (err: any) {
      return res.status(400).json({ error: `Could not process image: ${err.message}` });
    }
  }

  // Text file
  const dest = path.join(config.WORKSPACE_DIR, filename);
  fs.writeFileSync(dest, req.file.buffer);
  logActivity("system", `file uploaded: ${filename}`);
  let preview = "";
  try {
    preview = req.file.buffer.toString("utf-8").slice(0, 4000);
  } catch {
    preview = "(binary file)";
  }
  res.json({ filename, path: dest, preview });
});

app.post("/api/image/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file in request" });
  try {
    const id = Math.random().toString(36).substring(2, 10);
    const mime = req.file.mimetype || "image/png";
    const buffer = req.file.buffer;

    imageStore.set(id, { original: buffer, current: buffer, mime });
    markImageTouched(id);
    logActivity("system", `image opened: ${id}`);
    const state = await getImageState(id);
    res.json(state);
  } catch (err: any) {
    res.status(400).json({ error: `Could not read image: ${err.message}` });
  }
});

app.post("/api/image/:id/op", async (req, res) => {
  const { id } = req.params;
  const { op, params } = req.body;
  try {
    const state = await applyImageOp(id, op, params || {});
    res.json(state);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/image/:id/reset", async (req, res) => {
  const { id } = req.params;
  const entry = imageStore.get(id);
  if (!entry) return res.status(404).json({ error: "Unknown image id" });
  entry.current = Buffer.from(entry.original);
  markImageTouched(id);
  try {
    const state = await getImageState(id);
    res.json(state);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/image/:id/download", async (req, res) => {
  const { id } = req.params;
  const format = String(req.query.format || "PNG").toUpperCase();
  const entry = imageStore.get(id);
  if (!entry) return res.status(404).json({ error: "Unknown image id" });

  try {
    let outBuf: Buffer;
    let mime = "image/png";
    if (format === "JPEG" || format === "JPG") {
      outBuf = await sharp(entry.current).jpeg().toBuffer();
      mime = "image/jpeg";
    } else {
      outBuf = await sharp(entry.current).png().toBuffer();
    }
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="bubbles-edit.${format.toLowerCase()}"`);
    res.send(outBuf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Static files & Frontend Serving
app.use(express.static(FRONTEND_DIR));
app.use("/assets", express.static(ASSETS_DIR));

// Fallback for logo
app.get("/logo.png", (req, res) => {
  const frontendLogo = path.join(FRONTEND_DIR, "logo.png");
  if (fs.existsSync(frontendLogo)) return res.sendFile(frontendLogo);
  const assetLogo = path.join(ASSETS_DIR, "logo.png");
  if (fs.existsSync(assetLogo)) return res.sendFile(assetLogo);
  res.status(404).end();
});

app.use((req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Bubbles AI running on http://${HOST}:${PORT}`);
});
