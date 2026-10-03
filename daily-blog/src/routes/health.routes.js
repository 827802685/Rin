import express from "express";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { clientIpOf } from "../lib/client-ip.js";
import { getRateLimitStore } from "../lib/rate-limit-store.js";

const router = express.Router();

/**
 * 存活探针：进程在即健康。
 *
 * 顺带回传运行形态（`instanceId` / `trustProxy` / `rateLimit` / `clientIp`）：
 * 反向代理后面最常见的故障是「所有人都被算成同一个来源」或「谁都能伪造来源」，
 * 光看日志很难确认，`curl /health` 一眼就能看出这份实例到底怎么解析客户端地址。
 */
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    instanceId: config.instanceId,
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    requestId: req.requestId,
    trustProxy: {
      enabled: config.trustProxy.enabled,
      mode: config.trustProxy.mode,
      label: config.trustProxy.label,
    },
    clientIp: clientIpOf(req),
    rateLimit: getRateLimitStore().describe(),
  });
});

/** 就绪探针：额外校验数据库可用。 */
router.get("/ready", (req, res, next) => {
  try {
    getDb().prepare("SELECT 1 AS ok").get();
    res.json({
      status: "ready",
      database: "ok",
      requestId: req.requestId,
      instanceId: config.instanceId,
    });
  } catch (error) {
    next(error);
  }
});

export { router as healthRouter };
