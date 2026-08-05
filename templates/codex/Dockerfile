FROM node:20

ARG CODEX_CLI_VERSION=0.146.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_CLI_VERSION}"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

RUN mkdir -p /data /workspace /codex-home

ENV PORT=8080 \
    DB_PATH=/data/agents.db \
    WORKSPACE_ROOT=/workspace \
    CODEX_HOME=/codex-home \
    DEFAULT_MODEL=gpt-5.6-sol-high

EXPOSE 8080
CMD ["node", "src/index.mjs"]
