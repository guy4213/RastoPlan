import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../app.js";
import type { Database } from "../db/index.js";
import { hashPassword, verifyPassword } from "../auth/index.js";
import { requireAuthSecret } from "../config.js";
import { SESSION_MAX_AGE_SECONDS } from "./auth.js";

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
}

class InMemoryUsers implements Database {
  private readonly users = new Map<string, StoredUser>();

  async query<T extends object>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    if (sql.includes("password_hash FROM users")) {
      const email = String(params[0]);
      const user = [...this.users.values()].find((row) => row.email === email);
      return user ? ([{ id: user.id, email: user.email, password_hash: user.passwordHash }] as T[]) : [];
    }
    if (sql.startsWith("SELECT id, email FROM users")) {
      const user = this.users.get(String(params[0]));
      return user ? ([{ id: user.id, email: user.email }] as T[]) : [];
    }
    if (sql.startsWith("INSERT INTO users")) {
      const id = String(params[0]);
      const email = String(params[1]);
      if ([...this.users.values()].some((row) => row.email === email)) return [];
      this.users.set(id, { id, email, passwordHash: String(params[2]) });
      return [{ id, email }] as T[];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
}

function appForTest() {
  return buildApp({
    database: new InMemoryUsers(),
    config: {
      webOrigin: "http://localhost:5173",
      authSecret: "test-secret-that-is-long-enough-000000",
    },
  });
}

const PASSWORD = "correct horse battery";

test("a stored hash verifies only against the original password", async () => {
  const stored = await hashPassword(PASSWORD);
  assert.ok(stored.startsWith("scrypt$"), "the hash must record its own parameters");
  assert.ok(!stored.includes(PASSWORD), "the plaintext must never appear in the stored value");
  assert.equal(await verifyPassword(PASSWORD, stored), true);
  assert.equal(await verifyPassword("correct horse batteru", stored), false);
});

test("a corrupt stored hash fails the login instead of throwing", async () => {
  assert.equal(await verifyPassword(PASSWORD, "not-a-hash"), false);
  assert.equal(await verifyPassword(PASSWORD, "scrypt$a$b$c$d$e"), false);
  assert.equal(
    await verifyPassword(PASSWORD, `scrypt$1073741824$8$1$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`),
    false
  );
  assert.equal(
    await verifyPassword(PASSWORD, `scrypt$32768$8$1$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(65).toString("base64")}`),
    false
  );
  assert.equal(await verifyPassword(PASSWORD, `scrypt$32768$8$1$${"A".repeat(513)}$x`), false);
});

test("rejects the documented AUTH_SECRET placeholder", () => {
  assert.throws(() => requireAuthSecret("change-me-to-at-least-32-characters-long"), /placeholder/);
  assert.throws(() => requireAuthSecret("too-short"), /at least 32/);
  assert.equal(requireAuthSecret("a-unique-test-secret-that-is-long-enough"), "a-unique-test-secret-that-is-long-enough");
});

test("registering issues an http-only session and identifies the user", async () => {
  const app = appForTest();
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "Owner@Example.com", password: PASSWORD },
    });
    assert.equal(registered.statusCode, 201);

    const session = registered.cookies.find((entry) => entry.name === "rasto_session");
    assert.ok(session);
    assert.equal(session.httpOnly, true);
    assert.equal(session.sameSite, "Lax");
    assert.equal(session.maxAge, SESSION_MAX_AGE_SECONDS);

    const unsigned = app.unsignCookie(session.value);
    assert.equal(unsigned.valid, true);
    assert.ok(unsigned.value);
    const payload = JSON.parse(Buffer.from(unsigned.value, "base64url").toString("utf8")) as {
      v: number;
      userId: string;
      issuedAt: number;
    };
    assert.equal(payload.v, 1);
    assert.equal(payload.userId, (registered.json() as { id: string }).id);
    assert.ok(Number.isInteger(payload.issuedAt));
    // The address is stored normalised so a differently-cased login still matches.
    assert.equal((registered.json() as { email: string }).email, "owner@example.com");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `${session.name}=${session.value}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { email: string }).email, "owner@example.com");
  } finally {
    await app.close();
  }
});

test("a second registration with the same address is rejected", async () => {
  const app = appForTest();
  try {
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "owner@example.com", password: PASSWORD },
    });
    assert.equal(first.statusCode, 201);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "OWNER@example.com", password: PASSWORD },
    });
    assert.equal(second.statusCode, 409);
  } finally {
    await app.close();
  }
});

test("login accepts the right password and rejects the wrong one identically to an unknown account", async () => {
  const app = appForTest();
  try {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "owner@example.com", password: PASSWORD },
    });

    const good = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.com", password: PASSWORD },
    });
    assert.equal(good.statusCode, 200);
    assert.ok(good.cookies.some((entry) => entry.name === "rasto_session"));

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.com", password: "wrong password" },
    });
    const unknownAccount = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: PASSWORD },
    });

    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(unknownAccount.statusCode, 401);
    // Identical bodies: the response must not reveal which addresses exist.
    assert.deepEqual(wrongPassword.json(), unknownAccount.json());
  } finally {
    await app.close();
  }
});

test("rejects a short password and a malformed address", async () => {
  const app = appForTest();
  try {
    const shortPassword = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "owner@example.com", password: "short" },
    });
    assert.equal(shortPassword.statusCode, 400);

    const badEmail = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "not-an-email", password: PASSWORD },
    });
    assert.equal(badEmail.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("a forged session cookie is not accepted", async () => {
  const app = appForTest();
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "owner@example.com", password: PASSWORD },
    });
    const session = registered.cookies.find((entry) => entry.name === "rasto_session");
    assert.ok(session);

    // The unsigned user id on its own must not authenticate.
    const unsigned = session.value.split(".")[0]!;
    const forged = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `rasto_session=${unsigned}` },
    });
    assert.equal(forged.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("expired, future, wrong-version and malformed signed sessions are rejected", async () => {
  const app = appForTest();
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "owner@example.com", password: PASSWORD },
    });
    const userId = (registered.json() as { id: string }).id;
    const now = Math.floor(Date.now() / 1000);
    const invalidValues = [
      sessionValue(userId, now - SESSION_MAX_AGE_SECONDS),
      sessionValue(userId, now + 60),
      sessionValue(userId, now, 2),
      "not-json",
    ];

    for (const value of invalidValues) {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: `rasto_session=${app.signCookie(value)}` },
      });
      assert.equal(response.statusCode, 401);
    }
  } finally {
    await app.close();
  }
});

function sessionValue(userId: string, issuedAt: number, version = 1): string {
  return Buffer.from(JSON.stringify({ v: version, userId, issuedAt }), "utf8").toString("base64url");
}

test("logout clears the session", async () => {
  const app = appForTest();
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "owner@example.com", password: PASSWORD },
    });
    const session = registered.cookies.find((entry) => entry.name === "rasto_session");
    assert.ok(session);

    const loggedOut = await app.inject({ method: "POST", url: "/api/auth/logout" });
    assert.equal(loggedOut.statusCode, 204);
    const cleared = loggedOut.cookies.find((entry) => entry.name === "rasto_session");
    assert.ok(cleared, "logout must send an expiring cookie");
    assert.equal(cleared.value, "");
  } finally {
    await app.close();
  }
});
