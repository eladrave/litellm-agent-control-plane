import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

function toml(value) {
  return JSON.stringify(String(value));
}

export function normalizeBaseUrl(value) {
  const base = value.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export class CodexAppServer extends EventEmitter {
  constructor({ baseUrl, apiKey, defaultModel, codexHome, codexBin = "codex" }) {
    super();
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.codexHome = codexHome;
    this.codexBin = codexBin;
    this.pending = new Map();
    this.threads = new Set();
    this.nextId = 1;
    this.child = null;
  }

  async start() {
    if (this.child) return;
    const args = [
      "app-server", "--listen", "stdio://",
      "-c", `model=${toml(this.defaultModel)}`,
      "-c", 'model_provider="runtime_backend"',
      "-c", 'model_providers.runtime_backend.name="Runtime Backend"',
      "-c", `model_providers.runtime_backend.base_url=${toml(this.baseUrl)}`,
      "-c", 'model_providers.runtime_backend.env_key="RUNTIME_MODEL_API_KEY"',
      "-c", 'model_providers.runtime_backend.wire_api="responses"',
    ];
    this.child = spawn(this.codexBin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: this.codexHome, RUNTIME_MODEL_API_KEY: this.apiKey },
    });
    this.child.once("exit", (code, signal) => this.failAll(new Error(`codex app-server exited (${code ?? signal})`)));
    this.child.stderr.on("data", (chunk) => process.stderr.write(`[codex] ${chunk}`));
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line));
    await this.request("initialize", {
      clientInfo: { name: "litellm-agent-control-plane", title: "LAP Codex Runtime", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }

  send(message) {
    if (!this.child?.stdin?.writable) throw new Error("codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id != null && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Codex JSON-RPC error"));
      else pending.resolve(message.result);
      return;
    }
    if (message.id != null && message.method) {
      this.answerServerRequest(message);
      return;
    }
    if (message.method) this.emit("notification", message.method, message.params || {});
  }

  answerServerRequest(message) {
    let result = {};
    if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
      result = { decision: "decline" };
    } else if (message.method === "item/tool/requestUserInput") {
      result = { answers: {} };
    } else if (message.method === "item/permissions/requestApproval") {
      result = { permissions: {} };
    }
    this.send({ jsonrpc: "2.0", id: message.id, result });
  }

  async startThread({ cwd, model, instructions }) {
    const result = await this.request("thread/start", {
      cwd,
      model,
      modelProvider: "runtime_backend",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      developerInstructions: instructions || null,
      ephemeral: false,
    });
    if (result?.thread?.id) this.threads.add(result.thread.id);
    return result;
  }

  async ensureThread(threadId) {
    if (this.threads.has(threadId)) return;
    await this.request("thread/resume", { threadId });
    this.threads.add(threadId);
  }

  startTurn(threadId, text, model) {
    return this.request("turn/start", {
      threadId,
      model,
      approvalPolicy: "never",
      input: [{ type: "text", text, text_elements: [] }],
    });
  }

  interrupt(threadId, turnId) {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  failAll(error) {
    const child = this.child;
    this.child = null;
    this.threads.clear();
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    if (child) this.emit("exit", error);
  }

  healthy() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode == null);
  }

  stop() {
    if (!this.child) return;
    this.child.kill("SIGTERM");
    this.child = null;
  }
}
