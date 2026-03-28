import { prisma } from "@/lib/prisma";
import { kpiTemplateWriteSchema } from "@/lib/kra-kpi/builder-shared";
import { GALGOTIA_KPI_TEMPLATES } from "@/lib/kra-kpi/galgotia-kpi-templates";
import { GALGOTIA_TEMPLATE_CODES } from "@/lib/kra-kpi/galgotia-template-constants";
import { seedSystemKpiTemplates } from "@/lib/kra-kpi/kpi-template-service";

async function main() {
  for (const template of GALGOTIA_KPI_TEMPLATES) {
    const parsed = kpiTemplateWriteSchema.safeParse(template);
    if (!parsed.success) {
      throw new Error(
        `Template ${template.code} failed validation: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
      );
    }
  }

  await seedSystemKpiTemplates();

  const rows = await prisma.kpiTemplate.findMany({
    where: {
      code: { in: [...GALGOTIA_TEMPLATE_CODES] },
      tenantId: null,
      isSystem: true,
    },
    select: {
      code: true,
      builderPayload: true,
    },
    orderBy: { code: "asc" },
  });

  if (rows.length !== GALGOTIA_TEMPLATE_CODES.length) {
    const found = new Set(rows.map((row) => row.code));
    const missing = GALGOTIA_TEMPLATE_CODES.filter((code) => !found.has(code));
    throw new Error(`Missing seeded Galgotia templates: ${missing.join(", ")}`);
  }

  for (const row of rows) {
    const parsed = kpiTemplateWriteSchema.safeParse({
      code: row.code,
      name: row.code,
      isActive: true,
      sortOrder: 0,
      payload: row.builderPayload,
    });
    if (!parsed.success) {
      throw new Error(
        `Seeded template ${row.code} has invalid builder payload: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
      );
    }
  }

  console.log(`Seeded ${rows.length} Galgotia KPI templates successfully.`);
}

main()
  .catch((error) => {
    console.error("Failed to seed Galgotia KPI templates.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
