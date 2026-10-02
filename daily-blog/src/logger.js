import { randomUUID } from "node:crypto";

/** 结构化 JSON 日志，一行一条，便于检索与采集。 */
const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel = "info";

export function setLogLevel(level) {
  if (LEVEL_WEIGHT[level]) {
    currentLevel = level;
  }
}

function emit(level, event, meta = {}) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) {
    return;
  }
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...meta,
  };
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

export function createRequestLogger(requestId) {
  const base = { requestId };
  return {
    debug: (event, meta) => emit("debug", event, { ...base, ...meta }),
    info: (event, meta) => emit("info", event, { ...base, ...meta }),
    warn: (event, meta) => emit("warn", event, { ...base, ...meta }),
    error: (event, meta) => emit("error", event, { ...base, ...meta }),
  };
}

export const logger = {
  debug: (event, meta) => emit("debug", event, meta),
  info: (event, meta) => emit("info", event, meta),
  warn: (event, meta) => emit("warn", event, meta),
  error: (event, meta) => emit("error", event, meta),
};

export function generateRequestId() {
  return randomUUID();
}
