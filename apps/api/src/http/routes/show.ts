import { Hono } from "hono";
import { listShows, loadLatestShow, loadShowById } from "../../show/show-store.js";

export function createShowRoutes(): Hono {
  const api = new Hono();

  // Registered before `/:showId` so "latest" is never captured as an id.
  api.get("/show/latest", async (c) => {
    const show = await loadLatestShow();
    if (!show) {
      return c.json({ error: "No show available. Run npm run show:build to build one." }, 404);
    }
    return c.json(show);
  });

  // Summaries for the show picker, newest first.
  api.get("/shows", async (c) => {
    return c.json(await listShows());
  });

  api.get("/show/:showId", async (c) => {
    const show = await loadShowById(c.req.param("showId"));
    if (!show) {
      return c.json({ error: "Show not found" }, 404);
    }
    return c.json(show);
  });

  return api;
}
