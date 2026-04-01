import { z } from "zod";

export const journalCatalogScopeSchema = z.enum(["GLOBAL", "TENANT"]);
export type JournalCatalogScope = z.infer<typeof journalCatalogScopeSchema>;

export const journalImportSourceSystemSchema = z.enum([
  "SCIMAGO_RAW",
  "TENANT_TEMPLATE",
]);
export type JournalImportSourceSystem = z.infer<
  typeof journalImportSourceSystemSchema
>;

export const journalRecordStateSchema = z.enum(["ACTIVE", "ARCHIVED", "ALL"]);
export type JournalRecordState = z.infer<typeof journalRecordStateSchema>;

export const journalEffectiveSourceSchema = z.enum([
  "GLOBAL",
  "TENANT_ONLY",
  "TENANT_OVERRIDE",
  "ARCHIVED_GLOBAL",
  "ARCHIVED_TENANT",
]);
export type JournalEffectiveSource = z.infer<typeof journalEffectiveSourceSchema>;

export const journalPolicyStatusSchema = z.enum([
  "ALLOWED",
  "DISABLED",
  "BLACKLISTED",
]);
export type JournalPolicyStatus = z.infer<typeof journalPolicyStatusSchema>;

export const journalSortFieldSchema = z.enum([
  "title",
  "sourceYear",
  "sjrBestQuartile",
  "sjr",
  "hIndex",
  "updatedAt",
  "createdAt",
]);
export type JournalSortField = z.infer<typeof journalSortFieldSchema>;

export const journalSortDirectionSchema = z.enum(["asc", "desc"]);
export type JournalSortDirection = z.infer<typeof journalSortDirectionSchema>;

export const journalListFiltersSchema = z.object({
  search: z.string().trim().max(200).optional(),
  sourceYear: z.number().int().min(1900).max(2100).optional(),
  type: z.string().trim().max(80).optional(),
  quartile: z.string().trim().max(20).optional(),
  openAccess: z.enum(["yes", "no"]).optional(),
  openAccessDiamond: z.enum(["yes", "no"]).optional(),
  country: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  publisher: z.string().trim().max(200).optional(),
  policyStatus: journalPolicyStatusSchema.optional(),
  onlyEligibleJournals: z.boolean().optional(),
  effectiveSource: journalEffectiveSourceSchema.optional(),
  recordState: journalRecordStateSchema.default("ACTIVE"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sortField: journalSortFieldSchema.default("title"),
  sortDirection: journalSortDirectionSchema.default("asc"),
});
export type JournalListFilters = z.infer<typeof journalListFiltersSchema>;

export const journalUpdateInputSchema = z.object({
  sourceYear: z.number().int().min(1900).max(2100),
  sourceId: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().min(2).max(400),
  type: z.string().trim().min(1).max(80),
  issnRaw: z.string().trim().max(400).nullable().optional(),
  publisher: z.string().trim().max(300).nullable().optional(),
  duplicatePublisher: z.string().trim().max(300).nullable().optional(),
  openAccessLabel: z.string().trim().max(40).nullable().optional(),
  isOpenAccess: z.boolean().nullable().optional(),
  openAccessDiamondLabel: z.string().trim().max(40).nullable().optional(),
  isOpenAccessDiamond: z.boolean().nullable().optional(),
  sjr: z.number().min(0).nullable().optional(),
  sjrBestQuartile: z.string().trim().max(20).nullable().optional(),
  hIndex: z.number().int().min(0).nullable().optional(),
  totalDocsCurrent: z.number().int().min(0).nullable().optional(),
  totalDocs3Years: z.number().int().min(0).nullable().optional(),
  totalRefs: z.number().int().min(0).nullable().optional(),
  totalCitations3Years: z.number().int().min(0).nullable().optional(),
  citableDocs3Years: z.number().int().min(0).nullable().optional(),
  citationsPerDoc2Years: z.number().min(0).nullable().optional(),
  refsPerDoc: z.number().min(0).nullable().optional(),
  femalePercent: z.number().min(0).max(100).nullable().optional(),
  overton: z.number().int().min(0).nullable().optional(),
  sdg: z.number().int().min(0).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  coverage: z.string().trim().max(300).nullable().optional(),
  categories: z.string().trim().max(2000).nullable().optional(),
  areas: z.string().trim().max(1000).nullable().optional(),
  policyStatus: journalPolicyStatusSchema.default("ALLOWED"),
  policyNote: z.string().trim().max(1000).nullable().optional(),
});
export type JournalUpdateInput = z.infer<typeof journalUpdateInputSchema>;

export type JournalCatalogActionResult = {
  status: "success" | "error";
  message: string;
  id?: string;
  code?: string;
};

export type JournalCatalogRecordView = {
  id: string;
  scope: JournalCatalogScope;
  tenantId: string | null;
  sourceSystem: JournalImportSourceSystem;
  sourceYear: number;
  sourceId: string | null;
  identityKey: string;
  title: string;
  normalizedTitle: string;
  type: string;
  issnRaw: string | null;
  issnPrimary: string | null;
  issnList: string[];
  issnNormalizedList: string[];
  publisher: string | null;
  duplicatePublisher: string | null;
  openAccessLabel: string | null;
  isOpenAccess: boolean | null;
  openAccessDiamondLabel: string | null;
  isOpenAccessDiamond: boolean | null;
  sjr: number | null;
  sjrBestQuartile: string | null;
  hIndex: number | null;
  totalDocsCurrent: number | null;
  totalDocs3Years: number | null;
  totalRefs: number | null;
  totalCitations3Years: number | null;
  citableDocs3Years: number | null;
  citationsPerDoc2Years: number | null;
  refsPerDoc: number | null;
  femalePercent: number | null;
  overton: number | null;
  sdg: number | null;
  country: string | null;
  region: string | null;
  coverage: string | null;
  categories: string | null;
  areas: string | null;
  policyStatus: JournalPolicyStatus;
  policyNote: string | null;
  isJournalEligible: boolean;
  isArchived: boolean;
  isSuperseded: boolean;
  overriddenGlobalRecordId: string | null;
  importBatchId: string | null;
  effectiveSource: JournalEffectiveSource;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  supersededAt: string | null;
};

export type JournalCatalogListResponse = {
  rows: JournalCatalogRecordView[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    years: number[];
    quartiles: string[];
    types: string[];
    countries: string[];
    regions: string[];
    publishers: string[];
    policyStatuses: JournalPolicyStatus[];
  };
};

export type JournalImportBatchView = {
  id: string;
  scope: JournalCatalogScope;
  tenantId: string | null;
  fileName: string;
  fileType: string;
  sourceSystem: JournalImportSourceSystem;
  sourceYear: number;
  mode: string;
  status: "VALIDATED" | "APPLYING" | "CONFIRMED" | "FAILED";
  totalRows: number;
  validRows: number;
  warningRows: number;
  rejectedRows: number;
  appliedRows: number;
  confirmedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
  createdAt: string;
};

export type JournalImportPreviewRowView = {
  id: string;
  rowIndex: number;
  status: "VALID" | "WARNING" | "REJECTED" | "APPLIED";
  sourceId: string | null;
  identityKey: string | null;
  title: string | null;
  type: string | null;
  issnRaw: string | null;
  sourceYear: number | null;
  errors: string[];
  warnings: string[];
};

export type JournalImportPreviewResponse = {
  batch: JournalImportBatchView;
  rows: JournalImportPreviewRowView[];
  detectedFormat: JournalImportSourceSystem;
  message: string;
};

export const JOURNAL_TEMPLATE_HEADERS = [
  "source_year",
  "source_id",
  "title",
  "type",
  "issn",
  "publisher",
  "open_access",
  "open_access_diamond",
  "sjr",
  "sjr_best_quartile",
  "h_index",
  "total_docs_current",
  "total_docs_3years",
  "total_refs",
  "total_citations_3years",
  "citable_docs_3years",
  "citations_per_doc_2years",
  "refs_per_doc",
  "female_percent",
  "overton",
  "sdg",
  "country",
  "region",
  "coverage",
  "categories",
  "areas",
] as const;

export const SCIMAGO_RAW_HEADER_PREFIX =
  "Rank;Sourceid;Title;Type;Issn;Publisher;Open Access;Open Access Diamond;SJR;SJR Best Quartile;";
