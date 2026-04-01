import {
  JournalCatalogScope as PrismaJournalCatalogScope,
  JournalImportBatchStatus,
  JournalImportRowStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildIdentityKey,
  normalizeIssnList,
  normalizeJournalTitle,
  parseJournalImportBuffer,
  type NormalizedJournalImportData,
  type ParsedJournalImportRow,
} from "@/lib/journals/parser";
import {
  journalListFiltersSchema,
  journalUpdateInputSchema,
  type JournalCatalogActionResult,
  type JournalCatalogListResponse,
  type JournalCatalogRecordView,
  type JournalCatalogScope,
  type JournalEffectiveSource,
  type JournalImportBatchView,
  type JournalImportPreviewResponse,
  type JournalImportPreviewRowView,
  type JournalListFilters,
  type JournalUpdateInput,
} from "@/lib/journals/shared";

const GLOBAL_SCOPE_TENANT_KEY = "GLOBAL";
const IMPORT_CHUNK_SIZE = 500;

type JournalCatalogRecordRow = Prisma.JournalCatalogRecordGetPayload<object>;
type JournalImportBatchRow = Prisma.JournalImportBatchGetPayload<object>;
type JournalImportRowRow = Prisma.JournalImportRowGetPayload<object>;

type ListContext = {
  scope: JournalCatalogScope;
  tenantId?: string | null;
};

type PreviewInput = {
  scope: JournalCatalogScope;
  tenantId?: string | null;
  fileName: string;
  fileType: string;
  buffer: Buffer;
  sourceYear?: number;
  actorUserId: string;
};

type ConfirmInput = {
  batchId: string;
  scope: JournalCatalogScope;
  tenantId?: string | null;
  actorUserId: string;
  actorRole: Role;
};

type UpdateInput = {
  recordId: string;
  scope: JournalCatalogScope;
  tenantId?: string | null;
  values: JournalUpdateInput;
  actorUserId: string;
  actorRole: Role;
};

type ArchiveInput = {
  recordId: string;
  scope: JournalCatalogScope;
  tenantId?: string | null;
  actorUserId: string;
  actorRole: Role;
  reason?: string | null;
};

type RestoreInput = {
  recordId: string;
  scope: JournalCatalogScope;
  tenantId?: string | null;
  actorUserId: string;
  actorRole: Role;
};

type OverrideInput = {
  recordId: string;
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
};

type JournalLookupInput = {
  sourceYear: number;
  issn: string;
  tenantId?: string | null;
};

export type ResolvedJournalCatalogLookup = {
  record: JournalCatalogRecordView;
  requestedSourceYear: number;
  resolvedSourceYear: number;
  matchedExactly: boolean;
  resolutionStrategy:
    | "EXACT_YEAR"
    | "LATEST_PREVIOUS_YEAR"
    | "NEAREST_FUTURE_YEAR";
};

type RecordScopeAccess = {
  scope: JournalCatalogScope;
  tenantId: string | null;
  scopeTenantKey: string;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asNullableJsonValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function quarterRank(value: string | null) {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized === "Q1") return 1;
  if (normalized === "Q2") return 2;
  if (normalized === "Q3") return 3;
  if (normalized === "Q4") return 4;
  return 99;
}

function compareNullableNumber(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareNullableString(a: string | null, b: string | null) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function getEffectiveSource(
  record: JournalCatalogRecordRow,
): JournalEffectiveSource {
  if (record.isArchived) {
    return record.scope === PrismaJournalCatalogScope.GLOBAL
      ? "ARCHIVED_GLOBAL"
      : "ARCHIVED_TENANT";
  }

  if (record.scope === PrismaJournalCatalogScope.GLOBAL) {
    return "GLOBAL";
  }

  return record.overriddenGlobalRecordId ? "TENANT_OVERRIDE" : "TENANT_ONLY";
}

function mapRecordView(
  record: JournalCatalogRecordRow,
  effectiveSource = getEffectiveSource(record),
): JournalCatalogRecordView {
  return {
    id: record.id,
    scope: record.scope,
    tenantId: record.tenantId,
    sourceSystem: record.sourceSystem,
    sourceYear: record.sourceYear,
    sourceId: record.sourceId,
    identityKey: record.identityKey,
    title: record.title,
    normalizedTitle: record.normalizedTitle,
    type: record.type,
    issnRaw: record.issnRaw,
    issnPrimary: record.issnPrimary,
    issnList: record.issnList,
    issnNormalizedList: record.issnNormalizedList,
    publisher: record.publisher,
    duplicatePublisher: record.duplicatePublisher,
    openAccessLabel: record.openAccessLabel,
    isOpenAccess: record.isOpenAccess,
    openAccessDiamondLabel: record.openAccessDiamondLabel,
    isOpenAccessDiamond: record.isOpenAccessDiamond,
    sjr: record.sjr,
    sjrBestQuartile: record.sjrBestQuartile,
    hIndex: record.hIndex,
    totalDocsCurrent: record.totalDocsCurrent,
    totalDocs3Years: record.totalDocs3Years,
    totalRefs: record.totalRefs,
    totalCitations3Years: record.totalCitations3Years,
    citableDocs3Years: record.citableDocs3Years,
    citationsPerDoc2Years: record.citationsPerDoc2Years,
    refsPerDoc: record.refsPerDoc,
    femalePercent: record.femalePercent,
    overton: record.overton,
    sdg: record.sdg,
    country: record.country,
    region: record.region,
    coverage: record.coverage,
    categories: record.categories,
    areas: record.areas,
    policyStatus: record.policyStatus,
    policyNote: record.policyNote,
    isJournalEligible: record.isJournalEligible,
    isArchived: record.isArchived,
    isSuperseded: record.isSuperseded,
    overriddenGlobalRecordId: record.overriddenGlobalRecordId,
    importBatchId: record.importBatchId,
    effectiveSource,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    archivedAt: toIsoString(record.archivedAt),
    supersededAt: toIsoString(record.supersededAt),
  };
}

function mapBatchView(batch: JournalImportBatchRow): JournalImportBatchView {
  return {
    id: batch.id,
    scope: batch.scope,
    tenantId: batch.tenantId,
    fileName: batch.fileName,
    fileType: batch.fileType,
    sourceSystem: batch.sourceSystem,
    sourceYear: batch.sourceYear,
    mode: batch.mode,
    status: batch.status,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    warningRows: batch.warningRows,
    rejectedRows: batch.rejectedRows,
    appliedRows: batch.appliedRows,
    confirmedAt: toIsoString(batch.confirmedAt),
    failedAt: toIsoString(batch.failedAt),
    failureMessage: batch.failureMessage,
    createdAt: batch.createdAt.toISOString(),
  };
}

function mapPreviewRow(row: JournalImportRowRow): JournalImportPreviewRowView {
  const normalized =
    row.normalizedData && typeof row.normalizedData === "object"
      ? (row.normalizedData as Record<string, unknown>)
      : null;

  return {
    id: row.id,
    rowIndex: row.rowIndex,
    status: row.status,
    sourceId: row.sourceId,
    identityKey: row.identityKey,
    title: typeof normalized?.title === "string" ? normalized.title : null,
    type: typeof normalized?.type === "string" ? normalized.type : null,
    issnRaw: typeof normalized?.issnRaw === "string" ? normalized.issnRaw : null,
    sourceYear:
      typeof normalized?.sourceYear === "number" ? normalized.sourceYear : null,
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
  };
}

export function scopeTenantKeyFor(
  scope: JournalCatalogScope,
  tenantId?: string | null,
) {
  if (scope === "GLOBAL") return GLOBAL_SCOPE_TENANT_KEY;
  if (!tenantId) {
    throw new Error("Tenant id is required for tenant-scoped journal operations.");
  }
  return `TENANT:${tenantId}`;
}

function createScopeAccess(context: ListContext): RecordScopeAccess {
  const scopeTenantKey = scopeTenantKeyFor(context.scope, context.tenantId);
  return {
    scope: context.scope,
    tenantId: context.scope === "TENANT" ? context.tenantId ?? null : null,
    scopeTenantKey,
  };
}

function createRecordPayload(
  normalized: NormalizedJournalImportData,
  access: RecordScopeAccess,
  actorUserId: string,
  extra?: Partial<Prisma.JournalCatalogRecordUncheckedCreateInput>,
): Prisma.JournalCatalogRecordUncheckedCreateInput {
  return {
    tenantId: access.tenantId,
    scope: access.scope,
    scopeTenantKey: access.scopeTenantKey,
    sourceSystem: "SCIMAGO_RAW",
    sourceYear: normalized.sourceYear,
    sourceId: normalized.sourceId,
    identityKey: normalized.identityKey,
    currentIdentityKey: normalized.identityKey,
    title: normalized.title,
    normalizedTitle: normalized.normalizedTitle,
    type: normalized.type,
    issnRaw: normalized.issnRaw,
    issnPrimary: normalized.issnPrimary,
    issnList: normalized.issnList,
    issnNormalizedList: normalized.issnNormalizedList,
    publisher: normalized.publisher,
    duplicatePublisher: normalized.duplicatePublisher,
    openAccessLabel: normalized.openAccessLabel,
    isOpenAccess: normalized.isOpenAccess,
    openAccessDiamondLabel: normalized.openAccessDiamondLabel,
    isOpenAccessDiamond: normalized.isOpenAccessDiamond,
    sjr: normalized.sjr,
    sjrBestQuartile: normalized.sjrBestQuartile,
    hIndex: normalized.hIndex,
    totalDocsCurrent: normalized.totalDocsCurrent,
    totalDocs3Years: normalized.totalDocs3Years,
    totalRefs: normalized.totalRefs,
    totalCitations3Years: normalized.totalCitations3Years,
    citableDocs3Years: normalized.citableDocs3Years,
    citationsPerDoc2Years: normalized.citationsPerDoc2Years,
    refsPerDoc: normalized.refsPerDoc,
    femalePercent: normalized.femalePercent,
    overton: normalized.overton,
    sdg: normalized.sdg,
    country: normalized.country,
    region: normalized.region,
    coverage: normalized.coverage,
    categories: normalized.categories,
    areas: normalized.areas,
    policyStatus: "ALLOWED",
    policyNote: null,
    isJournalEligible: normalized.isJournalEligible,
    createdByUserId: actorUserId,
    ...extra,
  };
}

function applyDuplicateIdentityRules(rows: ParsedJournalImportRow[]) {
  const seen = new Map<string, number>();

  for (const row of rows) {
    const identityKey = row.normalizedData?.identityKey;
    if (!identityKey) continue;

    const existingRowIndex = seen.get(identityKey);
    if (existingRowIndex == null) {
      seen.set(identityKey, row.rowIndex);
      continue;
    }

    row.errors.push(
      `Duplicate journal identity in file; matching row ${existingRowIndex} uses the same source id / ISSN / title identity.`,
    );
  }
}

type ImportRecordPayloadExtra = Partial<Prisma.JournalCatalogRecordUncheckedCreateInput>;

function buildImportRecordPayload(
  row: NormalizedJournalImportData,
  access: RecordScopeAccess,
  actorUserId: string,
  extra?: ImportRecordPayloadExtra,
): Prisma.JournalCatalogRecordUncheckedCreateInput {
  return createRecordPayload(row, access, actorUserId, extra);
}

async function applyGlobalJournalImportBatch(args: {
  batch: JournalImportBatchRow;
  normalizedRows: NormalizedJournalImportData[];
  access: RecordScopeAccess;
  actorUserId: string;
}) {
  const { batch, normalizedRows, access, actorUserId } = args;

  await prisma.$transaction(
    async (tx) => {
      await tx.journalCatalogRecord.updateMany({
        where: {
          scope: PrismaJournalCatalogScope.GLOBAL,
          scopeTenantKey: GLOBAL_SCOPE_TENANT_KEY,
          sourceYear: batch.sourceYear,
          isArchived: false,
          isSuperseded: false,
          currentIdentityKey: { not: null },
        },
        data: {
          isSuperseded: true,
          supersededAt: new Date(),
          supersededByBatchId: batch.id,
          currentIdentityKey: null,
        },
      });

      for (const chunk of chunkArray(normalizedRows, IMPORT_CHUNK_SIZE)) {
        await tx.journalCatalogRecord.createMany({
          data: chunk.map((row) =>
            buildImportRecordPayload(row, access, actorUserId, {
              importBatchId: batch.id,
              sourceSystem: batch.sourceSystem,
              rawSourcePayload: asJsonValue(row),
            }),
          ),
        });
      }
    },
    {
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
}

async function applyTenantJournalImportBatch(args: {
  batch: JournalImportBatchRow;
  normalizedRows: NormalizedJournalImportData[];
  access: RecordScopeAccess;
  actorUserId: string;
  tenantId: string | null | undefined;
}) {
  const { batch, normalizedRows, access, actorUserId, tenantId } = args;
  const scopeTenantKey = scopeTenantKeyFor("TENANT", tenantId);

  for (const chunk of chunkArray(normalizedRows, IMPORT_CHUNK_SIZE)) {
    const identityKeys = [...new Set(chunk.map((row) => row.identityKey))];
    const existingRows =
      identityKeys.length > 0
        ? await prisma.journalCatalogRecord.findMany({
            where: {
              scope: PrismaJournalCatalogScope.TENANT,
              tenantId: tenantId ?? undefined,
              scopeTenantKey,
              sourceYear: batch.sourceYear,
              currentIdentityKey: { in: identityKeys },
              isArchived: false,
              isSuperseded: false,
            },
            select: {
              id: true,
              currentIdentityKey: true,
              createdByUserId: true,
            },
          })
        : [];

    const existingByIdentity = new Map(
      existingRows
        .filter(
          (
            row,
          ): row is {
            id: string;
            currentIdentityKey: string;
            createdByUserId: string | null;
          } => Boolean(row.currentIdentityKey),
        )
        .map((row) => [row.currentIdentityKey, row]),
    );

    const createPayloads: Prisma.JournalCatalogRecordUncheckedCreateInput[] = [];

    for (const row of chunk) {
      const nextData = buildImportRecordPayload(row, access, actorUserId, {
        importBatchId: batch.id,
        sourceSystem: batch.sourceSystem,
        rawSourcePayload: asJsonValue(row),
      });

      const existing = existingByIdentity.get(row.identityKey);
      if (existing) {
        await prisma.journalCatalogRecord.update({
          where: { id: existing.id },
          data: {
            ...nextData,
            createdByUserId: existing.createdByUserId ?? actorUserId,
          },
        });
        continue;
      }

      createPayloads.push(nextData);
    }

    if (createPayloads.length > 0) {
      await prisma.journalCatalogRecord.createMany({
        data: createPayloads,
      });
    }
  }
}

function buildSearchWhere(search: string): Prisma.JournalCatalogRecordWhereInput {
  const token = search.trim();
  const { issnPrimary, issnNormalizedList } = normalizeIssnList(token);
  const normalizedIssn = issnNormalizedList[0] ?? null;

  const orConditions: Prisma.JournalCatalogRecordWhereInput[] = [
    { title: { contains: token, mode: "insensitive" } },
    { sourceId: { contains: token, mode: "insensitive" } },
    { publisher: { contains: token, mode: "insensitive" } },
    { country: { contains: token, mode: "insensitive" } },
    { categories: { contains: token, mode: "insensitive" } },
    { areas: { contains: token, mode: "insensitive" } },
    { policyNote: { contains: token, mode: "insensitive" } },
    { issnRaw: { contains: token, mode: "insensitive" } },
  ];

  if (issnPrimary) {
    orConditions.push({ issnPrimary });
    orConditions.push({ issnList: { has: issnPrimary } });
  }

  if (normalizedIssn) {
    orConditions.push({ issnNormalizedList: { has: normalizedIssn } });
  }

  return { OR: orConditions };
}

function getAndConditions(
  value:
    | Prisma.JournalCatalogRecordWhereInput
    | Prisma.JournalCatalogRecordWhereInput[]
    | undefined,
) {
  if (!value) return [] as Prisma.JournalCatalogRecordWhereInput[];
  return Array.isArray(value) ? value : [value];
}

function buildBaseWhere(
  context: ListContext,
  sourceYear: number | undefined,
  recordState: JournalListFilters["recordState"],
  skipYear = false,
): Prisma.JournalCatalogRecordWhereInput {
  const predicates: Prisma.JournalCatalogRecordWhereInput[] = [];

  if (!skipYear && sourceYear != null) {
    predicates.push({ sourceYear });
  }

  if (recordState === "ACTIVE") {
    predicates.push({
      isArchived: false,
      isSuperseded: false,
      currentIdentityKey: { not: null },
    });
  } else if (recordState === "ARCHIVED") {
    predicates.push({
      isArchived: true,
      isSuperseded: false,
    });
  } else {
    predicates.push({
      isSuperseded: false,
      OR: [
        { isArchived: true },
        { isArchived: false, currentIdentityKey: { not: null } },
      ],
    });
  }

  const scopePredicates: Prisma.JournalCatalogRecordWhereInput[] = [];

  if (context.scope === "GLOBAL") {
    scopePredicates.push({
      scope: PrismaJournalCatalogScope.GLOBAL,
      scopeTenantKey: GLOBAL_SCOPE_TENANT_KEY,
    });
  } else {
    scopePredicates.push({
      scope: PrismaJournalCatalogScope.GLOBAL,
      scopeTenantKey: GLOBAL_SCOPE_TENANT_KEY,
    });
    scopePredicates.push({
      scope: PrismaJournalCatalogScope.TENANT,
      tenantId: context.tenantId ?? undefined,
      scopeTenantKey: scopeTenantKeyFor("TENANT", context.tenantId),
    });
  }

  predicates.push({ OR: scopePredicates });
  return { AND: predicates };
}

function applyFieldFilters(
  where: Prisma.JournalCatalogRecordWhereInput,
  filters: JournalListFilters,
): Prisma.JournalCatalogRecordWhereInput {
  const andConditions = [...getAndConditions(where.AND)];

  if (filters.search) {
    andConditions.push(buildSearchWhere(filters.search));
  }
  if (filters.type) {
    andConditions.push({ type: { equals: filters.type, mode: "insensitive" } });
  }
  if (filters.quartile) {
    andConditions.push({
      sjrBestQuartile: { equals: filters.quartile, mode: "insensitive" },
    });
  }
  if (filters.country) {
    andConditions.push({ country: { contains: filters.country, mode: "insensitive" } });
  }
  if (filters.region) {
    andConditions.push({ region: { contains: filters.region, mode: "insensitive" } });
  }
  if (filters.publisher) {
    andConditions.push({
      publisher: { contains: filters.publisher, mode: "insensitive" },
    });
  }
  if (filters.policyStatus) {
    andConditions.push({ policyStatus: filters.policyStatus });
  }
  if (filters.openAccess) {
    andConditions.push({ isOpenAccess: filters.openAccess === "yes" });
  }
  if (filters.openAccessDiamond) {
    andConditions.push({
      isOpenAccessDiamond: filters.openAccessDiamond === "yes",
    });
  }
  if (filters.onlyEligibleJournals) {
    andConditions.push({ isJournalEligible: true });
  }

  return { AND: andConditions };
}

async function resolveLatestYear(
  context: ListContext,
  recordState: JournalListFilters["recordState"],
): Promise<number | undefined> {
  const latest = await prisma.journalCatalogRecord.findFirst({
    where: buildBaseWhere(context, undefined, recordState, true),
    orderBy: [{ sourceYear: "desc" }, { updatedAt: "desc" }],
    select: { sourceYear: true },
  });

  return latest?.sourceYear;
}

function sortViews(
  rows: JournalCatalogRecordView[],
  filters: JournalListFilters,
): JournalCatalogRecordView[] {
  const direction = filters.sortDirection === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    let result = 0;

    switch (filters.sortField) {
      case "sourceYear":
        result = left.sourceYear - right.sourceYear;
        break;
      case "sjrBestQuartile":
        result = quarterRank(left.sjrBestQuartile) - quarterRank(right.sjrBestQuartile);
        break;
      case "sjr":
        result = compareNullableNumber(left.sjr, right.sjr);
        break;
      case "hIndex":
        result = compareNullableNumber(left.hIndex, right.hIndex);
        break;
      case "updatedAt":
        result =
          new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
        break;
      case "createdAt":
        result =
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        break;
      case "title":
      default:
        result = left.title.localeCompare(right.title, undefined, {
          sensitivity: "base",
        });
        break;
    }

    if (result === 0) {
      result = compareNullableString(left.issnPrimary, right.issnPrimary);
    }

    return result * direction;
  });
}

function createFacets(rows: JournalCatalogRecordView[]) {
  const collect = (values: Array<string | null>) =>
    [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()))]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  const years = [...new Set(rows.map((row) => row.sourceYear))].sort((a, b) => b - a);

  return {
    years,
    quartiles: collect(rows.map((row) => row.sjrBestQuartile)),
    types: collect(rows.map((row) => row.type)),
    countries: collect(rows.map((row) => row.country)),
    regions: collect(rows.map((row) => row.region)),
    publishers: collect(rows.map((row) => row.publisher)),
    policyStatuses: [...new Set(rows.map((row) => row.policyStatus))].sort(),
  };
}

async function getRecordForScope(
  recordId: string,
  context: ListContext,
): Promise<JournalCatalogRecordRow | null> {
  const record = await prisma.journalCatalogRecord.findUnique({
    where: { id: recordId },
  });

  if (!record) {
    return null;
  }

  if (context.scope === "GLOBAL") {
    return record.scope === PrismaJournalCatalogScope.GLOBAL ? record : null;
  }

  if (record.scope === PrismaJournalCatalogScope.GLOBAL) {
    return record;
  }

  return record.tenantId === context.tenantId ? record : null;
}

async function getBatchForScope(
  batchId: string,
  context: ListContext,
): Promise<JournalImportBatchRow | null> {
  const batch = await prisma.journalImportBatch.findUnique({
    where: { id: batchId },
  });

  if (!batch) {
    return null;
  }

  if (context.scope === "GLOBAL") {
    return batch.scope === PrismaJournalCatalogScope.GLOBAL ? batch : null;
  }

  return batch.scope === PrismaJournalCatalogScope.TENANT &&
    batch.tenantId === context.tenantId
    ? batch
    : null;
}

function toRecordActionError(
  message: string,
  code: string,
): JournalCatalogActionResult {
  return {
    status: "error",
    message,
    code,
  };
}

function normalizeUpdateValues(values: JournalUpdateInput) {
  const title = values.title.trim();
  const normalizedTitle = normalizeJournalTitle(title);
  const issnRaw = normalizeText(values.issnRaw ?? null);
  const { issnPrimary, issnList, issnNormalizedList } = normalizeIssnList(issnRaw);
  const sourceId = normalizeText(values.sourceId ?? null);
  const identityKey = buildIdentityKey({
    sourceId,
    issnPrimary,
    normalizedTitle,
  });

  return {
    sourceYear: values.sourceYear,
    sourceId,
    title,
    normalizedTitle,
    type: values.type.trim(),
    issnRaw,
    issnPrimary,
    issnList,
    issnNormalizedList,
    publisher: normalizeText(values.publisher ?? null),
    duplicatePublisher: normalizeText(values.duplicatePublisher ?? null),
    openAccessLabel: normalizeText(values.openAccessLabel ?? null),
    isOpenAccess: values.isOpenAccess ?? null,
    openAccessDiamondLabel: normalizeText(values.openAccessDiamondLabel ?? null),
    isOpenAccessDiamond: values.isOpenAccessDiamond ?? null,
    sjr: values.sjr ?? null,
    sjrBestQuartile: normalizeText(values.sjrBestQuartile ?? null),
    hIndex: values.hIndex ?? null,
    totalDocsCurrent: values.totalDocsCurrent ?? null,
    totalDocs3Years: values.totalDocs3Years ?? null,
    totalRefs: values.totalRefs ?? null,
    totalCitations3Years: values.totalCitations3Years ?? null,
    citableDocs3Years: values.citableDocs3Years ?? null,
    citationsPerDoc2Years: values.citationsPerDoc2Years ?? null,
    refsPerDoc: values.refsPerDoc ?? null,
    femalePercent: values.femalePercent ?? null,
    overton: values.overton ?? null,
    sdg: values.sdg ?? null,
    country: normalizeText(values.country ?? null),
    region: normalizeText(values.region ?? null),
    coverage: normalizeText(values.coverage ?? null),
    categories: normalizeText(values.categories ?? null),
    areas: normalizeText(values.areas ?? null),
    policyStatus: values.policyStatus,
    policyNote: normalizeText(values.policyNote ?? null),
    isJournalEligible: values.type.trim().toLowerCase() === "journal",
    identityKey,
  };
}

async function createAuditLog(input: {
  tenantId?: string | null;
  actorUserId: string;
  actorRole: Role;
  targetType: string;
  targetId: string;
  action: string;
  previousState?: Prisma.InputJsonValue | null;
  newState?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
}) {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      previousState: input.previousState ?? undefined,
      newState: input.newState ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  });
}

export async function listJournalCatalogRecords(
  context: ListContext,
  rawFilters: Partial<JournalListFilters> = {},
): Promise<JournalCatalogListResponse> {
  const filters = journalListFiltersSchema.parse(rawFilters);
  const resolvedYear =
    filters.sourceYear ?? (await resolveLatestYear(context, filters.recordState));
  const finalFilters: JournalListFilters = {
    ...filters,
    sourceYear: resolvedYear,
  };

  const baseWhere = buildBaseWhere(context, resolvedYear, finalFilters.recordState);
  const where = applyFieldFilters(baseWhere, finalFilters);

  const rawRows = await prisma.journalCatalogRecord.findMany({
    where,
    orderBy: [{ sourceYear: "desc" }, { updatedAt: "desc" }],
  });

  let mappedRows: JournalCatalogRecordView[];

  if (context.scope === "GLOBAL" || finalFilters.recordState !== "ACTIVE") {
    mappedRows = rawRows.map((row) => mapRecordView(row));
  } else {
    const tenantRows = rawRows.filter(
      (row) => row.scope === PrismaJournalCatalogScope.TENANT,
    );
    const tenantIdentitySet = new Set(tenantRows.map((row) => row.identityKey));
    const globalRows = rawRows.filter(
      (row) =>
        row.scope === PrismaJournalCatalogScope.GLOBAL &&
        !tenantIdentitySet.has(row.identityKey),
    );

    mappedRows = [...tenantRows, ...globalRows].map((row) => mapRecordView(row));
  }

  if (finalFilters.effectiveSource) {
    mappedRows = mappedRows.filter(
      (row) => row.effectiveSource === finalFilters.effectiveSource,
    );
  }

  const sortedRows = sortViews(mappedRows, finalFilters);
  const total = sortedRows.length;
  const start = (finalFilters.page - 1) * finalFilters.pageSize;
  const pagedRows = sortedRows.slice(start, start + finalFilters.pageSize);

  return {
    rows: pagedRows,
    total,
    page: finalFilters.page,
    pageSize: finalFilters.pageSize,
    facets: createFacets(sortedRows),
  };
}

export async function getJournalCatalogRecord(
  recordId: string,
  context: ListContext,
): Promise<JournalCatalogRecordView | null> {
  const record = await getRecordForScope(recordId, context);
  return record ? mapRecordView(record) : null;
}

export async function listJournalImportBatches(
  context: ListContext,
  limit = 20,
): Promise<JournalImportBatchView[]> {
  const where: Prisma.JournalImportBatchWhereInput =
    context.scope === "GLOBAL"
      ? { scope: PrismaJournalCatalogScope.GLOBAL }
      : {
          scope: PrismaJournalCatalogScope.TENANT,
          tenantId: context.tenantId ?? undefined,
        };

  const batches = await prisma.journalImportBatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return batches.map(mapBatchView);
}

export async function previewJournalImport(
  input: PreviewInput,
): Promise<JournalImportPreviewResponse> {
  const access = createScopeAccess({
    scope: input.scope,
    tenantId: input.tenantId,
  });

  const parsed = parseJournalImportBuffer({
    buffer: input.buffer,
    fileName: input.fileName,
    sourceYear: input.sourceYear,
  });

  applyDuplicateIdentityRules(parsed.rows);

  const rowsPayload = parsed.rows.map((row) => {
    const status =
      row.errors.length > 0
        ? JournalImportRowStatus.REJECTED
        : row.warnings.length > 0
          ? JournalImportRowStatus.WARNING
          : JournalImportRowStatus.VALID;

    return {
      rowIndex: row.rowIndex,
      status,
      sourceId: row.normalizedData?.sourceId ?? null,
      identityKey: row.normalizedData?.identityKey ?? null,
      rawText: row.rawText,
      rawData: asJsonValue(row.rawData),
      normalizedData: asNullableJsonValue(row.normalizedData),
      errors: row.errors,
      warnings: row.warnings,
    } satisfies Prisma.JournalImportRowUncheckedCreateWithoutImportBatchInput;
  });

  const totalRows = rowsPayload.length;
  const validRows = rowsPayload.filter(
    (row) => row.status === JournalImportRowStatus.VALID,
  ).length;
  const warningRows = rowsPayload.filter(
    (row) => row.status === JournalImportRowStatus.WARNING,
  ).length;
  const rejectedRows = rowsPayload.filter(
    (row) => row.status === JournalImportRowStatus.REJECTED,
  ).length;

  const batch = await prisma.journalImportBatch.create({
    data: {
      tenantId: access.tenantId,
      scope: access.scope,
      scopeTenantKey: access.scopeTenantKey,
      uploadedByUserId: input.actorUserId,
      fileName: input.fileName,
      fileType: input.fileType,
      sourceSystem: parsed.detectedFormat,
      sourceYear: parsed.sourceYear,
      mode: input.scope === "GLOBAL" ? "REPLACE_YEAR" : "UPSERT",
      totalRows,
      validRows,
      warningRows,
      rejectedRows,
      metadata: asJsonValue({
        detectedFormat: parsed.detectedFormat,
        previewGeneratedAt: new Date().toISOString(),
      }),
      rows: {
        create: rowsPayload,
      },
    },
  });

  const previewRows = await prisma.journalImportRow.findMany({
    where: { importBatchId: batch.id },
    orderBy: { rowIndex: "asc" },
    take: 200,
  });

  return {
    batch: mapBatchView(batch),
    rows: previewRows.map(mapPreviewRow),
    detectedFormat: parsed.detectedFormat,
    message: `Preview created for ${totalRows} row(s): ${validRows} valid, ${warningRows} warnings, ${rejectedRows} rejected.`,
  };
}

export async function confirmJournalImportBatch(
  input: ConfirmInput,
): Promise<JournalCatalogActionResult> {
  const context: ListContext = {
    scope: input.scope,
    tenantId: input.tenantId,
  };

  const batch = await getBatchForScope(input.batchId, context);
  if (!batch) {
    return toRecordActionError("Journal import batch not found.", "BATCH_NOT_FOUND");
  }

  const claimed = await prisma.journalImportBatch.updateMany({
    where: {
      id: batch.id,
      status: {
        in: [JournalImportBatchStatus.VALIDATED, JournalImportBatchStatus.FAILED],
      },
    },
    data: {
      status: JournalImportBatchStatus.APPLYING,
      failureMessage: null,
      failedAt: null,
    },
  });

  if (claimed.count === 0) {
    if (batch.status === JournalImportBatchStatus.CONFIRMED) {
      return toRecordActionError(
        "This import batch has already been confirmed.",
        "BATCH_ALREADY_CONFIRMED",
      );
    }

    if (batch.status === JournalImportBatchStatus.FAILED) {
      return toRecordActionError(
        "This import batch could not be reclaimed for retry.",
        "BATCH_RETRY_FAILED",
      );
    }

    return toRecordActionError(
      "This import batch is already being applied.",
      "BATCH_ALREADY_APPLYING",
    );
  }

  try {
    const rows = await prisma.journalImportRow.findMany({
      where: {
        importBatchId: batch.id,
        status: {
          in: [JournalImportRowStatus.VALID, JournalImportRowStatus.WARNING],
        },
      },
      orderBy: { rowIndex: "asc" },
    });

    const normalizedRows = rows
      .map((row) => row.normalizedData as NormalizedJournalImportData | null)
      .filter((row): row is NormalizedJournalImportData => Boolean(row));

    const access = createScopeAccess({
      scope: input.scope,
      tenantId: input.tenantId,
    });

    if (input.scope === "GLOBAL") {
      await applyGlobalJournalImportBatch({
        batch,
        normalizedRows,
        access,
        actorUserId: input.actorUserId,
      });
    } else {
      await applyTenantJournalImportBatch({
        batch,
        normalizedRows,
        access,
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
      });
    }

    await prisma.$transaction([
      prisma.journalImportRow.updateMany({
        where: {
          importBatchId: batch.id,
          status: {
            in: [JournalImportRowStatus.VALID, JournalImportRowStatus.WARNING],
          },
        },
        data: {
          status: JournalImportRowStatus.APPLIED,
        },
      }),
      prisma.journalImportBatch.update({
        where: { id: batch.id },
        data: {
          status: JournalImportBatchStatus.CONFIRMED,
          confirmedAt: new Date(),
          appliedRows: normalizedRows.length,
          failedAt: null,
          failureMessage: null,
        },
      }),
    ]);

    await createAuditLog({
      tenantId: input.scope === "TENANT" ? input.tenantId : null,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetType: "JournalImportBatch",
      targetId: batch.id,
      action: "journals.import.confirmed",
      newState: {
        scope: input.scope,
        sourceYear: batch.sourceYear,
        appliedRows: normalizedRows.length,
      },
    });

    return {
      status: "success",
      message:
        input.scope === "GLOBAL"
          ? `Imported ${normalizedRows.length} journal row(s) and replaced the ${batch.sourceYear} global snapshot.`
          : `Imported ${normalizedRows.length} tenant journal row(s).`,
      id: batch.id,
    };
  } catch (error) {
    await prisma.journalImportBatch.update({
      where: { id: batch.id },
      data: {
        status: JournalImportBatchStatus.FAILED,
        failedAt: new Date(),
        failureMessage:
          error instanceof Error ? error.message.slice(0, 500) : "Import failed.",
      },
    });

    return toRecordActionError(
      error instanceof Error ? error.message : "Journal import failed.",
      "IMPORT_FAILED",
    );
  }
}

export async function updateJournalCatalogRecord(
  input: UpdateInput,
): Promise<JournalCatalogActionResult> {
  const parsed = journalUpdateInputSchema.safeParse(input.values);
  if (!parsed.success) {
    return toRecordActionError(
      parsed.error.issues[0]?.message ?? "Invalid journal details.",
      "INVALID_INPUT",
    );
  }

  const context: ListContext = {
    scope: input.scope,
    tenantId: input.tenantId,
  };
  const record = await getRecordForScope(input.recordId, context);

  if (!record) {
    return toRecordActionError("Journal record not found.", "RECORD_NOT_FOUND");
  }

  if (input.scope === "TENANT" && record.scope === PrismaJournalCatalogScope.GLOBAL) {
    return toRecordActionError(
      "Tenant admins cannot edit global rows directly; create a tenant override instead.",
      "OVERRIDE_REQUIRED",
    );
  }

  if (record.isSuperseded) {
    return toRecordActionError(
      "Superseded journal rows are historical snapshots and cannot be edited.",
      "SUPERSEDED_RECORD",
    );
  }

  const normalized = normalizeUpdateValues(parsed.data);
  const scopeTenantKey = scopeTenantKeyFor(
    record.scope,
    record.scope === PrismaJournalCatalogScope.TENANT ? record.tenantId : null,
  );

  const conflictingRecord = await prisma.journalCatalogRecord.findFirst({
    where: {
      id: { not: record.id },
      scopeTenantKey,
      sourceYear: normalized.sourceYear,
      currentIdentityKey: normalized.identityKey,
      isArchived: false,
      isSuperseded: false,
    },
    select: { id: true },
  });

  if (conflictingRecord) {
    return toRecordActionError(
      "Another active journal row already exists for this year and identity.",
      "IDENTITY_CONFLICT",
    );
  }

  const previousState = mapRecordView(record);

  const updated = await prisma.journalCatalogRecord.update({
    where: { id: record.id },
    data: {
      sourceYear: normalized.sourceYear,
      sourceId: normalized.sourceId,
      identityKey: normalized.identityKey,
      currentIdentityKey: record.isArchived ? null : normalized.identityKey,
      title: normalized.title,
      normalizedTitle: normalized.normalizedTitle,
      type: normalized.type,
      issnRaw: normalized.issnRaw,
      issnPrimary: normalized.issnPrimary,
      issnList: normalized.issnList,
      issnNormalizedList: normalized.issnNormalizedList,
      publisher: normalized.publisher,
      duplicatePublisher: normalized.duplicatePublisher,
      openAccessLabel: normalized.openAccessLabel,
      isOpenAccess: normalized.isOpenAccess,
      openAccessDiamondLabel: normalized.openAccessDiamondLabel,
      isOpenAccessDiamond: normalized.isOpenAccessDiamond,
      sjr: normalized.sjr,
      sjrBestQuartile: normalized.sjrBestQuartile,
      hIndex: normalized.hIndex,
      totalDocsCurrent: normalized.totalDocsCurrent,
      totalDocs3Years: normalized.totalDocs3Years,
      totalRefs: normalized.totalRefs,
      totalCitations3Years: normalized.totalCitations3Years,
      citableDocs3Years: normalized.citableDocs3Years,
      citationsPerDoc2Years: normalized.citationsPerDoc2Years,
      refsPerDoc: normalized.refsPerDoc,
      femalePercent: normalized.femalePercent,
      overton: normalized.overton,
      sdg: normalized.sdg,
      country: normalized.country,
      region: normalized.region,
      coverage: normalized.coverage,
      categories: normalized.categories,
      areas: normalized.areas,
      policyStatus: normalized.policyStatus,
      policyNote: normalized.policyNote,
      isJournalEligible: normalized.isJournalEligible,
    },
  });

  await createAuditLog({
    tenantId:
      updated.scope === PrismaJournalCatalogScope.TENANT ? updated.tenantId : null,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    targetType: "JournalCatalogRecord",
    targetId: updated.id,
    action: "journals.record.updated",
    previousState,
    newState: mapRecordView(updated),
  });

  return {
    status: "success",
    message: "Journal record updated.",
    id: updated.id,
  };
}

export async function archiveJournalCatalogRecord(
  input: ArchiveInput,
): Promise<JournalCatalogActionResult> {
  const context: ListContext = {
    scope: input.scope,
    tenantId: input.tenantId,
  };
  const record = await getRecordForScope(input.recordId, context);

  if (!record) {
    return toRecordActionError("Journal record not found.", "RECORD_NOT_FOUND");
  }

  if (input.scope === "TENANT" && record.scope === PrismaJournalCatalogScope.GLOBAL) {
    return toRecordActionError(
      "Tenant admins cannot archive global rows directly.",
      "PERMISSION_DENIED",
    );
  }

  if (record.isArchived) {
    return toRecordActionError("Journal record is already archived.", "ALREADY_ARCHIVED");
  }

  if (record.isSuperseded) {
    return toRecordActionError(
      "Superseded journal rows cannot be archived.",
      "SUPERSEDED_RECORD",
    );
  }

  const archived = await prisma.journalCatalogRecord.update({
    where: { id: record.id },
    data: {
      isArchived: true,
      archivedAt: new Date(),
      archivedByUserId: input.actorUserId,
      archiveReason: normalizeText(input.reason ?? null),
      currentIdentityKey: null,
    },
  });

  await createAuditLog({
    tenantId:
      archived.scope === PrismaJournalCatalogScope.TENANT ? archived.tenantId : null,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    targetType: "JournalCatalogRecord",
    targetId: archived.id,
    action: "journals.record.archived",
    previousState: mapRecordView(record),
    newState: mapRecordView(archived),
    metadata: {
      reason: normalizeText(input.reason ?? null),
    },
  });

  return {
    status: "success",
    message: "Journal record archived.",
    id: archived.id,
  };
}

export async function restoreJournalCatalogRecord(
  input: RestoreInput,
): Promise<JournalCatalogActionResult> {
  const context: ListContext = {
    scope: input.scope,
    tenantId: input.tenantId,
  };
  const record = await getRecordForScope(input.recordId, context);

  if (!record) {
    return toRecordActionError("Journal record not found.", "RECORD_NOT_FOUND");
  }

  if (input.scope === "TENANT" && record.scope === PrismaJournalCatalogScope.GLOBAL) {
    return toRecordActionError(
      "Tenant admins cannot restore global rows directly.",
      "PERMISSION_DENIED",
    );
  }

  if (!record.isArchived) {
    return toRecordActionError("Journal record is already active.", "NOT_ARCHIVED");
  }

  if (record.isSuperseded) {
    return toRecordActionError(
      "Superseded journal rows cannot be restored.",
      "SUPERSEDED_RECORD",
    );
  }

  const conflict = await prisma.journalCatalogRecord.findFirst({
    where: {
      id: { not: record.id },
      scopeTenantKey: record.scopeTenantKey,
      sourceYear: record.sourceYear,
      currentIdentityKey: record.identityKey,
      isArchived: false,
      isSuperseded: false,
    },
    select: { id: true },
  });

  if (conflict) {
    return toRecordActionError(
      "A current journal row with the same identity already exists. Archive or edit that row before restoring this one.",
      "IDENTITY_CONFLICT",
    );
  }

  const restored = await prisma.journalCatalogRecord.update({
    where: { id: record.id },
    data: {
      isArchived: false,
      archivedAt: null,
      archivedByUserId: null,
      archiveReason: null,
      currentIdentityKey: record.identityKey,
    },
  });

  await createAuditLog({
    tenantId:
      restored.scope === PrismaJournalCatalogScope.TENANT ? restored.tenantId : null,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    targetType: "JournalCatalogRecord",
    targetId: restored.id,
    action: "journals.record.restored",
    previousState: mapRecordView(record),
    newState: mapRecordView(restored),
  });

  return {
    status: "success",
    message: "Journal record restored.",
    id: restored.id,
  };
}

export async function createTenantJournalOverride(
  input: OverrideInput,
): Promise<JournalCatalogActionResult> {
  const source = await prisma.journalCatalogRecord.findUnique({
    where: { id: input.recordId },
  });

  if (!source || source.scope !== PrismaJournalCatalogScope.GLOBAL) {
    return toRecordActionError("Global journal record not found.", "RECORD_NOT_FOUND");
  }

  if (source.isArchived || source.isSuperseded || !source.currentIdentityKey) {
    return toRecordActionError(
      "Only active global journal rows can be overridden.",
      "INVALID_OVERRIDE_SOURCE",
    );
  }

  const scopeTenantKey = scopeTenantKeyFor("TENANT", input.tenantId);
  const existing = await prisma.journalCatalogRecord.findFirst({
    where: {
      scope: PrismaJournalCatalogScope.TENANT,
      tenantId: input.tenantId,
      scopeTenantKey,
      sourceYear: source.sourceYear,
      currentIdentityKey: source.identityKey,
      isArchived: false,
      isSuperseded: false,
    },
  });

  if (existing) {
    return {
      status: "success",
      message: "Existing tenant row already overrides this journal.",
      id: existing.id,
    };
  }

  const created = await prisma.journalCatalogRecord.create({
    data: {
      tenantId: input.tenantId,
      scope: PrismaJournalCatalogScope.TENANT,
      scopeTenantKey,
      sourceSystem: source.sourceSystem,
      sourceYear: source.sourceYear,
      sourceId: source.sourceId,
      identityKey: source.identityKey,
      currentIdentityKey: source.identityKey,
      title: source.title,
      normalizedTitle: source.normalizedTitle,
      type: source.type,
      issnRaw: source.issnRaw,
      issnPrimary: source.issnPrimary,
      issnList: source.issnList,
      issnNormalizedList: source.issnNormalizedList,
      publisher: source.publisher,
      duplicatePublisher: source.duplicatePublisher,
      openAccessLabel: source.openAccessLabel,
      isOpenAccess: source.isOpenAccess,
      openAccessDiamondLabel: source.openAccessDiamondLabel,
      isOpenAccessDiamond: source.isOpenAccessDiamond,
      sjr: source.sjr,
      sjrBestQuartile: source.sjrBestQuartile,
      hIndex: source.hIndex,
      totalDocsCurrent: source.totalDocsCurrent,
      totalDocs3Years: source.totalDocs3Years,
      totalRefs: source.totalRefs,
      totalCitations3Years: source.totalCitations3Years,
      citableDocs3Years: source.citableDocs3Years,
      citationsPerDoc2Years: source.citationsPerDoc2Years,
      refsPerDoc: source.refsPerDoc,
      femalePercent: source.femalePercent,
      overton: source.overton,
      sdg: source.sdg,
      country: source.country,
      region: source.region,
      coverage: source.coverage,
      categories: source.categories,
      areas: source.areas,
      policyStatus: source.policyStatus,
      policyNote: source.policyNote,
      isJournalEligible: source.isJournalEligible,
      importBatchId: source.importBatchId,
      overriddenGlobalRecordId: source.id,
      rawSourcePayload: asNullableJsonValue(source.rawSourcePayload),
      metadata: asNullableJsonValue(source.metadata),
      createdByUserId: input.actorUserId,
    },
  });

  await createAuditLog({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    targetType: "JournalCatalogRecord",
    targetId: created.id,
    action: "journals.override.created",
    metadata: {
      sourceRecordId: source.id,
      sourceYear: source.sourceYear,
      identityKey: source.identityKey,
    },
    newState: mapRecordView(created),
  });

  return {
    status: "success",
    message: "Tenant override created from the global journal row.",
    id: created.id,
  };
}

export async function findEffectiveJournalRecordByIssn(
  input: JournalLookupInput,
): Promise<JournalCatalogRecordView | null> {
  const { issnNormalizedList } = normalizeIssnList(input.issn);
  const normalizedIssn = issnNormalizedList[0];
  if (!normalizedIssn) {
    return null;
  }

  if (input.tenantId) {
    const tenantRecord = await prisma.journalCatalogRecord.findFirst({
      where: {
        scope: PrismaJournalCatalogScope.TENANT,
        tenantId: input.tenantId,
        sourceYear: input.sourceYear,
        isArchived: false,
        isSuperseded: false,
        currentIdentityKey: { not: null },
        issnNormalizedList: { has: normalizedIssn },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (tenantRecord) {
      return mapRecordView(tenantRecord);
    }
  }

  const globalRecord = await prisma.journalCatalogRecord.findFirst({
    where: {
      scope: PrismaJournalCatalogScope.GLOBAL,
      sourceYear: input.sourceYear,
      isArchived: false,
      isSuperseded: false,
      currentIdentityKey: { not: null },
      issnNormalizedList: { has: normalizedIssn },
    },
    orderBy: { updatedAt: "desc" },
  });

  return globalRecord ? mapRecordView(globalRecord) : null;
}

export async function findBestEffectiveJournalRecordByIssn(
  input: JournalLookupInput,
): Promise<ResolvedJournalCatalogLookup | null> {
  const { issnNormalizedList } = normalizeIssnList(input.issn);
  const normalizedIssn = issnNormalizedList[0];
  if (!normalizedIssn) {
    return null;
  }

  const scopeWhere: Prisma.JournalCatalogRecordWhereInput[] = [
    {
      scope: PrismaJournalCatalogScope.GLOBAL,
      scopeTenantKey: GLOBAL_SCOPE_TENANT_KEY,
    },
  ];

  if (input.tenantId) {
    scopeWhere.unshift({
      scope: PrismaJournalCatalogScope.TENANT,
      tenantId: input.tenantId,
      scopeTenantKey: scopeTenantKeyFor("TENANT", input.tenantId),
    });
  }

  const candidates = await prisma.journalCatalogRecord.findMany({
    where: {
      OR: scopeWhere,
      isArchived: false,
      isSuperseded: false,
      currentIdentityKey: { not: null },
      issnNormalizedList: { has: normalizedIssn },
    },
    orderBy: [{ sourceYear: "desc" }, { updatedAt: "desc" }],
  });

  if (candidates.length === 0) {
    return null;
  }

  const ranked = [...candidates]
    .map((record) => {
      const yearDelta = record.sourceYear - input.sourceYear;
      const resolutionStrategy: ResolvedJournalCatalogLookup["resolutionStrategy"] =
        yearDelta === 0
          ? "EXACT_YEAR"
          : yearDelta < 0
            ? "LATEST_PREVIOUS_YEAR"
            : "NEAREST_FUTURE_YEAR";
      const priorityBucket =
        resolutionStrategy === "EXACT_YEAR"
          ? 0
          : resolutionStrategy === "LATEST_PREVIOUS_YEAR"
            ? 1
            : 2;
      const yearDistance = Math.abs(yearDelta);
      const scopePriority =
        record.scope === PrismaJournalCatalogScope.TENANT ? 0 : 1;

      return {
        record,
        resolutionStrategy,
        priorityBucket,
        yearDistance,
        scopePriority,
      };
    })
    .sort((left, right) => {
      if (left.priorityBucket !== right.priorityBucket) {
        return left.priorityBucket - right.priorityBucket;
      }
      if (left.yearDistance !== right.yearDistance) {
        return left.yearDistance - right.yearDistance;
      }
      if (left.scopePriority !== right.scopePriority) {
        return left.scopePriority - right.scopePriority;
      }
      return right.record.updatedAt.getTime() - left.record.updatedAt.getTime();
    });

  const best = ranked[0];
  if (!best) {
    return null;
  }

  return {
    record: mapRecordView(best.record),
    requestedSourceYear: input.sourceYear,
    resolvedSourceYear: best.record.sourceYear,
    matchedExactly: best.record.sourceYear === input.sourceYear,
    resolutionStrategy: best.resolutionStrategy,
  };
}
