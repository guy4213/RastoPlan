import assert from "node:assert/strict";
import test from "node:test";
import { databasePoolOptions } from "./index.js";

test("keeps Neon URL requirements while giving pg explicit strict TLS", () => {
  const options = databasePoolOptions(
    "postgresql://user:password@ep-example-pooler.us-east-2.aws.neon.tech/rastoplan?sslmode=require"
  );

  assert.equal(new URL(options.connectionString).searchParams.has("sslmode"), false);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(options.max, 10);
  assert.equal(options.connectionTimeoutMillis, 10_000);
  assert.equal(options.idleTimeoutMillis, 30_000);
});

test("rejects a direct or non-TLS Neon URL", () => {
  assert.throws(
    () => databasePoolOptions("postgresql://user:password@ep-example.us-east-2.aws.neon.tech/rastoplan?sslmode=require"),
    /pooled/
  );
  assert.throws(
    () => databasePoolOptions("postgresql://user:password@ep-example-pooler.us-east-2.aws.neon.tech/rastoplan"),
    /sslmode=require/
  );
});
