import express from "express";
import { getDb } from "../db/index.js";

const router = express.Router();

/** 存活探针：进程在即健康。 */
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    requestId: req.requestId,
  });
});

/** 就绪探针：额外校验数据库可用。 */
router.get("/ready", (req, res, next) => {
  try {
    getDb().prepare("SELECT 1 AS ok").get();
    res.json({ status: "ready", database: "ok", requestId: req.requestId });
  } catch (error) {
    next(error);
  }
});

export { router as healthRouter };
