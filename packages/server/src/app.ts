import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { parseWebOrigins, requireAuthSecret, sessionCookieOptions, type ServerConfig } from "./config.js";
import type { Database } from "./db/index.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";

export interface BuildAppOptions {
  database: Database;
  config: Pick<ServerConfig, "webOrigin" | "authSecret">;
}

export function buildApp({ database, config }: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });
  const cookieOptions = sessionCookieOptions(config.webOrigin);

  // The method list has to be explicit: @fastify/cors defaults to GET/HEAD/POST,
  // and the browser then blocks the PUT that saves a project and the DELETE that
  // removes one — surfacing as "Failed to fetch" with the server none the wiser.
  app.register(cors, {
    origin: parseWebOrigins(config.webOrigin),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  });
  // The signing secret gates boot rather than request handling: a server that
  // starts without one would hand out session cookies anybody could forge.
  app.register(cookie, { secret: requireAuthSecret(config.authSecret) });
  app.register(healthRoutes);
  app.register(authRoutes, { database, cookie: cookieOptions });
  app.register(projectRoutes, { database });

  return app;
}
