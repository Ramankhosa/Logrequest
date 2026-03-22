import { execFileSync } from "node:child_process";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

type GlobalWithMigrationFlag = typeof globalThis & {
  __r22MigrationsApplied?: boolean;
};

const globalWithMigrationFlag = globalThis as GlobalWithMigrationFlag;

if (!globalWithMigrationFlag.__r22MigrationsApplied) {
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
