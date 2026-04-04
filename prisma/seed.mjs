import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AccreditationScope,
  CriterionDataType,
  PrismaClient,
  TenantServiceCode,
  TenantServiceEntitlementStatus,
  UserLifecycleState,
} from "@prisma/client";
import { hash } from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = "postgresql://postgres:123@localhost:5432/logrequest";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo@12345";
const R43_SEED_PREFIX = "seed:r43";
// Keep these identifiers stable unless the seeded smoke/regression tests are updated too.
const R43_PUBLICATION_KPI_TITLE = "Seed: Publication Incentive Workflow";
const R43_PUBLICATION_PREFIX = "Seed R4.3";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

const DEFAULT_BENEFIT_TYPES = [
  { code: "MONETARY", name: "Monetary Incentive", unit: "INR", sortOrder: 0 },
  { code: "LEAVE_POINTS", name: "Leave Points", unit: "Points", sortOrder: 1 },
];

const DEFAULT_CONTRIBUTOR_ROLES = [
  { code: "LEAD_AUTHOR", name: "Lead / First Author", defaultCreditPercent: 60, sortOrder: 0 },
  { code: "CO_AUTHOR", name: "Co-Author", defaultCreditPercent: 20, sortOrder: 1 },
  { code: "CORRESPONDING", name: "Corresponding Author", defaultCreditPercent: 50, sortOrder: 2 },
];

const R43_PUBLICATION_FORM_FIELDS = [
  { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "journalName", label: "Journal / Conference", type: "TEXT", required: true, sortOrder: 1 },
  {
    key: "doi",
    label: "DOI",
    type: "TEXT",
    required: false,
    placeholder: "10.xxxx/...",
    sortOrder: 2,
    marker: "UNIQUE_CHECK",
  },
  {
    key: "indexing",
    label: "Indexing",
    type: "MULTI_SELECT",
    required: true,
    options: ["Scopus", "Web of Science", "UGC CARE List"],
    sortOrder: 3,
    marker: "CATEGORY_FIELD",
  },
  {
    key: "journalTier",
    label: "Journal Tier",
    type: "SELECT",
    required: true,
    options: ["Q1", "Q2", "Q3", "Q4", "UGC_CARE"],
    sortOrder: 4,
    marker: "CATEGORY_FIELD",
  },
  { key: "publicationDate", label: "Publication Date", type: "DATE", required: true, sortOrder: 5 },
  { key: "pdfLink", label: "Paper PDF / URL", type: "URL", required: true, sortOrder: 6 },
  {
    key: "coAuthors",
    label: "Co-Authors",
    type: "TEXTAREA",
    required: false,
    sortOrder: 7,
  },
  {
    key: "totalAuthors",
    label: "Total Number of Authors",
    type: "NUMBER",
    required: false,
    sortOrder: 8,
  },
  {
    key: "ugcCareReference",
    label: "UGC Care Reference",
    type: "TEXT",
    required: false,
    sortOrder: 9,
    visibilityRules: [{ fieldKey: "indexing", operator: "has_any", value: ["UGC CARE List"] }],
    requiredRules: [{ fieldKey: "indexing", operator: "has_any", value: ["UGC CARE List"] }],
    helpText: "Required when the paper is claimed through UGC CARE indexing.",
  },
];

const R43_PUBLICATION_TIERS = [
  {
    code: "Q1",
    name: "Q1 Journal",
    value: "Q1",
    priority: 0,
    leadSelectorTag: "FIRST_AUTHOR",
    monetaryAmount: 35000,
    leavePointsAmount: 10,
  },
  {
    code: "Q2",
    name: "Q2 Journal",
    value: "Q2",
    priority: 1,
    leadSelectorTag: "FIRST_AUTHOR",
    monetaryAmount: 30000,
    leavePointsAmount: 8,
  },
  {
    code: "UGC_CARE",
    name: "UGC Care Journal",
    value: "UGC_CARE",
    priority: 2,
    leadSelectorTag: "CORRESPONDING_AUTHOR",
    monetaryAmount: 5000,
    leavePointsAmount: 5,
  },
];

const DASHBOARD_SEED_PREFIX = "seed:dashboard";
const DASHBOARD_ACHIEVEMENT_PREFIX = "Seed Dashboard";

const DASHBOARD_PERIOD_BLUEPRINTS = [
  {
    code: "AY2024_25",
    label: "2024",
    name: "AY 2024-25",
    startDate: "2024-04-01T00:00:00.000Z",
    endDate: "2025-03-31T00:00:00.000Z",
    state: "CLOSED",
    targetSettingDeadline: "2024-04-30T00:00:00.000Z",
    achievementDeadline: "2025-03-10T00:00:00.000Z",
    reviewDeadline: "2025-03-25T00:00:00.000Z",
    description: "Historical seeded dashboard period with completed KPI data for 2024.",
    kraTitle: "Seed: Research and Administration 2024",
  },
  {
    code: "AY2025_26",
    label: "2025",
    name: "AY 2025-26",
    startDate: "2025-04-01T00:00:00.000Z",
    endDate: "2026-03-31T00:00:00.000Z",
    state: "IN_PROGRESS",
    targetSettingDeadline: "2025-04-30T00:00:00.000Z",
    achievementDeadline: "2026-03-15T00:00:00.000Z",
    reviewDeadline: "2026-03-31T00:00:00.000Z",
    description: "Current seeded dashboard period with mixed KPI states for 2025.",
    kraTitle: "Seed: Research and Administration 2025",
  },
];

const DASHBOARD_ASSIGNEE_GROUPS = {
  CSE: ["cseHead", "facultyOne", "demoEmployee"],
  ECE: ["eceHead", "facultyTwo", "eceStaff"],
  UNIV: ["provost", "admin", "owner"],
};

const DASHBOARD_KPI_BLUEPRINTS = [
  {
    key: "indexed_publications",
    title: "Research: Indexed Journal Publications",
    description: "Tracks indexed journal articles delivered by the department team.",
    measurementType: "NUMERIC",
    unitLabel: "papers",
    defaultTarget: 12,
    allocationType: "BOTH",
    startingUnitKey: "CSE",
    weightage: 10,
    sortOrder: 1,
    parentTarget: 14,
    userTargets: [4, 5, 5],
  },
  {
    key: "conference_presentations",
    title: "Research: Conference Papers Presented",
    description: "Tracks peer-reviewed conference presentations across the electronics group.",
    measurementType: "NUMERIC",
    unitLabel: "papers",
    defaultTarget: 11,
    allocationType: "BOTH",
    startingUnitKey: "ECE",
    weightage: 10,
    sortOrder: 2,
    parentTarget: 12,
    userTargets: [4, 4, 4],
  },
  {
    key: "patent_filings",
    title: "Research: Patent Filings Submitted",
    description: "Measures patent filing velocity for applied research outputs.",
    measurementType: "NUMERIC",
    unitLabel: "filings",
    defaultTarget: 6,
    allocationType: "INDIVIDUAL",
    startingUnitKey: "CSE",
    weightage: 10,
    sortOrder: 3,
    parentTarget: 7,
    userTargets: [2, 3, 2],
  },
  {
    key: "sponsored_grants",
    title: "Research: Sponsored Grant Value Mobilized",
    description: "Measures external research funding mobilized by the unit.",
    measurementType: "CURRENCY",
    unitLabel: "INR",
    defaultTarget: 1500000,
    allocationType: "BOTH",
    startingUnitKey: "ECE",
    weightage: 10,
    sortOrder: 4,
    parentTarget: 1800000,
    userTargets: [600000, 650000, 550000],
  },
  {
    key: "phd_completions",
    title: "Research: PhD Scholars Graduated",
    description: "Tracks successful doctoral completions under faculty supervision.",
    measurementType: "NUMERIC",
    unitLabel: "scholars",
    defaultTarget: 5,
    allocationType: "INDIVIDUAL",
    startingUnitKey: "CSE",
    weightage: 10,
    sortOrder: 5,
    parentTarget: 6,
    userTargets: [2, 2, 2],
  },
  {
    key: "consultancy_revenue",
    title: "Research: Consultancy Revenue Generated",
    description: "Captures revenue from industry consultancy and expert assignments.",
    measurementType: "CURRENCY",
    unitLabel: "INR",
    defaultTarget: 900000,
    allocationType: "BOTH",
    startingUnitKey: "ECE",
    weightage: 10,
    sortOrder: 6,
    parentTarget: 1050000,
    userTargets: [350000, 350000, 350000],
  },
  {
    key: "accreditation_actions",
    title: "Administration: Accreditation Action Items Closed",
    description: "Tracks institution-level accreditation action items closed on time.",
    measurementType: "NUMERIC",
    unitLabel: "items",
    defaultTarget: 30,
    allocationType: "BOTH",
    startingUnitKey: "UNIV",
    weightage: 10,
    sortOrder: 7,
    parentTarget: 36,
    userTargets: [12, 12, 12],
  },
  {
    key: "budget_savings",
    title: "Administration: Budget Savings Realized",
    description: "Measures budget savings realized through procurement and utilization discipline.",
    measurementType: "CURRENCY",
    unitLabel: "INR",
    defaultTarget: 400000,
    allocationType: "BOTH",
    startingUnitKey: "UNIV",
    weightage: 10,
    sortOrder: 8,
    parentTarget: 480000,
    userTargets: [180000, 150000, 150000],
  },
  {
    key: "committee_deliverables",
    title: "Administration: Committee Deliverables Completed",
    description: "Tracks committee and governance deliverables closed by the CSE team.",
    measurementType: "NUMERIC",
    unitLabel: "deliverables",
    defaultTarget: 16,
    allocationType: "BOTH",
    startingUnitKey: "CSE",
    weightage: 10,
    sortOrder: 9,
    parentTarget: 18,
    userTargets: [6, 6, 6],
  },
  {
    key: "automation_rollouts",
    title: "Administration: Process Automation Rollouts",
    description: "Measures digital process rollouts completed for institutional operations.",
    measurementType: "NUMERIC",
    unitLabel: "rollouts",
    defaultTarget: 8,
    allocationType: "BOTH",
    startingUnitKey: "UNIV",
    weightage: 10,
    sortOrder: 10,
    parentTarget: 9,
    userTargets: [3, 3, 3],
  },
];

function userName(user) {
  return `${user.firstName} ${user.lastName}`;
}

function at(value) {
  return new Date(value);
}

function makeSeedEventKey(suffix) {
  return `${R43_SEED_PREFIX}:${suffix}`;
}

function buildUnitSnapshot(unit) {
  return {
    unitId: unit?.id ?? null,
    unitName: unit?.name ?? null,
    unitPath: unit?.path ?? null,
    unitTypeKey: unit?.type?.typeKey ?? null,
  };
}

function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function addDays(value, days) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildDashboardMeasurementConfig(measurementType) {
  switch (measurementType) {
    case "CURRENCY":
      return {
        type: "CURRENCY",
        currencyCode: "INR",
        minValue: 0,
        decimalPlaces: 0,
      };
    case "NUMERIC":
    default:
      return {
        type: "NUMERIC",
        minValue: 0,
        decimalPlaces: 0,
      };
  }
}

async function upsertUser({
  email,
  firstName,
  lastName,
  password,
  isSuperadmin = false,
}) {
  const passwordHash = await hash(password, 12);

  return prisma.user.upsert({
    where: {
      officialEmail: email.toLowerCase(),
    },
    update: {
      firstName,
      lastName,
      isSuperadmin,
      lifecycleState: UserLifecycleState.ACTIVE,
      passwordHash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
      mustResetPassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      firstName,
      lastName,
      officialEmail: email.toLowerCase(),
      isSuperadmin,
      lifecycleState: UserLifecycleState.ACTIVE,
      passwordHash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
      mustResetPassword: false,
    },
  });
}

async function ensureMembership({
  tenantId,
  userId,
  role,
  createdByUserId,
  employeeId,
  designation,
}) {
  return prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
    update: {
      role,
      employeeId,
      designation,
      status: "ACTIVE",
      invitationState: "ACCEPTED",
      personnelStatus: "ACTIVE",
      createdByUserId,
      activationTimestamp: new Date(),
    },
    create: {
      tenantId,
      userId,
      role,
      employeeId,
      designation,
      status: "ACTIVE",
      invitationState: "ACCEPTED",
      personnelStatus: "ACTIVE",
      createdByUserId,
      activationTimestamp: new Date(),
    },
  });
}

async function ensurePrimaryUnitAssignment({ versionId, unitId, userId }) {
  await prisma.userOrgAssignment.updateMany({
    where: {
      versionId,
      userId,
      isPrimary: true,
      unitId: { not: unitId },
    },
    data: {
      assignmentType: "SECONDARY",
      isPrimary: false,
    },
  });

  const existingAssignment = await prisma.userOrgAssignment.findFirst({
    where: {
      versionId,
      unitId,
      userId,
    },
  });

  if (existingAssignment) {
    return prisma.userOrgAssignment.update({
      where: { id: existingAssignment.id },
      data: {
        assignmentType: "PRIMARY",
        isPrimary: true,
        effectiveTo: null,
        effectiveFrom: existingAssignment.effectiveFrom ?? new Date(),
      },
    });
  }

  return prisma.userOrgAssignment.create({
    data: {
      versionId,
      unitId,
      userId,
      assignmentType: "PRIMARY",
      isPrimary: true,
      effectiveFrom: new Date(),
    },
  });
}

async function ensureRoleDefinition({
  tenantId,
  roleKey,
  displayLabel,
  description,
  isUnitHead,
  approvalAuthority,
  maxPerUnit,
  sortOrder,
  createdByUserId,
}) {
  return prisma.orgRoleDefinition.upsert({
    where: {
      tenantId_roleKey: {
        tenantId,
        roleKey,
      },
    },
    update: {
      displayLabel,
      description,
      isUnitHead,
      approvalAuthority,
      maxPerUnit,
      sortOrder,
      isActive: true,
    },
    create: {
      tenantId,
      roleKey,
      displayLabel,
      description,
      isUnitHead,
      approvalAuthority,
      maxPerUnit,
      sortOrder,
      isActive: true,
      createdByUserId,
    },
  });
}

async function ensureOrgRoleDefinition({
  tenantId,
  roleKey,
  displayLabel,
  description,
  createdByUserId,
}) {
  return ensureRoleDefinition({
    tenantId,
    roleKey,
    displayLabel,
    description,
    isUnitHead: true,
    approvalAuthority: true,
    maxPerUnit: 1,
    sortOrder: 10,
    createdByUserId,
  });
}

async function ensureRoleAssignment({
  versionId,
  unitId,
  userId,
  roleDefinitionId,
  roleName,
  scope = "NODE",
}) {
  const existing = await prisma.orgRoleAssignment.findFirst({
    where: {
      versionId,
      unitId,
      userId,
      OR: [
        { roleDefinitionId },
        { roleName },
      ],
    },
  });

  if (existing) {
    return prisma.orgRoleAssignment.update({
      where: { id: existing.id },
      data: {
        roleDefinitionId,
        roleName,
        scope,
        isActive: true,
        effectiveTo: null,
        effectiveFrom: existing.effectiveFrom ?? new Date(),
      },
    });
  }

  return prisma.orgRoleAssignment.create({
    data: {
      versionId,
      unitId,
      userId,
      roleDefinitionId,
      roleName,
      scope,
      isActive: true,
      effectiveFrom: new Date(),
    },
  });
}

async function ensureUnitHeadAssignment({
  versionId,
  unitId,
  userId,
  roleDefinitionId,
  roleName,
  scope = "NODE",
}) {
  return ensureRoleAssignment({
    versionId,
    unitId,
    userId,
    roleDefinitionId,
    roleName,
    scope,
  });
}

async function ensureBenefitTypes(tenantId) {
  const benefitTypes = [];
  for (const row of DEFAULT_BENEFIT_TYPES) {
    const benefitType = await prisma.benefitType.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: row.code,
        },
      },
      update: {
        name: row.name,
        unit: row.unit,
        precision: 2,
        roundingMode: "HALF_UP",
        sortOrder: row.sortOrder,
        isActive: true,
      },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        unit: row.unit,
        precision: 2,
        roundingMode: "HALF_UP",
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
    benefitTypes.push(benefitType);
  }
  return new Map(benefitTypes.map((row) => [row.code, row]));
}

async function ensureContributorRoles(tenantId) {
  const roles = [];
  for (const row of DEFAULT_CONTRIBUTOR_ROLES) {
    const role = await prisma.contributorRole.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: row.code,
        },
      },
      update: {
        name: row.name,
        defaultCreditPercent: row.defaultCreditPercent,
        sortOrder: row.sortOrder,
        isActive: true,
      },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        defaultCreditPercent: row.defaultCreditPercent,
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
    roles.push(role);
  }
  return new Map(roles.map((row) => [row.code, row]));
}

async function ensurePublishedStructure(tenantId, actorUserId) {
  const existing = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: "PUBLISHED",
    },
    include: {
      units: true,
    },
  });
  if (existing) {
    return {
      version: existing,
      rootUnit: existing.units.find((unit) => unit.code === "UNIV"),
      cseUnit: existing.units.find((unit) => unit.code === "CSE"),
      eceUnit: existing.units.find((unit) => unit.code === "ECE"),
    };
  }

  const versionNumber =
    (await prisma.orgStructureVersion.aggregate({
      where: { tenantId },
      _max: { versionNumber: true },
    }))._max.versionNumber ?? 0;

  const version = await prisma.orgStructureVersion.create({
    data: {
      tenantId,
      name: "Seed Structure v1",
      versionNumber: versionNumber + 1,
      state: "PUBLISHED",
      validatedAt: new Date(),
      publishedAt: new Date(),
      createdByUserId: actorUserId,
    },
  });

  const rootType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "ROOT",
      internalCategory: "ORG_ROOT",
      displayLabel: "Root",
      allowRoot: true,
      sortOrder: 0,
    },
  });

  const deptType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "DEPT",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Department",
      allowRoot: false,
      sortOrder: 1,
    },
  });

  const rootUnit = await prisma.orgUnit.create({
    data: {
      tenantId,
      versionId: version.id,
      typeId: rootType.id,
      code: "UNIV",
      name: "Demo University",
      level: 0,
      sortOrder: 0,
      path: "UNIV",
      state: "ACTIVE",
      createdByUserId: actorUserId,
    },
  });

  const cseUnit = await prisma.orgUnit.create({
    data: {
      tenantId,
      versionId: version.id,
      typeId: deptType.id,
      code: "CSE",
      name: "Computer Science",
      parentId: rootUnit.id,
      level: 1,
      sortOrder: 1,
      path: "UNIV/CSE",
      state: "ACTIVE",
      createdByUserId: actorUserId,
    },
  });

  const eceUnit = await prisma.orgUnit.create({
    data: {
      tenantId,
      versionId: version.id,
      typeId: deptType.id,
      code: "ECE",
      name: "Electronics",
      parentId: rootUnit.id,
      level: 1,
      sortOrder: 2,
      path: "UNIV/ECE",
      state: "ACTIVE",
      createdByUserId: actorUserId,
    },
  });

  return {
    version,
    rootUnit,
    cseUnit,
    eceUnit,
  };
}

async function ensureCategory({
  tenantId,
  scope,
  categoryKey,
  displayLabel,
  description,
  colorHex,
  createdByUserId,
}) {
  if (tenantId === null) {
    const existing = await prisma.kraCategoryDefinition.findFirst({
      where: {
        tenantId: null,
        categoryKey,
      },
    });

    if (existing) {
      return prisma.kraCategoryDefinition.update({
        where: { id: existing.id },
        data: {
          displayLabel,
          description,
          colorHex,
          isActive: true,
        },
      });
    }

    return prisma.kraCategoryDefinition.create({
      data: {
        tenantId: null,
        scope,
        categoryKey,
        displayLabel,
        description,
        colorHex,
        isActive: true,
        createdByUserId,
      },
    });
  }

  return prisma.kraCategoryDefinition.upsert({
    where: {
      tenantId_categoryKey: {
        tenantId,
        categoryKey,
      },
    },
    update: {
      displayLabel,
      description,
      colorHex,
      isActive: true,
    },
    create: {
      tenantId,
      scope,
      categoryKey,
      displayLabel,
      description,
      colorHex,
      isActive: true,
      createdByUserId,
    },
  });
}

async function ensureReviewerUsers({
  tenant,
  owner,
  cseUnit,
  eceUnit,
}) {
  const cseHead = await upsertUser({
    email: "cse.head@demo-university.local.test",
    firstName: "CSE",
    lastName: "Head",
    password: DEMO_PASSWORD,
  });
  const eceHead = await upsertUser({
    email: "ece.head@demo-university.local.test",
    firstName: "ECE",
    lastName: "Head",
    password: DEMO_PASSWORD,
  });

  for (const [user, employeeId, unit] of [
    [cseHead, "EMP-CSE-HEAD-001", cseUnit],
    [eceHead, "EMP-ECE-HEAD-001", eceUnit],
  ]) {
    await ensureMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_USER",
      createdByUserId: owner.id,
      employeeId,
      designation: "Department Head",
    });
    await ensurePrimaryUnitAssignment({
      versionId: unit.versionId,
      unitId: unit.id,
      userId: user.id,
    });
  }

  const roleDefinition = await ensureOrgRoleDefinition({
    tenantId: tenant.id,
    roleKey: "DEPARTMENT_HEAD",
    displayLabel: "Department Head",
    description: "Seeded review head for KPI workflow demo data.",
    createdByUserId: owner.id,
  });

  await ensureUnitHeadAssignment({
    versionId: cseUnit.versionId,
    unitId: cseUnit.id,
    userId: cseHead.id,
    roleDefinitionId: roleDefinition.id,
    roleName: roleDefinition.displayLabel,
  });
  await ensureUnitHeadAssignment({
    versionId: eceUnit.versionId,
    unitId: eceUnit.id,
    userId: eceHead.id,
    roleDefinitionId: roleDefinition.id,
    roleName: roleDefinition.displayLabel,
  });

  return { cseHead, eceHead };
}

async function ensureDemoDataset(
  tenant,
  owner,
  facultyOne,
  facultyTwo,
  demoEmployee,
  cseUnit,
  tenantCategory,
) {
  const parentTargetValue = 15;
  const demoEmployeeTargetValue = 3;

  const period = await prisma.assessmentPeriod.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "AY2025_26",
      },
    },
    update: {
      name: "AY 2025-26",
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2025-04-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      state: "IN_PROGRESS",
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2025-04-30T00:00:00.000Z"),
      achievementDeadline: new Date("2026-03-15T00:00:00.000Z"),
      reviewDeadline: new Date("2026-03-31T00:00:00.000Z"),
      description: "Seeded assessment period for Release 1 verification.",
    },
    create: {
      tenantId: tenant.id,
      name: "AY 2025-26",
      code: "AY2025_26",
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2025-04-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      state: "IN_PROGRESS",
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2025-04-30T00:00:00.000Z"),
      achievementDeadline: new Date("2026-03-15T00:00:00.000Z"),
      reviewDeadline: new Date("2026-03-31T00:00:00.000Z"),
      description: "Seeded assessment period for Release 1 verification.",
      createdByUserId: owner.id,
    },
  });

  let kra = await prisma.kraDefinition.findFirst({
    where: {
      tenantId: tenant.id,
      periodId: period.id,
      title: "Seed: Research Excellence",
    },
  });

  if (!kra) {
    kra = await prisma.kraDefinition.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        categoryId: tenantCategory.id,
        title: "Seed: Research Excellence",
        description: "Research-focused KRA seeded for the demo tenant.",
        weightage: 100,
        state: "ACTIVE",
        sortOrder: 1,
        createdByUserId: owner.id,
      },
    });
  } else if (kra.state !== "ACTIVE") {
    kra = await prisma.kraDefinition.update({
      where: { id: kra.id },
      data: {
        categoryId: tenantCategory.id,
        description: "Research-focused KRA seeded for the demo tenant.",
        weightage: 100,
        state: "ACTIVE",
      },
    });
  }

  let kpi = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinitionId: kra.id,
      title: "Seed: Indexed Publications",
    },
  });

  if (!kpi) {
    kpi = await prisma.kpiDefinition.create({
      data: {
        kraDefinitionId: kra.id,
        title: "Seed: Indexed Publications",
        description: "Number of indexed publications produced in the period.",
        measurementType: "NUMERIC",
        unitLabel: "papers",
        weightage: 100,
        defaultTarget: 12,
        measurementConfig: {
          type: "NUMERIC",
          decimalPlaces: 0,
        },
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: {
          method: "LINEAR",
          capAt100: true,
        },
        allocationType: "BOTH",
        startingUnitId: cseUnit.id,
        state: "ACTIVE",
        sortOrder: 1,
        guidanceNotes: "Seeded KPI for Release 1 demo flows.",
        allowMultipleAchievementsPerAllocation: true,
      },
    });
  } else {
    kpi = await prisma.kpiDefinition.update({
      where: { id: kpi.id },
      data: {
        description: "Number of indexed publications produced in the period.",
        measurementType: "NUMERIC",
        unitLabel: "papers",
        weightage: 100,
        defaultTarget: 12,
        measurementConfig: {
          type: "NUMERIC",
          decimalPlaces: 0,
        },
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: {
          method: "LINEAR",
          capAt100: true,
        },
        allocationType: "BOTH",
        startingUnitId: cseUnit.id,
        state: "ACTIVE",
        sortOrder: 1,
        guidanceNotes: "Seeded KPI for Release 1 demo flows.",
        allowMultipleAchievementsPerAllocation: true,
      },
    });
  }

  let parentAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-parent-cse-publications",
    },
  });

  if (!parentAllocation) {
    parentAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUnitId: cseUnit.id,
        allocatedByUserId: owner.id,
        targetValue: parentTargetValue,
        state: "LOCKED",
        lockedAt: new Date(),
        notes: "seed-parent-cse-publications",
      },
    });
  } else {
    parentAllocation = await prisma.targetAllocation.update({
      where: { id: parentAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUnitId: cseUnit.id,
        allocatedByUserId: owner.id,
        targetValue: parentTargetValue,
        state: "LOCKED",
        lockedAt: parentAllocation.lockedAt ?? new Date(),
        notes: "seed-parent-cse-publications",
      },
    });
  }

  let facultyOneAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-faculty-one-publications",
    },
  });

  if (!facultyOneAllocation) {
    facultyOneAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyOne.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-one-publications",
      },
    });
  } else {
    facultyOneAllocation = await prisma.targetAllocation.update({
      where: { id: facultyOneAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyOne.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: facultyOneAllocation.lockedAt ?? new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-one-publications",
      },
    });
  }

  let facultyTwoAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-faculty-two-publications",
    },
  });

  if (!facultyTwoAllocation) {
    facultyTwoAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyTwo.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-two-publications",
      },
    });
  } else {
    facultyTwoAllocation = await prisma.targetAllocation.update({
      where: { id: facultyTwoAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyTwo.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: facultyTwoAllocation.lockedAt ?? new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-two-publications",
      },
    });
  }

  let demoEmployeeAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-demo-employee-publications",
    },
  });

  if (!demoEmployeeAllocation) {
    demoEmployeeAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: demoEmployee.id,
        allocatedByUserId: owner.id,
        targetValue: demoEmployeeTargetValue,
        state: "LOCKED",
        lockedAt: new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-demo-employee-publications",
      },
    });
  } else {
    demoEmployeeAllocation = await prisma.targetAllocation.update({
      where: { id: demoEmployeeAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: demoEmployee.id,
        allocatedByUserId: owner.id,
        targetValue: demoEmployeeTargetValue,
        state: "LOCKED",
        lockedAt: demoEmployeeAllocation.lockedAt ?? new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-demo-employee-publications",
      },
    });
  }

  const existingAchievement = await prisma.achievement.findFirst({
    where: {
      tenantId: tenant.id,
      targetAllocationId: facultyOneAllocation.id,
      reportedByUserId: facultyOne.id,
      evidenceDescription: "Seed verified achievement",
    },
  });

  if (!existingAchievement) {
    await prisma.achievement.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        targetAllocationId: facultyOneAllocation.id,
        reportedByUserId: facultyOne.id,
        actualValue: 7,
        evidenceDescription: "Seed verified achievement",
        evidenceLinks: [],
        computedScore: 100,
        state: "VERIFIED",
        verifiedByUserId: owner.id,
        verifiedAt: new Date(),
        verificationNote: "Seeded as approved sample data.",
        reportingDate: new Date("2026-01-15T00:00:00.000Z"),
      },
    });
  }

  return {
    period,
    kra,
    kpi,
    allocations: [
      parentAllocation,
      facultyOneAllocation,
      facultyTwoAllocation,
      demoEmployeeAllocation,
    ],
    demoEmployeeAllocation,
  };
}

async function ensureDashboardSupportUsers({
  tenant,
  owner,
  admin,
  rootUnit,
  cseUnit,
  eceUnit,
  reviewerUsers,
  facultyOne,
  facultyTwo,
  demoEmployee,
}) {
  const provost = await upsertUser({
    email: "provost@demo-university.local.test",
    firstName: "Priya",
    lastName: "Provost",
    password: DEMO_PASSWORD,
  });
  const eceStaff = await upsertUser({
    email: "ece.staff@demo-university.local.test",
    firstName: "Ethan",
    lastName: "Staff",
    password: DEMO_PASSWORD,
  });

  for (const [user, employeeId, designation] of [
    [provost, "EMP-UNIV-HEAD-001", "Provost"],
    [eceStaff, "EMP-ECE-003", "Assistant Professor"],
  ]) {
    await ensureMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_USER",
      createdByUserId: owner.id,
      employeeId,
      designation,
    });
  }

  await ensurePrimaryUnitAssignment({
    versionId: rootUnit.versionId,
    unitId: rootUnit.id,
    userId: owner.id,
  });
  await ensurePrimaryUnitAssignment({
    versionId: rootUnit.versionId,
    unitId: rootUnit.id,
    userId: admin.id,
  });
  await ensurePrimaryUnitAssignment({
    versionId: rootUnit.versionId,
    unitId: rootUnit.id,
    userId: provost.id,
  });
  await ensurePrimaryUnitAssignment({
    versionId: eceUnit.versionId,
    unitId: eceUnit.id,
    userId: eceStaff.id,
  });

  const institutionHeadRole = await ensureOrgRoleDefinition({
    tenantId: tenant.id,
    roleKey: "INSTITUTION_HEAD",
    displayLabel: "Institution Head",
    description: "Seeded institution-wide approver for hierarchy and dashboard testing.",
    createdByUserId: owner.id,
  });

  await ensureUnitHeadAssignment({
    versionId: rootUnit.versionId,
    unitId: rootUnit.id,
    userId: provost.id,
    roleDefinitionId: institutionHeadRole.id,
    roleName: institutionHeadRole.displayLabel,
    scope: "DESCENDANTS",
  });

  const professorRole = await ensureRoleDefinition({
    tenantId: tenant.id,
    roleKey: "PROFESSOR",
    displayLabel: "Professor",
    description: "Seeded faculty role for mixed-role hierarchy testing.",
    isUnitHead: false,
    approvalAuthority: false,
    maxPerUnit: -1,
    sortOrder: 50,
    createdByUserId: owner.id,
  });

  for (const [user, unit] of [
    [reviewerUsers.cseHead, cseUnit],
    [reviewerUsers.eceHead, eceUnit],
    [facultyOne, cseUnit],
    [facultyTwo, eceUnit],
    [demoEmployee, cseUnit],
    [eceStaff, eceUnit],
  ]) {
    await ensureRoleAssignment({
      versionId: unit.versionId,
      unitId: unit.id,
      userId: user.id,
      roleDefinitionId: professorRole.id,
      roleName: professorRole.displayLabel,
      scope: "NODE",
    });
  }

  return { provost, eceStaff };
}

function pickDashboardAchievementStates(periodCode, kpiIndex) {
  if (periodCode === "AY2024_25") {
    return ["VERIFIED", "VERIFIED", "VERIFIED"];
  }

  const patterns = [
    ["VERIFIED", "SUBMITTED", "REJECTED"],
    ["VERIFIED", "VERIFIED", "SUBMITTED"],
    ["VERIFIED", "REJECTED", "VERIFIED"],
    ["VERIFIED", "SUBMITTED", "VERIFIED"],
  ];

  return patterns[kpiIndex % patterns.length];
}

function buildDashboardActualValue(targetValue, state, kpiIndex, userIndex) {
  const multipliers = {
    VERIFIED: 1.08 + ((kpiIndex + userIndex) % 4) * 0.05,
    SUBMITTED: 0.88 + ((kpiIndex + userIndex) % 3) * 0.06,
    REJECTED: 0.52 + ((kpiIndex + userIndex) % 3) * 0.07,
  };
  return roundTo(targetValue * multipliers[state], 0);
}

function resolveDashboardReviewer(startingUnitKey, reporterKey, userContexts) {
  const primaryReviewerKeyByUnit = {
    CSE: "cseHead",
    ECE: "eceHead",
    UNIV: "provost",
  };
  const fallbackReviewerKeys = ["owner", "admin", "provost", "cseHead", "eceHead"];

  for (const key of [
    primaryReviewerKeyByUnit[startingUnitKey],
    ...fallbackReviewerKeys,
  ]) {
    if (key && key !== reporterKey) {
      return userContexts[key];
    }
  }

  throw new Error(`Unable to resolve reviewer for ${startingUnitKey}/${reporterKey}.`);
}

async function ensureDashboardKra({
  tenant,
  owner,
  period,
  tenantCategory,
  title,
  description,
}) {
  const existing = await prisma.kraDefinition.findFirst({
    where: {
      tenantId: tenant.id,
      periodId: period.id,
      title,
    },
  });

  if (existing) {
    return prisma.kraDefinition.update({
      where: { id: existing.id },
      data: {
        categoryId: tenantCategory.id,
        description,
        weightage: 100,
        state: "ACTIVE",
        sortOrder: 2,
      },
    });
  }

  return prisma.kraDefinition.create({
    data: {
      tenantId: tenant.id,
      periodId: period.id,
      categoryId: tenantCategory.id,
      title,
      description,
      weightage: 100,
      state: "ACTIVE",
      sortOrder: 2,
      createdByUserId: owner.id,
    },
  });
}

async function ensureDashboardKpi({
  kra,
  owner,
  startingUnit,
  blueprint,
}) {
  const existing = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinitionId: kra.id,
      title: blueprint.title,
    },
  });

  const baseData = {
    kraDefinitionId: kra.id,
    title: blueprint.title,
    description: blueprint.description,
    measurementType: blueprint.measurementType,
    unitLabel: blueprint.unitLabel,
    weightage: blueprint.weightage,
    defaultTarget: blueprint.defaultTarget,
    measurementConfig: buildDashboardMeasurementConfig(blueprint.measurementType),
    scoringMethod: "LINEAR",
    scoringDirection: "ASCENDING",
    scoringConfig: { method: "LINEAR", capAt100: true },
    allocationType: blueprint.allocationType,
    startingUnitId: startingUnit.id,
    achievementTemplateKey: "GENERIC",
    achievementFormConfig: {
      templateKey: "GENERIC",
      fields: [
        {
          key: "summary",
          label: "Summary",
          type: "TEXTAREA",
          required: true,
          sortOrder: 0,
        },
        {
          key: "impact",
          label: "Impact",
          type: "TEXT",
          required: false,
          sortOrder: 1,
        },
      ],
    },
    guidanceNotes: `${DASHBOARD_ACHIEVEMENT_PREFIX}: ${blueprint.description}`,
    state: "ACTIVE",
    sortOrder: blueprint.sortOrder,
    evidenceRequired: true,
    evidenceTypes: ["DOCUMENT", "URL"],
    evidenceInstructions: "Seeded dashboard scenario. Use a short narrative and one supporting link.",
    allowPartialCompletion: true,
  };

  if (existing) {
    return prisma.kpiDefinition.update({
      where: { id: existing.id },
      data: baseData,
    });
  }

  return prisma.kpiDefinition.create({
    data: baseData,
  });
}

async function seedDashboardAchievement({
  tenant,
  period,
  kpi,
  allocation,
  reporterContext,
  reviewerContext,
  startingUnit,
  blueprint,
  state,
  title,
  evidenceDescription,
  actualValue,
  targetValue,
  reportingDate,
}) {
  await prisma.achievement.deleteMany({
    where: {
      targetAllocationId: allocation.id,
      title: { startsWith: `${DASHBOARD_ACHIEVEMENT_PREFIX} ${period.code}` },
    },
  });

  const submittedAt = addDays(reportingDate, 1);
  const reviewAt = addDays(submittedAt, 2);
  const computedScore =
    targetValue > 0
      ? roundTo(Math.min(100, (actualValue / targetValue) * 100), 2)
      : 100;
  const reviewNote =
    state === "VERIFIED"
      ? `Verified in seeded dashboard scenario for ${period.code}.`
      : "Requires stronger documentary evidence before approval.";

  const verificationLog =
    state === "SUBMITTED"
      ? []
      : [
          buildVerificationLogEntry(
            "VERIFY",
            reviewerContext.user,
            state,
            reviewNote,
            reviewAt,
          ),
        ];

  const achievement = await prisma.achievement.create({
    data: {
      tenantId: tenant.id,
      periodId: period.id,
      kpiDefinitionId: kpi.id,
      targetAllocationId: allocation.id,
      reportedByUserId: reporterContext.user.id,
      title,
      actualValue,
      actualDate: reportingDate,
      evidenceDescription,
      evidenceLinks: [
        `https://demo-university.local.test/evidence/${period.code}/${blueprint.key}/${reporterContext.key}`,
      ],
      achievementFormData: {
        summary: `${title} seeded for KPI dashboard coverage.`,
        impact: blueprint.description,
      },
      state,
      currentVerifierUnitId: state === "SUBMITTED" ? startingUnit.id : null,
      currentVerifierUserId: state === "SUBMITTED" ? reviewerContext.user.id : null,
      computedScore,
      effectiveScore: computedScore,
      verifiedByUserId: state === "SUBMITTED" ? null : reviewerContext.user.id,
      verifiedAt: state === "SUBMITTED" ? null : reviewAt,
      verificationNote: state === "VERIFIED" ? reviewNote : null,
      rejectionReason: state === "REJECTED" ? reviewNote : null,
      verificationLog,
      reportingDate,
    },
  });

  const trailEntries = [
    {
      action: "RECORDED",
      actor: reporterContext.user,
      actorRole: reporterContext.role,
      actorUnitName: reporterContext.unit.name,
      note: `Seeded dashboard activity for ${period.code}.`,
      scoreAtAction: computedScore,
      createdAt: reportingDate,
    },
    {
      action: "SUBMITTED",
      actor: reporterContext.user,
      actorRole: reporterContext.role,
      actorUnitName: reporterContext.unit.name,
      note: `Submitted to ${startingUnit.name} review queue.`,
      scoreAtAction: computedScore,
      createdAt: submittedAt,
    },
  ];

  if (state === "VERIFIED" || state === "REJECTED") {
    trailEntries.push({
      action: state,
      actor: reviewerContext.user,
      actorRole: reviewerContext.role,
      actorUnitName: reviewerContext.unit.name,
      note: reviewNote,
      scoreAtAction: computedScore,
      createdAt: reviewAt,
    });
  }

  await recreateSubmissionTrail(achievement.id, trailEntries);
  return achievement;
}

async function ensureDashboardPeriodData({
  tenant,
  owner,
  periodBlueprint,
  tenantCategory,
  unitsByKey,
  userContexts,
}) {
  const period = await prisma.assessmentPeriod.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: periodBlueprint.code,
      },
    },
    update: {
      name: periodBlueprint.name,
      periodType: "SPECIFIC_RANGE",
      startDate: at(periodBlueprint.startDate),
      endDate: at(periodBlueprint.endDate),
      state: periodBlueprint.state,
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: at(periodBlueprint.targetSettingDeadline),
      achievementDeadline: at(periodBlueprint.achievementDeadline),
      reviewDeadline: at(periodBlueprint.reviewDeadline),
      description: periodBlueprint.description,
    },
    create: {
      tenantId: tenant.id,
      name: periodBlueprint.name,
      code: periodBlueprint.code,
      periodType: "SPECIFIC_RANGE",
      startDate: at(periodBlueprint.startDate),
      endDate: at(periodBlueprint.endDate),
      state: periodBlueprint.state,
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: at(periodBlueprint.targetSettingDeadline),
      achievementDeadline: at(periodBlueprint.achievementDeadline),
      reviewDeadline: at(periodBlueprint.reviewDeadline),
      description: periodBlueprint.description,
      createdByUserId: owner.id,
    },
  });

  const kra = await ensureDashboardKra({
    tenant,
    owner,
    period,
    tenantCategory,
    title: periodBlueprint.kraTitle,
    description: `Seeded dashboard KRA for ${periodBlueprint.label} with mixed research and administration KPIs.`,
  });

  const kpis = [];
  const allocations = [];
  const achievements = [];

  for (const [kpiIndex, blueprint] of DASHBOARD_KPI_BLUEPRINTS.entries()) {
    const startingUnit = unitsByKey[blueprint.startingUnitKey];
    const kpi = await ensureDashboardKpi({
      kra,
      owner,
      startingUnit,
      blueprint,
    });
    kpis.push(kpi);

    const prefix = `${DASHBOARD_SEED_PREFIX}:${period.code}:${blueprint.key}`;
    const parentAllocation = await ensureSeedAllocation({
      tenantId: tenant.id,
      periodId: period.id,
      kpiDefinitionId: kpi.id,
      assignedToUnitId: startingUnit.id,
      allocatedByUserId: owner.id,
      targetValue: blueprint.parentTarget,
      notes: `${prefix}:parent`,
    });
    allocations.push(parentAllocation);

    const assigneeKeys = DASHBOARD_ASSIGNEE_GROUPS[blueprint.startingUnitKey];
    const states = pickDashboardAchievementStates(period.code, kpiIndex);

    for (const [userIndex, assigneeKey] of assigneeKeys.entries()) {
      const assignee = userContexts[assigneeKey];
      const allocation = await ensureSeedAllocation({
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: assignee.user.id,
        allocatedByUserId: owner.id,
        targetValue: blueprint.userTargets[userIndex],
        parentAllocationId: parentAllocation.id,
        notes: `${prefix}:${assigneeKey}`,
      });
      allocations.push(allocation);

      const state = states[userIndex];
      const reviewer = resolveDashboardReviewer(
        blueprint.startingUnitKey,
        assigneeKey,
        userContexts,
      );
      const reportingDate = addDays(at(periodBlueprint.startDate), 18 + (kpiIndex * 7) + (userIndex * 3));
      const actualValue = buildDashboardActualValue(
        blueprint.userTargets[userIndex],
        state,
        kpiIndex,
        userIndex,
      );
      const title = `${DASHBOARD_ACHIEVEMENT_PREFIX} ${period.code}: ${blueprint.title} / ${userName(assignee.user)}`;
      const evidenceDescription =
        `${DASHBOARD_SEED_PREFIX}:${period.code}:${blueprint.key}:${assigneeKey}`;

      const achievement = await seedDashboardAchievement({
        tenant,
        period,
        kpi,
        allocation,
        reporterContext: assignee,
        reviewerContext: reviewer,
        startingUnit,
        blueprint,
        state,
        title,
        evidenceDescription,
        actualValue,
        targetValue: blueprint.userTargets[userIndex],
        reportingDate,
      });
      achievements.push(achievement);
    }
  }

  return {
    period,
    kra,
    kpis,
    allocations,
    achievements,
  };
}

async function ensureDashboardDataset({
  tenant,
  owner,
  tenantCategory,
  rootUnit,
  cseUnit,
  eceUnit,
  reviewerUsers,
  supportUsers,
  admin,
  facultyOne,
  facultyTwo,
  demoEmployee,
}) {
  const userContexts = {
    owner: { key: "owner", user: owner, role: "TENANT_OWNER", unit: rootUnit },
    admin: { key: "admin", user: admin, role: "TENANT_ADMIN", unit: rootUnit },
    provost: { key: "provost", user: supportUsers.provost, role: "TENANT_USER", unit: rootUnit },
    cseHead: { key: "cseHead", user: reviewerUsers.cseHead, role: "TENANT_USER", unit: cseUnit },
    eceHead: { key: "eceHead", user: reviewerUsers.eceHead, role: "TENANT_USER", unit: eceUnit },
    facultyOne: { key: "facultyOne", user: facultyOne, role: "TENANT_USER", unit: cseUnit },
    facultyTwo: { key: "facultyTwo", user: facultyTwo, role: "TENANT_USER", unit: eceUnit },
    demoEmployee: { key: "demoEmployee", user: demoEmployee, role: "TENANT_USER", unit: cseUnit },
    eceStaff: { key: "eceStaff", user: supportUsers.eceStaff, role: "TENANT_USER", unit: eceUnit },
  };

  const unitsByKey = {
    UNIV: rootUnit,
    CSE: cseUnit,
    ECE: eceUnit,
  };

  const periods = [];
  for (const periodBlueprint of DASHBOARD_PERIOD_BLUEPRINTS) {
    periods.push(
      await ensureDashboardPeriodData({
        tenant,
        owner,
        periodBlueprint,
        tenantCategory,
        unitsByKey,
        userContexts,
      }),
    );
  }

  return {
    periods,
    kpiTopicCount: DASHBOARD_KPI_BLUEPRINTS.length,
  };
}

async function ensureR43RewardKpi({
  tenant,
  owner,
  kra,
  cseUnit,
  eceUnit,
}) {
  let kpi = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinitionId: kra.id,
      title: R43_PUBLICATION_KPI_TITLE,
    },
  });

  const baseKpiData = {
    kraDefinitionId: kra.id,
    title: R43_PUBLICATION_KPI_TITLE,
    description:
      "Seeded publication incentive KPI with workflow remarks, notifications, and reward operations demo data.",
    measurementType: "NUMERIC",
    unitLabel: "papers",
    weightage: 0,
    defaultTarget: 4,
    measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
    scoringMethod: "LINEAR",
    scoringDirection: "ASCENDING",
    scoringConfig: { method: "LINEAR", capAt100: true },
    allocationType: "BOTH",
    startingUnitId: cseUnit.id,
    achievementTemplateKey: "PUBLICATION",
    achievementFormConfig: {
      templateKey: "PUBLICATION",
      fields: R43_PUBLICATION_FORM_FIELDS,
    },
    keyUnitId: eceUnit.id,
    finalUnitId: cseUnit.id,
    evidenceRequired: true,
    evidenceTypes: ["DOCUMENT", "URL"],
    evidenceInstructions:
      "Seeded R4.3 workflow demo: attach DOI proof and use contributor selector tags where applicable.",
    isTeamKpi: true,
    teamCreditMethod: "WEIGHTED_SPLIT",
    allowPartialCompletion: true,
    allowMultipleAchievementsPerAllocation: true,
    participantMode: "OPTIONAL_TEAM",
    rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
    policyDateFieldKey: "publicationDate",
    state: "ACTIVE",
    sortOrder: 2,
    guidanceNotes:
      "Use FIRST_AUTHOR and CORRESPONDING_AUTHOR selector tags to test reward distribution in the target-user form.",
  };

  if (!kpi) {
    kpi = await prisma.kpiDefinition.create({ data: baseKpiData });
  } else {
    kpi = await prisma.kpiDefinition.update({
      where: { id: kpi.id },
      data: baseKpiData,
    });
  }

  return kpi;
}

async function ensureR43KpiConfig({
  kpi,
  roleMap,
  benefitTypeMap,
}) {
  await prisma.kpiContributorConfig.upsert({
    where: { kpiDefinitionId: kpi.id },
    update: {
      allowExternalContributors: true,
      duplicateCheckFields: ["doi"],
      creditSumMode: "MUST_EQUAL_100",
    },
    create: {
      kpiDefinitionId: kpi.id,
      allowExternalContributors: true,
      duplicateCheckFields: ["doi"],
      creditSumMode: "MUST_EQUAL_100",
    },
  });

  await prisma.kpiApplicableRole.deleteMany({
    where: { kpiDefinitionId: kpi.id },
  });
  await prisma.kpiApplicableRole.createMany({
    data: [
      {
        kpiDefinitionId: kpi.id,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        isDefault: true,
        sortOrder: 0,
      },
      {
        kpiDefinitionId: kpi.id,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        isDefault: false,
        sortOrder: 1,
      },
      {
        kpiDefinitionId: kpi.id,
        contributorRoleId: roleMap.get("CORRESPONDING").id,
        isDefault: false,
        sortOrder: 2,
      },
    ],
  });

  const existingComponents = await prisma.kpiRewardComponent.findMany({
    where: { kpiDefinitionId: kpi.id },
    select: { id: true },
  });
  if (existingComponents.length > 0) {
    await prisma.contributorRewardEvent.deleteMany({
      where: {
        reward: { rewardComponentId: { in: existingComponents.map((row) => row.id) } },
      },
    });
    await prisma.contributorReward.deleteMany({
      where: { rewardComponentId: { in: existingComponents.map((row) => row.id) } },
    });
    await prisma.kpiRewardDistribution.deleteMany({
      where: { rewardComponentId: { in: existingComponents.map((row) => row.id) } },
    });
  }
  await prisma.kpiRewardRule.deleteMany({
    where: { rewardTier: { kpiDefinitionId: kpi.id } },
  });
  await prisma.kpiRewardComponent.deleteMany({
    where: { kpiDefinitionId: kpi.id },
  });
  await prisma.kpiRewardTier.deleteMany({
    where: { kpiDefinitionId: kpi.id },
  });

  for (const tier of R43_PUBLICATION_TIERS) {
    const createdTier = await prisma.kpiRewardTier.create({
      data: {
        kpiDefinitionId: kpi.id,
        tierSetKey: "PRIMARY",
        code: tier.code,
        name: tier.name,
        description: `Seeded tier for ${tier.value} publications.`,
        priority: tier.priority,
        matchMode: "HIGHEST_MATCH",
        isActive: true,
      },
    });

    await prisma.kpiRewardRule.create({
      data: {
        rewardTierId: createdTier.id,
        source: "FORM_FIELD",
        operator: "eq",
        fieldKey: "journalTier",
        value: tier.value,
        sortOrder: 0,
      },
    });

    for (const componentDef of [
      {
        code: `${tier.code}_MONETARY`,
        name: `${tier.name} Monetary Incentive`,
        amountValue: tier.monetaryAmount,
        benefitTypeCode: "MONETARY",
      },
      {
        code: `${tier.code}_LEAVE_POINTS`,
        name: `${tier.name} Leave Points`,
        amountValue: tier.leavePointsAmount,
        benefitTypeCode: "LEAVE_POINTS",
      },
    ]) {
      const component = await prisma.kpiRewardComponent.create({
        data: {
          kpiDefinitionId: kpi.id,
          rewardTierId: createdTier.id,
          benefitTypeId: benefitTypeMap.get(componentDef.benefitTypeCode).id,
          code: componentDef.code,
          name: componentDef.name,
          description: `Seeded ${componentDef.benefitTypeCode.toLowerCase()} component for ${tier.name}.`,
          trigger: "FINAL_VERIFY",
          amountMode: "FIXED_POOL",
          amountValue: componentDef.amountValue,
          distributionMode: "ROLE_PERCENT_SPLIT",
          singleEligibleHandling: "FULL_TO_SINGLE",
          emptyShareHandling: "ROLLOVER_TO_MATCHED",
          isActive: true,
          sortOrder: componentDef.benefitTypeCode === "MONETARY" ? tier.priority * 2 : tier.priority * 2 + 1,
        },
      });

      await prisma.kpiRewardDistribution.createMany({
        data: [
          {
            rewardComponentId: component.id,
            selectorType: "SELECTOR_TAG",
            selectorTag: tier.leadSelectorTag,
            sharePercent: 70,
            splitMode: "FULL_TO_MATCHED",
            sortOrder: 0,
          },
          {
            rewardComponentId: component.id,
            selectorType: "REMAINDER",
            selectorTag: null,
            sharePercent: 30,
            splitMode: "EQUAL",
            sortOrder: 1,
          },
        ],
      });
    }
  }

  return prisma.kpiDefinition.findUniqueOrThrow({
    where: { id: kpi.id },
    include: {
      rewardTiers: { orderBy: [{ priority: "asc" }, { code: "asc" }] },
      rewardComponents: {
        include: {
          benefitType: true,
          rewardTier: true,
          distributions: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      },
    },
  });
}

async function ensureSeedAllocation({
  tenantId,
  periodId,
  kpiDefinitionId,
  assignedToUnitId,
  assignedToUserId,
  allocatedByUserId,
  targetValue,
  parentAllocationId,
  notes,
}) {
  const existing = await prisma.targetAllocation.findFirst({
    where: { tenantId, notes },
  });

  if (existing) {
    return prisma.targetAllocation.update({
      where: { id: existing.id },
      data: {
        periodId,
        kpiDefinitionId,
        assignedToUnitId: assignedToUnitId ?? null,
        assignedToUserId: assignedToUserId ?? null,
        allocatedByUserId,
        targetValue,
        parentAllocationId: parentAllocationId ?? null,
        state: "LOCKED",
        lockedAt: existing.lockedAt ?? new Date(),
        notes,
      },
    });
  }

  return prisma.targetAllocation.create({
    data: {
      tenantId,
      periodId,
      kpiDefinitionId,
      assignedToUnitId: assignedToUnitId ?? null,
      assignedToUserId: assignedToUserId ?? null,
      allocatedByUserId,
      targetValue,
      parentAllocationId: parentAllocationId ?? null,
      state: "LOCKED",
      lockedAt: new Date(),
      notes,
    },
  });
}

function buildVerificationLogEntry(level, user, action, note, when) {
  return {
    level,
    userId: user.id,
    userName: userName(user),
    action,
    ...(note ? { note } : {}),
    at: when.toISOString(),
  };
}

function buildSeedCoAuthorList(...names) {
  return names.filter(Boolean).join(", ");
}

function buildSeedExternalContributor({
  name,
  affiliation,
  scope,
  contributorRoleId,
  orcid = undefined,
  note = null,
}) {
  return {
    type: "EXTERNAL",
    externalName: name,
    externalAffiliation: affiliation,
    externalScope: scope,
    contributorRoleId,
    creditPercent: 0,
    isExcludedFromReward: true,
    selectorTags: [],
    note,
    externalData: {
      name,
      affiliation,
      scope: scope === "INTERNATIONAL" ? "International" : "National",
      ...(orcid ? { orcid } : {}),
    },
  };
}

function buildRewardAllocations({
  contributors,
  leadSelectorTag,
  amount,
  precision,
}) {
  const eligible = contributors.filter((row) => !row.isExcludedFromReward);
  if (eligible.length === 0) return [];

  const totalAmount = roundTo(amount, precision);
  if (eligible.length === 1) {
    return [
      {
        contributor: eligible[0],
        amount: totalAmount,
        fallbackApplied: "FULL_TO_SINGLE",
        roundingAdjustment: roundTo(totalAmount - amount, precision),
      },
    ];
  }

  const lead = eligible.find((row) => row.selectorTags.includes(leadSelectorTag)) ?? eligible[0];
  const remainder = eligible.filter((row) => row.id !== lead.id);
  if (remainder.length === 0) {
    return [
      {
        contributor: lead,
        amount: totalAmount,
        fallbackApplied: "ROLLOVER_TO_MATCHED",
        roundingAdjustment: roundTo(totalAmount - amount, precision),
      },
    ];
  }

  const leadAmount = roundTo(amount * 0.7, precision);
  const remainderPool = totalAmount - leadAmount;
  const perRemainder = roundTo(remainderPool / remainder.length, precision);
  const allocations = [
    {
      contributor: lead,
      amount: leadAmount,
      fallbackApplied: null,
      roundingAdjustment: 0,
    },
    ...remainder.map((row) => ({
      contributor: row,
      amount: perRemainder,
      fallbackApplied: null,
      roundingAdjustment: 0,
    })),
  ];

  const roundedTotal = roundTo(
    allocations.reduce((sum, row) => sum + row.amount, 0),
    precision,
  );
  const residual = roundTo(totalAmount - roundedTotal, precision);
  if (residual !== 0) {
    allocations[0].amount = roundTo(allocations[0].amount + residual, precision);
    allocations[0].roundingAdjustment = residual;
  }

  return allocations;
}

async function recreateSubmissionTrail(achievementId, trailEntries) {
  await prisma.submissionTrail.deleteMany({
    where: { achievementId },
  });
  for (const entry of trailEntries) {
    await prisma.submissionTrail.create({
      data: {
        achievementId,
        action: entry.action,
        actorUserId: entry.actor.id,
        actorName: userName(entry.actor),
        actorRole: entry.actorRole,
        actorUnitName: entry.actorUnitName ?? null,
        note: entry.note ?? null,
        scoreAtAction: entry.scoreAtAction ?? null,
        metadata: entry.metadata ?? undefined,
        createdAt: entry.createdAt,
      },
    });
  }
}

async function createSeedAchievement({
  tenant,
  period,
  kpi,
  allocationId,
  reporter,
  state,
  title,
  reportingDate,
  actualValue,
  actualDate,
  evidenceDescription,
  evidenceLinks,
  achievementFormData,
  currentVerifierUnitId = null,
  currentVerifierUserId = null,
  recommendedByUserId = null,
  recommendedAt = null,
  recommendationNote = null,
  verifiedByUserId = null,
  verifiedAt = null,
  verificationNote = null,
  rejectionReason = null,
  verificationLog = [],
  computedScore = 25,
  effectiveScore = 25,
  contributors,
  trailEntries,
}) {
  const achievement = await prisma.achievement.create({
    data: {
      tenantId: tenant.id,
      periodId: period.id,
      kpiDefinitionId: kpi.id,
      targetAllocationId: allocationId,
      reportedByUserId: reporter.id,
      title,
      actualValue,
      actualDate,
      evidenceDescription,
      evidenceLinks,
      achievementFormData,
      state,
      currentVerifierUnitId,
      currentVerifierUserId,
      isTeamAchievement: contributors.length > 1,
      computedScore,
      effectiveScore,
      recommendedByUserId,
      recommendedAt,
      recommendationNote,
      verifiedByUserId,
      verifiedAt,
      verificationNote,
      rejectionReason,
      verificationLog,
      reportingDate,
    },
  });

  await prisma.achievementContributor.createMany({
    data: contributors.map((row) => ({
      achievementId: achievement.id,
      type: row.type ?? "INTERNAL",
      userId: row.user?.id ?? null,
      externalName: row.externalName ?? null,
      externalAffiliation: row.externalAffiliation ?? null,
      externalScope: row.externalScope ?? null,
      contributorRoleId: row.contributorRoleId,
      creditPercent: row.creditPercent,
      isExcludedFromReward: row.isExcludedFromReward ?? false,
      selectorTags: row.selectorTags ?? [],
      note: row.note ?? null,
      externalData: row.externalData ?? undefined,
    })),
  });

  await recreateSubmissionTrail(achievement.id, trailEntries);

  const contributorRows = await prisma.achievementContributor.findMany({
    where: { achievementId: achievement.id },
    orderBy: { createdAt: "asc" },
  });

  return { achievement, contributors: contributorRows };
}

async function createSeedNotifications(rows) {
  for (const row of rows) {
    await prisma.notification.create({
      data: {
        tenantId: row.tenantId,
        userId: row.userId,
        type: row.type,
        eventKey: row.eventKey,
        title: row.title,
        message: row.message,
        entityType: row.entityType ?? null,
        entityId: row.entityId ?? null,
        linkUrl: row.linkUrl ?? null,
        isRead: row.isRead ?? false,
        createdAt: row.createdAt,
      },
    });
  }
}

async function linkReplacementRewards({
  revokedRows,
  replacementRows,
}) {
  for (const [key, revokedReward] of revokedRows.entries()) {
    const replacement = replacementRows.get(key);
    if (!replacement) continue;
    await prisma.contributorReward.update({
      where: { id: revokedReward.id },
      data: { replacedByRewardId: replacement.id },
    });
    await prisma.contributorReward.update({
      where: { id: replacement.id },
      data: { supersedesRewardId: revokedReward.id },
    });
  }
}

async function createRewardRowsForAchievement({
  tenant,
  period,
  kpi,
  achievement,
  contributors,
  componentMap,
  tierMap,
  unitSnapshotByUserId,
  reporterUnit,
  owner,
  scenarioKey,
  tierCode,
  stateByComponentCode,
  stateNoteByComponentCode = {},
  releaseReferenceByComponentCode = {},
  revokedReasonByComponentCode = {},
  supersedesByComponentCode = {},
  replacementMode = false,
}) {
  const createdRows = new Map();
  const tier = tierMap.get(tierCode);
  const tierLeadSelector =
    R43_PUBLICATION_TIERS.find((row) => row.code === tierCode)?.leadSelectorTag ?? "FIRST_AUTHOR";
  const eligibleContributors = contributors.map((row) => ({
    id: row.id,
    userId: row.userId,
    contributorRoleId: row.contributorRoleId,
    creditPercent: row.creditPercent,
    isExcludedFromReward: row.isExcludedFromReward,
    selectorTags: row.selectorTags,
  }));

  for (const component of componentMap.values()) {
    if (component.rewardTierId !== tier?.id) continue;

    const allocations = buildRewardAllocations({
      contributors: eligibleContributors,
      leadSelectorTag: tierLeadSelector,
      amount: component.amountValue ?? 0,
      precision: component.benefitType.precision ?? 2,
    });

    for (const allocation of allocations) {
      const ownerSnapshot =
        (allocation.contributor.userId && unitSnapshotByUserId.get(allocation.contributor.userId))
        || reporterUnit;
      const componentState = stateByComponentCode[component.code] ?? "DRAFT";
      const reward = await prisma.contributorReward.create({
        data: {
          tenantId: tenant.id,
          periodId: period.id,
          kpiDefinitionId: kpi.id,
          achievementId: achievement.id,
          achievementContributorId: allocation.contributor.id,
          contributorUserId: allocation.contributor.userId,
          benefitTypeId: component.benefitTypeId,
          rewardTierId: tier.id,
          rewardComponentId: component.id,
          recurrenceKey: String(achievement.achievementFormData?.doi ?? achievement.id),
          state: componentState,
          statusRemark: stateNoteByComponentCode[component.code] ?? null,
          releasedAt:
            componentState === "RELEASED" || componentState === "REVOKED"
              ? at("2026-03-05T10:00:00.000Z")
              : null,
          releasedById:
            componentState === "RELEASED" || componentState === "REVOKED"
              ? owner.id
              : null,
          releaseReference:
            componentState === "RELEASED" || componentState === "REVOKED"
              ? releaseReferenceByComponentCode[component.code] ?? `${scenarioKey.toUpperCase()}-REL`
              : null,
          revokedAt: componentState === "REVOKED" ? at("2026-03-15T11:30:00.000Z") : null,
          revokedById: componentState === "REVOKED" ? owner.id : null,
          revocationReason:
            componentState === "REVOKED"
              ? revokedReasonByComponentCode[component.code] ?? "Seeded revocation after correction."
              : null,
          rewardOwnerUnitId: ownerSnapshot.unitId,
          rewardOwnerUnitName: ownerSnapshot.unitName,
          rewardOwnerUnitPath: ownerSnapshot.unitPath,
          rewardOwnerUnitTypeKey: ownerSnapshot.unitTypeKey,
          reporterUnitId: reporterUnit.unitId,
          reporterUnitName: reporterUnit.unitName,
          reporterUnitPath: reporterUnit.unitPath,
          reporterUnitTypeKey: reporterUnit.unitTypeKey,
          baseAmount: allocation.amount,
          finalAmount: allocation.amount,
          roundingAdjustment: allocation.roundingAdjustment,
          explanation: {
            tierCode,
            componentCode: component.code,
            selectorTags: allocation.contributor.selectorTags,
            fallbackApplied: allocation.fallbackApplied,
            replacementMode,
          },
          idempotencyKey: `${R43_SEED_PREFIX}:${scenarioKey}:${component.code}:${allocation.contributor.userId ?? allocation.contributor.id}:${replacementMode ? "replacement" : "base"}`,
          ...(supersedesByComponentCode[component.code]
            ? {
                supersedesRewardId:
                  supersedesByComponentCode[component.code].get(
                    allocation.contributor.userId ?? allocation.contributor.id,
                  ) ?? null,
              }
            : {}),
        },
      });

      createdRows.set(
        `${component.code}:${allocation.contributor.userId ?? allocation.contributor.id}`,
        reward,
      );

      const events =
        componentState === "PENDING"
          ? [
              {
                action: "GENERATED",
                fromState: null,
                toState: "DRAFT",
                note: "Seeded reward generated.",
                createdAt: at("2026-03-02T08:00:00.000Z"),
              },
              {
                action: "STATUS_UPDATED",
                fromState: "DRAFT",
                toState: "PENDING",
                note: stateNoteByComponentCode[component.code] ?? "Queued for release.",
                createdAt: at("2026-03-04T09:15:00.000Z"),
              },
            ]
          : componentState === "RELEASED"
            ? [
                {
                  action: "GENERATED",
                  fromState: null,
                  toState: "DRAFT",
                  note: "Seeded reward generated.",
                  createdAt: at("2026-03-01T09:30:00.000Z"),
                },
                {
                  action: "STATUS_UPDATED",
                  fromState: "DRAFT",
                  toState: "PENDING",
                  note: "Moved to payment run.",
                  createdAt: at("2026-03-03T11:00:00.000Z"),
                },
                {
                  action: "RELEASED",
                  fromState: "PENDING",
                  toState: "RELEASED",
                  note: stateNoteByComponentCode[component.code] ?? "Released in seeded batch.",
                  createdAt: at("2026-03-05T10:00:00.000Z"),
                },
              ]
            : componentState === "REVOKED"
              ? [
                  {
                    action: "GENERATED",
                    fromState: null,
                    toState: "DRAFT",
                    note: "Seeded reward generated.",
                    createdAt: at("2026-03-01T09:30:00.000Z"),
                  },
                  {
                    action: "STATUS_UPDATED",
                    fromState: "DRAFT",
                    toState: "PENDING",
                    note: "Moved to payment run.",
                    createdAt: at("2026-03-03T11:00:00.000Z"),
                  },
                  {
                    action: "RELEASED",
                    fromState: "PENDING",
                    toState: "RELEASED",
                    note: "Released before correction.",
                    createdAt: at("2026-03-05T10:00:00.000Z"),
                  },
                  {
                    action: "REVOKED",
                    fromState: "RELEASED",
                    toState: "REVOKED",
                    note:
                      revokedReasonByComponentCode[component.code]
                      ?? "Revoked after seeded correction.",
                    createdAt: at("2026-03-15T11:30:00.000Z"),
                  },
                ]
              : [
                  {
                    action: "GENERATED",
                    fromState: null,
                    toState: "DRAFT",
                    note: "Seeded reward generated.",
                    createdAt: at("2026-03-01T09:00:00.000Z"),
                  },
                ];

      for (const event of events) {
        await prisma.contributorRewardEvent.create({
          data: {
            rewardId: reward.id,
            tenantId: tenant.id,
            actorUserId: owner.id,
            actorRole: "TENANT_OWNER",
            action: event.action,
            fromState: event.fromState,
            toState: event.toState,
            note: event.note,
            metadata: {
              seededScenario: scenarioKey,
              componentCode: component.code,
            },
            createdAt: event.createdAt,
          },
        });
      }
    }
  }

  return createdRows;
}

async function ensureR43InterfaceSeed({
  tenant,
  owner,
  facultyOne,
  facultyTwo,
  demoEmployee,
  cseUnit,
  eceUnit,
  period,
  kra,
  reviewerUsers,
}) {
  const benefitTypeMap = await ensureBenefitTypes(tenant.id);
  const roleMap = await ensureContributorRoles(tenant.id);
  const kpiBase = await ensureR43RewardKpi({
    tenant,
    owner,
    kra,
    cseUnit,
    eceUnit,
  });

  await prisma.notification.deleteMany({
    where: {
      tenantId: tenant.id,
      eventKey: { startsWith: `${R43_SEED_PREFIX}:` },
    },
  });
  await prisma.achievement.deleteMany({
    where: {
      tenantId: tenant.id,
      kpiDefinitionId: kpiBase.id,
      title: { startsWith: R43_PUBLICATION_PREFIX },
    },
  });

  const kpi = await ensureR43KpiConfig({
    kpi: kpiBase,
    roleMap,
    benefitTypeMap,
  });

  const parentAllocation = await ensureSeedAllocation({
    tenantId: tenant.id,
    periodId: period.id,
    kpiDefinitionId: kpi.id,
    assignedToUnitId: cseUnit.id,
    assignedToUserId: null,
    allocatedByUserId: owner.id,
    targetValue: 8,
    parentAllocationId: null,
    notes: "seed-r43-parent-publication-workflow",
  });
  const facultyAllocation = await ensureSeedAllocation({
    tenantId: tenant.id,
    periodId: period.id,
    kpiDefinitionId: kpi.id,
    assignedToUnitId: null,
    assignedToUserId: facultyOne.id,
    allocatedByUserId: owner.id,
    targetValue: 4,
    parentAllocationId: parentAllocation.id,
    notes: "seed-r43-faculty1-publication-workflow",
  });
  const employeeAllocation = await ensureSeedAllocation({
    tenantId: tenant.id,
    periodId: period.id,
    kpiDefinitionId: kpi.id,
    assignedToUnitId: null,
    assignedToUserId: demoEmployee.id,
    allocatedByUserId: owner.id,
    targetValue: 4,
    parentAllocationId: parentAllocation.id,
    notes: "seed-r43-employee-publication-workflow",
  });

  const unitRows = await prisma.orgUnit.findMany({
    where: { versionId: cseUnit.versionId, id: { in: [cseUnit.id, eceUnit.id] } },
    include: { type: true },
  });
  const unitById = new Map(unitRows.map((row) => [row.id, row]));
  const cseSnapshot = buildUnitSnapshot(unitById.get(cseUnit.id));
  const eceSnapshot = buildUnitSnapshot(unitById.get(eceUnit.id));
  const unitSnapshotByUserId = new Map([
    [facultyOne.id, cseSnapshot],
    [demoEmployee.id, cseSnapshot],
    [reviewerUsers.cseHead.id, cseSnapshot],
    [facultyTwo.id, eceSnapshot],
    [reviewerUsers.eceHead.id, eceSnapshot],
  ]);
  const tierMap = new Map(kpi.rewardTiers.map((row) => [row.code, row]));
  const componentMap = new Map(kpi.rewardComponents.map((row) => [row.code, row]));

  const pendingRecommendation = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "SUBMITTED",
    title: "Seed R4.3 Pending Recommendation",
    reportingDate: at("2026-02-12T09:00:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-10T00:00:00.000Z"),
    evidenceDescription: "Resubmitted publication waiting for school-level recommendation.",
    evidenceLinks: ["https://example.com/r43/pending-recommendation.pdf"],
    achievementFormData: {
      paperTitle: "Adaptive Testing of AI-Assisted Workflow Engines",
      journalName: "Journal of Workflow Research",
      doi: "10.1000/seed-r43-pending-recommendation",
      indexing: ["Scopus"],
      journalTier: "Q1",
      publicationDate: "2026-02-10",
      pdfLink: "https://example.com/r43/pending-recommendation.pdf",
      coAuthors: buildSeedCoAuthorList(
        userName(facultyOne),
        userName(facultyTwo),
        "Dr. Nisha External",
      ),
      totalAuthors: 3,
    },
    currentVerifierUnitId: eceUnit.id,
    currentVerifierUserId: reviewerUsers.eceHead.id,
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Initial submission for review.", at("2026-02-05T10:00:00.000Z")),
      buildVerificationLogEntry("REJECT", reviewerUsers.eceHead, "rejected", "Upload the revised indexing proof.", at("2026-02-07T15:30:00.000Z")),
      buildVerificationLogEntry("RESUBMIT", facultyOne, "resubmitted", "Re-uploaded the indexing certificate and DOI proof.", at("2026-02-11T09:10:00.000Z")),
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Resubmitted with the corrected attachment.", at("2026-02-12T09:00:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
      buildSeedExternalContributor({
        name: "Dr. Nisha External",
        affiliation: "National Institute of Analytics",
        scope: "NATIONAL",
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        orcid: "0000-0002-9876-5432",
        note: "Seeded external co-author for mixed contributor validation.",
      }),
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Initial submission for review.", scoreAtAction: 25, createdAt: at("2026-02-05T10:00:00.000Z") },
      { action: "REJECTED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Upload the revised indexing proof.", scoreAtAction: 25, createdAt: at("2026-02-07T15:30:00.000Z") },
      { action: "RESUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Re-uploaded the indexing certificate and DOI proof.", scoreAtAction: 25, createdAt: at("2026-02-11T09:10:00.000Z") },
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Resubmitted with the corrected attachment.", scoreAtAction: 25, createdAt: at("2026-02-12T09:00:00.000Z") },
    ],
  });

  const pendingVerification = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: employeeAllocation.id,
    reporter: demoEmployee,
    state: "RECOMMENDED",
    title: "Seed R4.3 Pending Verification",
    reportingDate: at("2026-02-14T11:15:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-13T00:00:00.000Z"),
    evidenceDescription: "Recommended publication waiting for final verification by the source division.",
    evidenceLinks: ["https://example.com/r43/pending-verification.pdf"],
    achievementFormData: {
      paperTitle: "Benchmarking Review Timelines in Academic Institutions",
      journalName: "International Review Systems Journal",
      doi: "10.1000/seed-r43-pending-verification",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-02-13",
      pdfLink: "https://example.com/r43/pending-verification.pdf",
      coAuthors: buildSeedCoAuthorList(
        userName(demoEmployee),
        userName(facultyTwo),
        "Prof. Elena Collaborator",
      ),
      totalAuthors: 3,
    },
    currentVerifierUnitId: cseUnit.id,
    currentVerifierUserId: reviewerUsers.cseHead.id,
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-02-14T10:30:00.000Z"),
    recommendationNote: "Metadata cross-check completed. Ready for final verification.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", demoEmployee, "submitted", "Submitted with all supporting evidence.", at("2026-02-13T16:20:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Metadata cross-check completed. Ready for final verification.", at("2026-02-14T10:30:00.000Z")),
    ],
    contributors: [
      {
        user: demoEmployee,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 60,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CORRESPONDING").id,
        creditPercent: 40,
        selectorTags: ["CORRESPONDING_AUTHOR"],
      },
      buildSeedExternalContributor({
        name: "Prof. Elena Collaborator",
        affiliation: "University of Warwick",
        scope: "INTERNATIONAL",
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        orcid: "0000-0003-1111-2222",
      }),
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: demoEmployee, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitted with all supporting evidence.", scoreAtAction: 25, createdAt: at("2026-02-13T16:20:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Metadata cross-check completed. Ready for final verification.", scoreAtAction: 25, createdAt: at("2026-02-14T10:30:00.000Z") },
    ],
  });

  const r52StaleRecommendation = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "SUBMITTED",
    title: "Seed R5.2 Stale Recommendation Queue",
    reportingDate: at("2026-01-22T09:30:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-01-20T00:00:00.000Z"),
    evidenceDescription: "Older resubmitted publication kept in queue for stale-review dashboard coverage.",
    evidenceLinks: ["https://example.com/r52/stale-recommendation.pdf"],
    achievementFormData: {
      paperTitle: "Queued Review Age Tracking for Multi-Step Verifiers",
      journalName: "Review Operations Quarterly",
      doi: "10.1000/seed-r52-stale-recommendation",
      indexing: ["Scopus"],
      journalTier: "Q3",
      publicationDate: "2026-01-20",
      pdfLink: "https://example.com/r52/stale-recommendation.pdf",
      coAuthors: buildSeedCoAuthorList(userName(facultyOne)),
      totalAuthors: 1,
    },
    currentVerifierUnitId: eceUnit.id,
    currentVerifierUserId: reviewerUsers.eceHead.id,
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Waiting for recommendation.", at("2026-01-22T09:30:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 100,
        selectorTags: ["FIRST_AUTHOR"],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Waiting for recommendation.", scoreAtAction: 25, createdAt: at("2026-01-22T09:30:00.000Z") },
    ],
  });

  const r52StaleVerification = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: employeeAllocation.id,
    reporter: demoEmployee,
    state: "RECOMMENDED",
    title: "Seed R5.2 Stale Verification Queue",
    reportingDate: at("2026-01-18T11:00:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-01-17T00:00:00.000Z"),
    evidenceDescription: "Recommended publication kept waiting for final verification to test stale-age highlighting.",
    evidenceLinks: ["https://example.com/r52/stale-verification.pdf"],
    achievementFormData: {
      paperTitle: "Final Verification Aging Patterns in Contributor Workflows",
      journalName: "Academic KPI Review Journal",
      doi: "10.1000/seed-r52-stale-verification",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-01-17",
      pdfLink: "https://example.com/r52/stale-verification.pdf",
      coAuthors: buildSeedCoAuthorList(userName(demoEmployee)),
      totalAuthors: 1,
    },
    currentVerifierUnitId: cseUnit.id,
    currentVerifierUserId: reviewerUsers.cseHead.id,
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-01-18T10:10:00.000Z"),
    recommendationNote: "Ready for final verification after source check.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", demoEmployee, "submitted", "Submitted with source proof.", at("2026-01-17T16:20:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Ready for final verification after source check.", at("2026-01-18T10:10:00.000Z")),
    ],
    contributors: [
      {
        user: demoEmployee,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 100,
        selectorTags: ["FIRST_AUTHOR"],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: demoEmployee, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitted with source proof.", scoreAtAction: 25, createdAt: at("2026-01-17T16:20:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Ready for final verification after source check.", scoreAtAction: 25, createdAt: at("2026-01-18T10:10:00.000Z") },
    ],
  });

  const rejectedPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "REJECTED",
    title: "Seed R4.3 Rejected Publication",
    reportingDate: at("2026-01-28T14:00:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-01-27T00:00:00.000Z"),
    evidenceDescription: "Rejected sample to exercise remarks and target-user history.",
    evidenceLinks: ["https://example.com/r43/rejected-publication.pdf"],
    achievementFormData: {
      paperTitle: "Incomplete Evidence Sample",
      journalName: "Audit Edge Cases Quarterly",
      doi: "10.1000/seed-r43-rejected-publication",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-01-27",
      pdfLink: "https://example.com/r43/rejected-publication.pdf",
      coAuthors: buildSeedCoAuthorList(
        userName(facultyOne),
        "Dr. Mohan External",
      ),
      totalAuthors: 2,
    },
    rejectionReason: "Please upload the publisher confirmation letter and corrected DOI.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Submitting the paper for Q2 incentive.", at("2026-01-27T10:00:00.000Z")),
      buildVerificationLogEntry("REJECT", reviewerUsers.eceHead, "rejected", "Please upload the publisher confirmation letter and corrected DOI.", at("2026-01-28T14:00:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 100,
        selectorTags: ["FIRST_AUTHOR"],
      },
      buildSeedExternalContributor({
        name: "Dr. Mohan External",
        affiliation: "Institute of Applied Metrics",
        scope: "NATIONAL",
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
      }),
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitting the paper for Q2 incentive.", scoreAtAction: 25, createdAt: at("2026-01-27T10:00:00.000Z") },
      { action: "REJECTED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Please upload the publisher confirmation letter and corrected DOI.", scoreAtAction: 25, createdAt: at("2026-01-28T14:00:00.000Z") },
    ],
  });
  const draftRewardsPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: employeeAllocation.id,
    reporter: demoEmployee,
    state: "VERIFIED",
    title: "Seed R4.3 Draft Rewards Publication",
    reportingDate: at("2026-03-01T09:30:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-25T00:00:00.000Z"),
    evidenceDescription: "Verified publication with draft rewards for reward-ops testing.",
    evidenceLinks: ["https://example.com/r43/draft-rewards-publication.pdf"],
    achievementFormData: {
      paperTitle: "Draft Reward State Validation Paper",
      journalName: "Systems Verification Journal",
      doi: "10.1000/seed-r43-draft-rewards",
      indexing: ["Scopus"],
      journalTier: "Q1",
      publicationDate: "2026-02-25",
      pdfLink: "https://example.com/r43/draft-rewards-publication.pdf",
      coAuthors: buildSeedCoAuthorList(
        userName(demoEmployee),
        userName(facultyTwo),
        "Dr. Arjun External",
      ),
      totalAuthors: 3,
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-02-27T11:20:00.000Z"),
    recommendationNote: "Recommended after indexing and DOI validation.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-01T09:30:00.000Z"),
    verificationNote: "Verified and waiting for reward release preparation.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", demoEmployee, "submitted", "Paper submitted for seed reward draft case.", at("2026-02-26T09:00:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Recommended after indexing and DOI validation.", at("2026-02-27T11:20:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified and waiting for reward release preparation.", at("2026-03-01T09:30:00.000Z")),
    ],
    contributors: [
      {
        user: demoEmployee,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
      buildSeedExternalContributor({
        name: "Dr. Arjun External",
        affiliation: "Imperial College London",
        scope: "INTERNATIONAL",
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        note: "Excluded from reward to keep seed payout math stable.",
      }),
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: demoEmployee, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Paper submitted for seed reward draft case.", scoreAtAction: 25, createdAt: at("2026-02-26T09:00:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Recommended after indexing and DOI validation.", scoreAtAction: 25, createdAt: at("2026-02-27T11:20:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Verified and waiting for reward release preparation.", scoreAtAction: 25, createdAt: at("2026-03-01T09:30:00.000Z") },
    ],
  });

  const pendingRewardsPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "VERIFIED",
    title: "Seed R4.3 Pending Release Publication",
    reportingDate: at("2026-03-02T10:15:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-28T00:00:00.000Z"),
    evidenceDescription: "Verified publication whose rewards are queued for release.",
    evidenceLinks: ["https://example.com/r43/pending-release-publication.pdf"],
    achievementFormData: {
      paperTitle: "Queued Reward Batch Example",
      journalName: "Queue Management Review",
      doi: "10.1000/seed-r43-pending-release",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-02-28",
      pdfLink: "https://example.com/r43/pending-release-publication.pdf",
      coAuthors: buildSeedCoAuthorList(
        userName(facultyOne),
        userName(facultyTwo),
        "Ms. Asha External",
      ),
      totalAuthors: 3,
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-03-01T12:10:00.000Z"),
    recommendationNote: "Recommended for Q2 incentive processing.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-02T10:15:00.000Z"),
    verificationNote: "Verified and moved to the pending release batch.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Submitted for pending reward batch scenario.", at("2026-02-28T09:00:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Recommended for Q2 incentive processing.", at("2026-03-01T12:10:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified and moved to the pending release batch.", at("2026-03-02T10:15:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
      buildSeedExternalContributor({
        name: "Ms. Asha External",
        affiliation: "Independent Research Lab",
        scope: "NATIONAL",
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
      }),
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitted for pending reward batch scenario.", scoreAtAction: 25, createdAt: at("2026-02-28T09:00:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Recommended for Q2 incentive processing.", scoreAtAction: 25, createdAt: at("2026-03-01T12:10:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Verified and moved to the pending release batch.", scoreAtAction: 25, createdAt: at("2026-03-02T10:15:00.000Z") },
    ],
  });

  const releasedPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: employeeAllocation.id,
    reporter: demoEmployee,
    state: "VERIFIED",
    title: "Seed R4.3 Released Publication",
    reportingDate: at("2026-03-03T12:45:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-03-01T00:00:00.000Z"),
    evidenceDescription: "Single-author released publication to exercise FULL_TO_SINGLE reward fallback.",
    evidenceLinks: ["https://example.com/r43/released-publication.pdf"],
    achievementFormData: {
      paperTitle: "Single Author Reward Release Example",
      journalName: "UGC Care Demonstration Journal",
      doi: "10.1000/seed-r43-released",
      indexing: ["UGC CARE List"],
      journalTier: "UGC_CARE",
      publicationDate: "2026-03-01",
      pdfLink: "https://example.com/r43/released-publication.pdf",
      coAuthors: buildSeedCoAuthorList(userName(demoEmployee)),
      totalAuthors: 1,
      ugcCareReference: "UGC-CARE-2026-001",
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-03-02T16:20:00.000Z"),
    recommendationNote: "Single-author UGC paper cleared for release.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-03T12:45:00.000Z"),
    verificationNote: "Verified and released as the single eligible contributor case.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", demoEmployee, "submitted", "Single-author UGC paper submitted.", at("2026-03-01T08:45:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Single-author UGC paper cleared for release.", at("2026-03-02T16:20:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified and released as the single eligible contributor case.", at("2026-03-03T12:45:00.000Z")),
    ],
    contributors: [
      {
        user: demoEmployee,
        contributorRoleId: roleMap.get("CORRESPONDING").id,
        creditPercent: 100,
        selectorTags: ["CORRESPONDING_AUTHOR"],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: demoEmployee, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Single-author UGC paper submitted.", scoreAtAction: 25, createdAt: at("2026-03-01T08:45:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Single-author UGC paper cleared for release.", scoreAtAction: 25, createdAt: at("2026-03-02T16:20:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Verified and released as the single eligible contributor case.", scoreAtAction: 25, createdAt: at("2026-03-03T12:45:00.000Z") },
    ],
  });

  const correctedPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "VERIFIED",
    title: "Seed R4.3 Corrected Publication",
    reportingDate: at("2026-03-06T13:10:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-03-02T00:00:00.000Z"),
    evidenceDescription: "Corrected after publisher reclassified the journal from Q1 to Q2.",
    evidenceLinks: ["https://example.com/r43/corrected-publication.pdf"],
    achievementFormData: {
      paperTitle: "Correction and Reward Recalculation Example",
      journalName: "Publisher Update Journal",
      doi: "10.1000/seed-r43-corrected",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-03-02",
      pdfLink: "https://example.com/r43/corrected-publication.pdf",
      coAuthors: buildSeedCoAuthorList(
        userName(facultyOne),
        userName(facultyTwo),
        "Prof. Mei External",
      ),
      totalAuthors: 3,
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-03-04T11:45:00.000Z"),
    recommendationNote: "Originally cleared as Q1; corrected later after publisher update.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-06T13:10:00.000Z"),
    verificationNote: "Verified with corrected tier after published errata.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Submitted before the publisher errata was issued.", at("2026-03-03T10:15:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Originally cleared as Q1; corrected later after publisher update.", at("2026-03-04T11:45:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified with corrected tier after published errata.", at("2026-03-06T13:10:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
      buildSeedExternalContributor({
        name: "Prof. Mei External",
        affiliation: "Nanyang Technological University",
        scope: "INTERNATIONAL",
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        orcid: "0000-0001-2222-3333",
      }),
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitted before the publisher errata was issued.", scoreAtAction: 25, createdAt: at("2026-03-03T10:15:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Originally cleared as Q1; corrected later after publisher update.", scoreAtAction: 25, createdAt: at("2026-03-04T11:45:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Initially verified and released before the publisher corrected the tier.", scoreAtAction: 25, createdAt: at("2026-03-06T13:10:00.000Z") },
      {
        action: "CORRECTED",
        actor: owner,
        actorRole: "Tenant Owner",
        actorUnitName: cseUnit.name,
        note: "Publisher errata reclassified the journal from Q1 to Q2.",
        scoreAtAction: 25,
        metadata: {
          changedFieldKeys: ["journalTier", "evidenceDescription"],
          beforeAfterSummary: {
            journalTier: { before: "Q1", after: "Q2" },
            evidenceDescription: {
              before: "Initially verified before the publisher correction.",
              after: "Corrected after publisher reclassified the journal from Q1 to Q2.",
            },
          },
        },
        createdAt: at("2026-03-15T11:00:00.000Z"),
      },
      {
        action: "REWARD_REVOKED",
        actor: owner,
        actorRole: "Tenant Owner",
        actorUnitName: cseUnit.name,
        note: "Earlier released Q1 incentive revoked because the tier changed.",
        metadata: { oldState: "RELEASED", newState: "REVOKED" },
        createdAt: at("2026-03-15T11:30:00.000Z"),
      },
      {
        action: "REWARD_RECALCULATED",
        actor: owner,
        actorRole: "Tenant Owner",
        actorUnitName: cseUnit.name,
        note: "Replacement Q2 reward draft generated after correction.",
        metadata: { changedFieldKeys: ["journalTier"], oldState: "RELEASED", newState: "DRAFT" },
        createdAt: at("2026-03-15T11:45:00.000Z"),
      },
    ],
  });

  await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: draftRewardsPublication.achievement,
    contributors: draftRewardsPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "draft-rewards",
    tierCode: "Q1",
    stateByComponentCode: { Q1_MONETARY: "DRAFT", Q1_LEAVE_POINTS: "DRAFT" },
  });

  const pendingRewardRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: pendingRewardsPublication.achievement,
    contributors: pendingRewardsPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "pending-rewards",
    tierCode: "Q2",
    stateByComponentCode: { Q2_MONETARY: "PENDING", Q2_LEAVE_POINTS: "PENDING" },
    stateNoteByComponentCode: {
      Q2_MONETARY: "Queued for March incentive release batch.",
      Q2_LEAVE_POINTS: "Queued for March incentive release batch.",
    },
  });

  const releasedRewardRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: releasedPublication.achievement,
    contributors: releasedPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "released-rewards",
    tierCode: "UGC_CARE",
    stateByComponentCode: {
      UGC_CARE_MONETARY: "RELEASED",
      UGC_CARE_LEAVE_POINTS: "RELEASED",
    },
    stateNoteByComponentCode: {
      UGC_CARE_MONETARY: "Released in seeded disbursement run.",
      UGC_CARE_LEAVE_POINTS: "Released in seeded disbursement run.",
    },
    releaseReferenceByComponentCode: {
      UGC_CARE_MONETARY: "SEED-R43-REL-UGC-001",
      UGC_CARE_LEAVE_POINTS: "SEED-R43-REL-UGC-001",
    },
  });

  const revokedOriginalRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: correctedPublication.achievement,
    contributors: correctedPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "corrected-original",
    tierCode: "Q1",
    stateByComponentCode: { Q1_MONETARY: "REVOKED", Q1_LEAVE_POINTS: "REVOKED" },
    stateNoteByComponentCode: {
      Q1_MONETARY: "Originally released before the journal was reclassified.",
      Q1_LEAVE_POINTS: "Originally released before the journal was reclassified.",
    },
    releaseReferenceByComponentCode: {
      Q1_MONETARY: "SEED-R43-REL-Q1-ERRATA",
      Q1_LEAVE_POINTS: "SEED-R43-REL-Q1-ERRATA",
    },
    revokedReasonByComponentCode: {
      Q1_MONETARY: "Publisher errata changed the eligible tier from Q1 to Q2.",
      Q1_LEAVE_POINTS: "Publisher errata changed the eligible tier from Q1 to Q2.",
    },
  });

  const supersedesByComponentCode = {
    Q2_MONETARY: new Map(),
    Q2_LEAVE_POINTS: new Map(),
  };
  for (const [key, reward] of revokedOriginalRows.entries()) {
    if (key.startsWith("Q1_MONETARY:")) {
      supersedesByComponentCode.Q2_MONETARY.set(key.split(":")[1], reward.id);
    } else if (key.startsWith("Q1_LEAVE_POINTS:")) {
      supersedesByComponentCode.Q2_LEAVE_POINTS.set(key.split(":")[1], reward.id);
    }
  }

  const replacementRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: correctedPublication.achievement,
    contributors: correctedPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "corrected-replacement",
    tierCode: "Q2",
    stateByComponentCode: { Q2_MONETARY: "DRAFT", Q2_LEAVE_POINTS: "DRAFT" },
    stateNoteByComponentCode: {
      Q2_MONETARY: "Replacement reward awaiting release after correction.",
      Q2_LEAVE_POINTS: "Replacement reward awaiting release after correction.",
    },
    supersedesByComponentCode,
    replacementMode: true,
  });

  const normalizedOriginalMap = new Map();
  for (const [key, value] of revokedOriginalRows.entries()) {
    if (key.startsWith("Q1_MONETARY:")) {
      normalizedOriginalMap.set(`Q2_MONETARY:${key.split(":")[1]}`, value);
    } else if (key.startsWith("Q1_LEAVE_POINTS:")) {
      normalizedOriginalMap.set(`Q2_LEAVE_POINTS:${key.split(":")[1]}`, value);
    }
  }
  await linkReplacementRewards({
    revokedRows: normalizedOriginalMap,
    replacementRows,
  });

  const rewardNotificationRows = [];
  for (const [, reward] of [...pendingRewardRows.entries()].filter(([key]) => key.startsWith("Q2_MONETARY:"))) {
    if (!reward.contributorUserId) continue;
    rewardNotificationRows.push({
      tenantId: tenant.id,
      userId: reward.contributorUserId,
      type: "REWARD_PENDING",
      eventKey: makeSeedEventKey(`reward-pending:${reward.contributorUserId}`),
      title: "Reward marked pending",
      message: `${R43_PUBLICATION_KPI_TITLE} reward is pending release.`,
      entityType: "ContributorReward",
      entityId: reward.id,
      linkUrl: "/tenant-admin/kra-kpi",
      createdAt: at("2026-03-04T09:20:00.000Z"),
    });
  }
  for (const [, reward] of [...releasedRewardRows.entries()].filter(([key]) => key.startsWith("UGC_CARE_MONETARY:"))) {
    if (!reward.contributorUserId) continue;
    rewardNotificationRows.push({
      tenantId: tenant.id,
      userId: reward.contributorUserId,
      type: "REWARD_RELEASED",
      eventKey: makeSeedEventKey(`reward-released:${reward.contributorUserId}`),
      title: "Reward released",
      message: `${R43_PUBLICATION_KPI_TITLE} reward has been released.`,
      entityType: "ContributorReward",
      entityId: reward.id,
      linkUrl: "/tenant-admin/kra-kpi",
      createdAt: at("2026-03-05T10:05:00.000Z"),
    });
  }
  for (const [, reward] of [...revokedOriginalRows.entries()].filter(([key]) => key.startsWith("Q1_MONETARY:"))) {
    if (!reward.contributorUserId) continue;
    rewardNotificationRows.push({
      tenantId: tenant.id,
      userId: reward.contributorUserId,
      type: "REWARD_REVOKED",
      eventKey: makeSeedEventKey(`reward-revoked:${reward.contributorUserId}`),
      title: "Reward revoked",
      message: `${R43_PUBLICATION_KPI_TITLE} reward was revoked after a verified correction.`,
      entityType: "ContributorReward",
      entityId: reward.id,
      linkUrl: "/tenant-admin/kra-kpi",
      createdAt: at("2026-03-15T11:35:00.000Z"),
    });
  }

  await createSeedNotifications([
    {
      tenantId: tenant.id,
      userId: reviewerUsers.eceHead.id,
      type: "ACHIEVEMENT_SUBMITTED",
      eventKey: makeSeedEventKey("achievement-submitted:pending-recommendation"),
      title: "Achievement submitted for review",
      message: `${userName(facultyOne)} resubmitted a publication that needs recommendation.`,
      entityType: "Achievement",
      entityId: pendingRecommendation.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-02-12T09:01:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: reviewerUsers.cseHead.id,
      type: "ACHIEVEMENT_RECOMMENDED",
      eventKey: makeSeedEventKey("achievement-recommended:pending-verification"),
      title: "Achievement recommended for verification",
      message: `${userName(demoEmployee)} has a publication waiting for final verification.`,
      entityType: "Achievement",
      entityId: pendingVerification.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-02-14T10:35:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: reviewerUsers.eceHead.id,
      type: "ACHIEVEMENT_SUBMITTED",
      eventKey: makeSeedEventKey("achievement-submitted:r52-stale-recommendation"),
      title: "Achievement submitted for recommendation",
      message: `${userName(facultyOne)} has an older publication still waiting in the recommendation queue.`,
      entityType: "Achievement",
      entityId: r52StaleRecommendation.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-01-22T09:31:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: reviewerUsers.cseHead.id,
      type: "ACHIEVEMENT_RECOMMENDED",
      eventKey: makeSeedEventKey("achievement-recommended:r52-stale-verification"),
      title: "Achievement waiting final verification",
      message: `${userName(demoEmployee)} still has a recommendation waiting in the final verification queue.`,
      entityType: "Achievement",
      entityId: r52StaleVerification.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-01-18T10:15:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: facultyOne.id,
      type: "ACHIEVEMENT_REJECTED",
      eventKey: makeSeedEventKey("achievement-rejected:rejected-publication"),
      title: "Achievement rejected",
      message: "Your publication was rejected. Please upload the publisher confirmation letter and corrected DOI.",
      entityType: "Achievement",
      entityId: rejectedPublication.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-01-28T14:05:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: facultyOne.id,
      type: "ACHIEVEMENT_CORRECTED",
      eventKey: makeSeedEventKey("achievement-corrected:corrected-publication"),
      title: "Verified achievement corrected",
      message: "A verified publication was corrected after the journal tier changed from Q1 to Q2.",
      entityType: "Achievement",
      entityId: correctedPublication.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-03-15T11:46:00.000Z"),
    },
    ...rewardNotificationRows,
  ]);

  return {
    kpi,
    allocations: [parentAllocation, facultyAllocation, employeeAllocation],
    achievements: [
      pendingRecommendation.achievement,
      pendingVerification.achievement,
      r52StaleRecommendation.achievement,
      r52StaleVerification.achievement,
      rejectedPublication.achievement,
      draftRewardsPublication.achievement,
      pendingRewardsPublication.achievement,
      releasedPublication.achievement,
      correctedPublication.achievement,
    ],
  };
}

const ACCREDITATION_FRAMEWORK_SEEDS = [
  {
    code: "NAAC",
    name: "National Assessment and Accreditation Council",
    country: "IN",
    description: "Starter NAAC framework seed for demo and regression environments.",
    versionCode: "2024",
    versionName: "NAAC 2024",
    scoreBase: 1000,
    profiles: [
      {
        code: "UNIVERSITY",
        name: "University",
        isDefault: true,
      },
    ],
    criteria: [
      { code: "CR1", title: "Curricular Aspects", isLeaf: false, sortOrder: 1 },
      { code: "CR1.1", parentCode: "CR1", title: "Curricular Planning and Implementation", isLeaf: true, maxScore: 20, sortOrder: 1 },
      { code: "CR1.2", parentCode: "CR1", title: "Academic Flexibility", isLeaf: true, maxScore: 15, sortOrder: 2 },
      { code: "CR2", title: "Teaching-Learning and Evaluation", isLeaf: false, sortOrder: 2 },
      { code: "CR2.1", parentCode: "CR2", title: "Student Enrolment and Profile", isLeaf: true, maxScore: 30, sortOrder: 1 },
      { code: "CR2.2", parentCode: "CR2", title: "Student Satisfaction and Outcomes", isLeaf: true, maxScore: 25, sortOrder: 2 },
    ],
    weights: {
      UNIVERSITY: [
        { blockCode: "CR1.1", maxScore: 20, weightPercent: 22 },
        { blockCode: "CR1.2", maxScore: 15, weightPercent: 18 },
        { blockCode: "CR2.1", maxScore: 30, weightPercent: 32 },
        { blockCode: "CR2.2", maxScore: 25, weightPercent: 28 },
      ],
    },
    gradeBands: [
      { gradeLabel: "A++", scoreMin: 3.51, scoreMax: 4, outcome: "Top grade", sortOrder: 1 },
      { gradeLabel: "A+", scoreMin: 3.26, scoreMax: 3.5, outcome: "Excellent", sortOrder: 2 },
      { gradeLabel: "A", scoreMin: 3.01, scoreMax: 3.25, outcome: "Very good", sortOrder: 3 },
      { gradeLabel: "B++", scoreMin: 2.76, scoreMax: 3, outcome: "Good", sortOrder: 4 },
    ],
    thresholdRules: [
      {
        thresholdType: "MIN_OVERALL_SCORE",
        minValue: 2.0,
        outcome: "Eligible for accreditation consideration",
        description: "Starter institutional threshold.",
      },
    ],
  },
  {
    code: "NIRF",
    name: "National Institutional Ranking Framework",
    country: "IN",
    description: "Starter NIRF framework seed for demo and regression environments.",
    versionCode: "2024",
    versionName: "NIRF 2024",
    scoreBase: 100,
    profiles: [
      {
        code: "ENGINEERING",
        name: "Engineering",
        isDefault: true,
      },
    ],
    criteria: [
      { code: "TLR", title: "Teaching, Learning and Resources", isLeaf: false, sortOrder: 1 },
      { code: "TLR-1", parentCode: "TLR", title: "Faculty Student Ratio", isLeaf: true, maxScore: 20, sortOrder: 1 },
      { code: "TLR-2", parentCode: "TLR", title: "Faculty Qualification and Experience", isLeaf: true, maxScore: 20, sortOrder: 2 },
      { code: "RPC", title: "Research and Professional Practice", isLeaf: false, sortOrder: 2 },
      { code: "RPC-1", parentCode: "RPC", title: "Publications and Citations", isLeaf: true, maxScore: 30, sortOrder: 1 },
      { code: "RPC-2", parentCode: "RPC", title: "Patents and Projects", isLeaf: true, maxScore: 15, sortOrder: 2 },
      { code: "GO", title: "Graduation Outcomes", isLeaf: false, sortOrder: 3 },
      { code: "GO-1", parentCode: "GO", title: "Placement and Higher Studies", isLeaf: true, maxScore: 15, sortOrder: 1 },
    ],
    weights: {
      ENGINEERING: [
        { blockCode: "TLR-1", maxScore: 20, weightPercent: 20 },
        { blockCode: "TLR-2", maxScore: 20, weightPercent: 20 },
        { blockCode: "RPC-1", maxScore: 30, weightPercent: 30 },
        { blockCode: "RPC-2", maxScore: 15, weightPercent: 15 },
        { blockCode: "GO-1", maxScore: 15, weightPercent: 15 },
      ],
    },
    gradeBands: [
      { gradeLabel: "RANK_1_50", scoreMin: 70, scoreMax: 100, outcome: "Rank band 1-50", sortOrder: 1 },
      { gradeLabel: "RANK_51_100", scoreMin: 55, scoreMax: 69.99, outcome: "Rank band 51-100", sortOrder: 2 },
    ],
    thresholdRules: [
      {
        thresholdType: "MIN_RESEARCH_SCORE",
        minValue: 15,
        outcome: "Research section must meet baseline",
        description: "Starter NIRF research threshold.",
      },
    ],
  },
];

async function ensureAccreditationSeeds({ superadmin, tenant }) {
  await prisma.tenantServiceEntitlement.upsert({
    where: {
      tenantId_serviceCode: {
        tenantId: tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
      },
    },
    update: {
      status: TenantServiceEntitlementStatus.ENABLED,
      enabledAt: new Date(),
      enabledByUserId: superadmin.id,
      disabledAt: null,
      disabledByUserId: null,
      notes: "Enabled by seed for demo tenant access.",
    },
    create: {
      tenantId: tenant.id,
      serviceCode: TenantServiceCode.ACCREDITATION,
      status: TenantServiceEntitlementStatus.ENABLED,
      enabledAt: new Date(),
      enabledByUserId: superadmin.id,
      notes: "Enabled by seed for demo tenant access.",
    },
  });

  for (const framework of ACCREDITATION_FRAMEWORK_SEEDS) {
    const body = await prisma.accreditationBody.upsert({
      where: {
        tenantId_code: {
          tenantId: null,
          code: framework.code,
        },
      },
      update: {
        scope: AccreditationScope.GLOBAL,
        tenantId: null,
        name: framework.name,
        country: framework.country,
        description: framework.description,
        isActive: true,
        createdByUserId: superadmin.id,
      },
      create: {
        scope: AccreditationScope.GLOBAL,
        tenantId: null,
        code: framework.code,
        name: framework.name,
        country: framework.country,
        description: framework.description,
        isActive: true,
        createdByUserId: superadmin.id,
      },
    });

    const version = await prisma.accreditationBodyVersion.upsert({
      where: {
        bodyId_versionCode: {
          bodyId: body.id,
          versionCode: framework.versionCode,
        },
      },
      update: {
        versionName: framework.versionName,
        scoreBase: framework.scoreBase,
        isActive: true,
      },
      create: {
        bodyId: body.id,
        versionCode: framework.versionCode,
        versionName: framework.versionName,
        scoreBase: framework.scoreBase,
        isActive: true,
      },
    });

    const profileMap = new Map();
    for (const profileSeed of framework.profiles) {
      const profile = await prisma.accreditationProfile.upsert({
        where: {
          versionId_profileCode: {
            versionId: version.id,
            profileCode: profileSeed.code,
          },
        },
        update: {
          profileName: profileSeed.name,
          isDefault: profileSeed.isDefault,
        },
        create: {
          versionId: version.id,
          profileCode: profileSeed.code,
          profileName: profileSeed.name,
          isDefault: profileSeed.isDefault,
        },
      });
      profileMap.set(profileSeed.code, profile);
    }

    const blockMap = new Map();
    for (const criterionSeed of framework.criteria.filter((criterion) => !criterion.parentCode)) {
      const block = await prisma.criterionBlock.upsert({
        where: {
          versionId_blockCode: {
            versionId: version.id,
            blockCode: criterionSeed.code,
          },
        },
        update: {
          parentId: null,
          blockCode: criterionSeed.code,
          lineageKey: criterionSeed.code,
          blockType: criterionSeed.isLeaf ? "METRIC" : "GROUP",
          isSectionRoot: true,
          title: criterionSeed.title,
          dataType: CriterionDataType.QUANTITATIVE,
          maxScore: criterionSeed.maxScore ?? null,
          sortOrder: criterionSeed.sortOrder,
          depth: 0,
          isLeaf: criterionSeed.isLeaf,
          isActive: true,
        },
        create: {
          versionId: version.id,
          parentId: null,
          blockCode: criterionSeed.code,
          lineageKey: criterionSeed.code,
          blockType: criterionSeed.isLeaf ? "METRIC" : "GROUP",
          isSectionRoot: true,
          title: criterionSeed.title,
          dataType: CriterionDataType.QUANTITATIVE,
          maxScore: criterionSeed.maxScore ?? null,
          sortOrder: criterionSeed.sortOrder,
          depth: 0,
          isLeaf: criterionSeed.isLeaf,
          isActive: true,
        },
      });
      blockMap.set(criterionSeed.code, block);
    }

    for (const criterionSeed of framework.criteria.filter((criterion) => criterion.parentCode)) {
      const parent = blockMap.get(criterionSeed.parentCode);
      const depth = parent ? parent.depth + 1 : 0;
      const block = await prisma.criterionBlock.upsert({
        where: {
          versionId_blockCode: {
            versionId: version.id,
            blockCode: criterionSeed.code,
          },
        },
        update: {
          parentId: parent?.id ?? null,
          blockCode: criterionSeed.code,
          lineageKey: criterionSeed.code,
          blockType: criterionSeed.isLeaf ? "METRIC" : "GROUP",
          isSectionRoot: depth === 0,
          title: criterionSeed.title,
          dataType: CriterionDataType.QUANTITATIVE,
          maxScore: criterionSeed.maxScore ?? null,
          sortOrder: criterionSeed.sortOrder,
          depth,
          isLeaf: criterionSeed.isLeaf,
          isActive: true,
        },
        create: {
          versionId: version.id,
          parentId: parent?.id ?? null,
          blockCode: criterionSeed.code,
          lineageKey: criterionSeed.code,
          blockType: criterionSeed.isLeaf ? "METRIC" : "GROUP",
          isSectionRoot: depth === 0,
          title: criterionSeed.title,
          dataType: CriterionDataType.QUANTITATIVE,
          maxScore: criterionSeed.maxScore ?? null,
          sortOrder: criterionSeed.sortOrder,
          depth,
          isLeaf: criterionSeed.isLeaf,
          isActive: true,
        },
      });
      blockMap.set(criterionSeed.code, block);
    }

    for (const [profileCode, weights] of Object.entries(framework.weights)) {
      const profile = profileMap.get(profileCode);
      if (!profile) continue;

      await prisma.accreditationProfileWeight.deleteMany({
        where: { profileId: profile.id },
      });

      if (weights.length > 0) {
        await prisma.accreditationProfileWeight.createMany({
          data: weights.map((weight) => ({
            profileId: profile.id,
            blockId: blockMap.get(weight.blockCode).id,
            maxScore: weight.maxScore,
            weightPercent: weight.weightPercent,
          })),
        });
      }
    }

    await prisma.accreditationGradeBand.deleteMany({ where: { versionId: version.id } });
    await prisma.accreditationThresholdRule.deleteMany({ where: { versionId: version.id } });

    if (framework.gradeBands.length > 0) {
      await prisma.accreditationGradeBand.createMany({
        data: framework.gradeBands.map((band) => ({
          versionId: version.id,
          gradeLabel: band.gradeLabel,
          scoreMin: band.scoreMin,
          scoreMax: band.scoreMax,
          outcome: band.outcome,
          sortOrder: band.sortOrder,
        })),
      });
    }

    if (framework.thresholdRules.length > 0) {
      await prisma.accreditationThresholdRule.createMany({
        data: framework.thresholdRules.map((rule) => ({
          versionId: version.id,
          thresholdType: rule.thresholdType,
          minValue: rule.minValue,
          outcome: rule.outcome,
          description: rule.description,
        })),
      });
    }
  }
}

async function main() {
  const superadminEmail =
    (process.env.SUPERADMIN_EMAIL ?? "superadmin@local.test").trim().toLowerCase();

  const superadmin = await upsertUser({
    email: superadminEmail,
    firstName: process.env.SUPERADMIN_FIRST_NAME ?? "Platform",
    lastName: process.env.SUPERADMIN_LAST_NAME ?? "Admin",
    password: process.env.SUPERADMIN_PASSWORD ?? "Admin@12345",
    isSuperadmin: true,
  });

  const owner = await upsertUser({
    email: "owner@demo-university.local.test",
    firstName: "Demo",
    lastName: "Owner",
    password: DEMO_PASSWORD,
  });
  const admin = await upsertUser({
    email: "admin@demo-university.local.test",
    firstName: "Demo",
    lastName: "Admin",
    password: DEMO_PASSWORD,
  });
  const facultyOne = await upsertUser({
    email: "faculty1@demo-university.local.test",
    firstName: "Anita",
    lastName: "Faculty",
    password: DEMO_PASSWORD,
  });
  const facultyTwo = await upsertUser({
    email: "faculty2@demo-university.local.test",
    firstName: "Bharat",
    lastName: "Faculty",
    password: DEMO_PASSWORD,
  });
  const demoEmployee = await upsertUser({
    email: "employee@demo-university.local.test",
    firstName: "Demo",
    lastName: "Employee",
    password: DEMO_PASSWORD,
  });

  const tenant = await prisma.tenant.upsert({
    where: {
      code: "DEMO_UNIV",
    },
    update: {
      name: "Demo University",
      legalOrganizationName: "Demo University",
      organizationType: "UNIVERSITY",
      primaryDomains: ["demo-university.local.test"],
      subscriptionPlan: "ENTERPRISE",
      lifecycleState: "ACTIVE",
      ownerUserId: owner.id,
      createdByUserId: superadmin.id,
    },
    create: {
      code: "DEMO_UNIV",
      name: "Demo University",
      legalOrganizationName: "Demo University",
      organizationType: "UNIVERSITY",
      primaryDomains: ["demo-university.local.test"],
      subscriptionPlan: "ENTERPRISE",
      lifecycleState: "ACTIVE",
      ownerUserId: owner.id,
      createdByUserId: superadmin.id,
    },
  });

  await prisma.tenantPolicy.upsert({
    where: {
      tenantId: tenant.id,
    },
    update: {},
    create: {
      tenantId: tenant.id,
    },
  });

  await ensureAccreditationSeeds({
    superadmin,
    tenant,
  });

  await ensureMembership({
    tenantId: tenant.id,
    userId: owner.id,
    role: "TENANT_OWNER",
    createdByUserId: superadmin.id,
    employeeId: "EMP-OWNER-001",
    designation: "Tenant Owner",
  });
  await ensureMembership({
    tenantId: tenant.id,
    userId: admin.id,
    role: "TENANT_ADMIN",
    createdByUserId: owner.id,
    employeeId: "EMP-ADMIN-001",
    designation: "Tenant Admin",
  });
  await ensureMembership({
    tenantId: tenant.id,
    userId: facultyOne.id,
    role: "TENANT_USER",
    createdByUserId: owner.id,
    employeeId: "EMP-FAC-001",
    designation: "Professor",
  });
  await ensureMembership({
    tenantId: tenant.id,
    userId: facultyTwo.id,
    role: "TENANT_USER",
    createdByUserId: owner.id,
    employeeId: "EMP-FAC-002",
    designation: "Associate Professor",
  });

  const { rootUnit, cseUnit, eceUnit } = await ensurePublishedStructure(tenant.id, owner.id);
  if (!rootUnit || !cseUnit || !eceUnit) {
    throw new Error("Seed structure did not create the UNIV/CSE/ECE units.");
  }

  await ensureMembership({
    tenantId: tenant.id,
    userId: demoEmployee.id,
    role: "TENANT_USER",
    createdByUserId: owner.id,
    employeeId: "EMP-CSE-003",
    designation: "Assistant Professor",
  });

  await ensurePrimaryUnitAssignment({
    versionId: cseUnit.versionId,
    unitId: cseUnit.id,
    userId: demoEmployee.id,
  });
  await ensurePrimaryUnitAssignment({
    versionId: cseUnit.versionId,
    unitId: cseUnit.id,
    userId: facultyOne.id,
  });
  await ensurePrimaryUnitAssignment({
    versionId: eceUnit.versionId,
    unitId: eceUnit.id,
    userId: facultyTwo.id,
  });

  await ensureCategory({
    tenantId: null,
    scope: "GLOBAL",
    categoryKey: "RESEARCH",
    displayLabel: "Research",
    description: "Global research-focused category.",
    colorHex: "#2563EB",
    createdByUserId: superadmin.id,
  });

  const tenantCategory = await ensureCategory({
    tenantId: tenant.id,
    scope: "TENANT",
    categoryKey: "ACADEMICS",
    displayLabel: "Academics",
    description: "Tenant-specific academic outcomes.",
    colorHex: "#0F766E",
    createdByUserId: owner.id,
  });

  const demoData = await ensureDemoDataset(
    tenant,
    owner,
    facultyOne,
    facultyTwo,
    demoEmployee,
    cseUnit,
    tenantCategory,
  );
  const reviewerUsers = await ensureReviewerUsers({
    tenant,
    owner,
    cseUnit,
    eceUnit,
  });
  const supportUsers = await ensureDashboardSupportUsers({
    tenant,
    owner,
    admin,
    rootUnit,
    cseUnit,
    eceUnit,
    reviewerUsers,
    facultyOne,
    facultyTwo,
    demoEmployee,
  });
  const dashboardSeed = await ensureDashboardDataset({
    tenant,
    owner,
    tenantCategory,
    rootUnit,
    cseUnit,
    eceUnit,
    reviewerUsers,
    supportUsers,
    admin,
    facultyOne,
    facultyTwo,
    demoEmployee,
  });
  const r43Data = await ensureR43InterfaceSeed({
    tenant,
    owner,
    facultyOne,
    facultyTwo,
    demoEmployee,
    cseUnit,
    eceUnit,
    period: demoData.period,
    kra: demoData.kra,
    reviewerUsers,
  });

  console.log("Seed completed:", {
    database: DATABASE_URL,
    superadmin: {
      email: superadmin.officialEmail,
      password: process.env.SUPERADMIN_PASSWORD ?? "Admin@12345",
    },
    demoTenant: {
      code: tenant.code,
      ownerEmail: owner.officialEmail,
      adminEmail: admin.officialEmail,
      demoPassword: DEMO_PASSWORD,
    },
    demoEmployee: {
      email: demoEmployee.officialEmail,
      employeeId: "EMP-CSE-003",
      primaryUnitCode: cseUnit.code,
      allocationId: demoData.demoEmployeeAllocation.id,
      allocationTarget: demoData.demoEmployeeAllocation.targetValue,
      demoPassword: DEMO_PASSWORD,
    },
    reviewers: {
      provostEmail: supportUsers.provost.officialEmail,
      cseHeadEmail: reviewerUsers.cseHead.officialEmail,
      eceHeadEmail: reviewerUsers.eceHead.officialEmail,
      eceStaffEmail: supportUsers.eceStaff.officialEmail,
      demoPassword: DEMO_PASSWORD,
    },
    seededPeriodCode: demoData.period.code,
    seededKra: demoData.kra.title,
    seededKpi: demoData.kpi.title,
    dashboardSeed: {
      periodCodes: dashboardSeed.periods.map((row) => row.period.code),
      kraTitles: dashboardSeed.periods.map((row) => row.kra.title),
      kpiTopicsMirroredAcrossPeriods: dashboardSeed.kpiTopicCount,
      totalDashboardKpisSeeded: dashboardSeed.periods.reduce((sum, row) => sum + row.kpis.length, 0),
      totalDashboardAchievementsSeeded: dashboardSeed.periods.reduce(
        (sum, row) => sum + row.achievements.length,
        0,
      ),
    },
    allocationCount: demoData.allocations.length,
    r43WorkflowSeed: {
      kpiTitle: r43Data.kpi.title,
      seededAchievements: r43Data.achievements.length,
      seededAllocations: r43Data.allocations.length,
      statesCovered: ["SUBMITTED", "RECOMMENDED", "REJECTED", "VERIFIED"],
      rewardStatesCovered: ["DRAFT", "PENDING", "RELEASED", "REVOKED"],
      scenarios: [
        "Pending recommendation with resubmission trail",
        "Pending verification",
        "Rejected with remarks",
        "Verified with draft rewards",
        "Verified with pending rewards",
        "Released single-author reward",
        "Corrected verified achievement with revoke-and-replace rewards",
      ],
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
