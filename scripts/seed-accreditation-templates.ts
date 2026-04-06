import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccreditationScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { importSuperadminAccreditationTemplateBundle } from "@/lib/accreditation/template-bundle-import-service";
import { seedSystemKpiTemplates } from "@/lib/kra-kpi/kpi-template-service";

const defaultSeedDir = path.resolve("prisma/seed-data/accreditation");

function printUsage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/seed-accreditation-templates.ts [bundle-file-name-or-path]",
      "",
      "Examples:",
      "  npx tsx scripts/seed-accreditation-templates.ts",
      "  npx tsx scripts/seed-accreditation-templates.ts naac-university-template-import-final.json",
      "",
      "Environment:",
      "  ACCREDITATION_TEMPLATE_SEED_ACTOR_USER_ID  Optional superadmin user id to attribute imports.",
    ].join("\n"),
  );
}

export async function resolveActorUserId() {
  const actorUserId = process.env.ACCREDITATION_TEMPLATE_SEED_ACTOR_USER_ID?.trim();
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
      "No superadmin user found. Set ACCREDITATION_TEMPLATE_SEED_ACTOR_USER_ID or bootstrap a superadmin first.",
    );
  }

  console.log(`Using superadmin ${superadmin.officialEmail} (${superadmin.id})`);
  return superadmin.id;
}

export async function resolveSeedFiles(arg: string | undefined) {
  if (!arg) {
    const entries = await fs.readdir(defaultSeedDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => path.join(defaultSeedDir, entry.name))
      .sort((left, right) => left.localeCompare(right));
  }

  const explicitPath = path.isAbsolute(arg) ? arg : path.join(defaultSeedDir, arg);
  const stat = await fs.stat(explicitPath);
  if (!stat.isFile()) {
    throw new Error(`${explicitPath} is not a file.`);
  }
  return [explicitPath];
}

export async function seedAccreditationTemplateBundles(
  files: string[],
  actorUserId: string,
) {
  let seededCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    const absolutePath = path.resolve(filePath);
    const raw = await fs.readFile(absolutePath, "utf8");
    const bundle = JSON.parse(raw) as {
      body?: { code?: string };
      version?: { versionCode?: string };
    };

    const bodyCode = bundle.body?.code?.trim().toUpperCase();
    const versionCode = bundle.version?.versionCode?.trim();
    if (!bodyCode || !versionCode) {
      throw new Error(
        `Bundle ${absolutePath} is missing body.code or version.versionCode.`,
      );
    }

    const existingBody = await prisma.accreditationBody.findFirst({
      where: {
        scope: AccreditationScope.GLOBAL,
        code: bodyCode,
      },
      include: {
        versions: {
          select: {
            id: true,
            versionCode: true,
          },
        },
      },
    });

    if (existingBody) {
      const existingVersion = existingBody.versions.find(
        (version) => version.versionCode === versionCode,
      );
      if (existingVersion) {
        console.log(
          `Skipping ${bodyCode} / ${versionCode}: already seeded as version ${existingVersion.id}.`,
        );
        skippedCount += 1;
        continue;
      }

      throw new Error(
        `Cannot seed ${bodyCode} / ${versionCode} because body ${bodyCode} already exists with different versions. Seed into a clean environment or import explicitly through the app.`,
      );
    }

    console.log(`Seeding ${bodyCode} / ${versionCode} from ${absolutePath}`);
    const result = await importSuperadminAccreditationTemplateBundle(bundle, actorUserId);
    if (result.status === "error") {
      throw new Error(
        `Failed to seed ${bodyCode} / ${versionCode}: ${result.message}`,
      );
    }

    console.log(
      `Seeded ${bodyCode} / ${versionCode} -> ${result.version.id} (${result.version.lifecycleStatus})`,
    );
    seededCount += 1;
  }

  await seedSystemKpiTemplates();
  const systemTemplateCount = await prisma.kpiTemplate.count({
    where: {
      tenantId: null,
      isSystem: true,
    },
  });

  console.log(
    `Accreditation bundles processed: seeded ${seededCount}, skipped ${skippedCount}.`,
  );
  console.log(`System KPI templates ensured: ${systemTemplateCount}.`);

  return {
    seededCount,
    skippedCount,
    systemTemplateCount,
  };
}

async function main() {
  const firstArg = process.argv[2];
  if (firstArg === "--help" || firstArg === "-h") {
    printUsage();
    return;
  }

  const actorUserId = await resolveActorUserId();
  const files = await resolveSeedFiles(firstArg);

  if (files.length === 0) {
    console.log("No accreditation template bundles found to seed.");
  }

  await seedAccreditationTemplateBundles(files, actorUserId);
}

const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
