import type { FastifyInstance } from "fastify";

// CRUD stub for /api/projects (spec 12). Backed by ApiProvider + Postgres
// starting Milestone 3 — routes exist so the shape is in place, but each
// handler is deliberately unimplemented for now.
export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects", async (_req, reply) => {
    reply.code(501).send({ error: "not implemented" });
  });

  app.get("/api/projects/:id", async (_req, reply) => {
    reply.code(501).send({ error: "not implemented" });
  });

  app.post("/api/projects", async (_req, reply) => {
    reply.code(501).send({ error: "not implemented" });
  });

  app.put("/api/projects/:id", async (_req, reply) => {
    reply.code(501).send({ error: "not implemented" });
  });

  app.delete("/api/projects/:id", async (_req, reply) => {
    reply.code(501).send({ error: "not implemented" });
  });
}
