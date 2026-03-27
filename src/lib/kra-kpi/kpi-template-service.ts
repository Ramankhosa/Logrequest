import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult } from "./shared";
import type { KpiBuilderPayload } from "./builder-shared";
import { kpiTemplateWriteSchema, type KpiTemplateWriteInput } from "./builder-shared";
import { ACHIEVEMENT_TEMPLATES } from "./shared";
import { saveKpiBuilder } from "./kpi-builder-service";
import { seedDefaultBenefitTypes } from "./benefit-type-service";
import { seedDefaultContributorRoles } from "./contributor-role-service";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;
const JOURNAL_ARTICLE_TEMPLATE_KEY = "JOURNAL_ARTICLE_TEMPLATE";

function isTenantAdmin(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

const PUBLICATION_TIER_ROWS = [
  {
    code: "Q1",
    name: "Q1 Journal",
    value: "Q1",
    monetaryAmount: 35000,
    leavePoints: 10,
    leadSelectorTag: "FIRST_AUTHOR",
    priority: 0,
  },
  {
    code: "Q2",
    name: "Q2 Journal",
    value: "Q2",
    monetaryAmount: 30000,
    leavePoints: 8,
    leadSelectorTag: "FIRST_AUTHOR",
    priority: 1,
  },
  {
    code: "Q3",
    name: "Q3 Journal",
    value: "Q3",
    monetaryAmount: 25000,
    leavePoints: 7,
    leadSelectorTag: "FIRST_AUTHOR",
    priority: 2,
  },
  {
    code: "Q4",
    name: "Q4 Journal",
    value: "Q4",
    monetaryAmount: 25000,
    leavePoints: 5,
    leadSelectorTag: "FIRST_AUTHOR",
    priority: 3,
  },
  {
    code: "UGC_CARE",
    name: "UGC Care Journal",
    value: "UGC_CARE",
    monetaryAmount: 5000,
    leavePoints: 5,
    leadSelectorTag: "CORRESPONDING_AUTHOR",
    priority: 4,
  },
] as const;

const JOURNAL_ARTICLE_TIER_ROWS = [
  {
    code: "Q1",
    name: "Q1 Journal Article",
    value: "Q1",
    monetaryAmount: 35000,
    researchPoints: 150,
    priority: 0,
  },
  {
    code: "Q2",
    name: "Q2 Journal Article",
    value: "Q2",
    monetaryAmount: 25000,
    researchPoints: 125,
    priority: 1,
  },
  {
    code: "Q3",
    name: "Q3 Journal Article",
    value: "Q3",
    monetaryAmount: 20000,
    researchPoints: 100,
    priority: 2,
  },
  {
    code: "Q4",
    name: "Q4 Journal Article",
    value: "Q4",
    monetaryAmount: 15000,
    researchPoints: 70,
    priority: 3,
  },
] as const;

function buildPublicationRewardTiers() {
  return PUBLICATION_TIER_ROWS.map((tier) => ({
    tierSetKey: "PRIMARY",
    code: tier.code,
    name: tier.name,
    description: `Auto-matches when journal tier is ${tier.value}.`,
    priority: tier.priority,
    matchMode: "HIGHEST_MATCH" as const,
    effectiveFrom: null,
    effectiveTo: null,
    isActive: true,
    rules: [
      {
        source: "FORM_FIELD" as const,
        operator: "eq" as const,
        fieldKey: "journalTier",
        value: tier.value,
        sortOrder: 0,
      },
    ],
  }));
}

function buildSelectorSplitDistributions(leadSelectorTag: string) {
  return [
    {
      selectorType: "SELECTOR_TAG" as const,
      selectorTag: leadSelectorTag,
      sharePercent: 70,
      splitMode: "FULL_TO_MATCHED" as const,
      sortOrder: 0,
    },
    {
      selectorType: "REMAINDER" as const,
      sharePercent: 30,
      splitMode: "EQUAL" as const,
      sortOrder: 1,
    },
  ];
}

function buildPublicationRewardComponents() {
  return PUBLICATION_TIER_ROWS.flatMap((tier, sortIndex) => [
    {
      rewardTierCode: tier.code,
      benefitTypeCode: "MONETARY",
      code: `${tier.code}_MONETARY`,
      name: `${tier.name} Monetary Incentive`,
      description: `${tier.name} pooled incentive for publication team members.`,
      trigger: "FINAL_VERIFY" as const,
      amountMode: "FIXED_POOL" as const,
      amountValue: tier.monetaryAmount,
      distributionMode: "ROLE_PERCENT_SPLIT" as const,
      singleEligibleHandling: "FULL_TO_SINGLE" as const,
      emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
      isActive: true,
      sortOrder: sortIndex * 2,
      distributions: buildSelectorSplitDistributions(tier.leadSelectorTag),
    },
    {
      rewardTierCode: tier.code,
      benefitTypeCode: "LEAVE_POINTS",
      code: `${tier.code}_LEAVE_POINTS`,
      name: `${tier.name} Leave Points`,
      description: `${tier.name} leave-point reward for publication team members.`,
      trigger: "FINAL_VERIFY" as const,
      amountMode: "FIXED_POOL" as const,
      amountValue: tier.leavePoints,
      distributionMode: "ROLE_PERCENT_SPLIT" as const,
      singleEligibleHandling: "FULL_TO_SINGLE" as const,
      emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
      isActive: true,
      sortOrder: sortIndex * 2 + 1,
      distributions: buildSelectorSplitDistributions(tier.leadSelectorTag),
    },
  ]);
}

function buildJournalArticleRewardTiers() {
  return JOURNAL_ARTICLE_TIER_ROWS.map((tier) => ({
    tierSetKey: "PRIMARY",
    code: tier.code,
    name: tier.name,
    description: `Auto-matches when the journal quartile is ${tier.value}.`,
    priority: tier.priority,
    matchMode: "HIGHEST_MATCH" as const,
    effectiveFrom: null,
    effectiveTo: null,
    isActive: true,
    rules: [
      {
        source: "FORM_FIELD" as const,
        operator: "eq" as const,
        fieldKey: "journalQuartile",
        value: tier.value,
        sortOrder: 0,
      },
    ],
  }));
}

function buildJournalArticleSelectorDistributions() {
  return [
    {
      selectorType: "SELECTOR_TAG" as const,
      selectorTag: "FIRST_AUTHOR",
      sharePercent: 70,
      splitMode: "FULL_TO_MATCHED" as const,
      sortOrder: 0,
    },
    {
      selectorType: "SELECTOR_TAG" as const,
      selectorTag: "CORRESPONDING_AUTHOR",
      sharePercent: 70,
      splitMode: "FULL_TO_MATCHED" as const,
      sortOrder: 1,
    },
  ];
}

function buildJournalArticleRewardComponents() {
  return JOURNAL_ARTICLE_TIER_ROWS.flatMap((tier, sortIndex) => {
    const selectorDistributions = buildJournalArticleSelectorDistributions();

    return [
      {
        rewardTierCode: tier.code,
        benefitTypeCode: "MONETARY",
        code: `${tier.code}_JOURNAL_MONETARY`,
        name: `${tier.name} Monetary Incentive`,
        description: `${tier.name} pooled monetary incentive split by internal contribution credit.`,
        trigger: "FINAL_VERIFY" as const,
        amountMode: "FIXED_POOL" as const,
        amountValue: tier.monetaryAmount,
        distributionMode: "CREDIT_PERCENT_SPLIT" as const,
        singleEligibleHandling: "FULL_TO_SINGLE" as const,
        emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
        isActive: true,
        sortOrder: sortIndex * 4,
        distributions: selectorDistributions,
      },
      {
        rewardTierCode: tier.code,
        benefitTypeCode: "RESEARCH_POINTS",
        code: `${tier.code}_JOURNAL_RESEARCH_POINTS`,
        name: `${tier.name} Research Points`,
        description: `${tier.name} research points split by internal contribution credit.`,
        trigger: "FINAL_VERIFY" as const,
        amountMode: "FIXED_POOL" as const,
        amountValue: tier.researchPoints,
        distributionMode: "CREDIT_PERCENT_SPLIT" as const,
        singleEligibleHandling: "FULL_TO_SINGLE" as const,
        emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
        isActive: true,
        sortOrder: sortIndex * 4 + 1,
        distributions: selectorDistributions,
      },
      {
        rewardTierCode: tier.code,
        benefitTypeCode: "PUBLICATION_ACHIEVEMENT_WEIGHTED",
        code: `${tier.code}_JOURNAL_PUBLICATION_WEIGHTED`,
        name: `${tier.name} Publication Achievement (Contribution-Wise)`,
        description: `${tier.name} weighted publication achievement split by internal contribution credit.`,
        trigger: "FINAL_VERIFY" as const,
        amountMode: "FIXED_POOL" as const,
        amountValue: 1,
        distributionMode: "CREDIT_PERCENT_SPLIT" as const,
        singleEligibleHandling: "FULL_TO_SINGLE" as const,
        emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
        isActive: true,
        sortOrder: sortIndex * 4 + 2,
        distributions: selectorDistributions,
      },
      {
        rewardTierCode: tier.code,
        benefitTypeCode: "PUBLICATION_ACHIEVEMENT",
        code: `${tier.code}_JOURNAL_PUBLICATION`,
        name: `${tier.name} Publication Achievement`,
        description: `${tier.name} publication achievement counted as one per eligible internal contributor.`,
        trigger: "FINAL_VERIFY" as const,
        amountMode: "FIXED_PER_PERSON" as const,
        amountValue: 1,
        distributionMode: "FIXED_PER_PERSON" as const,
        singleEligibleHandling: "FULL_TO_SINGLE" as const,
        emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
        isActive: true,
        sortOrder: sortIndex * 4 + 3,
        distributions: [],
      },
    ];
  });
}

const SYSTEM_KPI_TEMPLATES: KpiTemplateWriteInput[] = [
  {
    code: "SYSTEM_TEMPLATE_JOURNAL_ARTICLE",
    name: "Journal Article",
    description:
      "Journal article KPI template with Q1-Q4 incentives, research points, and publication-achievement outputs.",
    category: "TEMPLATES",
    sortOrder: 0,
    isActive: true,
    payload: {
      definition: {
        kraDefinitionId: "TEMPLATE_KRA",
        title: "Journal Article",
        description:
          "Tracks verified journal articles with quartile-based incentive, research point, and publication-achievement outputs.",
        measurementType: "NUMERIC",
        unitLabel: "articles",
        weightage: 0,
        defaultTarget: null,
        measurementConfig: null,
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: "BOTH",
        startingUnitId: "TEMPLATE_UNIT",
        achievementTemplateKey: "PUBLICATION",
        achievementFormConfig: {
          templateKey: JOURNAL_ARTICLE_TEMPLATE_KEY,
          fields: [
            ...ACHIEVEMENT_TEMPLATES.PUBLICATION.fields,
            {
              key: "journalQuartile",
              label: "Journal Quartile",
              type: "SELECT",
              required: true,
              options: ["Q1", "Q2", "Q3", "Q4"],
              sortOrder: 10,
              marker: "CATEGORY_FIELD",
            },
          ],
        },
        guidanceNotes:
          "Internal author credit is auto-derived for this template: solo internal author gets 100%; otherwise the lead internal author gets 70% and the remaining 30% is split equally across other internal authors. FIRST_AUTHOR is preferred; CORRESPONDING_AUTHOR is used only as a fallback lead marker. External contributors are ignored for these splits.",
        sortOrder: 0,
        keyUnitId: null,
        finalUnitId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        evidenceInstructions: "Attach the journal proof, DOI, and publication evidence.",
        isTeamKpi: true,
        teamCreditMethod: "WEIGHTED_SPLIT",
        allowPartialCompletion: true,
        participantMode: "OPTIONAL_TEAM",
        rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
        policyDateFieldKey: "publicationDate",
        contributionRoles: null,
      },
      applicableRoles: [
        { roleCode: "LEAD_AUTHOR", isDefault: true, sortOrder: 0 },
        { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
        { roleCode: "CORRESPONDING", isDefault: false, sortOrder: 2 },
      ],
      contributorConfig: {
        externalContribTemplateId: null,
        allowExternalContributors: true,
        duplicateCheckFields: ["doi"],
        creditSumMode: "MUST_EQUAL_100",
      },
      stages: [],
      rewardTiers: buildJournalArticleRewardTiers(),
      rewardComponents: buildJournalArticleRewardComponents(),
    },
  },
  {
    code: "SYSTEM_RESEARCH_PUBLICATION",
    name: "Research Paper",
    description: "Publication KPI with quartile tiers and first/corresponding-author reward selectors.",
    category: "RESEARCH",
    sortOrder: 1,
    isActive: true,
    payload: {
      definition: {
        kraDefinitionId: "TEMPLATE_KRA",
        title: "Faculty Research Publication Incentive",
        description: "Tracks verified journal publications with tiered incentives.",
        measurementType: "NUMERIC",
        unitLabel: "papers",
        weightage: 0,
        defaultTarget: null,
        measurementConfig: null,
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: "BOTH",
        startingUnitId: "TEMPLATE_UNIT",
        achievementTemplateKey: "PUBLICATION",
        achievementFormConfig: {
          templateKey: "PUBLICATION",
          fields: [
            ...ACHIEVEMENT_TEMPLATES.PUBLICATION.fields,
            {
              key: "journalTier",
              label: "Journal Tier",
              type: "SELECT",
              required: true,
              options: ["Q1", "Q2", "Q3", "Q4", "UGC_CARE"],
              sortOrder: 10,
              marker: "CATEGORY_FIELD",
            },
          ],
        },
        guidanceNotes: "Use selector tags FIRST_AUTHOR and CORRESPONDING_AUTHOR on contributors when relevant.",
        sortOrder: 0,
        keyUnitId: null,
        finalUnitId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        evidenceInstructions: "Attach publication proof or DOI.",
        isTeamKpi: true,
        teamCreditMethod: "WEIGHTED_SPLIT",
        allowPartialCompletion: true,
        participantMode: "OPTIONAL_TEAM",
        rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
        policyDateFieldKey: "publicationDate",
        contributionRoles: null,
      },
      applicableRoles: [
        { roleCode: "LEAD_AUTHOR", isDefault: true, sortOrder: 0 },
        { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
        { roleCode: "CORRESPONDING", isDefault: false, sortOrder: 2 },
      ],
      contributorConfig: {
        externalContribTemplateId: null,
        allowExternalContributors: true,
        duplicateCheckFields: ["doi"],
        creditSumMode: "MUST_EQUAL_100",
      },
      stages: [],
      rewardTiers: buildPublicationRewardTiers(),
      rewardComponents: buildPublicationRewardComponents(),
    },
  },
  {
    code: "SYSTEM_RESEARCH_GRANT",
    name: "Grant",
    description: "Research grant KPI starter template.",
    category: "RESEARCH",
    sortOrder: 2,
    isActive: true,
    payload: {
      definition: {
        kraDefinitionId: "TEMPLATE_KRA",
        title: "Research Grant",
        description: "Tracks sanctioned grants and project funding.",
        measurementType: "CURRENCY",
        unitLabel: "INR",
        weightage: 0,
        defaultTarget: null,
        measurementConfig: null,
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: "BOTH",
        startingUnitId: "TEMPLATE_UNIT",
        achievementTemplateKey: "GRANT",
        achievementFormConfig: {
          templateKey: "GRANT",
          fields: ACHIEVEMENT_TEMPLATES.GRANT.fields,
        },
        guidanceNotes: null,
        sortOrder: 1,
        keyUnitId: null,
        finalUnitId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        evidenceInstructions: "Attach sanction letter or official approval.",
        isTeamKpi: true,
        teamCreditMethod: "WEIGHTED_SPLIT",
        allowPartialCompletion: true,
        participantMode: "OPTIONAL_TEAM",
        rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
        policyDateFieldKey: "startDate",
        contributionRoles: null,
      },
      applicableRoles: [
        { roleCode: "PI", isDefault: true, sortOrder: 0 },
        { roleCode: "CO_PI", isDefault: false, sortOrder: 1 },
      ],
      contributorConfig: {
        externalContribTemplateId: null,
        allowExternalContributors: false,
        duplicateCheckFields: ["sanctionNumber"],
        creditSumMode: "MUST_EQUAL_100",
      },
      stages: [],
      rewardTiers: [],
      rewardComponents: [],
    },
  },
  {
    code: "SYSTEM_PATENT",
    name: "Patent",
    description: "Patent filing and grant KPI starter template.",
    category: "RESEARCH",
    sortOrder: 3,
    isActive: true,
    payload: {
      definition: {
        kraDefinitionId: "TEMPLATE_KRA",
        title: "Patent",
        description: "Tracks patent filing and grant achievements.",
        measurementType: "MILESTONE",
        unitLabel: null,
        weightage: 0,
        defaultTarget: null,
        measurementConfig: null,
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: "BOTH",
        startingUnitId: "TEMPLATE_UNIT",
        achievementTemplateKey: "PATENT",
        achievementFormConfig: {
          templateKey: "PATENT",
          fields: ACHIEVEMENT_TEMPLATES.PATENT.fields,
        },
        guidanceNotes: null,
        sortOrder: 2,
        keyUnitId: null,
        finalUnitId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        evidenceInstructions: "Attach filing acknowledgement or grant certificate.",
        isTeamKpi: true,
        teamCreditMethod: "WEIGHTED_SPLIT",
        allowPartialCompletion: true,
        participantMode: "OPTIONAL_TEAM",
        rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
        policyDateFieldKey: "filingDate",
        contributionRoles: null,
      },
      applicableRoles: [
        { roleCode: "PI", isDefault: true, sortOrder: 0 },
        { roleCode: "CO_PI", isDefault: false, sortOrder: 1 },
      ],
      contributorConfig: {
        externalContribTemplateId: null,
        allowExternalContributors: false,
        duplicateCheckFields: ["applicationNumber"],
        creditSumMode: "MUST_EQUAL_100",
      },
      stages: [],
      rewardTiers: [],
      rewardComponents: [],
    },
  },
];

export async function seedSystemKpiTemplates(): Promise<void> {
  for (const template of SYSTEM_KPI_TEMPLATES) {
    await prisma.kpiTemplate.upsert({
      where: { code: template.code },
      create: {
        code: template.code,
        name: template.name,
        description: template.description ?? undefined,
        category: template.category ?? undefined,
        isSystem: true,
        isActive: template.isActive,
        sortOrder: template.sortOrder,
        builderPayload: template.payload as object,
      },
      update: {
        tenantId: null,
        name: template.name,
        description: template.description ?? null,
        category: template.category ?? null,
        isSystem: true,
        isActive: template.isActive,
        sortOrder: template.sortOrder,
        builderPayload: template.payload as object,
      },
    });
  }
}

export async function listKpiTemplates(tenantId: string) {
  await seedSystemKpiTemplates();
  return prisma.kpiTemplate.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
      isActive: true,
    },
    orderBy: [{ isSystem: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getKpiTemplate(templateId: string, tenantId: string) {
  await seedSystemKpiTemplates();
  return prisma.kpiTemplate.findFirst({
    where: {
      id: templateId,
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
    },
  });
}

export async function createKpiTemplate(
  tenantId: string,
  input: KpiTemplateWriteInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return { status: "error", message: "Insufficient permissions.", code: "PERMISSION_DENIED" };
  }

  const parsed = kpiTemplateWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.kpiTemplate.findUnique({
    where: { code: parsed.data.code },
    select: { id: true, tenantId: true },
  });
  if (existing) {
    return { status: "error", message: `Template code "${parsed.data.code}" already exists.`, code: "DUPLICATE_CODE" };
  }

  const created = await prisma.kpiTemplate.create({
    data: {
      tenantId,
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? undefined,
      category: parsed.data.category ?? undefined,
      isSystem: false,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      builderPayload: parsed.data.payload as object,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "KpiTemplate",
      targetId: created.id,
      action: "CREATE",
      newState: { code: created.code, name: created.name } as object,
    },
  });

  return { status: "success", message: "KPI template created.", id: created.id, code: created.code };
}

export async function updateKpiTemplate(
  templateId: string,
  tenantId: string,
  input: Partial<KpiTemplateWriteInput>,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return { status: "error", message: "Insufficient permissions.", code: "PERMISSION_DENIED" };
  }

  const existing = await prisma.kpiTemplate.findFirst({
    where: { id: templateId, tenantId, isSystem: false },
  });
  if (!existing) {
    return { status: "error", message: "KPI template not found.", code: "KPI_TEMPLATE_NOT_FOUND" };
  }

  const payload = {
    code: input.code ?? existing.code,
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    category: input.category ?? existing.category,
    isActive: input.isActive ?? existing.isActive,
    sortOrder: input.sortOrder ?? existing.sortOrder,
    payload: (input.payload ?? (existing.builderPayload as KpiBuilderPayload)) as KpiBuilderPayload,
  };
  const parsed = kpiTemplateWriteSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await prisma.kpiTemplate.update({
    where: { id: templateId },
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      category: parsed.data.category ?? null,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      builderPayload: parsed.data.payload as object,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "KpiTemplate",
      targetId: templateId,
      action: "UPDATE",
      newState: { code: parsed.data.code, name: parsed.data.name } as object,
    },
  });

  return { status: "success", message: "KPI template updated.", id: templateId, code: parsed.data.code };
}

export async function applyTemplateToKpi(
  tenantId: string,
  templateId: string,
  target: {
    kraDefinitionId: string;
    kpiId?: string;
    titleOverride?: string | null;
    startingUnitId?: string | null;
  },
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  const template = await getKpiTemplate(templateId, tenantId);
  if (!template) {
    return { status: "error", message: "KPI template not found.", code: "KPI_TEMPLATE_NOT_FOUND" };
  }

  await seedDefaultContributorRoles(tenantId);
  await seedDefaultBenefitTypes(tenantId);

  const payload = (template.builderPayload as KpiBuilderPayload);
  return saveKpiBuilder(
    tenantId,
    {
      ...payload,
      definition: {
        ...payload.definition,
        id: target.kpiId,
        kraDefinitionId: target.kraDefinitionId,
        title: target.titleOverride?.trim() || payload.definition.title,
        startingUnitId: target.startingUnitId?.trim() || payload.definition.startingUnitId,
      },
    },
    actorUserId,
    actorRole,
  );
}
