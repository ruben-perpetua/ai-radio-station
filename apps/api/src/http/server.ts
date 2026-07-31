import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "../config/env.js";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
