# Codex app-server runtime

This template exposes the Codex CLI app-server through the Anthropic Managed
Agents API used by LiteLLM Agent Control Plane. Each managed-agent session maps
to a durable Codex thread, while model calls go to any OpenAI
Responses-compatible endpoint.

## Run locally

```bash
docker build -t lap-codex-runtime .
docker run --rm -p 8080:8080 \
  -e MODEL_BASE_URL=https://api.openai.com/v1 \
  -e MODEL_API_KEY="$OPENAI_API_KEY" \
  -e DEFAULT_MODEL=gpt-5.6-sol-high \
  -e RUNTIME_API_KEY=change-me \
  -v codex-runtime-data:/data \
  -v codex-runtime-home:/codex-home \
  lap-codex-runtime
```

`MODEL_BASE_URL` may include `/v1`; it is appended when omitted. The same
settings can use the aliases `LITELLM_BASE_URL`, `LITELLM_API_KEY`, and
`LITELLM_DEFAULT_MODEL`. `RUNTIME_API_KEY` protects the runtime HTTP API and is
separate from the model provider credential.

Verify a running instance with:

```bash
BASE=http://localhost:8080 RUNTIME_API_KEY=change-me MODEL=gpt-5.6-sol-high ./scripts/smoke.sh
```

The container pins Codex CLI because app-server is an experimental protocol.
Upgrade the `CODEX_CLI_VERSION` build argument only after the unit and smoke
tests pass against the new version.
