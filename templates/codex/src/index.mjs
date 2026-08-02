import { mkdirSync } from "node:fs";

import { createApp } from "./app.mjs";
import { CodexAppServer, normalizeBaseUrl } from "./codex-app-server.mjs";
import { createStore } from "./store.mjs";

const port = Number(process.env.PORT || 8080);
const dbPath = process.env.DB_PATH || "/data/agents.db";
const workspaceRoot = process.env.WORKSPACE_ROOT || "/workspace";
const codexHome = process.env.CODEX_HOME || "/codex-home";
const baseUrl = process.env.MODEL_BASE_URL || process.env.LITELLM_BASE_URL || "https://api.openai.com/v1";
const apiKey = process.env.MODEL_API_KEY || process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY || "";
const defaultModel = process.env.DEFAULT_MODEL || process.env.LITELLM_DEFAULT_MODEL || "gpt-5.6-sol-high";
const configuredModels = (process.env.MODEL_MODELS || process.env.LITELLM_MODELS || defaultModel)
  .split(",").map((value) => value.trim()).filter(Boolean);

if (!apiKey) throw new Error("MODEL_API_KEY, LITELLM_API_KEY, or OPENAI_API_KEY is required");
mkdirSync(workspaceRoot, { recursive: true });
mkdirSync(codexHome, { recursive: true });

const store = createStore(dbPath);
const codex = new CodexAppServer({ baseUrl, apiKey, defaultModel, codexHome });
await codex.start();

async function listModels() {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`model discovery returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) throw new Error("model discovery returned an invalid response");
    return payload;
  } catch (error) {
    console.warn(`[models] ${error.message}; using configured fallback`);
    return { object: "list", data: configuredModels.map((id) => ({ id, object: "model", owned_by: "runtime_backend" })) };
  }
}

const app = createApp({
  store,
  codex,
  workspaceRoot,
  defaultModel,
  listModels,
  runtimeApiKey: process.env.RUNTIME_API_KEY || "",
});
const server = app.listen(port, "0.0.0.0", () => console.log(`[boot] Codex runtime listening on :${port}`));

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[shutdown] ${signal}`);
  server.close(() => {
    codex.stop();
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
