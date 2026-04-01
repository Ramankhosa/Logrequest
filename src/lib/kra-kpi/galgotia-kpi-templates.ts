import type {
  BuilderRewardComponent,
  BuilderRewardTier,
  KpiTemplateWriteDraft,
} from "./builder-shared";
import type { AchievementFieldConfig } from "./shared";
import { ACHIEVEMENT_TEMPLATES } from "./shared";
import {
  GALGOTIA_BOOK_CHAPTER_TEMPLATE_KEY,
  GALGOTIA_EDITED_BOOK_TEMPLATE_KEY,
  GALGOTIA_TEMPLATE_CATEGORY,
} from "./galgotia-template-constants";

const TEMPLATE_KRA_ID = "TEMPLATE_KRA";
const TEMPLATE_UNIT_ID = "TEMPLATE_UNIT";

type TemplateDefinitionInput = {
  title: string;
  description: string;
  measurementType:
    | "NUMERIC"
    | "PERCENTAGE"
    | "CURRENCY"
    | "BOOLEAN"
    | "RATING"
    | "MILESTONE"
    | "DATE_TARGET"
    | "GRADE";
  unitLabel: string | null;
  achievementTemplateKey: string;
  fields: AchievementFieldConfig[];
  guidanceNotes: string | null;
  evidenceInstructions: string | null;
  isTeamKpi: boolean;
  teamCreditMethod: "FULL_EACH" | "EQUAL_SPLIT" | "WEIGHTED_SPLIT" | "PRIMARY_ONLY";
  allowMultipleAchievementsPerAllocation?: boolean;
  participantMode: "SINGLE_OWNER" | "OPTIONAL_TEAM" | "REQUIRED_TEAM";
  rewardRecurrencePolicy:
    | "RECURRING"
    | "ONCE_PER_PERIOD"
    | "ONCE_PER_KPI_LIFETIME"
    | "ONCE_PER_UNIQUE_KEY";
  policyDateFieldKey?: string | null;
  sortOrder: number;
};

type TemplateInput = {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  definition: TemplateDefinitionInput;
  applicableRoles: Array<{ roleCode: string; isDefault: boolean; sortOrder: number }>;
  contributorConfig: {
    externalContribTemplateId: null;
    allowExternalContributors: boolean;
    duplicateCheckFields: string[];
    creditSumMode: "MUST_EQUAL_100" | "MAX_100" | "UNCAPPED";
  };
  rewardTiers: BuilderRewardTier[];
  rewardComponents: BuilderRewardComponent[];
};

function cloneFields(fields: AchievementFieldConfig[]): AchievementFieldConfig[] {
  return fields.map((field) => ({
    ...field,
    ...(field.options ? { options: [...field.options] } : {}),
    ...(field.validation ? { validation: { ...field.validation } } : {}),
  }));
}

function declarationField(label: string): AchievementFieldConfig {
  return {
    key: "selfDeclaration",
    label,
    type: "DECLARATION",
    required: true,
    sortOrder: 99,
  };
}

function buildTemplate(input: TemplateInput): KpiTemplateWriteDraft {
  return {
    code: input.code,
    name: input.name,
    description: input.description,
    category: GALGOTIA_TEMPLATE_CATEGORY,
    sortOrder: input.sortOrder,
    isActive: true,
    payload: {
      definition: {
        kraDefinitionId: TEMPLATE_KRA_ID,
        title: input.definition.title,
        description: input.definition.description,
        measurementType: input.definition.measurementType,
        unitLabel: input.definition.unitLabel,
        weightage: 0,
        defaultTarget: null,
        measurementConfig: null,
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: "BOTH",
        startingUnitId: TEMPLATE_UNIT_ID,
        achievementTemplateKey: input.definition.achievementTemplateKey,
        achievementFormConfig: {
          templateKey: input.definition.achievementTemplateKey,
          fields: input.definition.fields,
        },
        guidanceNotes: input.definition.guidanceNotes,
        sortOrder: input.definition.sortOrder,
        keyUnitId: null,
        finalUnitId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        evidenceInstructions: input.definition.evidenceInstructions,
        isTeamKpi: input.definition.isTeamKpi,
        teamCreditMethod: input.definition.teamCreditMethod,
        allowPartialCompletion: true,
        allowMultipleAchievementsPerAllocation:
          input.definition.allowMultipleAchievementsPerAllocation ?? false,
        participantMode: input.definition.participantMode,
        rewardRecurrencePolicy: input.definition.rewardRecurrencePolicy,
        policyDateFieldKey: input.definition.policyDateFieldKey ?? null,
        contributionRoles: null,
      },
      applicableRoles: input.applicableRoles,
      contributorConfig: input.contributorConfig,
      stages: [],
      rewardTiers: input.rewardTiers,
      rewardComponents: input.rewardComponents,
    },
  };
}

function buildEqualSplitComponent(input: {
  code: string;
  name: string;
  amountMode: "FIXED_VALUE" | "PERCENT_OF_FIELD";
  amountValue: number;
  amountFieldKey?: string;
  rewardTierCode?: string;
  sortOrder: number;
}) {
  return {
    benefitTypeCode: "MONETARY",
    code: input.code,
    name: input.name,
    trigger: "FINAL_VERIFY" as const,
    rewardTierCode: input.rewardTierCode ?? null,
    amountMode: input.amountMode,
    amountValue: input.amountValue,
    amountFieldKey: input.amountFieldKey ?? null,
    distributionMode: "EQUAL_SPLIT" as const,
    singleEligibleHandling: "FULL_TO_SINGLE" as const,
    emptyShareHandling: "DROP_UNALLOCATED" as const,
    isActive: true,
    sortOrder: input.sortOrder,
    distributions: [],
  };
}

function buildDirectOwnerComponent(input: {
  code: string;
  name: string;
  amountValue: number;
  rewardTierCode?: string;
  sortOrder: number;
}) {
  return {
    benefitTypeCode: "MONETARY",
    code: input.code,
    name: input.name,
    trigger: "FINAL_VERIFY" as const,
    rewardTierCode: input.rewardTierCode ?? null,
    amountMode: "FIXED_VALUE" as const,
    amountValue: input.amountValue,
    amountFieldKey: null,
    distributionMode: "DIRECT_OWNER" as const,
    singleEligibleHandling: "FULL_TO_SINGLE" as const,
    emptyShareHandling: "DROP_UNALLOCATED" as const,
    isActive: true,
    sortOrder: input.sortOrder,
    distributions: [],
  };
}

const journalCaseRows = [
  {
    caseCode: "CASE_1",
    amountMultiplier: 1,
    note: "Case 1: first 35%, corresponding 35%, GU co-authors share 30%.",
  },
  {
    caseCode: "CASE_2",
    amountMultiplier: 1,
    note: "Case 2: first 50%, corresponding 50%.",
  },
  {
    caseCode: "CASE_3",
    amountMultiplier: 1,
    note: "Case 3: first or corresponding 60%, GU co-authors share 40%.",
  },
  {
    caseCode: "CASE_4",
    amountMultiplier: 1,
    note: "Case 4: first or corresponding 100%.",
  },
  {
    caseCode: "CASE_5",
    amountMultiplier: 0.4,
    note: "Case 5: only GU co-authors share the 40% GU pool.",
  },
] as const;

const journalQuartileRows = [
  { quartile: "Q1", amount: 30000, priority: 0 },
  { quartile: "Q2", amount: 25000, priority: 1 },
  { quartile: "Q3", amount: 15000, priority: 2 },
  { quartile: "Q4", amount: 10000, priority: 3 },
] as const;

function buildJournalRewardTiers() {
  return journalQuartileRows.flatMap((tier) =>
    journalCaseRows.map((caseRow, index) => ({
      tierSetKey: "PRIMARY",
      code: `${tier.quartile}_${caseRow.caseCode}`,
      name: `${tier.quartile} ${caseRow.caseCode}`,
      description: `${tier.quartile} reward for ${caseRow.caseCode}.`,
      priority: tier.priority * 10 + index,
      matchMode: "HIGHEST_MATCH" as const,
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true,
      rules: [
        {
          source: "FORM_FIELD" as const,
          operator: "eq" as const,
          fieldKey: "journalQuartile",
          value: tier.quartile,
          sortOrder: 0,
        },
        {
          source: "FORM_FIELD" as const,
          operator: "eq" as const,
          fieldKey: "authorshipCase",
          value: caseRow.caseCode,
          sortOrder: 1,
        },
      ],
    })),
  );
}

function buildJournalRewardComponents() {
  return journalQuartileRows.flatMap((tier) =>
    journalCaseRows.map((caseRow, index) => ({
      benefitTypeCode: "MONETARY",
      code: `${tier.quartile}_${caseRow.caseCode}_INCENTIVE`,
      name: `${tier.quartile} Journal Incentive (${caseRow.caseCode})`,
      description: caseRow.note,
      trigger: "FINAL_VERIFY" as const,
      rewardTierCode: `${tier.quartile}_${caseRow.caseCode}`,
      amountMode: "FIXED_VALUE" as const,
      amountValue: Math.round(tier.amount * caseRow.amountMultiplier),
      amountFieldKey: null,
      distributionMode: "CREDIT_PERCENT_SPLIT" as const,
      singleEligibleHandling: "FULL_TO_SINGLE" as const,
      emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
      isActive: true,
      sortOrder: tier.priority * 10 + index,
      distributions: [],
    })),
  );
}

const bookBaseFields = cloneFields(ACHIEVEMENT_TEMPLATES.BOOK.fields);
const consultancyBaseFields = cloneFields(ACHIEVEMENT_TEMPLATES.CONSULTANCY.fields);
const phdFields = [
  ...cloneFields(ACHIEVEMENT_TEMPLATES.PHD_SUPERVISION.fields),
  declarationField(
    "I confirm this scholar was awarded a PhD under my supervision at Galgotias University.",
  ),
];
const fdpWorkshopFields = [
  ...cloneFields(ACHIEVEMENT_TEMPLATES.FDP_WORKSHOP.fields),
  declarationField(
    "I confirm this sponsored program ran at least 30 hours and I served as convenor.",
  ),
];

const journalFields = [
  ...cloneFields(ACHIEVEMENT_TEMPLATES.PUBLICATION.fields).map((field) =>
    field.key === "doi" ? { ...field, required: true } : field,
  ),
  {
    key: "journalQuartile",
    label: "Journal Quartile (SJR/JCR)",
    type: "SELECT",
    required: true,
    options: ["Q1", "Q2", "Q3", "Q4"],
    sortOrder: 10,
    marker: "CATEGORY_FIELD",
  } satisfies AchievementFieldConfig,
  {
    key: "authorshipCase",
    label: "Galgotias Authorship Case",
    type: "SELECT",
    required: true,
    options: ["CASE_1", "CASE_2", "CASE_3", "CASE_4", "CASE_5"],
    sortOrder: 11,
    marker: "CATEGORY_FIELD",
  } satisfies AchievementFieldConfig,
  {
    key: "impactFactor",
    label: "Impact Factor",
    type: "NUMBER",
    required: false,
    sortOrder: 12,
  } satisfies AchievementFieldConfig,
  {
    key: "totalAuthors",
    label: "Total Number of Authors",
    type: "NUMBER",
    required: true,
    sortOrder: 13,
  } satisfies AchievementFieldConfig,
  {
    key: "guAuthorsCount",
    label: "Number of GU Authors",
    type: "NUMBER",
    required: true,
    sortOrder: 14,
  } satisfies AchievementFieldConfig,
  declarationField(
    "I confirm this Scopus/WoS journal paper carries Galgotias affiliation and all details are correct.",
  ),
];

export const GALGOTIA_KPI_TEMPLATES: KpiTemplateWriteDraft[] = [
  buildTemplate({
    code: "GU_SCOPUS_JOURNAL_PUBLICATION",
    name: "Scopus/WoS Journal Publication Incentive",
    description: "Galgotias policy template for Scopus or WoS journal publication incentives.",
    sortOrder: 100,
    definition: {
      title: "Scopus/WoS Journal Publication Incentive",
      description: "Quartile-based journal publication incentive with Galgotias authorship-case payouts.",
      measurementType: "NUMERIC",
      unitLabel: "papers",
      achievementTemplateKey: "GU_JOURNAL_PUB",
      fields: journalFields,
      guidanceNotes:
        "Use the Galgotias 5-case matrix when setting contributor credit. Case 1: 35/35/30. Case 2: 50/50. Case 3: 60/40. Case 4: 100. Case 5 pays only the 40% GU co-author pool and the template already reduces the amount. External contributors are recorded but excluded from payout. Reviewer must confirm full-time or regular faculty eligibility, Galgotias affiliation, Scopus or WoS indexing, and any PhD minimum-publication exception.",
      evidenceInstructions:
        "Attach the paper first page, DOI or publisher URL, and a Scopus or WoS screenshot showing indexing and quartile.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      allowMultipleAchievementsPerAllocation: true,
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "publicationDate",
      sortOrder: 100,
    },
    applicableRoles: [
      { roleCode: "FIRST_AUTHOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CORRESPONDING_AUTHOR", isDefault: false, sortOrder: 1 },
      { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 2 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: true,
      duplicateCheckFields: ["doi"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: buildJournalRewardTiers(),
    rewardComponents: buildJournalRewardComponents(),
  }),
  buildTemplate({
    code: "GU_SCOPUS_TEXTBOOK_AUTHORED",
    name: "Scopus-Indexed Textbook (Authored)",
    description: "Galgotias policy template for authored textbook incentives.",
    sortOrder: 101,
    definition: {
      title: "Scopus-Indexed Textbook (Authored)",
      description: "Fixed incentive for a Scopus-indexed authored textbook.",
      measurementType: "NUMERIC",
      unitLabel: "books",
      achievementTemplateKey: "GU_TEXTBOOK",
      fields: [
        ...bookBaseFields,
        {
          key: "bookType",
          label: "Book Type",
          type: "SELECT",
          required: true,
          options: ["Authored Textbook"],
          sortOrder: 6,
          marker: "CATEGORY_FIELD",
        },
        {
          key: "chapterCount",
          label: "Number of Chapters",
          type: "NUMBER",
          required: false,
          sortOrder: 7,
        },
        declarationField(
          "I confirm this authored textbook is original and published by a Scopus-indexed publisher.",
        ),
      ],
      guidanceNotes:
        "Policy pays Rs. 25,000 per textbook and splits it equally among eligible GU authors. External authors may be recorded but do not share the payout.",
      evidenceInstructions:
        "Attach the publisher page, indexing proof, and publication details for the textbook.",
      isTeamKpi: true,
      teamCreditMethod: "EQUAL_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: null,
      sortOrder: 101,
    },
    applicableRoles: [
      { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: true,
      duplicateCheckFields: ["isbn"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [],
    rewardComponents: [
      buildEqualSplitComponent({
        code: "TEXTBOOK_INCENTIVE",
        name: "Textbook Authorship Incentive",
        amountMode: "FIXED_VALUE",
        amountValue: 25000,
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_SCOPUS_EDITED_BOOK",
    name: "Scopus-Indexed Edited Book",
    description: "Galgotias policy template for edited book incentives.",
    sortOrder: 102,
    definition: {
      title: "Scopus-Indexed Edited Book",
      description: "Fixed incentive for a Scopus-indexed edited book.",
      measurementType: "NUMERIC",
      unitLabel: "books",
      achievementTemplateKey: GALGOTIA_EDITED_BOOK_TEMPLATE_KEY,
      fields: [
        ...bookBaseFields,
        {
          key: "bookType",
          label: "Book Type",
          type: "SELECT",
          required: true,
          options: ["Edited Book"],
          sortOrder: 6,
          marker: "CATEGORY_FIELD",
        },
        {
          key: "editorRole",
          label: "Your Role",
          type: "SELECT",
          required: true,
          options: ["Chief Editor", "Co-Editor"],
          sortOrder: 7,
        },
        declarationField(
          "I confirm this edited book is Scopus-indexed and I served as an editor for it.",
        ),
      ],
      guidanceNotes:
        "Policy pays Rs. 15,000 per edited book and splits it equally among eligible GU editors. Reviewer must manually check the same contributor and same ISBN across edited-book and book-chapter claims because the combined editor plus chapter incentive for one book cannot exceed Rs. 20,000.",
      evidenceInstructions:
        "Attach the publisher page, indexing proof, and documentation showing your editorial role.",
      isTeamKpi: true,
      teamCreditMethod: "EQUAL_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: null,
      sortOrder: 102,
    },
    applicableRoles: [
      { roleCode: "CHIEF_EDITOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_EDITOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: true,
      duplicateCheckFields: ["isbn"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [],
    rewardComponents: [
      buildEqualSplitComponent({
        code: "EDITED_BOOK_INCENTIVE",
        name: "Edited Book Incentive",
        amountMode: "FIXED_VALUE",
        amountValue: 15000,
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_SCOPUS_BOOK_CHAPTER",
    name: "Scopus-Indexed Book Chapter",
    description: "Galgotias policy template for Scopus-indexed book chapter incentives.",
    sortOrder: 103,
    definition: {
      title: "Scopus-Indexed Book Chapter",
      description: "Fixed incentive for a Scopus-indexed book chapter.",
      measurementType: "NUMERIC",
      unitLabel: "chapters",
      achievementTemplateKey: GALGOTIA_BOOK_CHAPTER_TEMPLATE_KEY,
      fields: [
        ...bookBaseFields,
        {
          key: "chapterTitle",
          label: "Chapter Title",
          type: "TEXT",
          required: true,
          sortOrder: 6,
          marker: "UNIQUE_CHECK",
        },
        {
          key: "chapterNumber",
          label: "Chapter Number",
          type: "NUMBER",
          required: false,
          sortOrder: 7,
        },
        declarationField(
          "I confirm this chapter is original, Scopus-indexed, and all submitted details are correct.",
        ),
      ],
      guidanceNotes:
        "Policy pays Rs. 5,000 per chapter and splits it equally among eligible GU authors. Reviewer must manually check edited-book claims for the same ISBN because the combined edited-book plus chapter benefit for one contributor and one ISBN cannot exceed Rs. 20,000.",
      evidenceInstructions:
        "Attach the publisher page, indexing proof, chapter proof, and chapter metadata.",
      isTeamKpi: true,
      teamCreditMethod: "EQUAL_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: null,
      sortOrder: 103,
    },
    applicableRoles: [
      { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: true,
      duplicateCheckFields: ["isbn", "chapterTitle"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [],
    rewardComponents: [
      buildEqualSplitComponent({
        code: "BOOK_CHAPTER_INCENTIVE",
        name: "Book Chapter Incentive",
        amountMode: "FIXED_VALUE",
        amountValue: 5000,
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_PHD_AWARDED",
    name: "PhD Awarded (Supervision Incentive)",
    description: "Galgotias policy template for PhD supervision incentives.",
    sortOrder: 104,
    definition: {
      title: "PhD Awarded (Supervision Incentive)",
      description: "Role-based incentive for supervision of a PhD awarded under GU registration.",
      measurementType: "NUMERIC",
      unitLabel: "phds",
      achievementTemplateKey: "GU_PHD_AWARDED",
      fields: phdFields,
      guidanceNotes:
        "Policy pays Rs. 18,000 per awarded PhD. Supervisor receives 60% and the remaining 40% is split equally among eligible GU co-supervisors. Sole supervisor cases pay the full amount to the supervisor.",
      evidenceInstructions:
        "Attach the award notification or degree proof and the supervision details for the scholar.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "awardDate",
      sortOrder: 104,
    },
    applicableRoles: [
      { roleCode: "SUPERVISOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_SUPERVISOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: false,
      duplicateCheckFields: ["enrollmentNumber"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [],
    rewardComponents: [
      {
        benefitTypeCode: "MONETARY",
        code: "PHD_SUPERVISION_INCENTIVE",
        name: "PhD Supervision Incentive",
        trigger: "FINAL_VERIFY" as const,
        rewardTierCode: null,
        amountMode: "FIXED_VALUE" as const,
        amountValue: 18000,
        amountFieldKey: null,
        distributionMode: "ROLE_PERCENT_SPLIT" as const,
        singleEligibleHandling: "FULL_TO_SINGLE" as const,
        emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
        isActive: true,
        sortOrder: 0,
        distributions: [
          {
            selectorType: "ROLE" as const,
            contributorRoleCode: "SUPERVISOR",
            selectorTag: null,
            sharePercent: 60,
            splitMode: "FULL_TO_MATCHED" as const,
            sortOrder: 0,
          },
          {
            selectorType: "ROLE" as const,
            contributorRoleCode: "CO_SUPERVISOR",
            selectorTag: null,
            sharePercent: 40,
            splitMode: "EQUAL" as const,
            sortOrder: 1,
          },
        ],
      },
    ],
  }),
  buildTemplate({
    code: "GU_RESEARCH_GRANT",
    name: "Research Grant Incentive",
    description: "Galgotias policy template for research grant incentives.",
    sortOrder: 105,
    definition: {
      title: "Research Grant Incentive",
      description: "10% of sanctioned amount split between PI and Co-PIs.",
      measurementType: "CURRENCY",
      unitLabel: "INR",
      achievementTemplateKey: "GU_RESEARCH_GRANT",
      fields: [
        ...cloneFields(ACHIEVEMENT_TEMPLATES.GRANT.fields),
        {
          key: "grantType",
          label: "Grant Type",
          type: "SELECT",
          required: true,
          options: ["Government", "Non-Government", "Industry"],
          sortOrder: 7,
        },
        declarationField(
          "I confirm this grant is sanctioned and the amount matches the sanction letter.",
        ),
      ],
      guidanceNotes:
        "Policy pays 10% of the sanctioned grant amount. PI receives 60% and eligible GU Co-PIs split the remaining 40% equally.",
      evidenceInstructions:
        "Attach the sanction letter and supporting grant documents showing the sanctioned amount.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 105,
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
    rewardTiers: [],
    rewardComponents: [
      {
        benefitTypeCode: "MONETARY",
        code: "GRANT_INCENTIVE",
        name: "Grant Incentive",
        trigger: "FINAL_VERIFY" as const,
        rewardTierCode: null,
        amountMode: "PERCENT_OF_FIELD" as const,
        amountValue: 10,
        amountFieldKey: "sanctionedAmount",
        distributionMode: "ROLE_PERCENT_SPLIT" as const,
        singleEligibleHandling: "FULL_TO_SINGLE" as const,
        emptyShareHandling: "ROLLOVER_TO_MATCHED" as const,
        isActive: true,
        sortOrder: 0,
        distributions: [
          {
            selectorType: "ROLE" as const,
            contributorRoleCode: "PI",
            selectorTag: null,
            sharePercent: 60,
            splitMode: "FULL_TO_MATCHED" as const,
            sortOrder: 0,
          },
          {
            selectorType: "ROLE" as const,
            contributorRoleCode: "CO_PI",
            selectorTag: null,
            sharePercent: 40,
            splitMode: "EQUAL" as const,
            sortOrder: 1,
          },
        ],
      },
    ],
  }),
  buildTemplate({
    code: "GU_CONSULTANCY_PROJECT",
    name: "Consultancy Project Incentive",
    description: "Galgotias policy template for consultancy savings incentives.",
    sortOrder: 106,
    definition: {
      title: "Consultancy Project Incentive",
      description: "70% of project savings split equally among eligible GU consultants.",
      measurementType: "CURRENCY",
      unitLabel: "INR",
      achievementTemplateKey: "GU_CONSULTANCY",
      fields: [
        ...consultancyBaseFields,
        declarationField(
          "I confirm the consultancy details and financial figures are accurate and verifiable.",
        ),
      ],
      guidanceNotes:
        "Policy pays 70% of project savings and splits it equally among all eligible GU consultants irrespective of position.",
      evidenceInstructions:
        "Attach the approval or agreement document and financial summary showing value, expenditure, and savings.",
      isTeamKpi: true,
      teamCreditMethod: "EQUAL_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 106,
    },
    applicableRoles: [
      { roleCode: "LEAD_CONSULTANT", isDefault: true, sortOrder: 0 },
      { roleCode: "CONSULTANT", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: false,
      duplicateCheckFields: ["referenceNumber"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [],
    rewardComponents: [
      buildEqualSplitComponent({
        code: "CONSULTANCY_INCENTIVE",
        name: "Consultancy Savings Incentive",
        amountMode: "PERCENT_OF_FIELD",
        amountValue: 70,
        amountFieldKey: "savings",
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_PATENT_FILING",
    name: "Patent Filing Incentive",
    description: "Galgotias policy template for patent filing incentives.",
    sortOrder: 107,
    definition: {
      title: "Patent Filing Incentive",
      description: "Fixed incentive for successful patent filing with Galgotias University as applicant.",
      measurementType: "MILESTONE",
      unitLabel: null,
      achievementTemplateKey: "GU_PATENT_FILING",
      fields: [
        ...cloneFields(ACHIEVEMENT_TEMPLATES.PATENT.fields),
        {
          key: "applicantIsGU",
          label: "Is Galgotias University listed as applicant?",
          type: "BOOLEAN",
          required: true,
          sortOrder: 8,
        },
        declarationField(
          "I confirm this patent lists Galgotias University as applicant and I am a listed inventor.",
        ),
      ],
      guidanceNotes:
        "Policy pays Rs. 2,000 per filing and splits it equally among eligible GU inventors. Reviewer must confirm the applicant is Galgotias University.",
      evidenceInstructions:
        "Attach the filing acknowledgement, application details, and applicant proof.",
      isTeamKpi: true,
      teamCreditMethod: "EQUAL_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "filingDate",
      sortOrder: 107,
    },
    applicableRoles: [{ roleCode: "INVENTOR", isDefault: true, sortOrder: 0 }],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: false,
      duplicateCheckFields: ["applicationNumber"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [
      {
        tierSetKey: "PRIMARY",
        code: "GU_APPLICANT",
        name: "GU is Applicant",
        description: "Reward triggers only when Galgotias University is the applicant.",
        priority: 0,
        matchMode: "HIGHEST_MATCH" as const,
        effectiveFrom: null,
        effectiveTo: null,
        isActive: true,
        rules: [
          {
            source: "FORM_FIELD" as const,
            operator: "eq" as const,
            fieldKey: "applicantIsGU",
            value: true,
            sortOrder: 0,
          },
        ],
      },
    ],
    rewardComponents: [
      buildEqualSplitComponent({
        code: "PATENT_FILING_INCENTIVE",
        name: "Patent Filing Incentive",
        amountMode: "FIXED_VALUE",
        amountValue: 2000,
        rewardTierCode: "GU_APPLICANT",
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_INTL_CONFERENCE_CONVENOR",
    name: "International Conference Convenor Incentive",
    description: "Galgotias policy template for international conference convenor incentives.",
    sortOrder: 108,
    definition: {
      title: "International Conference Convenor Incentive",
      description: "Fixed incentive for convening an international conference with Scopus-indexed proceedings.",
      measurementType: "MILESTONE",
      unitLabel: null,
      achievementTemplateKey: "GU_INTL_CONF_CONV",
      fields: [
        {
          key: "conferenceName",
          label: "Conference Name",
          type: "TEXT",
          required: true,
          sortOrder: 0,
        },
        {
          key: "conferenceType",
          label: "Conference Scope",
          type: "SELECT",
          required: true,
          options: ["International"],
          sortOrder: 1,
          marker: "CATEGORY_FIELD",
        },
        {
          key: "venue",
          label: "Venue / Location",
          type: "TEXT",
          required: true,
          sortOrder: 2,
        },
        {
          key: "startDate",
          label: "Start Date",
          type: "DATE",
          required: true,
          sortOrder: 3,
          marker: "POLICY_DATE_FIELD",
        },
        {
          key: "endDate",
          label: "End Date",
          type: "DATE",
          required: true,
          sortOrder: 4,
        },
        {
          key: "proceedingsPublisher",
          label: "Proceedings Publisher",
          type: "TEXT",
          required: true,
          sortOrder: 5,
        },
        {
          key: "proceedingsScopusIndexed",
          label: "Are proceedings Scopus-indexed?",
          type: "BOOLEAN",
          required: true,
          sortOrder: 6,
        },
        {
          key: "proceedingsLink",
          label: "Proceedings Link / Proof",
          type: "URL",
          required: true,
          sortOrder: 7,
        },
        {
          key: "participantCount",
          label: "Number of Participants",
          type: "NUMBER",
          required: false,
          sortOrder: 8,
        },
        {
          key: "referenceNumber",
          label: "Conference Reference / Approval Number",
          type: "TEXT",
          required: false,
          sortOrder: 9,
          marker: "UNIQUE_CHECK",
        },
        declarationField(
          "I confirm I convened this conference and its proceedings are Scopus-indexed.",
        ),
      ],
      guidanceNotes:
        "Policy pays Rs. 5,000 after the Scopus-indexed proceedings are available. Reviewer must confirm the proceedings publication condition and convenor identity.",
      evidenceInstructions:
        "Attach the approval reference, proceedings proof, and documentation showing the Scopus-indexed proceedings publication.",
      isTeamKpi: false,
      teamCreditMethod: "PRIMARY_ONLY",
      participantMode: "SINGLE_OWNER",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 108,
    },
    applicableRoles: [{ roleCode: "CONVENOR", isDefault: true, sortOrder: 0 }],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: false,
      duplicateCheckFields: ["referenceNumber"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [
      {
        tierSetKey: "PRIMARY",
        code: "SCOPUS_PROCEEDINGS",
        name: "Scopus Proceedings Published",
        description: "Reward triggers only when proceedings are Scopus indexed.",
        priority: 0,
        matchMode: "HIGHEST_MATCH" as const,
        effectiveFrom: null,
        effectiveTo: null,
        isActive: true,
        rules: [
          {
            source: "FORM_FIELD" as const,
            operator: "eq" as const,
            fieldKey: "proceedingsScopusIndexed",
            value: true,
            sortOrder: 0,
          },
        ],
      },
    ],
    rewardComponents: [
      buildDirectOwnerComponent({
        code: "CONFERENCE_CONVENOR_INCENTIVE",
        name: "International Conference Convenor Incentive",
        amountValue: 5000,
        rewardTierCode: "SCOPUS_PROCEEDINGS",
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_FDP_STC_VAC_TRAINING_CONVENOR",
    name: "FDP/STC/VAC/Training/Workshop Convenor Incentive",
    description: "Galgotias policy template for externally sponsored convenor incentives.",
    sortOrder: 109,
    definition: {
      title: "FDP/STC/VAC/Training/Workshop Convenor Incentive",
      description: "Fixed incentive for convening an externally sponsored program of at least 30 hours.",
      measurementType: "MILESTONE",
      unitLabel: null,
      achievementTemplateKey: "GU_FDP_WORKSHOP",
      fields: fdpWorkshopFields,
      guidanceNotes:
        "Policy pays Rs. 5,000 only for externally sponsored FDP, STC, VAC, training programs, or hands-on workshops of at least 30 hours. Reviewer must verify the approval letter and the named convenor.",
      evidenceInstructions:
        "Attach the sponsorship or approval letter and the completion report or certificate.",
      isTeamKpi: false,
      teamCreditMethod: "PRIMARY_ONLY",
      participantMode: "SINGLE_OWNER",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 109,
    },
    applicableRoles: [{ roleCode: "CONVENOR", isDefault: true, sortOrder: 0 }],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: false,
      duplicateCheckFields: ["referenceNumber"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [
      {
        tierSetKey: "PRIMARY",
        code: "SPONSORED_MIN_30HR",
        name: "Sponsored Program of Minimum 30 Hours",
        description: "Reward triggers only for externally sponsored programs of at least 30 hours.",
        priority: 0,
        matchMode: "HIGHEST_MATCH" as const,
        effectiveFrom: null,
        effectiveTo: null,
        isActive: true,
        rules: [
          {
            source: "FORM_FIELD" as const,
            operator: "gte" as const,
            fieldKey: "totalHours",
            value: 30,
            sortOrder: 0,
          },
          {
            source: "FORM_FIELD" as const,
            operator: "eq" as const,
            fieldKey: "isSponsored",
            value: true,
            sortOrder: 1,
          },
        ],
      },
    ],
    rewardComponents: [
      buildDirectOwnerComponent({
        code: "FDP_WORKSHOP_INCENTIVE",
        name: "FDP/Workshop Convenor Incentive",
        amountValue: 5000,
        rewardTierCode: "SPONSORED_MIN_30HR",
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_CONFERENCE_PAPER",
    name: "Conference Paper Presentation Incentive",
    description: "Galgotias policy template for conference paper incentives.",
    sortOrder: 110,
    definition: {
      title: "Conference Paper Presentation Incentive",
      description: "Fixed incentive for Scopus-indexed conference papers with no university funding.",
      measurementType: "NUMERIC",
      unitLabel: "papers",
      achievementTemplateKey: "GU_CONFERENCE_PAPER",
      fields: [
        ...cloneFields(ACHIEVEMENT_TEMPLATES.CONFERENCE.fields).map((field) =>
          field.key === "proceedingsLink" ? { ...field, required: true } : field,
        ),
        {
          key: "conferenceScope",
          label: "Conference Scope",
          type: "SELECT",
          required: true,
          options: ["International", "National"],
          sortOrder: 6,
        },
        {
          key: "receivedUniversityFunding",
          label: "Did you receive any financial support from the university for this conference?",
          type: "BOOLEAN",
          required: true,
          sortOrder: 7,
        },
        declarationField(
          "I confirm this paper received no university funding and all submitted details are accurate.",
        ),
      ],
      guidanceNotes:
        "Policy pays Rs. 5,000 per conference paper and splits it equally among eligible GU authors irrespective of author position. Reviewer must enforce the max 2 claims per faculty per semester rule manually and confirm that no university funding was received.",
      evidenceInstructions:
        "Attach the conference proof, proceedings or certificate, indexing evidence, and funding declaration.",
      isTeamKpi: true,
      teamCreditMethod: "EQUAL_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "RECURRING",
      policyDateFieldKey: "date",
      sortOrder: 110,
    },
    applicableRoles: [
      { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: true,
      duplicateCheckFields: ["conferenceName", "paperTitle"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [
      {
        tierSetKey: "PRIMARY",
        code: "NO_UNI_FUNDING",
        name: "No University Funding",
        description: "Reward triggers only when the presenter received no university funding.",
        priority: 0,
        matchMode: "HIGHEST_MATCH" as const,
        effectiveFrom: null,
        effectiveTo: null,
        isActive: true,
        rules: [
          {
            source: "FORM_FIELD" as const,
            operator: "eq" as const,
            fieldKey: "receivedUniversityFunding",
            value: false,
            sortOrder: 0,
          },
        ],
      },
    ],
    rewardComponents: [
      buildEqualSplitComponent({
        code: "CONFERENCE_PAPER_INCENTIVE",
        name: "Conference Paper Incentive",
        amountMode: "FIXED_VALUE",
        amountValue: 5000,
        rewardTierCode: "NO_UNI_FUNDING",
        sortOrder: 0,
      }),
    ],
  }),
  buildTemplate({
    code: "GU_EDP_MDP_CONVENOR",
    name: "EDP/MDP Convenor Incentive",
    description: "Galgotias policy template for EDP or MDP savings incentives.",
    sortOrder: 111,
    definition: {
      title: "EDP/MDP Convenor Incentive",
      description: "70% of program savings distributed using the convenor's approved chart.",
      measurementType: "CURRENCY",
      unitLabel: "INR",
      achievementTemplateKey: "GU_EDP_MDP",
      fields: [
        ...consultancyBaseFields,
        {
          key: "programType",
          label: "Program Type",
          type: "SELECT",
          required: true,
          options: ["EDP", "MDP"],
          sortOrder: 9,
          marker: "CATEGORY_FIELD",
        },
        declarationField(
          "I confirm the financial details and contributor split match the approved distribution chart.",
        ),
      ],
      guidanceNotes:
        "Policy pays 70% of savings and distributes it according to the convenor's submitted distribution chart. Enter contributor credit percentages exactly as approved in that chart.",
      evidenceInstructions:
        "Attach the approval document, financial summary, and the distribution chart approved for the program.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 111,
    },
    applicableRoles: [
      { roleCode: "CONVENOR", isDefault: true, sortOrder: 0 },
      { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: false,
      duplicateCheckFields: ["referenceNumber"],
      creditSumMode: "MUST_EQUAL_100",
    },
    rewardTiers: [],
    rewardComponents: [
      {
        benefitTypeCode: "MONETARY",
        code: "EDP_MDP_INCENTIVE",
        name: "EDP/MDP Savings Incentive",
        trigger: "FINAL_VERIFY" as const,
        rewardTierCode: null,
        amountMode: "PERCENT_OF_FIELD" as const,
        amountValue: 70,
        amountFieldKey: "savings",
        distributionMode: "CREDIT_PERCENT_SPLIT" as const,
        singleEligibleHandling: "FULL_TO_SINGLE" as const,
        emptyShareHandling: "DROP_UNALLOCATED" as const,
        isActive: true,
        sortOrder: 0,
        distributions: [],
      },
    ],
  }),
];
