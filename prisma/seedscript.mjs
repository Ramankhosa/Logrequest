import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserLifecycleState } from "@prisma/client";
import { hash } from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:123@localhost:5432/logrequest";
const DEMO_DOMAIN = "demo-university.local.test";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo@12345";

const pool = new Pool({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const FIRST = ["Aarav","Aditi","Akash","Amrita","Anika","Arjun","Bhavna","Diya","Farhan","Gauri","Harini","Ishaan","Kavya","Madhav","Meera","Neel","Pallavi","Pranav","Rhea","Sameer","Shaurya","Shruti","Tanvi","Tarun","Vedant","Vidya","Yash","Zoya"];
const LAST = ["Agarwal","Banerjee","Bhat","Desai","Ghosh","Gupta","Iyer","Jain","Joshi","Kapoor","Kulkarni","Mehta","Menon","Mishra","Nair","Patel","Rao","Reddy","Sen","Shah","Sharma","Singh","Srinivasan","Subramanian","Trivedi","Varma"];

const UNIT_TYPES = [
  ["ROOT", "ORG_ROOT", "Root", true, 0],
  ["FAC", "SCHOOL_LIKE_UNIT", "Faculty", false, 10],
  ["SCH", "SCHOOL_LIKE_UNIT", "School", false, 20],
  ["DEPT", "DEPARTMENT_LIKE_UNIT", "Department", false, 30],
  ["OFF", "OFFICE", "Office", false, 40],
];

const UNITS = [
  ["UNIV", "Demo University", "ROOT", null, 0, "root"],
  ["ENG", "Faculty of Engineering", "FAC", "UNIV", 10, "faculty"],
  ["SCI", "Faculty of Science", "FAC", "UNIV", 20, "faculty"],
  ["BUS", "Faculty of Business", "FAC", "UNIV", 30, "faculty"],
  ["ADM", "Central Administration", "OFF", "UNIV", 40, "admin-division"],
  ["COMP", "School of Computing", "SCH", "ENG", 10, "school"],
  ["ELEC", "School of Electronics", "SCH", "ENG", 20, "school"],
  ["MECH", "School of Mechanical Sciences", "SCH", "ENG", 30, "school"],
  ["MATH", "School of Mathematical Sciences", "SCH", "SCI", 10, "school"],
  ["LIFE", "School of Life Sciences", "SCH", "SCI", 20, "school"],
  ["MGMT", "School of Management", "SCH", "BUS", 10, "school"],
  ["FIN", "School of Finance", "SCH", "BUS", 20, "school"],
  ["REG", "Registrar Office", "OFF", "ADM", 10, "office"],
  ["HR", "Human Resources Office", "OFF", "ADM", 20, "office"],
  ["ITS", "IT Services Office", "OFF", "ADM", 30, "office"],
  ["CSE", "Department of Computer Science and Engineering", "DEPT", "COMP", 10, "department"],
  ["DSAI", "Department of Data Science and AI", "DEPT", "COMP", 20, "department"],
  ["CYB", "Department of Cyber Security", "DEPT", "COMP", 30, "department"],
  ["ECE", "Department of Electronics and Communication", "DEPT", "ELEC", 10, "department"],
  ["VLSI", "Department of VLSI Systems", "DEPT", "ELEC", 20, "department"],
  ["MFG", "Department of Manufacturing Engineering", "DEPT", "MECH", 10, "department"],
  ["AMTH", "Department of Applied Mathematics", "DEPT", "MATH", 10, "department"],
  ["STAT", "Department of Statistics", "DEPT", "MATH", 20, "department"],
  ["BIOT", "Department of Biotechnology", "DEPT", "LIFE", 10, "department"],
  ["MICR", "Department of Microbiology", "DEPT", "LIFE", 20, "department"],
  ["MBA", "MBA Programme", "DEPT", "MGMT", 10, "department"],
  ["BBA", "BBA Programme", "DEPT", "MGMT", 20, "department"],
  ["FINA", "Finance and Accounting", "DEPT", "FIN", 10, "department"],
  ["BANK", "Banking and Risk Studies", "DEPT", "FIN", 20, "department"],
];

const ROLES = [
  ["VICE_CHANCELLOR", "Vice Chancellor", true, true, 1, 10, "Institution-wide executive head."],
  ["DEAN", "Dean", true, true, 1, 20, "Faculty head."],
  ["SCHOOL_DIRECTOR", "School Director", true, true, 1, 30, "School-level academic head."],
  ["OFFICE_HEAD", "Office Head", true, true, 1, 40, "Administrative office head."],
  ["DEPARTMENT_HEAD", "Department Head", true, true, 1, 50, "Department-level academic head."],
  ["PROGRAM_COORDINATOR", "Program Coordinator", false, false, 3, 60, "Coordinates school and program delivery."],
  ["PROFESSOR", "Professor", false, false, -1, 70, "Senior academic staff."],
  ["ASSOCIATE_PROFESSOR", "Associate Professor", false, false, -1, 80, "Mid-career academic staff."],
  ["ASSISTANT_PROFESSOR", "Assistant Professor", false, false, -1, 90, "Early-career academic staff."],
  ["RESEARCH_FELLOW", "Research Fellow", false, false, -1, 100, "Research-focused contributor."],
  ["ADMIN_OFFICER", "Administrative Officer", false, false, -1, 110, "Handles operational support."],
  ["EXECUTIVE_ASSISTANT", "Executive Assistant", false, false, -1, 120, "Supports institutional leadership."],
];

const STAFF_ROLES = ["PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR", "RESEARCH_FELLOW"];

const hashSeed = (seed) => [...seed].reduce((v, ch) => ((v * 31) + ch.charCodeAt(0)) >>> 0, 0);
const personName = (seed) => ({ firstName: FIRST[hashSeed(seed) % FIRST.length], lastName: LAST[Math.floor(hashSeed(seed) / FIRST.length) % LAST.length] });
const mail = (local) => `${local}@${DEMO_DOMAIN}`;

async function upsertUser({ emailAddress, firstName, lastName, password, isSuperadmin = false }) {
  const passwordHash = await hash(password, 12);
  return prisma.user.upsert({
    where: { officialEmail: emailAddress.toLowerCase() },
    update: {
      firstName, lastName, isSuperadmin,
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
      firstName, lastName,
      officialEmail: emailAddress.toLowerCase(),
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

async function ensureMembership({ tenantId, userId, role, createdByUserId, employeeId, designation, department }) {
  return prisma.membership.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    update: { role, employeeId, designation, department, status: "ACTIVE", invitationState: "ACCEPTED", personnelStatus: "ACTIVE", createdByUserId, activationTimestamp: new Date() },
    create: { tenantId, userId, role, employeeId, designation, department, status: "ACTIVE", invitationState: "ACCEPTED", personnelStatus: "ACTIVE", createdByUserId, activationTimestamp: new Date() },
  });
}

async function ensurePrimaryUnitAssignment({ versionId, unitId, userId }) {
  await prisma.userOrgAssignment.updateMany({ where: { versionId, userId, isPrimary: true, unitId: { not: unitId } }, data: { assignmentType: "SECONDARY", isPrimary: false } });
  const existing = await prisma.userOrgAssignment.findFirst({ where: { versionId, unitId, userId } });
  if (existing) return prisma.userOrgAssignment.update({ where: { id: existing.id }, data: { assignmentType: "PRIMARY", isPrimary: true, effectiveTo: null, effectiveFrom: existing.effectiveFrom ?? new Date() } });
  return prisma.userOrgAssignment.create({ data: { versionId, unitId, userId, assignmentType: "PRIMARY", isPrimary: true, effectiveFrom: new Date() } });
}

async function ensureSecondaryUnitAssignment({ versionId, unitId, userId }) {
  const primary = await prisma.userOrgAssignment.findFirst({ where: { versionId, unitId, userId, assignmentType: "PRIMARY" } });
  if (primary) return primary;
  const existing = await prisma.userOrgAssignment.findFirst({ where: { versionId, unitId, userId, assignmentType: "SECONDARY" } });
  if (existing) return prisma.userOrgAssignment.update({ where: { id: existing.id }, data: { isPrimary: false, effectiveTo: null } });
  return prisma.userOrgAssignment.create({ data: { versionId, unitId, userId, assignmentType: "SECONDARY", isPrimary: false, effectiveFrom: new Date() } });
}
async function ensureTenantAndBaseUsers() {
  const superadmin = await upsertUser({ emailAddress: (process.env.SUPERADMIN_EMAIL ?? "superadmin@local.test").trim().toLowerCase(), firstName: process.env.SUPERADMIN_FIRST_NAME ?? "Platform", lastName: process.env.SUPERADMIN_LAST_NAME ?? "Admin", password: process.env.SUPERADMIN_PASSWORD ?? "Admin@12345", isSuperadmin: true });
  const owner = await upsertUser({ emailAddress: mail("owner"), firstName: "Demo", lastName: "Owner", password: DEMO_PASSWORD });
  const admin = await upsertUser({ emailAddress: mail("admin"), firstName: "Demo", lastName: "Admin", password: DEMO_PASSWORD });
  const facultyOne = await upsertUser({ emailAddress: mail("faculty1"), firstName: "Anita", lastName: "Faculty", password: DEMO_PASSWORD });
  const facultyTwo = await upsertUser({ emailAddress: mail("faculty2"), firstName: "Bharat", lastName: "Faculty", password: DEMO_PASSWORD });
  const demoEmployee = await upsertUser({ emailAddress: mail("employee"), firstName: "Demo", lastName: "Employee", password: DEMO_PASSWORD });

  const tenant = await prisma.tenant.upsert({
    where: { code: "DEMO_UNIV" },
    update: { name: "Demo University", legalOrganizationName: "Demo University", organizationType: "UNIVERSITY", primaryDomains: [DEMO_DOMAIN], subscriptionPlan: "ENTERPRISE", lifecycleState: "ACTIVE", ownerUserId: owner.id, createdByUserId: superadmin.id },
    create: { code: "DEMO_UNIV", name: "Demo University", legalOrganizationName: "Demo University", organizationType: "UNIVERSITY", primaryDomains: [DEMO_DOMAIN], subscriptionPlan: "ENTERPRISE", lifecycleState: "ACTIVE", ownerUserId: owner.id, createdByUserId: superadmin.id },
  });

  await prisma.tenantPolicy.upsert({ where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id } });
  return { superadmin, owner, admin, facultyOne, facultyTwo, demoEmployee, tenant };
}

async function ensureStructureVersion(tenantId, actorUserId) {
  const existing = await prisma.orgStructureVersion.findFirst({ where: { tenantId, state: "PUBLISHED" }, orderBy: { versionNumber: "desc" } });
  if (existing) return existing;
  const versionNumber = (await prisma.orgStructureVersion.aggregate({ where: { tenantId }, _max: { versionNumber: true } }))._max.versionNumber ?? 0;
  return prisma.orgStructureVersion.create({ data: { tenantId, name: "Demo Seed Structure", versionNumber: versionNumber + 1, state: "PUBLISHED", validatedAt: new Date(), publishedAt: new Date(), createdByUserId: actorUserId } });
}

async function ensureUnitType(versionId, tuple) {
  const [typeKey, internalCategory, displayLabel, allowRoot, sortOrder] = tuple;
  const existing = await prisma.orgUnitType.findUnique({ where: { versionId_typeKey: { versionId, typeKey } } });
  if (existing) return prisma.orgUnitType.update({ where: { id: existing.id }, data: { internalCategory, displayLabel, allowRoot, sortOrder } });
  return prisma.orgUnitType.create({ data: { versionId, typeKey, internalCategory, displayLabel, allowRoot, sortOrder } });
}

async function ensureUnit({ tenantId, versionId, typeId, code, name, parentId, sortOrder, createdByUserId }) {
  const existing = await prisma.orgUnit.findUnique({ where: { versionId_code: { versionId, code } } });
  if (existing) return prisma.orgUnit.update({ where: { id: existing.id }, data: { typeId, name, parentId, sortOrder, state: "ACTIVE", effectiveTo: null, createdByUserId } });
  return prisma.orgUnit.create({ data: { tenantId, versionId, typeId, code, name, parentId, level: 0, sortOrder, path: code, state: "ACTIVE", createdByUserId } });
}

async function syncUnits({ tenantId, versionId, actorUserId }) {
  const typeMap = new Map();
  for (const tuple of UNIT_TYPES) typeMap.set(tuple[0], await ensureUnitType(versionId, tuple));

  const unitMap = new Map();
  for (const [code, name, typeKey, parentCode, sortOrder] of UNITS) {
    const parent = parentCode ? unitMap.get(parentCode) : null;
    const unit = await ensureUnit({ tenantId, versionId, typeId: typeMap.get(typeKey).id, code, name, parentId: parent?.id ?? null, sortOrder, createdByUserId: actorUserId });
    unitMap.set(code, unit);
  }

  const childrenByParent = new Map();
  for (const tuple of UNITS) {
    const parentCode = tuple[3] ?? "__ROOT__";
    const list = childrenByParent.get(parentCode) ?? [];
    list.push(tuple);
    childrenByParent.set(parentCode, list.sort((a, b) => a[4] - b[4]));
  }

  const visit = async (code, level, parentPath, parentId) => {
    const unit = unitMap.get(code);
    const path = parentPath ? `${parentPath}/${code}` : code;
    await prisma.orgUnit.update({ where: { id: unit.id }, data: { parentId, level, path, state: "ACTIVE" } });
    for (const child of childrenByParent.get(code) ?? []) await visit(child[0], level + 1, path, unit.id);
  };

  await visit("UNIV", 0, "", null);
  const refreshed = await prisma.orgUnit.findMany({ where: { versionId } });
  return new Map(refreshed.map((unit) => [unit.code, unit]));
}

async function syncRoleDefinitions(tenantId, actorUserId) {
  const roleMap = new Map();
  for (const [roleKey, displayLabel, isUnitHead, approvalAuthority, maxPerUnit, sortOrder, description] of ROLES) {
    const role = await prisma.orgRoleDefinition.upsert({
      where: { tenantId_roleKey: { tenantId, roleKey } },
      update: { displayLabel, description, isUnitHead, approvalAuthority, maxPerUnit, sortOrder, isActive: true },
      create: { tenantId, roleKey, displayLabel, description, isUnitHead, approvalAuthority, maxPerUnit, sortOrder, isActive: true, createdByUserId: actorUserId },
    });
    roleMap.set(roleKey, role);
  }
  return roleMap;
}

function plan(localPart, primaryUnitCode, designation, roleAssignments, extra = {}) {
  const derived = personName(localPart);
  return {
    emailAddress: mail(localPart),
    firstName: extra.firstName ?? derived.firstName,
    lastName: extra.lastName ?? derived.lastName,
    password: DEMO_PASSWORD,
    membershipRole: extra.membershipRole ?? "TENANT_USER",
    primaryUnitCode,
    secondaryUnitCodes: extra.secondaryUnitCodes ?? [],
    designation,
    roleAssignments,
    employeeId: extra.employeeId ?? null,
  };
}

function buildPlans(baseUsers) {
  const plans = [
    plan("owner", "UNIV", "Vice Chancellor", [{ unitCode: "UNIV", roleKey: "VICE_CHANCELLOR" }], { membershipRole: "TENANT_OWNER", firstName: baseUsers.owner.firstName, lastName: baseUsers.owner.lastName, employeeId: "EMP-OWNER-001" }),
    plan("admin", "UNIV", "Executive Assistant", [{ unitCode: "UNIV", roleKey: "EXECUTIVE_ASSISTANT" }], { membershipRole: "TENANT_ADMIN", firstName: baseUsers.admin.firstName, lastName: baseUsers.admin.lastName, employeeId: "EMP-ADMIN-001" }),
    plan("faculty1", "CSE", "Professor", [{ unitCode: "CSE", roleKey: "PROFESSOR" }], { firstName: baseUsers.facultyOne.firstName, lastName: baseUsers.facultyOne.lastName, employeeId: "EMP-FAC-001" }),
    plan("faculty2", "ECE", "Associate Professor", [{ unitCode: "ECE", roleKey: "ASSOCIATE_PROFESSOR" }], { firstName: baseUsers.facultyTwo.firstName, lastName: baseUsers.facultyTwo.lastName, employeeId: "EMP-FAC-002" }),
    plan("employee", "CSE", "Assistant Professor", [{ unitCode: "CSE", roleKey: "ASSISTANT_PROFESSOR" }], { firstName: baseUsers.demoEmployee.firstName, lastName: baseUsers.demoEmployee.lastName, employeeId: "EMP-CSE-003" }),
  ];

  for (const [code, , , , , group] of UNITS.filter((row) => row[5] === "faculty")) {
    plans.push(plan(`${code.toLowerCase()}.dean`, code, "Dean", [{ unitCode: code, roleKey: "DEAN" }]));
    plans.push(plan(`${code.toLowerCase()}.assistant`, code, "Executive Assistant", [{ unitCode: code, roleKey: "EXECUTIVE_ASSISTANT" }]));
  }

  for (const [code, , , , , group] of UNITS.filter((row) => row[5] === "admin-division")) {
    plans.push(plan(`${code.toLowerCase()}.head`, code, "Office Head", [{ unitCode: code, roleKey: "OFFICE_HEAD" }]));
    plans.push(plan(`${code.toLowerCase()}.officer`, code, "Administrative Officer", [{ unitCode: code, roleKey: "ADMIN_OFFICER" }]));
  }

  for (const [code] of UNITS.filter((row) => row[5] === "school")) {
    plans.push(plan(`${code.toLowerCase()}.director`, code, "School Director", [{ unitCode: code, roleKey: "SCHOOL_DIRECTOR" }]));
    plans.push(plan(`${code.toLowerCase()}.coordinator`, code, "Program Coordinator", [{ unitCode: code, roleKey: "PROGRAM_COORDINATOR" }]));
  }

  for (const [code] of UNITS.filter((row) => row[5] === "office")) {
    plans.push(plan(`${code.toLowerCase()}.head`, code, "Office Head", [{ unitCode: code, roleKey: "OFFICE_HEAD" }]));
    plans.push(plan(`${code.toLowerCase()}.officer`, code, "Administrative Officer", [{ unitCode: code, roleKey: "ADMIN_OFFICER" }]));
  }

  let rotation = 0;
  for (const [code] of UNITS.filter((row) => row[5] === "department")) {
    plans.push(plan(`${code.toLowerCase()}.head`, code, "Department Head", [{ unitCode: code, roleKey: "DEPARTMENT_HEAD" }]));
    if (code === "CSE") {
      plans.push(plan("cse.fellow", "CSE", "Research Fellow", [{ unitCode: "CSE", roleKey: "RESEARCH_FELLOW" }]));
      continue;
    }
    if (code === "ECE") {
      plans.push(plan("ece.assistant", "ECE", "Assistant Professor", [{ unitCode: "ECE", roleKey: "ASSISTANT_PROFESSOR" }]));
      continue;
    }
    const roleA = STAFF_ROLES[rotation % STAFF_ROLES.length];
    const roleB = STAFF_ROLES[(rotation + 1) % STAFF_ROLES.length];
    rotation += 2;
    plans.push(plan(`${code.toLowerCase()}.staff1`, code, ROLES.find((r) => r[0] === roleA)[1], [{ unitCode: code, roleKey: roleA }]));
    plans.push(plan(`${code.toLowerCase()}.staff2`, code, ROLES.find((r) => r[0] === roleB)[1], [{ unitCode: code, roleKey: roleB }]));
  }

  return plans.map((item, index) => ({ ...item, employeeId: item.employeeId ?? `EMP-${String(index + 1).padStart(4, "0")}` }));
}

async function syncPlan({ tenant, actorUserId, versionId, planItem, unitMap, roleMap, unitById }) {
  const user = await upsertUser({ emailAddress: planItem.emailAddress, firstName: planItem.firstName, lastName: planItem.lastName, password: planItem.password });
  const primaryUnit = unitMap.get(planItem.primaryUnitCode);
  const desiredUnitCodes = new Set([planItem.primaryUnitCode, ...planItem.secondaryUnitCodes, ...planItem.roleAssignments.map((item) => item.unitCode)]);
  const desiredRoleKeys = new Set(planItem.roleAssignments.map((item) => `${item.unitCode}:${item.roleKey}`));

  await ensureMembership({ tenantId: tenant.id, userId: user.id, role: planItem.membershipRole, createdByUserId: actorUserId, employeeId: planItem.employeeId, designation: planItem.designation, department: primaryUnit?.name ?? planItem.primaryUnitCode });

  const currentUnits = await prisma.userOrgAssignment.findMany({ where: { versionId, userId: user.id } });
  for (const assignment of currentUnits) {
    const unit = unitById.get(assignment.unitId);
    if (unit && !desiredUnitCodes.has(unit.code)) await prisma.userOrgAssignment.delete({ where: { id: assignment.id } });
  }

  await ensurePrimaryUnitAssignment({ versionId, unitId: primaryUnit.id, userId: user.id });
  for (const unitCode of desiredUnitCodes) {
    if (unitCode !== planItem.primaryUnitCode) await ensureSecondaryUnitAssignment({ versionId, unitId: unitMap.get(unitCode).id, userId: user.id });
  }

  const currentRoles = await prisma.orgRoleAssignment.findMany({ where: { versionId, userId: user.id }, include: { roleDefinition: { select: { roleKey: true } }, unit: { select: { code: true } } } });
  for (const assignment of currentRoles) {
    const key = `${assignment.unit.code}:${assignment.roleDefinition?.roleKey ?? assignment.roleName}`;
    if (!desiredRoleKeys.has(key)) await prisma.orgRoleAssignment.delete({ where: { id: assignment.id } });
  }

  for (const desired of planItem.roleAssignments) {
    const unit = unitMap.get(desired.unitCode);
    const role = roleMap.get(desired.roleKey);
    const existing = await prisma.orgRoleAssignment.findFirst({ where: { versionId, unitId: unit.id, userId: user.id, roleDefinitionId: role.id } });
    if (existing) {
      await prisma.orgRoleAssignment.update({ where: { id: existing.id }, data: { roleName: role.displayLabel, scope: "NODE", isActive: true, effectiveTo: null } });
    } else {
      await prisma.orgRoleAssignment.create({ data: { versionId, unitId: unit.id, userId: user.id, roleDefinitionId: role.id, roleName: role.displayLabel, scope: "NODE", isActive: true, effectiveFrom: new Date() } });
    }
  }

  return user;
}

async function regenerateReportingLines({ tenantId, versionId, actorUserId }) {
  const warnings = [];
  const units = await prisma.orgUnit.findMany({ where: { versionId, state: { not: "INACTIVE" } }, orderBy: [{ level: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, code: true, parentId: true, level: true } });
  const assignments = await prisma.orgRoleAssignment.findMany({ where: { versionId, isActive: true }, include: { roleDefinition: { select: { isUnitHead: true, sortOrder: true } } } });

  const grouped = new Map();
  for (const assignment of assignments) {
    const list = grouped.get(assignment.unitId) ?? [];
    list.push(assignment);
    grouped.set(assignment.unitId, list);
  }

  const headByUnit = new Map();
  for (const unit of units) {
    const list = grouped.get(unit.id) ?? [];
    const head = list.filter((item) => item.roleDefinition?.isUnitHead).sort((a, b) => (a.roleDefinition?.sortOrder ?? 0) - (b.roleDefinition?.sortOrder ?? 0))[0];
    if (head) headByUnit.set(unit.id, head.userId);
    else if (list.length > 0) warnings.push(`Unit \"${unit.name}\" (${unit.code}) has members but no head.`);
  }

  const seen = new Set();
  const lines = [];
  for (const unit of units) {
    const headUserId = headByUnit.get(unit.id);
    if (!headUserId) continue;
    for (const assignment of grouped.get(unit.id) ?? []) {
      if (assignment.userId === headUserId) continue;
      const key = `${headUserId}:${assignment.userId}:${unit.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push({ versionId, unitId: unit.id, managerUserId: headUserId, memberUserId: assignment.userId, lineType: "SOLID" });
      }
    }
    if (!unit.parentId) continue;
    const parentHead = headByUnit.get(unit.parentId);
    if (parentHead && parentHead !== headUserId) {
      const key = `${parentHead}:${headUserId}:${unit.parentId}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push({ versionId, unitId: unit.parentId, managerUserId: parentHead, memberUserId: headUserId, lineType: "SOLID" });
      }
    } else if (!parentHead) {
      const parent = units.find((item) => item.id === unit.parentId);
      if (parent) warnings.push(`Unit head of \"${unit.name}\" has no manager because parent \"${parent.name}\" has no head.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.reportingLine.deleteMany({ where: { versionId } });
    if (lines.length) await tx.reportingLine.createMany({ data: lines });
    await tx.auditLog.create({ data: { tenantId, actorUserId, actorRole: "TENANT_OWNER", targetType: "OrgStructureVersion", targetId: versionId, action: "seedscript.reporting_lines.derived", newState: { linesCreated: lines.length, warnings } } });
  });

  return { created: lines.length, warnings };
}

async function summarize(tenantId, versionId) {
  const [unitCount, levelAgg, roleDefinitionCount, membershipCount, roleAssignmentCount, reportingLineCount, seededUserCount] = await Promise.all([
    prisma.orgUnit.count({ where: { versionId } }),
    prisma.orgUnit.aggregate({ where: { versionId }, _max: { level: true } }),
    prisma.orgRoleDefinition.count({ where: { tenantId, isActive: true } }),
    prisma.membership.count({ where: { tenantId } }),
    prisma.orgRoleAssignment.count({ where: { versionId, isActive: true } }),
    prisma.reportingLine.count({ where: { versionId } }),
    prisma.membership.count({ where: { tenantId, user: { officialEmail: { endsWith: `@${DEMO_DOMAIN}` } } } }),
  ]);
  const departmentCodes = UNITS.filter((row) => row[5] === "department").map((row) => row[0]);
  const departmentCount = await prisma.orgUnit.count({ where: { versionId, code: { in: departmentCodes } } });
  return { unitCount, maxDepthLevel: levelAgg._max.level ?? 0, departmentCount, roleDefinitionCount, membershipCount, seededUserCount, roleAssignmentCount, reportingLineCount };
}

async function main() {
  const baseUsers = await ensureTenantAndBaseUsers();
  const { superadmin, owner, admin, tenant } = baseUsers;
  const version = await ensureStructureVersion(tenant.id, owner.id);
  const unitMap = await syncUnits({ tenantId: tenant.id, versionId: version.id, actorUserId: owner.id });
  const unitById = new Map([...unitMap.values()].map((unit) => [unit.id, unit]));
  const roleMap = await syncRoleDefinitions(tenant.id, owner.id);
  const plans = buildPlans(baseUsers);

  await ensureMembership({ tenantId: tenant.id, userId: owner.id, role: "TENANT_OWNER", createdByUserId: superadmin.id, employeeId: "EMP-OWNER-001", designation: "Vice Chancellor", department: unitMap.get("UNIV").name });
  await ensureMembership({ tenantId: tenant.id, userId: admin.id, role: "TENANT_ADMIN", createdByUserId: owner.id, employeeId: "EMP-ADMIN-001", designation: "Executive Assistant", department: unitMap.get("UNIV").name });

  const users = [];
  for (const planItem of plans) users.push(await syncPlan({ tenant, actorUserId: owner.id, versionId: version.id, planItem, unitMap, roleMap, unitById }));

  const reporting = await regenerateReportingLines({ tenantId: tenant.id, versionId: version.id, actorUserId: owner.id });
  const summary = await summarize(tenant.id, version.id);

  console.log("Seedscript completed:", {
    database: DATABASE_URL,
    demoTenant: { code: tenant.code, versionId: version.id, loginDomain: DEMO_DOMAIN, defaultPassword: DEMO_PASSWORD },
    seededUsers: users.length,
    reportingLinesCreated: reporting.created,
    reportingWarnings: reporting.warnings,
    summary,
    sampleAccounts: [mail("owner"), mail("admin"), mail("faculty1"), mail("employee"), mail("eng.dean"), mail("comp.director"), mail("cse.head"), mail("reg.officer")],
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
