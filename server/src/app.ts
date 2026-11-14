import cors from "cors";
import express from "express";
import { errorHandler } from "./errors.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5174" }));
  app.use(express.json({ limit: "1mb" }));

  const api = express.Router();
  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Rota não encontrada" });
  });
  app.use(errorHandler);
  return app;
}
