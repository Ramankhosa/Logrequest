import { z } from "zod";
import type { AchievementFieldConfig } from "./shared";

export const externalContributorCreditSumModeSchema = z.enum([
  "MUST_EQUAL_100",
  "MAX_100",
  "UNCAPPED",
]);

export type ExternalContributorCreditSumMode = z.infer<
  typeof externalContributorCreditSumModeSchema
>;

export const EXTERNAL_CONTRIBUTOR_CREDIT_SUM_MODE_OPTIONS: Array<{
  value: ExternalContributorCreditSumMode;
  label: string;
  description: string;
}> = [
  {
    value: "MUST_EQUAL_100",
    label: "Must Equal 100",
    description: "Combined contributor credit must total exactly 100%.",
  },
  {
    value: "MAX_100",
    label: "Max 100",
    description: "Combined contributor credit can be below 100% but not exceed it.",
  },
  {
    value: "UNCAPPED",
    label: "Uncapped",
    description: "Contributor credit is informational and may exceed 100%.",
  },
];

export const BASE_EXTERNAL_CONTRIBUTOR_FIELDS: AchievementFieldConfig[] = [
  {
    key: "name",
    label: "Full Name",
    type: "TEXT",
    required: true,
    sortOrder: 0,
  },
  {
    key: "affiliation",
    label: "Institution / Organization",
    type: "TEXT",
    required: true,
    sortOrder: 1,
  },
];

const DEFAULT_EXTERNAL_TEMPLATE_FIELDS: AchievementFieldConfig[] = [
  ...BASE_EXTERNAL_CONTRIBUTOR_FIELDS,
  {
    key: "email",
    label: "Email",
    type: "EMAIL",
    required: false,
    sortOrder: 2,
  },
  {
    key: "country",
    label: "Country",
    type: "SELECT",
    required: false,
    options: ["India", "USA", "UK", "Germany", "Japan", "China", "Other"],
    sortOrder: 3,
  },
  {
    key: "scope",
    label: "Scope",
    type: "SELECT",
    required: true,
    options: ["National", "International"],
    sortOrder: 4,
  },
];

export type ExternalContributorTemplateSeed = {
  name: string;
  description: string;
  isDefault: boolean;
  sortOrder: number;
  fields: AchievementFieldConfig[];
};

export const DEFAULT_EXTERNAL_CONTRIBUTOR_TEMPLATE_SEEDS: ExternalContributorTemplateSeed[] = [
  {
    name: "Default External",
    description: "Base external contributor profile used when a KPI does not choose a specialized template.",
    isDefault: true,
    sortOrder: 0,
    fields: DEFAULT_EXTERNAL_TEMPLATE_FIELDS,
  },
  {
    name: "Research Collaborator",
    description: "Collects researcher-specific identifiers for academic collaborators.",
    isDefault: false,
    sortOrder: 1,
    fields: [
      ...DEFAULT_EXTERNAL_TEMPLATE_FIELDS,
      {
        key: "orcid",
        label: "ORCID",
        type: "TEXT",
        required: false,
        pattern: "^\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dX]$",
        placeholder: "0000-0002-1234-5678",
        sortOrder: 5,
      },
      {
        key: "googleScholarId",
        label: "Google Scholar ID",
        type: "TEXT",
        required: false,
        sortOrder: 6,
      },
      {
        key: "hIndex",
        label: "H-Index",
        type: "NUMBER",
        required: false,
        sortOrder: 7,
      },
    ],
  },
  {
    name: "Industry Partner",
    description: "Captures company and role details for industry-side contributors.",
    isDefault: false,
    sortOrder: 2,
    fields: [
      ...DEFAULT_EXTERNAL_TEMPLATE_FIELDS,
      {
        key: "company",
        label: "Company",
        type: "TEXT",
        required: true,
        sortOrder: 5,
      },
      {
        key: "designation",
        label: "Designation",
        type: "TEXT",
        required: false,
        sortOrder: 6,
      },
      {
        key: "industryDomain",
        label: "Industry Domain",
        type: "SELECT",
        required: false,
        options: ["IT", "Manufacturing", "Pharma", "Finance", "Energy", "Healthcare", "Other"],
        sortOrder: 7,
      },
    ],
  },
];

export type ExternalContributorTemplateView = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  fields: AchievementFieldConfig[];
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  kpiConfigCount?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type KpiContributorConfigView = {
  id: string;
  kpiDefinitionId: string;
  externalContribTemplateId: string | null;
  allowExternalContributors: boolean;
  duplicateCheckFields: string[];
  creditSumMode: ExternalContributorCreditSumMode;
  createdAt: Date;
  updatedAt: Date;
};

export type EffectiveKpiContributorConfigView = {
  id: string | null;
  kpiDefinitionId: string;
  externalContribTemplateId: string | null;
  externalContribTemplateName: string | null;
  allowExternalContributors: boolean;
  duplicateCheckFields: string[];
  creditSumMode: ExternalContributorCreditSumMode;
  inheritedTemplate: boolean;
};
