import "dotenv/config";
import { hash } from "bcryptjs";
import type {
  AchievementState,
  AssessmentPeriodState,
  ContributorType,
  ExternalContributorScope,
  GradeValue,
  KpiFlowStatus,
  KpiMeasurementType,
  MilestoneStatus,
  OrgUnit,
  Role,
  User,
  UserLifecycleState,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyTemplateToKpi, seedSystemKpiTemplates } from "@/lib/kra-kpi/kpi-template-service";

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo@12345";
const DEMO_DOMAIN = "galgotias-demo.local.test";
const DEMO_TENANT_CODE = "GALGOTIA_DEMO";
const DEMO_TENANT_NAME = "Galgotias University Demo";
const DEMO_PERIOD = {
  code: "AY2026_27",
  name: "AY 2026-27",
  startDate: new Date("2026-04-01T00:00:00.000Z"),
  endDate: new Date("2027-03-31T00:00:00.000Z"),
  targetSettingDeadline: new Date("2026-04-30T00:00:00.000Z"),
  achievementDeadline: new Date("2027-03-15T00:00:00.000Z"),
  reviewDeadline: new Date("2027-03-31T00:00:00.000Z"),
} as const;

const UNIT_TYPES = [
  ["ROOT", "ORG_ROOT", "Root", true, 0],
  ["SCH", "SCHOOL_LIKE_UNIT", "School", false, 10],
  ["OFF", "OFFICE", "Office", false, 20],
] as const;

const UNITS = [
  ["UNIV", "Galgotias University", "ROOT", null, 0],
  ["SCSE", "School of Computer Science and Engineering", "SCH", "UNIV", 10],
  ["SAI", "School of Artificial Intelligence", "SCH", "UNIV", 20],
  ["SALTM", "School of Agricultural Sciences and Technology Management", "SCH", "UNIV", 30],
  ["SFS", "School Of Forensic Sciences", "SCH", "UNIV", 40],
  ["SCAT", "School of Computer Applications and Technology", "SCH", "UNIV", 50],
  ["SOE", "School of Engineering", "SCH", "UNIV", 60],
  ["SOB", "School of Business", "SCH", "UNIV", 70],
  ["SOL", "School of Law", "SCH", "UNIV", 80],
  ["SOFC", "School of Finance and Commerce", "SCH", "UNIV", 90],
  ["SLE", "School of Liberal Education", "SCH", "UNIV", 100],
  ["SLANG", "School of Languages", "SCH", "UNIV", 110],
  ["SMAS", "School of Media and Communication Studies", "SCH", "UNIV", 120],
  ["SON", "School of Nursing", "SCH", "UNIV", 130],
  ["SAHS", "School of Allied Health Sciences", "SCH", "UNIV", 140],
  ["SOAG", "School of Agriculture", "SCH", "UNIV", 150],
  ["SBS", "School of Basic Sciences", "SCH", "UNIV", 160],
  ["SMCS", "School of Medical and Allied Sciences", "SCH", "UNIV", 170],
  ["SOD", "School of Design", "SCH", "UNIV", 180],
  ["SOH", "School of Hotel Management", "SCH", "UNIV", 190],
  ["SOBT", "School of Biosciences and Technology", "SCH", "UNIV", 200],
  ["GPOLY", "Galgotias Polytechnic", "SCH", "UNIV", 210],
  ["SOVE", "School of Vocational Education", "SCH", "UNIV", 220],
  ["SOEDU", "School of Education", "SCH", "UNIV", 230],
  ["SLLL", "School of Life Long Learning", "SCH", "UNIV", 240],
  ["SODT", "School of Digital Transformation", "SCH", "UNIV", 250],
  ["REG", "Registrar Office", "OFF", "UNIV", 260],
  ["ITS", "IT Services Office", "OFF", "UNIV", 270],
] as const;

const ROLE_DEFINITIONS = [
  ["VICE_CHANCELLOR", "Vice Chancellor", true, true, 1, 10, "Institution-wide executive head."],
  ["SCHOOL_DIRECTOR", "School Director / Dean", true, true, 1, 20, "School-level academic head."],
  ["OFFICE_HEAD", "Office Head", true, true, 1, 30, "Administrative office head."],
  ["PROFESSOR", "Professor", false, false, -1, 40, "Senior academic staff."],
  ["ASSOCIATE_PROFESSOR", "Associate Professor", false, false, -1, 50, "Mid-career academic staff."],
  ["ASSISTANT_PROFESSOR", "Assistant Professor", false, false, -1, 60, "Early-career academic staff."],
  ["RESEARCH_FELLOW", "Research Fellow", false, false, -1, 70, "Research-focused contributor."],
  ["ADMIN_OFFICER", "Administrative Officer", false, false, -1, 80, "Handles operational support."],
  ["EXECUTIVE_ASSISTANT", "Executive Assistant", false, false, -1, 90, "Supports institutional leadership."],
] as const;

type DemoUserKey =
  | "owner"
  | "admin"
  | "scse.director"
  | "soe.director"
  | "sai.director"
  | "sob.director"
  | "faculty1"
  | "faculty2"
  | "employee"
  | "research.fellow"
  | "reg.officer"
  | "its.officer";

type DemoRoleKey =
  | "VICE_CHANCELLOR"
  | "SCHOOL_DIRECTOR"
  | "OFFICE_HEAD"
  | "PROFESSOR"
  | "ASSOCIATE_PROFESSOR"
  | "ASSISTANT_PROFESSOR"
  | "RESEARCH_FELLOW"
  | "ADMIN_OFFICER"
  | "EXECUTIVE_ASSISTANT";

type DemoUserPlan = {
  key: DemoUserKey;
  emailLocal: string;
  firstName: string;
  lastName: string;
  membershipRole: Role;
  designation: string;
  employeeId: string;
  primaryUnitCode: (typeof UNITS)[number][0];
  roleAssignments: Array<{
    unitCode: (typeof UNITS)[number][0];
    roleKey: DemoRoleKey;
  }>;
};

const USER_PLANS: DemoUserPlan[] = [
  {
    key: "owner",
    emailLocal: "owner",
    firstName: "Rohit",
    lastName: "Malhotra",
    membershipRole: "TENANT_OWNER",
    designation: "Vice Chancellor",
    employeeId: "GU-DEMO-001",
    primaryUnitCode: "UNIV",
    roleAssignments: [{ unitCode: "UNIV", roleKey: "VICE_CHANCELLOR" }],
  },
  {
    key: "admin",
    emailLocal: "admin",
    firstName: "Pooja",
    lastName: "Arora",
    membershipRole: "TENANT_ADMIN",
    designation: "Executive Assistant",
    employeeId: "GU-DEMO-002",
    primaryUnitCode: "REG",
    roleAssignments: [{ unitCode: "REG", roleKey: "ADMIN_OFFICER" }],
  },
  {
    key: "scse.director",
    emailLocal: "scse.director",
    firstName: "Kavita",
    lastName: "Jain",
    membershipRole: "TENANT_USER",
    designation: "School Director",
    employeeId: "GU-DEMO-003",
    primaryUnitCode: "SCSE",
    roleAssignments: [{ unitCode: "SCSE", roleKey: "SCHOOL_DIRECTOR" }],
  },
  {
    key: "soe.director",
    emailLocal: "soe.director",
    firstName: "Manish",
    lastName: "Tiwari",
    membershipRole: "TENANT_USER",
    designation: "School Director",
    employeeId: "GU-DEMO-004",
    primaryUnitCode: "SOE",
    roleAssignments: [{ unitCode: "SOE", roleKey: "SCHOOL_DIRECTOR" }],
  },
  {
    key: "sai.director",
    emailLocal: "sai.director",
    firstName: "Ritika",
    lastName: "Bansal",
    membershipRole: "TENANT_USER",
    designation: "School Director",
    employeeId: "GU-DEMO-005",
    primaryUnitCode: "SAI",
    roleAssignments: [{ unitCode: "SAI", roleKey: "SCHOOL_DIRECTOR" }],
  },
  {
    key: "sob.director",
    emailLocal: "sob.director",
    firstName: "Sanjay",
    lastName: "Gupta",
    membershipRole: "TENANT_USER",
    designation: "School Director",
    employeeId: "GU-DEMO-006",
    primaryUnitCode: "SOB",
    roleAssignments: [{ unitCode: "SOB", roleKey: "SCHOOL_DIRECTOR" }],
  },
  {
    key: "faculty1",
    emailLocal: "faculty1",
    firstName: "Anita",
    lastName: "Verma",
    membershipRole: "TENANT_USER",
    designation: "Professor",
    employeeId: "GU-DEMO-007",
    primaryUnitCode: "SCSE",
    roleAssignments: [{ unitCode: "SCSE", roleKey: "PROFESSOR" }],
  },
  {
    key: "faculty2",
    emailLocal: "faculty2",
    firstName: "Bharat",
    lastName: "Mehra",
    membershipRole: "TENANT_USER",
    designation: "Associate Professor",
    employeeId: "GU-DEMO-008",
    primaryUnitCode: "SOE",
    roleAssignments: [{ unitCode: "SOE", roleKey: "ASSOCIATE_PROFESSOR" }],
  },
  {
    key: "employee",
    emailLocal: "employee",
    firstName: "Deepak",
    lastName: "Sharma",
    membershipRole: "TENANT_USER",
    designation: "Assistant Professor",
    employeeId: "GU-DEMO-009",
    primaryUnitCode: "SAI",
    roleAssignments: [{ unitCode: "SAI", roleKey: "ASSISTANT_PROFESSOR" }],
  },
  {
    key: "research.fellow",
    emailLocal: "research.fellow",
    firstName: "Madhav",
    lastName: "Sethi",
    membershipRole: "TENANT_USER",
    designation: "Research Fellow",
    employeeId: "GU-DEMO-010",
    primaryUnitCode: "SCSE",
    roleAssignments: [{ unitCode: "SCSE", roleKey: "RESEARCH_FELLOW" }],
  },
  {
    key: "reg.officer",
    emailLocal: "reg.officer",
    firstName: "Tarun",
    lastName: "Joshi",
    membershipRole: "TENANT_USER",
    designation: "Administrative Officer",
    employeeId: "GU-DEMO-011",
    primaryUnitCode: "REG",
    roleAssignments: [{ unitCode: "REG", roleKey: "ADMIN_OFFICER" }],
  },
  {
    key: "its.officer",
    emailLocal: "its.officer",
    firstName: "Vidya",
    lastName: "Nair",
    membershipRole: "TENANT_USER",
    designation: "Administrative Officer",
    employeeId: "GU-DEMO-012",
    primaryUnitCode: "ITS",
    roleAssignments: [{ unitCode: "ITS", roleKey: "ADMIN_OFFICER" }],
  },
] as const;

type DemoKraKey = "RESEARCH_OUTPUT" | "PROJECTS_IP" | "ACADEMIC_OUTREACH";
type TargetPayload = {
  value?: number;
  milestone?: MilestoneStatus;
  date?: Date;
  grade?: GradeValue;
  boolean?: boolean;
  rating?: number;
};

function mail(local: string): string {
  return `${local}@${DEMO_DOMAIN}`.toLowerCase();
}

function userName(user: Pick<User, "firstName" | "lastName">): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function roundTo(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

async function upsertUser(input: {
  emailAddress: string;
  firstName: string;
  lastName: string;
  password: string;
  isSuperadmin?: boolean;
}) {
  const passwordHash = await hash(input.password, 12);

  return prisma.user.upsert({
    where: { officialEmail: input.emailAddress.toLowerCase() },
    update: {
      firstName: input.firstName,
      lastName: input.lastName,
      isSuperadmin: input.isSuperadmin ?? false,
      lifecycleState: "ACTIVE" satisfies UserLifecycleState,
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
      firstName: input.firstName,
      lastName: input.lastName,
      officialEmail: input.emailAddress.toLowerCase(),
      isSuperadmin: input.isSuperadmin ?? false,
      lifecycleState: "ACTIVE" satisfies UserLifecycleState,
      passwordHash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
      mustResetPassword: false,
    },
  });
}

async function ensureTenantAndSuperadmin() {
  const superadmin = await upsertUser({
    emailAddress: (process.env.SUPERADMIN_EMAIL ?? "superadmin@local.test").trim().toLowerCase(),
    firstName: process.env.SUPERADMIN_FIRST_NAME ?? "Platform",
    lastName: process.env.SUPERADMIN_LAST_NAME ?? "Admin",
    password: process.env.SUPERADMIN_PASSWORD ?? "Admin@12345",
    isSuperadmin: true,
  });

  const ownerPlan = USER_PLANS.find((plan) => plan.key === "owner");
  if (!ownerPlan) {
    throw new Error("Owner plan not found.");
  }
  const ownerUser = await upsertUser({
    emailAddress: mail(ownerPlan.emailLocal),
    firstName: ownerPlan.firstName,
    lastName: ownerPlan.lastName,
    password: DEMO_PASSWORD,
  });

  const tenant = await prisma.tenant.upsert({
    where: { code: DEMO_TENANT_CODE },
    update: {
      name: DEMO_TENANT_NAME,
      legalOrganizationName: DEMO_TENANT_NAME,
      organizationType: "UNIVERSITY",
      primaryDomains: [DEMO_DOMAIN],
      subscriptionPlan: "ENTERPRISE",
      lifecycleState: "ACTIVE",
      ownerUserId: ownerUser.id,
      createdByUserId: superadmin.id,
    },
    create: {
      code: DEMO_TENANT_CODE,
      name: DEMO_TENANT_NAME,
      legalOrganizationName: DEMO_TENANT_NAME,
      organizationType: "UNIVERSITY",
      primaryDomains: [DEMO_DOMAIN],
      subscriptionPlan: "ENTERPRISE",
      lifecycleState: "ACTIVE",
      ownerUserId: ownerUser.id,
      createdByUserId: superadmin.id,
    },
  });

  await prisma.tenantPolicy.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id },
  });

  return { tenant, superadmin, ownerUser };
}

async function ensureMembership(input: {
  tenantId: string;
  userId: string;
  role: Role;
  createdByUserId: string;
  employeeId: string;
  designation: string;
  department: string;
}) {
  return prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    update: {
      role: input.role,
      employeeId: input.employeeId,
      designation: input.designation,
      department: input.department,
      status: "ACTIVE",
      invitationState: "ACCEPTED",
      personnelStatus: "ACTIVE",
      createdByUserId: input.createdByUserId,
      activationTimestamp: new Date(),
    },
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      employeeId: input.employeeId,
      designation: input.designation,
      department: input.department,
      status: "ACTIVE",
      invitationState: "ACCEPTED",
      personnelStatus: "ACTIVE",
      createdByUserId: input.createdByUserId,
      activationTimestamp: new Date(),
    },
  });
}

async function ensurePublishedStructure(tenantId: string, actorUserId: string) {
  let version = await prisma.orgStructureVersion.findFirst({
    where: { tenantId, state: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
  });

  if (!version) {
    const nextVersionNumber =
      (await prisma.orgStructureVersion.aggregate({
        where: { tenantId },
        _max: { versionNumber: true },
      }))._max.versionNumber ?? 0;

    version = await prisma.orgStructureVersion.create({
      data: {
        tenantId,
        name: "Galgotias Demo Structure",
        versionNumber: nextVersionNumber + 1,
        state: "PUBLISHED",
        validatedAt: new Date(),
        publishedAt: new Date(),
        createdByUserId: actorUserId,
      },
    });
  }

  const typeMap = new Map<string, { id: string }>();
  for (const [typeKey, internalCategory, displayLabel, allowRoot, sortOrder] of UNIT_TYPES) {
    const type = await prisma.orgUnitType.upsert({
      where: { versionId_typeKey: { versionId: version.id, typeKey } },
      update: { internalCategory, displayLabel, allowRoot, sortOrder },
      create: {
        versionId: version.id,
        typeKey,
        internalCategory,
        displayLabel,
        allowRoot,
        sortOrder,
      },
    });
    typeMap.set(typeKey, type);
  }

  const unitMap = new Map<string, OrgUnit>();
  for (const [code, name, typeKey, parentCode, sortOrder] of UNITS) {
    const existing = await prisma.orgUnit.findUnique({
      where: { versionId_code: { versionId: version.id, code } },
    });
    const parent = parentCode ? unitMap.get(parentCode) : null;
    const unit = existing
      ? await prisma.orgUnit.update({
          where: { id: existing.id },
          data: {
            typeId: typeMap.get(typeKey)?.id,
            name,
            parentId: parent?.id ?? null,
            sortOrder,
            state: "ACTIVE",
            effectiveTo: null,
            createdByUserId: actorUserId,
          },
        })
      : await prisma.orgUnit.create({
          data: {
            tenantId,
            versionId: version.id,
            typeId: typeMap.get(typeKey)?.id ?? "",
            code,
            name,
            parentId: parent?.id ?? null,
            level: 0,
            sortOrder,
            path: code,
            state: "ACTIVE",
            createdByUserId: actorUserId,
          },
        });
    unitMap.set(code, unit);
  }

  const childCodesByParent = new Map<string, string[]>();
  for (const [code, , , parentCode] of UNITS) {
    const key = parentCode ?? "__ROOT__";
    const current = childCodesByParent.get(key) ?? [];
    current.push(code);
    childCodesByParent.set(key, current);
  }

  const refreshPaths = async (code: string, level: number, parentPath: string, parentId: string | null) => {
    const unit = unitMap.get(code);
    if (!unit) {
      return;
    }
    const path = parentPath ? `${parentPath}/${code}` : code;
    const updated = await prisma.orgUnit.update({
      where: { id: unit.id },
      data: {
        parentId,
        level,
        path,
        state: "ACTIVE",
      },
    });
    unitMap.set(code, updated);
    for (const childCode of childCodesByParent.get(code) ?? []) {
      await refreshPaths(childCode, level + 1, path, updated.id);
    }
  };
  await refreshPaths("UNIV", 0, "", null);

  return { version, unitMap };
}

async function ensureRoleDefinitions(tenantId: string, actorUserId: string) {
  const roleMap = new Map<string, { id: string; displayLabel: string }>();
  for (const [roleKey, displayLabel, isUnitHead, approvalAuthority, maxPerUnit, sortOrder, description] of ROLE_DEFINITIONS) {
    const role = await prisma.orgRoleDefinition.upsert({
      where: { tenantId_roleKey: { tenantId, roleKey } },
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
        createdByUserId: actorUserId,
      },
    });
    roleMap.set(roleKey, role);
  }
  return roleMap;
}

async function ensurePrimaryUnitAssignment(input: {
  versionId: string;
  unitId: string;
  userId: string;
}) {
  await prisma.userOrgAssignment.updateMany({
    where: {
      versionId: input.versionId,
      userId: input.userId,
      isPrimary: true,
      unitId: { not: input.unitId },
    },
    data: {
      assignmentType: "SECONDARY",
      isPrimary: false,
    },
  });

  const existing = await prisma.userOrgAssignment.findFirst({
    where: {
      versionId: input.versionId,
      unitId: input.unitId,
      userId: input.userId,
    },
  });

  if (existing) {
    return prisma.userOrgAssignment.update({
      where: { id: existing.id },
      data: {
        assignmentType: "PRIMARY",
        isPrimary: true,
        effectiveTo: null,
        effectiveFrom: existing.effectiveFrom ?? new Date(),
      },
    });
  }

  return prisma.userOrgAssignment.create({
    data: {
      versionId: input.versionId,
      unitId: input.unitId,
      userId: input.userId,
      assignmentType: "PRIMARY",
      isPrimary: true,
      effectiveFrom: new Date(),
    },
  });
}

async function syncUsers(input: {
  tenantId: string;
  actorUserId: string;
  versionId: string;
  unitMap: Map<string, OrgUnit>;
  roleMap: Map<string, { id: string; displayLabel: string }>;
}) {
  const userMap = new Map<DemoUserKey, User>();

  for (const plan of USER_PLANS) {
    const user = await upsertUser({
      emailAddress: mail(plan.emailLocal),
      firstName: plan.firstName,
      lastName: plan.lastName,
      password: DEMO_PASSWORD,
    });
    userMap.set(plan.key, user);

    const primaryUnit = input.unitMap.get(plan.primaryUnitCode);
    if (!primaryUnit) {
      throw new Error(`Primary unit ${plan.primaryUnitCode} not found for ${plan.key}.`);
    }

    await ensureMembership({
      tenantId: input.tenantId,
      userId: user.id,
      role: plan.membershipRole,
      createdByUserId: input.actorUserId,
      employeeId: plan.employeeId,
      designation: plan.designation,
      department: primaryUnit.name,
    });

    await ensurePrimaryUnitAssignment({
      versionId: input.versionId,
      unitId: primaryUnit.id,
      userId: user.id,
    });

    const desiredRoleKeys = new Set(plan.roleAssignments.map((assignment) => `${assignment.unitCode}:${assignment.roleKey}`));
    const currentRoles = await prisma.orgRoleAssignment.findMany({
      where: { versionId: input.versionId, userId: user.id },
      include: {
        roleDefinition: { select: { roleKey: true } },
        unit: { select: { code: true } },
      },
    });
    for (const current of currentRoles) {
      const roleKey = current.roleDefinition?.roleKey ?? current.roleName;
      const signature = `${current.unit.code}:${roleKey}`;
      if (!desiredRoleKeys.has(signature)) {
        await prisma.orgRoleAssignment.delete({ where: { id: current.id } });
      }
    }

    for (const assignment of plan.roleAssignments) {
      const unit = input.unitMap.get(assignment.unitCode);
      const role = input.roleMap.get(assignment.roleKey);
      if (!unit || !role) {
        throw new Error(`Role assignment missing dependency for ${plan.key}.`);
      }

      const existing = await prisma.orgRoleAssignment.findFirst({
        where: {
          versionId: input.versionId,
          unitId: unit.id,
          userId: user.id,
          roleDefinitionId: role.id,
        },
      });
      if (existing) {
        await prisma.orgRoleAssignment.update({
          where: { id: existing.id },
          data: {
            roleName: role.displayLabel,
            scope: "NODE",
            isActive: true,
            effectiveTo: null,
          },
        });
      } else {
        await prisma.orgRoleAssignment.create({
          data: {
            versionId: input.versionId,
            unitId: unit.id,
            userId: user.id,
            roleDefinitionId: role.id,
            roleName: role.displayLabel,
            scope: "NODE",
            isActive: true,
            effectiveFrom: new Date(),
          },
        });
      }
    }
  }

  return userMap;
}

async function regenerateReportingLines(input: {
  tenantId: string;
  versionId: string;
  actorUserId: string;
}) {
  const units = await prisma.orgUnit.findMany({
    where: { versionId: input.versionId, state: { not: "INACTIVE" } },
    orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
    select: { id: true, parentId: true },
  });
  const assignments = await prisma.orgRoleAssignment.findMany({
    where: { versionId: input.versionId, isActive: true },
    include: { roleDefinition: { select: { isUnitHead: true, sortOrder: true } } },
  });

  const groupedByUnit = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const current = groupedByUnit.get(assignment.unitId) ?? [];
    current.push(assignment);
    groupedByUnit.set(assignment.unitId, current);
  }

  const headByUnit = new Map<string, string>();
  for (const unit of units) {
    const head = (groupedByUnit.get(unit.id) ?? [])
      .filter((assignment) => assignment.roleDefinition?.isUnitHead)
      .sort((a, b) => (a.roleDefinition?.sortOrder ?? 0) - (b.roleDefinition?.sortOrder ?? 0))[0];
    if (head) {
      headByUnit.set(unit.id, head.userId);
    }
  }

  const seen = new Set<string>();
  const lines: Array<{
    versionId: string;
    unitId: string;
    managerUserId: string;
    memberUserId: string;
    lineType: string;
  }> = [];

  for (const unit of units) {
    const headUserId = headByUnit.get(unit.id);
    if (!headUserId) {
      continue;
    }

    for (const assignment of groupedByUnit.get(unit.id) ?? []) {
      if (assignment.userId === headUserId) {
        continue;
      }
      const key = `${headUserId}:${assignment.userId}:${unit.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      lines.push({
        versionId: input.versionId,
        unitId: unit.id,
        managerUserId: headUserId,
        memberUserId: assignment.userId,
        lineType: "SOLID",
      });
    }

    if (!unit.parentId) {
      continue;
    }
    const parentHeadUserId = headByUnit.get(unit.parentId);
    if (!parentHeadUserId || parentHeadUserId === headUserId) {
      continue;
    }
    const key = `${parentHeadUserId}:${headUserId}:${unit.parentId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push({
      versionId: input.versionId,
      unitId: unit.parentId,
      managerUserId: parentHeadUserId,
      memberUserId: headUserId,
      lineType: "SOLID",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.reportingLine.deleteMany({ where: { versionId: input.versionId } });
    if (lines.length > 0) {
      await tx.reportingLine.createMany({ data: lines });
    }
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: "TENANT_OWNER",
        targetType: "OrgStructureVersion",
        targetId: input.versionId,
        action: "seed.galgotia_demo.reporting_lines",
        newState: { linesCreated: lines.length } as object,
      },
    });
  });
}

type KpiSeedPlan = {
  templateCode: string;
  kraKey: DemoKraKey;
  startingUnitCode: (typeof UNITS)[number][0];
  sortOrder: number;
  weightage: number;
  defaultTarget: TargetPayload;
  assignees: Array<{
    userKey: DemoUserKey;
    target: TargetPayload;
  }>;
};

const KPI_PLANS: KpiSeedPlan[] = [
  {
    templateCode: "GU_SCOPUS_JOURNAL_PUBLICATION",
    kraKey: "RESEARCH_OUTPUT",
    startingUnitCode: "SCSE",
    sortOrder: 1,
    weightage: 15,
    defaultTarget: { value: 4 },
    assignees: [
      { userKey: "faculty1", target: { value: 2 } },
      { userKey: "employee", target: { value: 2 } },
    ],
  },
  {
    templateCode: "GU_SCOPUS_TEXTBOOK_AUTHORED",
    kraKey: "RESEARCH_OUTPUT",
    startingUnitCode: "SCSE",
    sortOrder: 2,
    weightage: 5,
    defaultTarget: { value: 1 },
    assignees: [{ userKey: "faculty1", target: { value: 1 } }],
  },
  {
    templateCode: "GU_SCOPUS_EDITED_BOOK",
    kraKey: "RESEARCH_OUTPUT",
    startingUnitCode: "SOE",
    sortOrder: 3,
    weightage: 5,
    defaultTarget: { value: 1 },
    assignees: [{ userKey: "faculty2", target: { value: 1 } }],
  },
  {
    templateCode: "GU_SCOPUS_BOOK_CHAPTER",
    kraKey: "RESEARCH_OUTPUT",
    startingUnitCode: "SCSE",
    sortOrder: 4,
    weightage: 5,
    defaultTarget: { value: 2 },
    assignees: [
      { userKey: "faculty1", target: { value: 1 } },
      { userKey: "employee", target: { value: 1 } },
    ],
  },
  {
    templateCode: "GU_PHD_AWARDED",
    kraKey: "RESEARCH_OUTPUT",
    startingUnitCode: "SCSE",
    sortOrder: 5,
    weightage: 10,
    defaultTarget: { value: 1 },
    assignees: [{ userKey: "faculty1", target: { value: 1 } }],
  },
  {
    templateCode: "GU_CONFERENCE_PAPER",
    kraKey: "RESEARCH_OUTPUT",
    startingUnitCode: "SOE",
    sortOrder: 6,
    weightage: 5,
    defaultTarget: { value: 2 },
    assignees: [{ userKey: "faculty2", target: { value: 2 } }],
  },
  {
    templateCode: "GU_RESEARCH_GRANT",
    kraKey: "PROJECTS_IP",
    startingUnitCode: "SOE",
    sortOrder: 7,
    weightage: 12,
    defaultTarget: { value: 1500000 },
    assignees: [{ userKey: "faculty2", target: { value: 1500000 } }],
  },
  {
    templateCode: "GU_CONSULTANCY_PROJECT",
    kraKey: "PROJECTS_IP",
    startingUnitCode: "SAI",
    sortOrder: 8,
    weightage: 12,
    defaultTarget: { value: 300000 },
    assignees: [{ userKey: "employee", target: { value: 300000 } }],
  },
  {
    templateCode: "GU_PATENT_FILING",
    kraKey: "PROJECTS_IP",
    startingUnitCode: "SAI",
    sortOrder: 9,
    weightage: 11,
    defaultTarget: { milestone: "COMPLETED" },
    assignees: [{ userKey: "employee", target: { milestone: "COMPLETED" } }],
  },
  {
    templateCode: "GU_INTL_CONFERENCE_CONVENOR",
    kraKey: "ACADEMIC_OUTREACH",
    startingUnitCode: "SCSE",
    sortOrder: 10,
    weightage: 8,
    defaultTarget: { milestone: "COMPLETED" },
    assignees: [{ userKey: "scse.director", target: { milestone: "COMPLETED" } }],
  },
  {
    templateCode: "GU_FDP_STC_VAC_TRAINING_CONVENOR",
    kraKey: "ACADEMIC_OUTREACH",
    startingUnitCode: "SCSE",
    sortOrder: 11,
    weightage: 6,
    defaultTarget: { milestone: "COMPLETED" },
    assignees: [{ userKey: "scse.director", target: { milestone: "COMPLETED" } }],
  },
  {
    templateCode: "GU_EDP_MDP_CONVENOR",
    kraKey: "ACADEMIC_OUTREACH",
    startingUnitCode: "SOB",
    sortOrder: 12,
    weightage: 6,
    defaultTarget: { value: 400000 },
    assignees: [{ userKey: "sob.director", target: { value: 400000 } }],
  },
] as const;

type ContributorSeed = {
  type?: ContributorType;
  userKey?: DemoUserKey;
  externalName?: string;
  externalAffiliation?: string;
  externalScope?: ExternalContributorScope;
  contributorRoleCode: string;
  creditPercent: number;
  selectorTags?: string[];
  isExcludedFromReward?: boolean;
  note?: string;
};

type SeedAchievementPlan = {
  seedKey: string;
  templateCode: string;
  assigneeKey: DemoUserKey;
  reporterKey: DemoUserKey;
  state: AchievementState;
  title: string;
  reportingDate: Date;
  actualValue?: number;
  actualDate?: Date;
  actualMilestone?: MilestoneStatus;
  evidenceLinks: string[];
  formData: Record<string, unknown>;
  contributors: ContributorSeed[];
  recommendation?: {
    byUserKey: DemoUserKey;
    at: Date;
    note: string;
  };
  verification?: {
    currentVerifierUserKey?: DemoUserKey;
    currentVerifierUnitCode?: (typeof UNITS)[number][0];
    byUserKey?: DemoUserKey;
    at?: Date;
    note?: string;
    rejectionReason?: string;
  };
};

const SEED_ACHIEVEMENTS: SeedAchievementPlan[] = [
  {
    seedKey: "journal-verified-q1",
    templateCode: "GU_SCOPUS_JOURNAL_PUBLICATION",
    assigneeKey: "faculty1",
    reporterKey: "faculty1",
    state: "VERIFIED",
    title: "Explainable AI Framework for Medical Image Diagnosis",
    reportingDate: new Date("2026-05-20T00:00:00.000Z"),
    actualValue: 1,
    actualDate: new Date("2026-05-18T00:00:00.000Z"),
    evidenceLinks: ["https://doi.org/10.5555/gu.demo.q1.2026.001"],
    formData: {
      paperTitle: "Explainable AI Framework for Medical Image Diagnosis",
      journalName: "Journal of Intelligent Healthcare Systems",
      issn: "2456-1234",
      volume: "18",
      issue: "2",
      doi: "10.5555/gu.demo.q1.2026.001",
      indexing: ["Scopus"],
      publicationDate: "2026-05-18",
      pdfLink: "https://example.org/demo-publications/medical-image-diagnosis.pdf",
      coAuthors: "Deepak Sharma, Laura Kim",
      journalQuartile: "Q1",
      authorshipCase: "CASE_1",
      impactFactor: 4.8,
      totalAuthors: 3,
      guAuthorsCount: 2,
    },
    contributors: [
      { userKey: "faculty1", contributorRoleCode: "FIRST_AUTHOR", creditPercent: 35, selectorTags: ["FIRST_AUTHOR"] },
      { userKey: "employee", contributorRoleCode: "CO_AUTHOR", creditPercent: 30 },
      {
        type: "EXTERNAL",
        externalName: "Laura Kim",
        externalAffiliation: "University of Leeds",
        externalScope: "INTERNATIONAL",
        contributorRoleCode: "CORRESPONDING_AUTHOR",
        creditPercent: 35,
        selectorTags: ["CORRESPONDING_AUTHOR"],
        isExcludedFromReward: true,
      },
    ],
    verification: {
      byUserKey: "scse.director",
      at: new Date("2026-05-25T00:00:00.000Z"),
      note: "Verified as a Q1 Scopus publication with correct authorship case.",
    },
  },
  {
    seedKey: "journal-submitted-q2",
    templateCode: "GU_SCOPUS_JOURNAL_PUBLICATION",
    assigneeKey: "faculty1",
    reporterKey: "faculty1",
    state: "SUBMITTED",
    title: "Secure Federated Learning for Smart Campus Networks",
    reportingDate: new Date("2026-07-12T00:00:00.000Z"),
    actualValue: 1,
    actualDate: new Date("2026-07-10T00:00:00.000Z"),
    evidenceLinks: ["https://doi.org/10.5555/gu.demo.q2.2026.002"],
    formData: {
      paperTitle: "Secure Federated Learning for Smart Campus Networks",
      journalName: "International Journal of Secure Computing Applications",
      issn: "2394-5678",
      volume: "22",
      issue: "7",
      doi: "10.5555/gu.demo.q2.2026.002",
      indexing: ["Scopus"],
      publicationDate: "2026-07-10",
      pdfLink: "https://example.org/demo-publications/secure-federated-learning.pdf",
      coAuthors: "Deepak Sharma, Nitin Rao",
      journalQuartile: "Q2",
      authorshipCase: "CASE_3",
      impactFactor: 3.1,
      totalAuthors: 3,
      guAuthorsCount: 2,
    },
    contributors: [
      { userKey: "faculty1", contributorRoleCode: "FIRST_AUTHOR", creditPercent: 60, selectorTags: ["FIRST_AUTHOR"] },
      { userKey: "employee", contributorRoleCode: "CO_AUTHOR", creditPercent: 40 },
    ],
    verification: {
      currentVerifierUserKey: "scse.director",
      currentVerifierUnitCode: "SCSE",
    },
  },
  {
    seedKey: "grant-recommended",
    templateCode: "GU_RESEARCH_GRANT",
    assigneeKey: "faculty2",
    reporterKey: "faculty2",
    state: "RECOMMENDED",
    title: "AI Enabled 6G Edge Analytics Grant",
    reportingDate: new Date("2026-06-10T00:00:00.000Z"),
    actualValue: 1800000,
    actualDate: new Date("2026-06-01T00:00:00.000Z"),
    evidenceLinks: ["https://example.org/demo-grants/6g-edge-analytics-sanction.pdf"],
    formData: {
      projectTitle: "AI Enabled 6G Edge Analytics Grant",
      fundingAgency: "Department of Science and Technology",
      sanctionedAmount: 1800000,
      sanctionNumber: "DST-GU-2026-117",
      duration: 24,
      startDate: "2026-06-01",
      sanctionLetterLink: "https://example.org/demo-grants/6g-edge-analytics-sanction.pdf",
      grantType: "Government",
    },
    contributors: [
      { userKey: "faculty2", contributorRoleCode: "PI", creditPercent: 60 },
      { userKey: "employee", contributorRoleCode: "CO_PI", creditPercent: 40 },
    ],
    recommendation: {
      byUserKey: "soe.director",
      at: new Date("2026-06-14T00:00:00.000Z"),
      note: "Recommended after validating sanction letter and grant amount.",
    },
    verification: {
      currentVerifierUserKey: "owner",
      currentVerifierUnitCode: "UNIV",
      note: "Pending final institutional approval.",
    },
  },
  {
    seedKey: "book-chapter-draft",
    templateCode: "GU_SCOPUS_BOOK_CHAPTER",
    assigneeKey: "faculty1",
    reporterKey: "faculty1",
    state: "DRAFT",
    title: "AI-Driven Curriculum Intelligence Chapter",
    reportingDate: new Date("2026-08-05T00:00:00.000Z"),
    actualValue: 1,
    evidenceLinks: ["https://example.org/demo-books/ai-curriculum-chapter"],
    formData: {
      bookTitle: "Emerging Digital Education Frameworks",
      publisher: "Springer Nature",
      isbn: "978-93-00000-01-0",
      publicationYear: 2026,
      scopusIndexed: true,
      publisherLink: "https://example.org/demo-books/emerging-digital-education-frameworks",
      chapterTitle: "AI-Driven Curriculum Intelligence Chapter",
      chapterNumber: 4,
    },
    contributors: [
      { userKey: "faculty1", contributorRoleCode: "AUTHOR", creditPercent: 50 },
      { userKey: "employee", contributorRoleCode: "CO_AUTHOR", creditPercent: 50 },
    ],
  },
  {
    seedKey: "consultancy-submitted",
    templateCode: "GU_CONSULTANCY_PROJECT",
    assigneeKey: "employee",
    reporterKey: "employee",
    state: "SUBMITTED",
    title: "Smart Lab Infrastructure Optimization Consultancy",
    reportingDate: new Date("2026-09-02T00:00:00.000Z"),
    actualValue: 320000,
    actualDate: new Date("2026-08-28T00:00:00.000Z"),
    evidenceLinks: ["https://example.org/demo-consulting/smart-lab-consultancy.pdf"],
    formData: {
      projectTitle: "Smart Lab Infrastructure Optimization Consultancy",
      clientOrg: "Noida Innovation Council",
      projectValue: 780000,
      totalExpenditure: 460000,
      savings: 320000,
      startDate: "2026-07-01",
      endDate: "2026-08-20",
      referenceNumber: "GU-CON-2026-021",
      approvalLink: "https://example.org/demo-consulting/smart-lab-consultancy.pdf",
    },
    contributors: [
      { userKey: "employee", contributorRoleCode: "LEAD_CONSULTANT", creditPercent: 60 },
      { userKey: "faculty1", contributorRoleCode: "CONSULTANT", creditPercent: 40 },
    ],
    verification: {
      currentVerifierUserKey: "sai.director",
      currentVerifierUnitCode: "SAI",
    },
  },
  {
    seedKey: "patent-verified",
    templateCode: "GU_PATENT_FILING",
    assigneeKey: "employee",
    reporterKey: "employee",
    state: "VERIFIED",
    title: "IoT Enabled Adaptive Energy Controller Patent",
    reportingDate: new Date("2026-06-22T00:00:00.000Z"),
    actualMilestone: "COMPLETED",
    actualDate: new Date("2026-06-20T00:00:00.000Z"),
    evidenceLinks: ["https://example.org/demo-patents/adaptive-energy-controller.pdf"],
    formData: {
      patentTitle: "IoT Enabled Adaptive Energy Controller Patent",
      applicationNumber: "202611045678",
      patentOffice: "Indian Patent Office",
      filingDate: "2026-06-20",
      status: "Filed",
      inventors: "Deepak Sharma, Anita Verma",
      certificateLink: "https://example.org/demo-patents/adaptive-energy-controller.pdf",
      applicantIsGU: true,
    },
    contributors: [
      { userKey: "employee", contributorRoleCode: "INVENTOR", creditPercent: 50 },
      { userKey: "faculty1", contributorRoleCode: "INVENTOR", creditPercent: 50 },
    ],
    verification: {
      byUserKey: "sai.director",
      at: new Date("2026-06-26T00:00:00.000Z"),
      note: "Verified against filing acknowledgement with Galgotias University as applicant.",
    },
  },
  {
    seedKey: "fdp-submitted",
    templateCode: "GU_FDP_STC_VAC_TRAINING_CONVENOR",
    assigneeKey: "scse.director",
    reporterKey: "scse.director",
    state: "SUBMITTED",
    title: "Outcome-Based Education Design Workshop",
    reportingDate: new Date("2026-08-18T00:00:00.000Z"),
    actualMilestone: "COMPLETED",
    actualDate: new Date("2026-08-15T00:00:00.000Z"),
    evidenceLinks: ["https://example.org/demo-fdp/obe-design-workshop-report.pdf"],
    formData: {
      programName: "Outcome-Based Education Design Workshop",
      programType: "Hands-on Workshop",
      sponsoringAgency: "AICTE",
      isSponsored: true,
      startDate: "2026-08-10",
      endDate: "2026-08-15",
      totalHours: 36,
      participantCount: 64,
      referenceNumber: "GU-FDP-2026-009",
      certificateLink: "https://example.org/demo-fdp/obe-design-workshop-report.pdf",
      selfDeclaration: true,
    },
    contributors: [{ userKey: "scse.director", contributorRoleCode: "CONVENOR", creditPercent: 100 }],
    verification: {
      currentVerifierUserKey: "owner",
      currentVerifierUnitCode: "UNIV",
    },
  },
  {
    seedKey: "conference-paper-rejected",
    templateCode: "GU_CONFERENCE_PAPER",
    assigneeKey: "faculty2",
    reporterKey: "faculty2",
    state: "REJECTED",
    title: "Low-Power Mixed Signal Design for Wearable Sensors",
    reportingDate: new Date("2026-10-01T00:00:00.000Z"),
    actualValue: 1,
    actualDate: new Date("2026-09-25T00:00:00.000Z"),
    evidenceLinks: ["https://example.org/demo-conference/wearable-sensors-paper.pdf"],
    formData: {
      conferenceName: "International Conference on Embedded Intelligence 2026",
      paperTitle: "Low-Power Mixed Signal Design for Wearable Sensors",
      presentationType: "Oral",
      location: "Dubai",
      date: "2026-09-25",
      proceedingsLink: "https://example.org/demo-conference/wearable-sensors-paper.pdf",
      conferenceScope: "International",
      receivedUniversityFunding: true,
      selfDeclaration: true,
    },
    contributors: [
      { userKey: "faculty2", contributorRoleCode: "AUTHOR", creditPercent: 60 },
      { userKey: "employee", contributorRoleCode: "CO_AUTHOR", creditPercent: 40 },
    ],
    verification: {
      byUserKey: "soe.director",
      at: new Date("2026-10-05T00:00:00.000Z"),
      rejectionReason: "Rejected because the submission indicates university funding, which is not eligible under this policy.",
    },
  },
  {
    seedKey: "edp-verified",
    templateCode: "GU_EDP_MDP_CONVENOR",
    assigneeKey: "sob.director",
    reporterKey: "sob.director",
    state: "VERIFIED",
    title: "Executive Development Programme on Digital Manufacturing",
    reportingDate: new Date("2026-11-18T00:00:00.000Z"),
    actualValue: 450000,
    actualDate: new Date("2026-11-15T00:00:00.000Z"),
    evidenceLinks: ["https://example.org/demo-edp/digital-manufacturing-edp.pdf"],
    formData: {
      projectTitle: "Executive Development Programme on Digital Manufacturing",
      clientOrg: "UP Manufacturing Cluster Association",
      projectValue: 900000,
      totalExpenditure: 450000,
      savings: 450000,
      startDate: "2026-10-10",
      endDate: "2026-11-15",
      referenceNumber: "GU-EDP-2026-014",
      approvalLink: "https://example.org/demo-edp/digital-manufacturing-edp.pdf",
      programType: "EDP",
      selfDeclaration: true,
    },
    contributors: [
      { userKey: "sob.director", contributorRoleCode: "CONVENOR", creditPercent: 70 },
      { userKey: "admin", contributorRoleCode: "TEAM_MEMBER", creditPercent: 30 },
    ],
    verification: {
      byUserKey: "owner",
      at: new Date("2026-11-22T00:00:00.000Z"),
      note: "Verified with approved distribution chart and final savings statement.",
    },
  },
] as const;

async function ensurePeriod(tenantId: string, actorUserId: string) {
  return prisma.assessmentPeriod.upsert({
    where: { tenantId_code: { tenantId, code: DEMO_PERIOD.code } },
    update: {
      name: DEMO_PERIOD.name,
      periodType: "SPECIFIC_RANGE",
      startDate: DEMO_PERIOD.startDate,
      endDate: DEMO_PERIOD.endDate,
      state: "OPEN",
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: DEMO_PERIOD.targetSettingDeadline,
      achievementDeadline: DEMO_PERIOD.achievementDeadline,
      reviewDeadline: DEMO_PERIOD.reviewDeadline,
      description: "Galgotias demo period seeded with active targets and mixed-stage achievements.",
    },
    create: {
      tenantId,
      name: DEMO_PERIOD.name,
      code: DEMO_PERIOD.code,
      periodType: "SPECIFIC_RANGE",
      startDate: DEMO_PERIOD.startDate,
      endDate: DEMO_PERIOD.endDate,
      state: "OPEN",
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: DEMO_PERIOD.targetSettingDeadline,
      achievementDeadline: DEMO_PERIOD.achievementDeadline,
      reviewDeadline: DEMO_PERIOD.reviewDeadline,
      description: "Galgotias demo period seeded with active targets and mixed-stage achievements.",
      createdByUserId: actorUserId,
    },
  });
}

async function ensureCategory(input: {
  tenantId: string;
  categoryKey: string;
  displayLabel: string;
  description: string;
  colorHex: string;
  createdByUserId: string;
}) {
  return prisma.kraCategoryDefinition.upsert({
    where: {
      tenantId_categoryKey: {
        tenantId: input.tenantId,
        categoryKey: input.categoryKey,
      },
    },
    update: {
      scope: "TENANT",
      displayLabel: input.displayLabel,
      description: input.description,
      colorHex: input.colorHex,
      isActive: true,
    },
    create: {
      tenantId: input.tenantId,
      scope: "TENANT",
      categoryKey: input.categoryKey,
      displayLabel: input.displayLabel,
      description: input.description,
      colorHex: input.colorHex,
      isActive: true,
      createdByUserId: input.createdByUserId,
    },
  });
}

async function ensureKra(input: {
  tenantId: string;
  periodId: string;
  categoryId: string;
  title: string;
  description: string;
  weightage: number;
  sortOrder: number;
  createdByUserId: string;
}) {
  const existing = await prisma.kraDefinition.findFirst({
    where: { tenantId: input.tenantId, periodId: input.periodId, title: input.title },
  });

  if (existing) {
    return prisma.kraDefinition.update({
      where: { id: existing.id },
      data: {
        categoryId: input.categoryId,
        description: input.description,
        weightage: input.weightage,
        state: "ACTIVE",
        sortOrder: input.sortOrder,
      },
    });
  }

  return prisma.kraDefinition.create({
    data: {
      tenantId: input.tenantId,
      periodId: input.periodId,
      categoryId: input.categoryId,
      title: input.title,
      description: input.description,
      weightage: input.weightage,
      state: "ACTIVE",
      sortOrder: input.sortOrder,
      createdByUserId: input.createdByUserId,
    },
  });
}

function measurementDefaultFields(measurementType: KpiMeasurementType, target: TargetPayload) {
  return {
    targetValue:
      measurementType === "NUMERIC" ||
      measurementType === "PERCENTAGE" ||
      measurementType === "CURRENCY"
        ? target.value ?? null
        : null,
    targetMilestone: measurementType === "MILESTONE" ? target.milestone ?? null : null,
    targetDate: measurementType === "DATE_TARGET" ? target.date ?? null : null,
    targetBoolean: measurementType === "BOOLEAN" ? target.boolean ?? null : null,
    targetRating: measurementType === "RATING" ? target.rating ?? null : null,
    targetGrade: measurementType === "GRADE" ? target.grade ?? null : null,
  };
}

function achievementActualFields(plan: SeedAchievementPlan, measurementType: KpiMeasurementType) {
  return {
    actualValue:
      measurementType === "NUMERIC" ||
      measurementType === "PERCENTAGE" ||
      measurementType === "CURRENCY"
        ? plan.actualValue ?? null
        : null,
    actualMilestone: measurementType === "MILESTONE" ? plan.actualMilestone ?? null : null,
    actualDate: plan.actualDate ?? null,
  };
}

function computeScore(measurementType: KpiMeasurementType, target: TargetPayload, plan: SeedAchievementPlan) {
  if (measurementType === "MILESTONE") {
    return plan.actualMilestone === "COMPLETED" ? 100 : 50;
  }
  if (
    (measurementType === "NUMERIC" || measurementType === "PERCENTAGE" || measurementType === "CURRENCY") &&
    target.value &&
    plan.actualValue != null
  ) {
    return roundTo(Math.min(100, (plan.actualValue / target.value) * 100), 2);
  }
  return 100;
}

function buildVerificationLog(input: {
  plan: SeedAchievementPlan;
  users: Map<DemoUserKey, User>;
}) {
  const entries: Array<Record<string, unknown>> = [];
  const reporter = input.users.get(input.plan.reporterKey);
  if (reporter && input.plan.state !== "DRAFT") {
    entries.push({
      level: "SUBMIT",
      userId: reporter.id,
      userName: userName(reporter),
      action: "SUBMITTED",
      note: "Seeded demo submission.",
      at: addDays(input.plan.reportingDate, 1).toISOString(),
    });
  }

  if (input.plan.recommendation) {
    const recommender = input.users.get(input.plan.recommendation.byUserKey);
    if (recommender) {
      entries.push({
        level: "RECOMMEND",
        userId: recommender.id,
        userName: userName(recommender),
        action: "RECOMMENDED",
        note: input.plan.recommendation.note,
        at: input.plan.recommendation.at.toISOString(),
      });
    }
  }

  if (input.plan.state === "VERIFIED" || input.plan.state === "REJECTED") {
    const verifierKey = input.plan.verification?.byUserKey;
    const verifier = verifierKey ? input.users.get(verifierKey) : null;
    if (verifier) {
      entries.push({
        level: "VERIFY",
        userId: verifier.id,
        userName: userName(verifier),
        action: input.plan.state,
        note:
          input.plan.state === "VERIFIED"
            ? input.plan.verification?.note ?? "Verified in seeded Galgotias demo."
            : input.plan.verification?.rejectionReason ?? "Rejected in seeded Galgotias demo.",
        at: input.plan.verification?.at?.toISOString() ?? addDays(input.plan.reportingDate, 4).toISOString(),
      });
    }
  }

  return entries;
}

function deriveFlowStatus(states: AchievementState[]): KpiFlowStatus {
  if (states.includes("RECOMMENDED")) return "FINAL_REVIEW";
  if (states.includes("SUBMITTED")) return "SUBMITTED";
  if (states.includes("REJECTED")) return "REJECTED";
  if (states.includes("VERIFIED")) return "VERIFIED";
  if (states.includes("DRAFT")) return "IN_PROGRESS";
  return "ASSIGNED";
}

async function recreateSubmissionTrail(input: {
  achievementId: string;
  plan: SeedAchievementPlan;
  users: Map<DemoUserKey, User>;
  userPlansByKey: Map<DemoUserKey, DemoUserPlan>;
  units: Map<string, OrgUnit>;
}) {
  await prisma.submissionTrail.deleteMany({ where: { achievementId: input.achievementId } });

  const reporter = input.users.get(input.plan.reporterKey);
  const reporterPlan = input.userPlansByKey.get(input.plan.reporterKey);
  const reporterUnit = reporterPlan ? input.units.get(reporterPlan.primaryUnitCode) : null;
  if (!reporter || !reporterPlan) {
    return;
  }

  const trailEntries: Array<{
    action: string;
    actorUserId: string;
    actorName: string;
    actorRole: string;
    actorUnitName: string | null;
    note: string | null;
    createdAt: Date;
  }> = [
    {
      action: "RECORDED",
      actorUserId: reporter.id,
      actorName: userName(reporter),
      actorRole: reporterPlan.membershipRole,
      actorUnitName: reporterUnit?.name ?? null,
      note: "Seeded Galgotias demo achievement.",
      createdAt: input.plan.reportingDate,
    },
  ];

  if (input.plan.state !== "DRAFT") {
    trailEntries.push({
      action: "SUBMITTED",
      actorUserId: reporter.id,
      actorName: userName(reporter),
      actorRole: reporterPlan.membershipRole,
      actorUnitName: reporterUnit?.name ?? null,
      note: "Submitted into the review pipeline.",
      createdAt: addDays(input.plan.reportingDate, 1),
    });
  }

  if (input.plan.recommendation) {
    const recommender = input.users.get(input.plan.recommendation.byUserKey);
    const recommenderPlan = input.userPlansByKey.get(input.plan.recommendation.byUserKey);
    const recommenderUnit = recommenderPlan ? input.units.get(recommenderPlan.primaryUnitCode) : null;
    if (recommender && recommenderPlan) {
      trailEntries.push({
        action: "RECOMMENDED",
        actorUserId: recommender.id,
        actorName: userName(recommender),
        actorRole: recommenderPlan.membershipRole,
        actorUnitName: recommenderUnit?.name ?? null,
        note: input.plan.recommendation.note,
        createdAt: input.plan.recommendation.at,
      });
    }
  }

  if (input.plan.state === "VERIFIED" || input.plan.state === "REJECTED") {
    const verifierKey = input.plan.verification?.byUserKey;
    const verifier = verifierKey ? input.users.get(verifierKey) : null;
    const verifierPlan = verifierKey ? input.userPlansByKey.get(verifierKey) : null;
    const verifierUnit = verifierPlan ? input.units.get(verifierPlan.primaryUnitCode) : null;
    if (verifier && verifierPlan) {
      trailEntries.push({
        action: input.plan.state,
        actorUserId: verifier.id,
        actorName: userName(verifier),
        actorRole: verifierPlan.membershipRole,
        actorUnitName: verifierUnit?.name ?? null,
        note:
          input.plan.state === "VERIFIED"
            ? input.plan.verification?.note ?? "Verified in demo."
            : input.plan.verification?.rejectionReason ?? "Rejected in demo.",
        createdAt: input.plan.verification?.at ?? addDays(input.plan.reportingDate, 4),
      });
    }
  }

  for (const row of trailEntries) {
    await prisma.submissionTrail.create({
      data: {
        achievementId: input.achievementId,
        action: row.action,
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        actorRole: row.actorRole,
        actorUnitName: row.actorUnitName,
        note: row.note,
        createdAt: row.createdAt,
      },
    });
  }
}

async function ensureGalgotiaDemoKpis(input: {
  tenantId: string;
  ownerUserId: string;
  unitMap: Map<string, OrgUnit>;
}) {
  await seedSystemKpiTemplates();
  const period = await ensurePeriod(input.tenantId, input.ownerUserId);

  const researchCategory = await ensureCategory({
    tenantId: input.tenantId,
    categoryKey: "RESEARCH",
    displayLabel: "Research",
    description: "Research and scholarly output initiatives.",
    colorHex: "#0f766e",
    createdByUserId: input.ownerUserId,
  });
  const innovationCategory = await ensureCategory({
    tenantId: input.tenantId,
    categoryKey: "INNOVATION",
    displayLabel: "Innovation and Projects",
    description: "Research grants, consultancy, patents, and innovation outcomes.",
    colorHex: "#1d4ed8",
    createdByUserId: input.ownerUserId,
  });
  const outreachCategory = await ensureCategory({
    tenantId: input.tenantId,
    categoryKey: "ACADEMIC_OUTREACH",
    displayLabel: "Academic Outreach",
    description: "Academic events, workshops, and executive education initiatives.",
    colorHex: "#b45309",
    createdByUserId: input.ownerUserId,
  });

  const kraMap = new Map<DemoKraKey, { id: string }>();
  kraMap.set(
    "RESEARCH_OUTPUT",
    await ensureKra({
      tenantId: input.tenantId,
      periodId: period.id,
      categoryId: researchCategory.id,
      title: "Research Output and Publications",
      description: "Galgotias publications, books, conference papers, and PhD outcomes.",
      weightage: 45,
      sortOrder: 1,
      createdByUserId: input.ownerUserId,
    }),
  );
  kraMap.set(
    "PROJECTS_IP",
    await ensureKra({
      tenantId: input.tenantId,
      periodId: period.id,
      categoryId: innovationCategory.id,
      title: "Research Projects, Grants and Intellectual Property",
      description: "Galgotias grant, consultancy, patent, and project-based incentive KPIs.",
      weightage: 35,
      sortOrder: 2,
      createdByUserId: input.ownerUserId,
    }),
  );
  kraMap.set(
    "ACADEMIC_OUTREACH",
    await ensureKra({
      tenantId: input.tenantId,
      periodId: period.id,
      categoryId: outreachCategory.id,
      title: "Academic Events and Executive Education",
      description: "Galgotias convenor, training, and executive education incentive KPIs.",
      weightage: 20,
      sortOrder: 3,
      createdByUserId: input.ownerUserId,
    }),
  );

  const templates = await prisma.kpiTemplate.findMany({
    where: {
      tenantId: null,
      isSystem: true,
      code: { in: KPI_PLANS.map((plan) => plan.templateCode) },
    },
    select: { id: true, code: true, builderPayload: true },
  });
  const templateByCode = new Map(templates.map((template) => [template.code, template]));

  const kpiRecords = new Map<string, { id: string; title: string; measurementType: KpiMeasurementType }>();
  for (const plan of KPI_PLANS) {
    const template = templateByCode.get(plan.templateCode);
    if (!template) {
      throw new Error(`Missing Galgotias template ${plan.templateCode}.`);
    }
    const title = ((template.builderPayload as { definition?: { title?: string } }).definition?.title ?? "").trim();
    if (!title) {
      throw new Error(`Template ${plan.templateCode} is missing a definition title.`);
    }
    const kra = kraMap.get(plan.kraKey);
    const startingUnit = input.unitMap.get(plan.startingUnitCode);
    if (!kra || !startingUnit) {
      throw new Error(`Missing KRA or starting unit for ${plan.templateCode}.`);
    }
    const existing = await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: kra.id, title },
      select: { id: true },
    });

    const result = await applyTemplateToKpi(
      input.tenantId,
      template.id,
      {
        kraDefinitionId: kra.id,
        kpiId: existing?.id,
        titleOverride: title,
        startingUnitId: startingUnit.id,
      },
      input.ownerUserId,
      "TENANT_OWNER",
    );
    if (result.status !== "success" || !result.id) {
      throw new Error(result.message);
    }

    const updated = await prisma.kpiDefinition.update({
      where: { id: result.id },
      data: {
        state: "ACTIVE",
        sortOrder: plan.sortOrder,
        weightage: plan.weightage,
        defaultTarget: plan.defaultTarget.value ?? null,
        startingUnitId: startingUnit.id,
      },
      select: { id: true, title: true, measurementType: true },
    });
    kpiRecords.set(plan.templateCode, updated);
  }

  return { period, kpiRecords };
}

async function ensureTargetAllocations(input: {
  tenantId: string;
  periodId: string;
  ownerUserId: string;
  users: Map<DemoUserKey, User>;
  kpis: Map<string, { id: string; title: string; measurementType: KpiMeasurementType }>;
}) {
  const allocationMap = new Map<string, { id: string }>();

  for (const plan of KPI_PLANS) {
    const kpi = input.kpis.get(plan.templateCode);
    if (!kpi) throw new Error(`Missing KPI record for ${plan.templateCode}.`);
    for (const assignee of plan.assignees) {
      const user = input.users.get(assignee.userKey);
      if (!user) throw new Error(`Missing user ${assignee.userKey} for allocation.`);
      const notes = `seed:galgotia-demo:allocation:${plan.templateCode}:${assignee.userKey}`;
      const fields = measurementDefaultFields(kpi.measurementType, assignee.target);
      const existing = await prisma.targetAllocation.findFirst({
        where: { tenantId: input.tenantId, notes },
      });
      const allocation = existing
        ? await prisma.targetAllocation.update({
            where: { id: existing.id },
            data: {
              periodId: input.periodId,
              kpiDefinitionId: kpi.id,
              assignedToUserId: user.id,
              assignedToUnitId: null,
              allocatedByUserId: input.ownerUserId,
              state: "LOCKED",
              lockedAt: existing.lockedAt ?? new Date(),
              flowStatus: "ASSIGNED",
              notes,
              ...fields,
            },
          })
        : await prisma.targetAllocation.create({
            data: {
              tenantId: input.tenantId,
              periodId: input.periodId,
              kpiDefinitionId: kpi.id,
              assignedToUserId: user.id,
              assignedToUnitId: null,
              allocatedByUserId: input.ownerUserId,
              state: "LOCKED",
              lockedAt: new Date(),
              flowStatus: "ASSIGNED",
              notes,
              ...fields,
            },
          });
      allocationMap.set(`${plan.templateCode}:${assignee.userKey}`, { id: allocation.id });
    }
  }

  return allocationMap;
}

async function ensureSeedAchievements(input: {
  tenantId: string;
  periodId: string;
  users: Map<DemoUserKey, User>;
  userPlansByKey: Map<DemoUserKey, DemoUserPlan>;
  unitMap: Map<string, OrgUnit>;
  kpis: Map<string, { id: string; title: string; measurementType: KpiMeasurementType }>;
  allocations: Map<string, { id: string }>;
}) {
  const contributorRoles = await prisma.contributorRole.findMany({
    where: { tenantId: input.tenantId, isActive: true },
    select: { id: true, code: true },
  });
  const contributorRoleMap = new Map(contributorRoles.map((role) => [role.code, role.id]));
  const allocationStates = new Map<string, AchievementState[]>();

  for (const plan of SEED_ACHIEVEMENTS) {
    const kpi = input.kpis.get(plan.templateCode);
    const allocation = input.allocations.get(`${plan.templateCode}:${plan.assigneeKey}`);
    const reporter = input.users.get(plan.reporterKey);
    if (!kpi || !allocation || !reporter) {
      throw new Error(`Seed achievement ${plan.seedKey} is missing a KPI, allocation, or reporter.`);
    }
    const targetPlan = KPI_PLANS.find(
      (kpiPlan) =>
        kpiPlan.templateCode === plan.templateCode &&
        kpiPlan.assignees.some((assignee) => assignee.userKey === plan.assigneeKey),
    )?.assignees.find((assignee) => assignee.userKey === plan.assigneeKey)?.target;
    if (!targetPlan) {
      throw new Error(`Missing target plan for ${plan.seedKey}.`);
    }

    const existing = await prisma.achievement.findFirst({
      where: {
        tenantId: input.tenantId,
        evidenceDescription: `seed:galgotia-demo:${plan.seedKey}`,
      },
      select: { id: true },
    });
    const computedScore = computeScore(kpi.measurementType, targetPlan, plan);
    const currentVerifierUserId = plan.verification?.currentVerifierUserKey
      ? input.users.get(plan.verification.currentVerifierUserKey)?.id ?? null
      : null;
    const currentVerifierUnitId = plan.verification?.currentVerifierUnitCode
      ? input.unitMap.get(plan.verification.currentVerifierUnitCode)?.id ?? null
      : null;
    const recommendedByUserId = plan.recommendation?.byUserKey
      ? input.users.get(plan.recommendation.byUserKey)?.id ?? null
      : null;
    const verifiedByUserId = plan.verification?.byUserKey
      ? input.users.get(plan.verification.byUserKey)?.id ?? null
      : null;

    const actualFields = achievementActualFields(plan, kpi.measurementType);
    const achievementData = {
      tenantId: input.tenantId,
      periodId: input.periodId,
      kpiDefinitionId: kpi.id,
      targetAllocationId: allocation.id,
      reportedByUserId: reporter.id,
      title: plan.title,
      evidenceDescription: `seed:galgotia-demo:${plan.seedKey}`,
      evidenceLinks: plan.evidenceLinks,
      achievementFormData: plan.formData as object,
      state: plan.state,
      currentVerifierUnitId,
      currentVerifierUserId,
      isTeamAchievement: plan.contributors.length > 1,
      computedScore,
      effectiveScore: computedScore,
      recommendedByUserId,
      recommendedAt: plan.recommendation?.at ?? null,
      recommendationNote: plan.recommendation?.note ?? null,
      verifiedByUserId: plan.state === "VERIFIED" ? verifiedByUserId : null,
      verifiedAt: plan.state === "VERIFIED" ? plan.verification?.at ?? null : null,
      verificationNote: plan.state === "VERIFIED" ? plan.verification?.note ?? null : null,
      rejectionReason: plan.state === "REJECTED" ? plan.verification?.rejectionReason ?? null : null,
      verificationLog: buildVerificationLog({ plan, users: input.users }) as object,
      reportingDate: plan.reportingDate,
      ...actualFields,
    };

    const achievement = existing
      ? await prisma.achievement.update({ where: { id: existing.id }, data: achievementData })
      : await prisma.achievement.create({ data: achievementData });

    await prisma.achievementContributor.deleteMany({ where: { achievementId: achievement.id } });
    if (plan.contributors.length > 0) {
      await prisma.achievementContributor.createMany({
        data: plan.contributors.map((contributor) => {
          const contributorRoleId = contributorRoleMap.get(contributor.contributorRoleCode);
          if (!contributorRoleId) {
            throw new Error(`Contributor role ${contributor.contributorRoleCode} is not seeded.`);
          }
          return {
            achievementId: achievement.id,
            type: contributor.type ?? "INTERNAL",
            userId: contributor.userKey ? input.users.get(contributor.userKey)?.id ?? null : null,
            externalName: contributor.externalName ?? null,
            externalAffiliation: contributor.externalAffiliation ?? null,
            externalScope: contributor.externalScope ?? null,
            contributorRoleId,
            creditPercent: contributor.creditPercent,
            selectorTags: contributor.selectorTags ?? [],
            isExcludedFromReward: contributor.isExcludedFromReward ?? false,
            note: contributor.note ?? null,
          };
        }),
      });
    }

    await recreateSubmissionTrail({
      achievementId: achievement.id,
      plan,
      users: input.users,
      userPlansByKey: input.userPlansByKey,
      units: input.unitMap,
    });

    const states = allocationStates.get(allocation.id) ?? [];
    states.push(plan.state);
    allocationStates.set(allocation.id, states);
  }

  for (const [allocationId, states] of allocationStates.entries()) {
    await prisma.targetAllocation.update({
      where: { id: allocationId },
      data: { flowStatus: deriveFlowStatus(states) },
    });
  }
}

async function finalizePeriodState(periodId: string) {
  await prisma.assessmentPeriod.update({
    where: { id: periodId },
    data: { state: "IN_PROGRESS" satisfies AssessmentPeriodState },
  });
}

async function main() {
  const { tenant, superadmin, ownerUser } = await ensureTenantAndSuperadmin();
  const { version, unitMap } = await ensurePublishedStructure(tenant.id, ownerUser.id);
  const roleMap = await ensureRoleDefinitions(tenant.id, ownerUser.id);
  const users = await syncUsers({
    tenantId: tenant.id,
    actorUserId: ownerUser.id,
    versionId: version.id,
    unitMap,
    roleMap,
  });
  await regenerateReportingLines({
    tenantId: tenant.id,
    versionId: version.id,
    actorUserId: ownerUser.id,
  });

  const userPlansByKey = new Map(USER_PLANS.map((plan) => [plan.key, plan]));
  const { period, kpiRecords } = await ensureGalgotiaDemoKpis({
    tenantId: tenant.id,
    ownerUserId: ownerUser.id,
    unitMap,
  });
  const allocations = await ensureTargetAllocations({
    tenantId: tenant.id,
    periodId: period.id,
    ownerUserId: ownerUser.id,
    users,
    kpis: kpiRecords,
  });
  await ensureSeedAchievements({
    tenantId: tenant.id,
    periodId: period.id,
    users,
    userPlansByKey,
    unitMap,
    kpis: kpiRecords,
    allocations,
  });
  await finalizePeriodState(period.id);

  const [kpiCount, allocationCount, achievementCount] = await Promise.all([
    prisma.kpiDefinition.count({ where: { kraDefinition: { tenantId: tenant.id, periodId: period.id } } }),
    prisma.targetAllocation.count({ where: { tenantId: tenant.id, periodId: period.id } }),
    prisma.achievement.count({ where: { tenantId: tenant.id, periodId: period.id } }),
  ]);

  console.log("Galgotias demo seed completed.", {
    database: "postgresql://postgres:123@localhost:5432/logrequest",
    superadmin: superadmin.officialEmail,
    tenant: {
      code: tenant.code,
      name: tenant.name,
      domain: DEMO_DOMAIN,
      defaultPassword: DEMO_PASSWORD,
      period: DEMO_PERIOD.code,
    },
    sampleAccounts: [
      mail("owner"),
      mail("admin"),
      mail("faculty1"),
      mail("faculty2"),
      mail("employee"),
      mail("scse.director"),
      mail("soe.director"),
      mail("sob.director"),
    ],
    counts: {
      kpis: kpiCount,
      allocations: allocationCount,
      achievements: achievementCount,
    },
    note: "Use `npm run seed:galgotia:templates` if you only want the Galgotias system templates without the full demo tenant.",
  });
}

main()
  .catch((error) => {
    console.error("Failed to seed Galgotias demo data.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
