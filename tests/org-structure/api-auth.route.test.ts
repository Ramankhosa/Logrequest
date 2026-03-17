import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const listRoleDefinitionsMock = vi.fn();
const createRoleDefinitionMock = vi.fn();
const updateRoleDefinitionMock = vi.fn();
const deleteRoleDefinitionMock = vi.fn();
const assignRoleToUserMock = vi.fn();
const removeRoleAssignmentMock = vi.fn();
const getUnitMembersMock = vi.fn();
const bulkAssignRolesMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/org-structure/roles-service", () => ({
  listRoleDefinitions: listRoleDefinitionsMock,
  createRoleDefinition: createRoleDefinitionMock,
  updateRoleDefinition: updateRoleDefinitionMock,
  deleteRoleDefinition: deleteRoleDefinitionMock,
  assignRoleToUser: assignRoleToUserMock,
  removeRoleAssignment: removeRoleAssignmentMock,
  getUnitMembers: getUnitMembersMock,
  bulkAssignRoles: bulkAssignRolesMock,
}));

function tenantSession(role: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_USER") {
  return {
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      role,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API Route Auth & Authorization", () => {
  test("10.1 all role endpoints return 403 when session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const rolesRoute = await import("@/app/api/tenant/structure/roles/route");
    const roleIdRoute = await import(
      "@/app/api/tenant/structure/roles/[roleId]/route"
    );
    const assignRoute = await import(
      "@/app/api/tenant/structure/roles/assign/route"
    );

    const getRes = await rolesRoute.GET();
    const postRes = await rolesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    const patchRes = await roleIdRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ roleId: "role-1" }) },
    );
    const deleteRes = await roleIdRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ roleId: "role-1" }),
    });
    const assignPostRes = await assignRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    const assignDeleteRes = await assignRoute.DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({ assignmentId: "a-1" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(getRes.status).toBe(403);
    expect(postRes.status).toBe(403);
    expect(patchRes.status).toBe(403);
    expect(deleteRes.status).toBe(403);
    expect(assignPostRes.status).toBe(403);
    expect(assignDeleteRes.status).toBe(403);
  });

  test("10.2 role endpoints return 403 when session has no tenantId", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "user-1", role: "TENANT_ADMIN" },
    });

    const rolesRoute = await import("@/app/api/tenant/structure/roles/route");
    const roleIdRoute = await import(
      "@/app/api/tenant/structure/roles/[roleId]/route"
    );
    const assignRoute = await import(
      "@/app/api/tenant/structure/roles/assign/route"
    );

    const getRes = await rolesRoute.GET();
    const postRes = await rolesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    const patchRes = await roleIdRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ roleId: "role-1" }) },
    );
    const deleteRes = await roleIdRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ roleId: "role-1" }),
    });
    const assignPostRes = await assignRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    const assignDeleteRes = await assignRoute.DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({ assignmentId: "a-1" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(getRes.status).toBe(403);
    expect(postRes.status).toBe(403);
    expect(patchRes.status).toBe(403);
    expect(deleteRes.status).toBe(403);
    expect(assignPostRes.status).toBe(403);
    expect(assignDeleteRes.status).toBe(403);
  });

  test("10.3 role create/update/delete return 403 for TENANT_USER", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));

    const rolesRoute = await import("@/app/api/tenant/structure/roles/route");
    const roleIdRoute = await import(
      "@/app/api/tenant/structure/roles/[roleId]/route"
    );

    const postRes = await rolesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ roleKey: "DEAN", displayLabel: "Dean" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const patchRes = await roleIdRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ displayLabel: "Dean Updated" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ roleId: "role-1" }) },
    );
    const deleteRes = await roleIdRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ roleId: "role-1" }),
    });

    expect(postRes.status).toBe(403);
    expect(patchRes.status).toBe(403);
    expect(deleteRes.status).toBe(403);
  });

  test("10.4 role create/update/delete succeed for TENANT_ADMIN", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_ADMIN"));
    createRoleDefinitionMock.mockResolvedValue({
      status: "success",
      message: "created",
    });
    updateRoleDefinitionMock.mockResolvedValue({
      status: "success",
      message: "updated",
    });
    deleteRoleDefinitionMock.mockResolvedValue({
      status: "success",
      message: "deleted",
    });

    const rolesRoute = await import("@/app/api/tenant/structure/roles/route");
    const roleIdRoute = await import(
      "@/app/api/tenant/structure/roles/[roleId]/route"
    );

    const postRes = await rolesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ roleKey: "DEAN", displayLabel: "Dean" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const patchRes = await roleIdRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ displayLabel: "Dean Updated" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ roleId: "role-1" }) },
    );
    const deleteRes = await roleIdRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ roleId: "role-1" }),
    });

    expect(postRes.status).toBe(201);
    expect(patchRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
  });

  test("10.5 role create/update/delete succeed for TENANT_OWNER", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    createRoleDefinitionMock.mockResolvedValue({
      status: "success",
      message: "created",
    });
    updateRoleDefinitionMock.mockResolvedValue({
      status: "success",
      message: "updated",
    });
    deleteRoleDefinitionMock.mockResolvedValue({
      status: "success",
      message: "deleted",
    });

    const rolesRoute = await import("@/app/api/tenant/structure/roles/route");
    const roleIdRoute = await import(
      "@/app/api/tenant/structure/roles/[roleId]/route"
    );

    const postRes = await rolesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ roleKey: "DEAN", displayLabel: "Dean" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const patchRes = await roleIdRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ displayLabel: "Dean Updated" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ roleId: "role-1" }) },
    );
    const deleteRes = await roleIdRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ roleId: "role-1" }),
    });

    expect(postRes.status).toBe(201);
    expect(patchRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
  });

  test("10.6 role list allows TENANT_USER", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));
    listRoleDefinitionsMock.mockResolvedValue([
      { id: "r-1", roleKey: "DEAN", displayLabel: "Dean", assignmentCount: 0 },
    ]);

    const rolesRoute = await import("@/app/api/tenant/structure/roles/route");
    const res = await rolesRoute.GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data)).toBe(true);
  });

  test("10.7 unit members GET allows TENANT_USER", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));
    getUnitMembersMock.mockResolvedValue([
      { id: "a-1", roleName: "Head", userId: "u-2", unitId: "unit-1" },
    ]);

    const membersRoute = await import(
      "@/app/api/tenant/structure/units/[unitId]/members/route"
    );
    const res = await membersRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ unitId: "unit-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("success");
    expect(json.data).toHaveLength(1);
  });

  test("10.8 user import returns 403 for TENANT_USER", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));
    const userImportRoute = await import(
      "@/app/api/tenant/structure/user-import/route"
    );
    const formData = new FormData();
    formData.set(
      "file",
      new File(["email,first_name,last_name,unit_code,role_key"], "import.csv", {
        type: "text/csv",
      }),
    );
    formData.set("action", "preview");
    const res = await userImportRoute.POST(
      new Request("http://localhost", { method: "POST", body: formData }),
    );

    expect(res.status).toBe(403);
  });

  test("10.9 user import returns 400 when file is missing", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_ADMIN"));
    const userImportRoute = await import(
      "@/app/api/tenant/structure/user-import/route"
    );
    const formData = new FormData();
    formData.set("action", "preview");

    const res = await userImportRoute.POST(
      new Request("http://localhost", { method: "POST", body: formData }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("No file provided");
  });

  test("10.10 user import returns 400 for invalid action", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_ADMIN"));
    const userImportRoute = await import(
      "@/app/api/tenant/structure/user-import/route"
    );
    const formData = new FormData();
    formData.set(
      "file",
      new File(
        [
          "email,first_name,last_name,employee_id,unit_code,role_key\nalice@example.com,Alice,Walker,EMP001,CSE,DEPT_HEAD",
        ],
        "import.csv",
        { type: "text/csv" },
      ),
    );
    formData.set("action", "something-else");

    const res = await userImportRoute.POST(
      new Request("http://localhost", { method: "POST", body: formData }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.message).toContain("Invalid action");
  });
});
