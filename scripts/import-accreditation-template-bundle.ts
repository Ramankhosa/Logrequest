import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { importSuperadminAccreditationTemplateBundle } from "@/lib/accreditation/template-bundle-import-service";

const defaultBundlePath = "C:/Users/raman/Downloads/naac_university_template_import_final.json";

function printUsage() {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/import-accreditation-template-bundle.ts [bundle-path] [--actor-user-id <userId>]",
      "",
      `Default bundle path: ${defaultBundlePath}`,
    ].join("\n"),
  );
}

function resolveArgs(argv: string[]) {
  const args = [...argv];
  let bundlePath = defaultBundlePath;
  let actorUserId: string | null = null;

  if (args.length > 0 && !args[0]!.startsWith("--")) {
    bundlePath = args.shift()!;
  }

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--actor-user-id") {
      actorUserId = args.shift() ?? null;
      continue;
    }

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { bundlePath, actorUserId };
}

async function resolveActorUserId(actorUserId: string | null) {
  if (actorUserId) {
    return actorUserId;
  }

  const superadmin = await prisma.user.findFirst({
    where: { isSuperadmin: true },
    select: { id: true, officialEmail: true },
    orderBy: { createdAt: "asc" },
  });

  if (!superadmin) {
    throw new Error(
      "No superadmin user found. Pass --actor-user-id <userId> or bootstrap a superadmin first.",
    );
  }

  console.log(`Using superadmin ${superadmin.officialEmail} (${superadmin.id})`);
  return superadmin.id;
}

async function main() {
  const { bundlePath, actorUserId } = resolveArgs(process.argv.slice(2));
  const absoluteBundlePath = path.resolve(bundlePath);
  const raw = await fs.readFile(absoluteBundlePath, "utf8");
  const bundle = JSON.parse(raw) as unknown;
  const resolvedActorUserId = await resolveActorUserId(actorUserId);

  console.log(`Importing accreditation template bundle from ${absoluteBundlePath}`);
  const result = await importSuperadminAccreditationTemplateBundle(
    bundle,
    resolvedActorUserId,
  );

  if (result.status === "error") {
    console.error(`Import failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  console.log("Import succeeded.");
  console.log(
    JSON.stringify(
      {
        body: result.body,
        version: result.version,
        importedCounts: result.importedCounts,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
