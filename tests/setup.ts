import { execFileSync } from "node:child_process";
import { Client } from "pg";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

type GlobalWithMigrationFlag = typeof globalThis & {
  __r22MigrationsApplied?: boolean;
};

const globalWithMigrationFlag = globalThis as GlobalWithMigrationFlag;
const defaultDatabaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:123@localhost:5432/logrequest";
const testDatabaseName = process.env.TEST_DATABASE_NAME ?? "logrequest_vitest";
const testDatabaseUrl = buildDatabaseUrl(defaultDatabaseUrl, testDatabaseName);

process.env.DATABASE_URL = testDatabaseUrl;

function buildDatabaseUrl(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function recreateTestDatabase(connectionString: string) {
  const databaseUrl = new URL(connectionString);
  const targetDatabase = databaseUrl.pathname.replace(/^\//, "");
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [targetDatabase],
    );
    await client.query(`DROP DATABASE IF EXISTS "${targetDatabase}"`);
    await client.query(`CREATE DATABASE "${targetDatabase}"`);
  } finally {
    await client.end();
  }
}

if (!globalWithMigrationFlag.__r22MigrationsApplied) {
  await recreateTestDatabase(testDatabaseUrl);
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      cwd: process.cwd(),
      stdio: "pipe",
      env: process.env,
    },
  );
  globalWithMigrationFlag.__r22MigrationsApplied = true;
}
