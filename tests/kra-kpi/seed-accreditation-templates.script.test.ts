import { beforeEach, describe, expect, test, vi } from "vitest";

const readFileMock = vi.fn();
const accreditationBodyFindFirstMock = vi.fn();
const kpiTemplateCountMock = vi.fn();
const importTemplateBundleMock = vi.fn();
const seedSystemKpiTemplatesMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: readFileMock,
  },
  readFile: readFileMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    accreditationBody: {
      findFirst: accreditationBodyFindFirstMock,
    },
    kpiTemplate: {
      count: kpiTemplateCountMock,
    },
    $disconnect: vi.fn(),
  },
}));

vi.mock("@/lib/accreditation/template-bundle-import-service", () => ({
  importSuperadminAccreditationTemplateBundle: importTemplateBundleMock,
}));

vi.mock("@/lib/kra-kpi/kpi-template-service", () => ({
  seedSystemKpiTemplates: seedSystemKpiTemplatesMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  kpiTemplateCountMock.mockResolvedValue(42);
});

describe("seed-accreditation-templates script", () => {
  test("ensures system KPI templates after seeding a new accreditation bundle", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        body: { code: "NAAC" },
        version: { versionCode: "UNIVERSITY_MANUAL_DEC_2019" },
      }),
    );
    accreditationBodyFindFirstMock.mockResolvedValue(null);
    importTemplateBundleMock.mockResolvedValue({
      status: "success",
      version: {
        id: "version-1",
        lifecycleStatus: "DRAFT",
      },
    });

    const { seedAccreditationTemplateBundles } = await import(
      "../../scripts/seed-accreditation-templates"
    );

    const result = await seedAccreditationTemplateBundles(
      ["prisma/seed-data/accreditation/naac-university-template-import-final.json"],
      "actor-1",
    );

    expect(importTemplateBundleMock).toHaveBeenCalledTimes(1);
    expect(seedSystemKpiTemplatesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      seededCount: 1,
      skippedCount: 0,
      systemTemplateCount: 42,
    });
  });

  test("still ensures system KPI templates when the accreditation bundle is skipped", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        body: { code: "NAAC" },
        version: { versionCode: "UNIVERSITY_MANUAL_DEC_2019" },
      }),
    );
    accreditationBodyFindFirstMock.mockResolvedValue({
      id: "body-1",
      versions: [{ id: "version-1", versionCode: "UNIVERSITY_MANUAL_DEC_2019" }],
    });

    const { seedAccreditationTemplateBundles } = await import(
      "../../scripts/seed-accreditation-templates"
    );

    const result = await seedAccreditationTemplateBundles(
      ["prisma/seed-data/accreditation/naac-university-template-import-final.json"],
      "actor-1",
    );

    expect(importTemplateBundleMock).not.toHaveBeenCalled();
    expect(seedSystemKpiTemplatesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      seededCount: 0,
      skippedCount: 1,
      systemTemplateCount: 42,
    });
  });
});
