// Per-user accounts. Replaces the shared-office-password stub: every project
// now belongs to exactly one user, and that ownership is enforced in SQL.
//
// Password hashing uses scrypt from node:crypto rather than a native argon2
// build. scrypt is memory-hard, ships with Node, and keeps the Render deploy
// free of node-gyp; swapping in argon2id later only touches this file.
import { randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { Database } from "../db/index.js";

/**
 * promisify() cannot pick the options-carrying scrypt overload, so the
 * parameters would silently fall back to Node defaults. Wrapping it by hand
 * keeps the cost factors we actually chose.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

// scrypt cost. Memory per hash is roughly 128 * N * r, so N=2^15 with r=8
// costs 32MB and lands around 60ms — memory-hard well beyond bcrypt, while
// staying affordable when several logins arrive at once on a small instance.
// Node caps scrypt memory at 32MB by default, which is exactly the requirement
// here, so maxmem is raised explicitly rather than left to trip at runtime.
const SCRYPT_COST = 2 ** 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_EMAIL_LENGTH = 254;

export interface User {
  id: string;
  email: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELISM}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/**
 * Constant-time verification. Returns false rather than throwing on a malformed
 * stored hash, so one corrupt row cannot turn a failed login into a 500.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelism = Number(parts[3]);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) return false;

  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Emails are matched case-insensitively; the stored form is the normalised one. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

export async function findUserByEmail(database: Database, email: string): Promise<UserRow | undefined> {
  const rows = await database.query<UserRow>(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [normaliseEmail(email)]
  );
  return rows[0];
}

export async function findUserById(database: Database, id: string): Promise<User | undefined> {
  const rows = await database.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE id = $1",
    [id]
  );
  return rows[0];
}

export interface CreateUserResult {
  ok: true;
  user: User;
}
export interface CreateUserConflict {
  ok: false;
  reason: "email-taken";
}

export async function createUser(
  database: Database,
  email: string,
  password: string
): Promise<CreateUserResult | CreateUserConflict> {
  const normalised = normaliseEmail(email);
  const passwordHash = await hashPassword(password);
  const id = randomUUID();

  // ON CONFLICT DO NOTHING makes the uniqueness check and the insert one
  // statement: two simultaneous registrations for the same address cannot both
  // pass a separate existence check and then race into a duplicate row.
  const inserted = await database.query<{ id: string; email: string }>(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email`,
    [id, normalised, passwordHash]
  );
  if (inserted.length === 0) return { ok: false, reason: "email-taken" };
  return { ok: true, user: inserted[0]! };
}

export async function authenticate(
  database: Database,
  email: string,
  password: string
): Promise<User | undefined> {
  const row = await findUserByEmail(database, email);
  if (!row) {
    // Hash anyway so a missing account and a wrong password take comparable
    // time; otherwise response latency enumerates registered addresses.
    await hashPassword(password);
    return undefined;
  }
  const valid = await verifyPassword(password, row.password_hash);
  return valid ? { id: row.id, email: row.email } : undefined;
}
