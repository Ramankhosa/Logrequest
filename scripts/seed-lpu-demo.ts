import "dotenv/config";
import path from "node:path";
import { spawn } from "node:child_process";

const tsxCliPath = path.resolve("node_modules/tsx/dist/cli.mjs");
const seedScriptPath = path.resolve("scripts/seed-galgotia-demo.ts");

const child = spawn(
  process.execPath,
  [tsxCliPath, seedScriptPath],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      SEED_DEMO_DOMAIN: process.env.SEED_DEMO_DOMAIN ?? "lpu.local.test",
      SEED_DEMO_TENANT_CODE: process.env.SEED_DEMO_TENANT_CODE ?? "LPU",
      SEED_DEMO_TENANT_NAME: process.env.SEED_DEMO_TENANT_NAME ?? "LPU",
      SEED_DEMO_ROOT_UNIT_NAME:
        process.env.SEED_DEMO_ROOT_UNIT_NAME ?? "Lovely Professional University",
      SEED_DEMO_POLYTECHNIC_NAME:
        process.env.SEED_DEMO_POLYTECHNIC_NAME ?? "LPU Polytechnic",
      SEED_DEMO_STRUCTURE_NAME:
        process.env.SEED_DEMO_STRUCTURE_NAME ?? "LPU Demo Structure",
      SEED_DEMO_LABEL: process.env.SEED_DEMO_LABEL ?? "LPU demo",
      SEED_DEMO_EMPLOYEE_PREFIX:
        process.env.SEED_DEMO_EMPLOYEE_PREFIX ?? "LPU-DEMO",
      SEED_ENABLE_ACCREDITATION_SERVICE:
        process.env.SEED_ENABLE_ACCREDITATION_SERVICE ?? "true",
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error("Failed to launch LPU demo seed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
