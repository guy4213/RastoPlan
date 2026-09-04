import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG, type Project } from "@rastoplan/core";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import type { Database } from "../db/index.js";

interface StoredProject {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  data: string;
}

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
}

/**
 * Stands in for Postgres by matching the exact statements the routes issue.
 * Ownership is modelled faithfully — including the conflict branch that only
 * updates a row when the caller already owns it — because that clause is the
 * mechanism the isolation tests below are actually checking.
 */
class InMemoryDatabase implements Database {
  private readonly projects = new Map<string, StoredProject>();
  private readonly users = new Map<string, StoredUser>();

  async query<T extends object>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    if (sql.includes("password_hash FROM users")) {
      const email = requiredString(params[0]);
      const user = [...this.users.values()].find((row) => row.email === email);
      return user ? ([{ id: user.id, email: user.email, password_hash: user.passwordHash }] as T[]) : [];
    }

    if (sql.startsWith("SELECT id, email FROM users")) {
      const id = requiredString(params[0]);
      const user = this.users.get(id);
      return user ? ([{ id: user.id, email: user.email }] as T[]) : [];
    }

    if (sql.startsWith("INSERT INTO users")) {
      const id = requiredString(params[0]);
      const email = requiredString(params[1]);
      if ([...this.users.values()].some((row) => row.email === email)) return [];
      this.users.set(id, { id, email, passwordHash: requiredString(params[2]) });
      return [{ id, email }] as T[];
    }

    if (sql.startsWith("SELECT id, name, updated_at, jsonb_array_length")) {
      const userId = requiredString(params[0]);
      const rows = [...this.projects.values()]
        .filter((row) => row.userId === userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(({ id, name, updatedAt, data }) => ({
          id,
          name,
          updated_at: updatedAt,
          pours_count: (JSON.parse(data) as { pours: unknown[] }).pours.length,
        }));
      return rows as T[];
    }

    if (sql.startsWith("SELECT id, name, updated_at, data FROM projects")) {
      const id = requiredString(params[0]);
      const userId = requiredString(params[1]);
      const project = this.projects.get(id);
      return project && project.userId === userId
        ? ([{ id: project.id, name: project.name, updated_at: project.updatedAt, data: project.data }] as T[])
        : [];
    }

    if (sql.startsWith("INSERT INTO projects")) {
      const id = requiredString(params[0]);
      const userId = requiredString(params[1]);
      const existing = this.projects.get(id);
      // WHERE projects.user_id = EXCLUDED.user_id
      if (existing && existing.userId !== userId) return [];
      this.projects.set(id, {
        id,
        userId,
        name: requiredString(params[2]),
        createdAt: requiredString(params[3]),
        updatedAt: requiredString(params[4]),
        data: requiredString(params[5]),
      });
      return [{ id }] as T[];
    }

    if (sql.startsWith("DELETE FROM projects")) {
      const id = requiredString(params[0]);
      const userId = requiredString(params[1]);
      const project = this.projects.get(id);
      if (!project || project.userId !== userId) return [] as T[];
      this.projects.delete(id);
      return [{ id }] as T[];
    }

    throw new Error(`unexpected SQL: ${sql}`);
  }

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("test database received a non-string parameter");
  return value;
}

function projectFixture(id = "project-1"): Project {
  return {
    id,
    name: "Tower A",
    createdAt: "2026-08-30T09:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [],
    walls: [],
    placements: [],
  };
}

function appForTest() {
  return buildApp({
    database: new InMemoryDatabase(),
    config: {
      webOrigin: "http://localhost:5173",
      authSecret: "test-secret-that-is-long-enough-000000",
    },
  });
}

/** Registers an account and returns the Cookie header its session needs. */
async function signUp(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "correct horse battery" },
  });
  assert.equal(response.statusCode, 201);
  const session = response.cookies.find((entry) => entry.name === "rasto_session");
  assert.ok(session, "register must set a session cookie");
  return `${session.name}=${session.value}`;
}

test("creates then reads a migrated project", async () => {
  const app = appForTest();
  try {
    const cookie = await signUp(app, "owner@example.com");
    const project = projectFixture();
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: project,
      headers: { cookie },
    });
    assert.equal(created.statusCode, 201);

    const loaded = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: { cookie },
    });
    assert.equal(loaded.statusCode, 200);
    assert.deepEqual(loaded.json(), { ...project, schemaVersion: 3, pours: [] });
  } finally {
    await app.close();
  }
});

test("returns 404 when a project does not exist", async () => {
  const app = appForTest();
  try {
    const cookie = await signUp(app, "owner@example.com");
    const response = await app.inject({ method: "GET", url: "/api/projects/missing", headers: { cookie } });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "project not found" });
  } finally {
    await app.close();
  }
});

test("lists, duplicates, and removes projects through the storage contract", async () => {
  const app = appForTest();
  try {
    const cookie = await signUp(app, "owner@example.com");
    const project = projectFixture();
    await app.inject({ method: "POST", url: "/api/projects", payload: project, headers: { cookie } });

    const listed = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie } });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json(), [
      { id: project.id, name: project.name, updatedAt: project.updatedAt, poursCount: 0 },
    ]);

    const duplicated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/duplicate`,
      payload: { name: "Tower A copy" },
      headers: { cookie },
    });
    assert.equal(duplicated.statusCode, 201);
    const copy = duplicated.json() as { id: string; name: string };
    assert.notEqual(copy.id, project.id);
    assert.equal(copy.name, "Tower A copy");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/projects/${copy.id}`,
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 204);
  } finally {
    await app.close();
  }
});

test("rejects malformed project payloads before persistence", async () => {
  const app = appForTest();
  try {
    const cookie = await signUp(app, "owner@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { id: "project-1" },
      headers: { cookie },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "invalid project payload" });
  } finally {
    await app.close();
  }
});

test("every project route refuses an unauthenticated caller", async () => {
  const app = appForTest();
  try {
    const project = projectFixture();
    const calls = [
      app.inject({ method: "GET", url: "/api/projects" }),
      app.inject({ method: "GET", url: `/api/projects/${project.id}` }),
      app.inject({ method: "POST", url: "/api/projects", payload: project }),
      app.inject({ method: "PUT", url: `/api/projects/${project.id}`, payload: project }),
      app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/duplicate`,
        payload: { name: "copy" },
      }),
      app.inject({ method: "DELETE", url: `/api/projects/${project.id}` }),
    ];

    for (const response of await Promise.all(calls)) {
      assert.equal(response.statusCode, 401);
    }
  } finally {
    await app.close();
  }
});

test("one user cannot read, overwrite, duplicate or delete another user's project", async () => {
  const app = appForTest();
  try {
    const owner = await signUp(app, "owner@example.com");
    const intruder = await signUp(app, "intruder@example.com");

    const project = projectFixture();
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: project,
      headers: { cookie: owner },
    });
    assert.equal(created.statusCode, 201);

    const listed = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: intruder } });
    assert.deepEqual(listed.json(), [], "the intruder's project list must be empty");

    const read = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: { cookie: intruder },
    });
    assert.equal(read.statusCode, 404);

    const overwrite = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}`,
      payload: { ...project, name: "Hijacked" },
      headers: { cookie: intruder },
    });
    assert.equal(overwrite.statusCode, 404);

    const copied = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/duplicate`,
      payload: { name: "stolen copy" },
      headers: { cookie: intruder },
    });
    assert.equal(copied.statusCode, 404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}`,
      headers: { cookie: intruder },
    });
    assert.equal(deleted.statusCode, 404);

    // The owner's copy must be untouched by every attempt above.
    const stillThere = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: { cookie: owner },
    });
    assert.equal(stillThere.statusCode, 200);
    assert.equal((stillThere.json() as Project).name, "Tower A");
  } finally {
    await app.close();
  }
});

test("CORS allows the methods the browser actually uses to save and delete", async () => {
  // @fastify/cors defaults to GET/HEAD/POST. With that default the browser
  // rejects the PUT that saves a project and the DELETE that removes one
  // before the request is ever sent, which surfaces as "Failed to fetch"
  // while the server logs nothing at all.
  const app = appForTest();
  try {
    for (const method of ["PUT", "DELETE", "POST", "GET"]) {
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/api/projects/project-1",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": method,
        },
      });

      const allowed = String(preflight.headers["access-control-allow-methods"] ?? "")
        .split(",")
        .map((entry) => entry.trim());
      assert.ok(allowed.includes(method), `${method} must be allowed, got: ${allowed.join(",")}`);
      assert.equal(preflight.headers["access-control-allow-credentials"], "true");
      assert.equal(preflight.headers["access-control-allow-origin"], "http://localhost:5173");
    }
  } finally {
    await app.close();
  }
});

test("CORS accepts every configured origin, so dev and preview both work", async () => {
  // vite dev serves on 5173 and vite preview on 4173. With a single origin the
  // one you are not running is rejected, and the app reports only
  // "Failed to fetch" with nothing in the server log to explain it.
  const app = buildApp({
    database: new InMemoryDatabase(),
    config: {
      webOrigin: "http://localhost:5173, http://localhost:4173/",
      authSecret: "test-secret-that-is-long-enough-000000",
    },
  });
  try {
    for (const origin of ["http://localhost:5173", "http://localhost:4173"]) {
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/api/projects/project-1",
        headers: { origin, "access-control-request-method": "PUT" },
      });
      assert.equal(preflight.headers["access-control-allow-origin"], origin);
      assert.equal(preflight.headers["access-control-allow-credentials"], "true");
    }

    const stranger = await app.inject({
      method: "OPTIONS",
      url: "/api/projects/project-1",
      headers: { origin: "http://evil.example", "access-control-request-method": "PUT" },
    });
    assert.notEqual(stranger.headers["access-control-allow-origin"], "http://evil.example");
  } finally {
    await app.close();
  }
});
