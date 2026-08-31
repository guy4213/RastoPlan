import { randomUUID } from "node:crypto";
import { migrateProject, type Project, type ProjectMeta } from "@rastoplan/core";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../db/index.js";
import { currentUser } from "./auth.js";

interface ProjectRouteOptions {
  database: Database;
}

interface ProjectRow {
  id: string;
  name: string;
  updated_at: Date | string;
  data: unknown;
}

interface ProjectMetaRow {
  id: string;
  name: string;
  updated_at: Date | string;
  pours_count: number;
}

interface IdParams {
  id: string;
}

interface DuplicateBody {
  name: string;
}

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 256;

export const projectRoutes: FastifyPluginAsync<ProjectRouteOptions> = async (app, { database }) => {
  /**
   * Every project route resolves the caller first. Isolation itself lives in
   * the SQL below — the owner id is part of each WHERE clause rather than a
   * check a handler could forget — but a request with no session must not
   * reach those queries at all.
   */
  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentUser(request, database);
    if (!user) {
      await reply.code(401).send({ error: "לא מחובר" });
      return undefined;
    }
    return user;
  };

  app.get("/api/projects", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;

    const rows = await database.query<ProjectMetaRow>(
      "SELECT id, name, updated_at, jsonb_array_length(COALESCE(data -> 'pours', '[]'::jsonb)) AS pours_count FROM projects WHERE user_id = $1 ORDER BY updated_at DESC",
      [user.id]
    );

    const metas: ProjectMeta[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: new Date(row.updated_at).toISOString(),
      poursCount: row.pours_count,
    }));
    return reply.send(metas);
  });

  app.get<{ Params: IdParams }>("/api/projects/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!isValidId(request.params.id)) return badRequest(reply, "invalid project id");

    const row = await findProject(database, request.params.id, user.id);
    if (!row) return reply.code(404).send({ error: "project not found" });

    const project = readStoredProject(row.data);
    if (!project) return reply.code(500).send({ error: "stored project is invalid" });
    return reply.send(project);
  });

  app.post("/api/projects", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;

    const parsed = parseProject(request.body);
    if (!parsed.ok) return badRequest(reply, parsed.error);

    const saved = await saveProject(database, parsed.project, user.id);
    if (!saved) return reply.code(404).send({ error: "project not found" });
    return reply.code(201).send();
  });

  app.put<{ Params: IdParams }>("/api/projects/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!isValidId(request.params.id)) return badRequest(reply, "invalid project id");

    const parsed = parseProject(request.body);
    if (!parsed.ok) return badRequest(reply, parsed.error);
    if (parsed.project.id !== request.params.id) return badRequest(reply, "project id must match the URL");

    // A miss here means the id exists but belongs to somebody else. Reporting
    // "not found" rather than "forbidden" keeps other users' ids unguessable.
    const saved = await saveProject(database, parsed.project, user.id);
    if (!saved) return reply.code(404).send({ error: "project not found" });
    return reply.code(204).send();
  });

  app.post<{ Params: IdParams; Body: DuplicateBody }>("/api/projects/:id/duplicate", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!isValidId(request.params.id)) return badRequest(reply, "invalid project id");
    if (!isValidName(request.body?.name)) return badRequest(reply, "invalid project name");

    const row = await findProject(database, request.params.id, user.id);
    if (!row) return reply.code(404).send({ error: "project not found" });

    const original = readStoredProject(row.data);
    if (!original) return reply.code(500).send({ error: "stored project is invalid" });

    const now = new Date().toISOString();
    const copy: Project = {
      ...original,
      id: randomUUID(),
      name: request.body.name.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await saveProject(database, copy, user.id);
    return reply.code(201).send(copy);
  });

  app.delete<{ Params: IdParams }>("/api/projects/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!isValidId(request.params.id)) return badRequest(reply, "invalid project id");

    const deleted = await database.query<{ id: string }>(
      "DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id",
      [request.params.id, user.id]
    );
    if (deleted.length === 0) return reply.code(404).send({ error: "project not found" });
    return reply.code(204).send();
  });
};

async function findProject(
  database: Database,
  id: string,
  userId: string
): Promise<ProjectRow | undefined> {
  const rows = await database.query<ProjectRow>(
    "SELECT id, name, updated_at, data FROM projects WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
  return rows[0];
}

/**
 * Upsert scoped to the owner. The `WHERE projects.user_id = EXCLUDED.user_id`
 * on the conflict branch is what stops one user from overwriting another's
 * project by guessing its id: the insert collides, the update is filtered out,
 * and no row comes back.
 */
async function saveProject(database: Database, project: Project, userId: string): Promise<boolean> {
  const migrated = migrateProject(project);
  const rows = await database.query<{ id: string }>(
    `INSERT INTO projects (id, user_id, name, created_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data
     WHERE projects.user_id = EXCLUDED.user_id
     RETURNING id`,
    [migrated.id, userId, migrated.name, migrated.createdAt, migrated.updatedAt, JSON.stringify(migrated)]
  );
  return rows.length > 0;
}

function readStoredProject(value: unknown): Project | undefined {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  const result = parseProject(parsed);
  return result.ok ? migrateProject(result.project) : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseProject(value: unknown): { ok: true; project: Project } | { ok: false; error: string } {
  if (!isProject(value)) return { ok: false, error: "invalid project payload" };
  return { ok: true, project: value };
}

function isProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  if (!isValidId(value.id) || !isValidName(value.name)) return false;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return false;
  if (!isRecord(value.catalog) || !isRecord(value.rules)) return false;
  if (!Array.isArray(value.pours) || !Array.isArray(value.walls) || !Array.isArray(value.placements)) return false;
  if (
    value.schemaVersion !== undefined &&
    (typeof value.schemaVersion !== "number" || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 1)
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function badRequest(reply: FastifyReply, error: string) {
  return reply.code(400).send({ error });
}
