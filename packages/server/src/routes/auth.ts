import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../db/index.js";
import {
  authenticate,
  createUser,
  findUserById,
  isValidEmail,
  isValidPassword,
  MIN_PASSWORD_LENGTH,
  type User,
} from "../auth/index.js";

export const SESSION_COOKIE = "rasto_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_VERSION = 1;
const MAX_SESSION_VALUE_LENGTH = 512;
const MAX_USER_ID_LENGTH = 128;

export interface AuthRouteOptions {
  database: Database;
  cookie: { sameSite: "none" | "lax"; secure: boolean };
}

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
}

/**
 * Reads the signed session cookie and resolves the user it names.
 *
 * The user is looked up on every request rather than trusted from the cookie
 * alone, so a deleted account stops working immediately instead of when its
 * cookie happens to expire.
 */
export async function currentUser(
  request: FastifyRequest,
  database: Database
): Promise<User | undefined> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return undefined;

  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return undefined;

  const session = readSessionValue(unsigned.value, Math.floor(Date.now() / 1000));
  if (!session) return undefined;

  return findUserById(database, session.userId);
}

export function setSessionCookie(
  reply: FastifyReply,
  userId: string,
  cookie: AuthRouteOptions["cookie"]
): void {
  reply.setCookie(SESSION_COOKIE, createSessionValue(userId, Math.floor(Date.now() / 1000)), {
    path: "/",
    httpOnly: true,
    signed: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    ...cookie,
  });
}

interface SessionPayload {
  v: number;
  userId: string;
  issuedAt: number;
}

function createSessionValue(userId: string, issuedAt: number): string {
  const payload: SessionPayload = { v: SESSION_VERSION, userId, issuedAt };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function readSessionValue(value: string, now: number): SessionPayload | undefined {
  if (value.length === 0 || value.length > MAX_SESSION_VALUE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) return undefined;

    const parsed = JSON.parse(decoded.toString("utf8")) as unknown;
    if (!isSessionPayload(parsed)) return undefined;
    if (parsed.issuedAt > now || now - parsed.issuedAt >= SESSION_MAX_AGE_SECONDS) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const payload = value as Record<string, unknown>;
  return (
    payload.v === SESSION_VERSION &&
    typeof payload.userId === "string" &&
    payload.userId.length > 0 &&
    payload.userId.length <= MAX_USER_ID_LENGTH &&
    typeof payload.issuedAt === "number" &&
    Number.isInteger(payload.issuedAt) &&
    payload.issuedAt >= 0
  );
}

function clearSessionCookie(reply: FastifyReply, cookie: AuthRouteOptions["cookie"]): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, ...cookie });
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { database, cookie }) => {
  app.post<{ Body: CredentialsBody }>("/api/auth/register", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!isValidEmail(email)) return reply.code(400).send({ error: "כתובת אימייל אינה תקינה" });
    if (!isValidPassword(password)) {
      return reply.code(400).send({ error: `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים` });
    }

    const created = await createUser(database, email, password);
    if (!created.ok) return reply.code(409).send({ error: "כתובת האימייל כבר רשומה" });

    setSessionCookie(reply, created.user.id, cookie);
    return reply.code(201).send({ id: created.user.id, email: created.user.email });
  });

  app.post<{ Body: CredentialsBody }>("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    // Both branches return the same message: distinguishing "no such account"
    // from "wrong password" tells an attacker which addresses are registered.
    if (!isValidEmail(email) || !isValidPassword(password)) {
      return reply.code(401).send({ error: "אימייל או סיסמה שגויים" });
    }

    const user = await authenticate(database, email, password);
    if (!user) return reply.code(401).send({ error: "אימייל או סיסמה שגויים" });

    setSessionCookie(reply, user.id, cookie);
    return reply.send({ id: user.id, email: user.email });
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply, cookie);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await currentUser(request, database);
    if (!user) return reply.code(401).send({ error: "לא מחובר" });
    return reply.send({ id: user.id, email: user.email });
  });
};
