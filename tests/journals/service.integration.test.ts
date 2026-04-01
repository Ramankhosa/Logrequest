import { afterEach, describe, expect, test } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  archiveJournalCatalogRecord,
  confirmJournalImportBatch,
  createTenantJournalOverride,
  listJournalCatalogRecords,
  previewJournalImport,
  restoreJournalCatalogRecord,
  updateJournalCatalogRecord,
} from "@/lib/journals/service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

let tracker: DbTracker | null = null;

afterEach(async () => {
  if (!tracker) return;

  const tenantIds = [...tracker.tenantIds];
  const userIds = [...tracker.userIds];

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        {
          actorUserId: { in: userIds },
          targetType: { in: ["JournalCatalogRecord", "JournalImportBatch"] },
        },
        {
          tenantId: { in: tenantIds },
          targetType: { in: ["JournalCatalogRecord", "JournalImportBatch"] },
        },
      ],
    },
  });

  await prisma.journalCatalogRecord.deleteMany({
    where: {
      OR: [
        { createdByUserId: { in: userIds } },
        { tenantId: { in: tenantIds } },
      ],
    },
  });

  await prisma.journalImportBatch.deleteMany({
    where: {
      OR: [
        { uploadedByUserId: { in: userIds } },
        { tenantId: { in: tenantIds } },
      ],
    },
  });

  await cleanupTrackedData(tracker);
  tracker = null;
});

function scimagoBuffer(lines: string[]) {
  return Buffer.from(lines.join("\n"), "utf8");
}

function sampleImportBuffer() {
  return scimagoBuffer([
    "Rank;Sourceid;Title;Type;Issn;Publisher;Open Access;Open Access Diamond;SJR;SJR Best Quartile;H index;Total Docs. (2024);Total Docs. (3years);Total Refs.;Total Citations (3years);Citable Docs. (3years);Citations / Doc. (2years);Ref. / Doc.;%Female;Overton;SDG;Country;Region;Publisher;Coverage;Categories;Areas,,,,,,,",
    "\"1;1001;\"\"Journal Alpha\"\";journal;\"\"12345678\",\" 87654321\"\";\"\"Alpha Press\"\";Yes;No;8\",750;Q1;120;10;25;400;210;22;8,50;40,0;48,\"00;3;6;India;Southern Asia;\"\"Alpha Press\"\";\"\"2018-2025\"\";\"\"Engineering (Q1)\"\";\"\"Engineering\"\"\",,",
    "\"2;1002;\"\"Journal Beta\"\";journal;\"\"11112222\"\";\"\"Beta Press\"\";No;No;3\",250;Q3;40;12;20;300;100;18;2,75;25,0;35,\"00;1;2;India;Southern Asia;\"\"Beta Press\"\";\"\"2019-2025\"\";\"\"Computer Science (Q3)\"\";\"\"Computer Science\"\"\",,",
  ]);
}

describe("journal catalog service", () => {
  test("global confirm replaces the selected year snapshot", async () => {
    tracker = newDbTracker();
    const actor = await createTestUser(tracker, {
      firstName: "Global",
      lastName: "Admin",
    });

    const preview = await previewJournalImport({
      scope: "GLOBAL",
      buffer: sampleImportBuffer(),
      fileName: "scimagojr-2024.csv",
      fileType: "text/csv",
      sourceYear: 2024,
      actorUserId: actor.id,
    });

    expect(preview.batch.validRows).toBe(2);

    const firstConfirm = await confirmJournalImportBatch({
      batchId: preview.batch.id,
      scope: "GLOBAL",
      actorUserId: actor.id,
      actorRole: Role.SUPERADMIN,
    });

    expect(firstConfirm.status).toBe("success");

    const firstList = await listJournalCatalogRecords(
      { scope: "GLOBAL" },
      { sourceYear: 2024 },
    );
    expect(firstList.rows).toHaveLength(2);

    const secondPreview = await previewJournalImport({
      scope: "GLOBAL",
      buffer: scimagoBuffer([
        "Rank;Sourceid;Title;Type;Issn;Publisher;Open Access;Open Access Diamond;SJR;SJR Best Quartile;H index;Total Docs. (2024);Total Docs. (3years);Total Refs.;Total Citations (3years);Citable Docs. (3years);Citations / Doc. (2years);Ref. / Doc.;%Female;Overton;SDG;Country;Region;Publisher;Coverage;Categories;Areas,,,,,,,",
        "\"1;1003;\"\"Journal Gamma\"\";journal;\"\"99998888\"\";\"\"Gamma Press\"\";No;No;5\",125;Q2;55;20;45;700;280;30;4,25;35,0;42,\"00;2;4;India;Southern Asia;\"\"Gamma Press\"\";\"\"2021-2025\"\";\"\"Mathematics (Q2)\"\";\"\"Mathematics\"\"\",,",
      ]),
      fileName: "scimagojr-2024-replacement.csv",
      fileType: "text/csv",
      sourceYear: 2024,
      actorUserId: actor.id,
    });

    const secondConfirm = await confirmJournalImportBatch({
      batchId: secondPreview.batch.id,
      scope: "GLOBAL",
      actorUserId: actor.id,
      actorRole: Role.SUPERADMIN,
    });

    expect(secondConfirm.status).toBe("success");

    const finalList = await listJournalCatalogRecords(
      { scope: "GLOBAL" },
      { sourceYear: 2024 },
    );

    expect(finalList.rows).toHaveLength(1);
    expect(finalList.rows[0]?.title).toBe("Journal Gamma");

    const supersededCount = await prisma.journalCatalogRecord.count({
      where: {
        scope: "GLOBAL",
        sourceYear: 2024,
        isSuperseded: true,
      },
    });
    expect(supersededCount).toBe(2);
  });

  test("tenant override wins over global and falls back after archive", async () => {
    tracker = newDbTracker();
    const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
    const globalActor = await createTestUser(tracker, {
      firstName: "Global",
      lastName: "Owner",
    });

    const globalRecord = await prisma.journalCatalogRecord.create({
      data: {
        scope: "GLOBAL",
        scopeTenantKey: "GLOBAL",
        sourceSystem: "SCIMAGO_RAW",
        sourceYear: 2024,
        sourceId: "SRC-001",
        identityKey: "SRC:SRC-001",
        currentIdentityKey: "SRC:SRC-001",
        title: "Global Journal",
        normalizedTitle: "global journal",
        type: "journal",
        issnRaw: "1234-5678",
        issnPrimary: "1234-5678",
        issnList: ["1234-5678"],
        issnNormalizedList: ["12345678"],
        publisher: "Global Press",
        isJournalEligible: true,
        createdByUserId: globalActor.id,
      },
    });

    const overrideResult = await createTenantJournalOverride({
      recordId: globalRecord.id,
      tenantId: tenant.id,
      actorUserId: actor.id,
      actorRole: Role.TENANT_OWNER,
    });

    expect(overrideResult.status).toBe("success");

    let tenantList = await listJournalCatalogRecords(
      { scope: "TENANT", tenantId: tenant.id },
      { sourceYear: 2024 },
    );
    expect(tenantList.rows).toHaveLength(1);
    expect(tenantList.rows[0]?.effectiveSource).toBe("TENANT_OVERRIDE");

    const archiveResult = await archiveJournalCatalogRecord({
      recordId: overrideResult.id!,
      scope: "TENANT",
      tenantId: tenant.id,
      actorUserId: actor.id,
      actorRole: Role.TENANT_OWNER,
      reason: "Testing fallback",
    });
    expect(archiveResult.status).toBe("success");

    tenantList = await listJournalCatalogRecords(
      { scope: "TENANT", tenantId: tenant.id },
      { sourceYear: 2024 },
    );
    expect(tenantList.rows).toHaveLength(1);
    expect(tenantList.rows[0]?.effectiveSource).toBe("GLOBAL");

    const restoreResult = await restoreJournalCatalogRecord({
      recordId: overrideResult.id!,
      scope: "TENANT",
      tenantId: tenant.id,
      actorUserId: actor.id,
      actorRole: Role.TENANT_OWNER,
    });
    expect(restoreResult.status).toBe("success");

    tenantList = await listJournalCatalogRecords(
      { scope: "TENANT", tenantId: tenant.id },
      { sourceYear: 2024 },
    );
    expect(tenantList.rows[0]?.effectiveSource).toBe("TENANT_OVERRIDE");
  });

  test("tenant confirm imports rows into the catalog and can retry a failed batch", async () => {
    tracker = newDbTracker();
    const { tenant, actor } = await createTenantActor(tracker, "TENANT_ADMIN");

    const preview = await previewJournalImport({
      scope: "TENANT",
      tenantId: tenant.id,
      buffer: sampleImportBuffer(),
      fileName: "tenant-scimagojr-2024.csv",
      fileType: "text/csv",
      sourceYear: 2024,
      actorUserId: actor.id,
    });

    await prisma.journalImportBatch.update({
      where: { id: preview.batch.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        failureMessage: "Simulated expired transaction",
      },
    });

    const retryConfirm = await confirmJournalImportBatch({
      batchId: preview.batch.id,
      scope: "TENANT",
      tenantId: tenant.id,
      actorUserId: actor.id,
      actorRole: Role.TENANT_ADMIN,
    });

    expect(retryConfirm.status).toBe("success");

    const tenantList = await listJournalCatalogRecords(
      { scope: "TENANT", tenantId: tenant.id },
      { sourceYear: 2024 },
    );

    expect(tenantList.rows).toHaveLength(2);
    expect(tenantList.rows.map((row) => row.title)).toEqual([
      "Journal Alpha",
      "Journal Beta",
    ]);

    const confirmedBatch = await prisma.journalImportBatch.findUniqueOrThrow({
      where: { id: preview.batch.id },
      select: {
        status: true,
        appliedRows: true,
        failedAt: true,
        failureMessage: true,
      },
    });

    expect(confirmedBatch.status).toBe("CONFIRMED");
    expect(confirmedBatch.appliedRows).toBe(2);
    expect(confirmedBatch.failedAt).toBeNull();
    expect(confirmedBatch.failureMessage).toBeNull();
  });

  test("tenant updates can persist journal policy status and note", async () => {
    tracker = newDbTracker();
    const { tenant, actor } = await createTenantActor(tracker, "TENANT_ADMIN");

    const record = await prisma.journalCatalogRecord.create({
      data: {
        tenantId: tenant.id,
        scope: "TENANT",
        scopeTenantKey: `TENANT:${tenant.id}`,
        sourceSystem: "TENANT_TEMPLATE",
        sourceYear: 2024,
        sourceId: "SRC-POLICY-1",
        identityKey: "SRC:SRC-POLICY-1",
        currentIdentityKey: "SRC:SRC-POLICY-1",
        title: "Policy Test Journal",
        normalizedTitle: "policy test journal",
        type: "journal",
        issnRaw: "1234-5678",
        issnPrimary: "1234-5678",
        issnList: ["1234-5678"],
        issnNormalizedList: ["12345678"],
        publisher: "Policy Press",
        policyStatus: "ALLOWED",
        policyNote: null,
        isJournalEligible: true,
        createdByUserId: actor.id,
      },
    });

    const result = await updateJournalCatalogRecord({
      recordId: record.id,
      scope: "TENANT",
      tenantId: tenant.id,
      actorUserId: actor.id,
      actorRole: Role.TENANT_ADMIN,
      values: {
        sourceYear: 2024,
        sourceId: "SRC-POLICY-1",
        title: "Policy Test Journal",
        type: "journal",
        issnRaw: "1234-5678",
        publisher: "Policy Press",
        policyStatus: "DISABLED",
        policyNote: "Institution advisory hold",
      },
    });

    expect(result.status).toBe("success");

    const updated = await prisma.journalCatalogRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: {
        policyStatus: true,
        policyNote: true,
      },
    });

    expect(updated.policyStatus).toBe("DISABLED");
    expect(updated.policyNote).toBe("Institution advisory hold");
  });
});
