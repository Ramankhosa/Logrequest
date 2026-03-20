import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const assessmentPeriodFindFirstMock = vi.fn();
const kpiDefinitionFindFirstMock = vi.fn();
const listReviewCyclesMock = vi.fn();
const generateReviewCyclesMock = vi.fn();
const listTargetUnitsMock = vi.fn();
const addTargetUnitMock = vi.fn();
const removeTargetUnitMock = vi.fn();
const updateTargetUnitMock = vi.fn();
const allocateToTargetUnitsMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assessmentPeriod: {
      findFirst: assessmentPeriodFindFirstMock,
    },
    kpiDefinition: {
      findFirst: kpiDefinitionFindFirstMock,
    },
  },
}));

vi.mock("@/lib/kra-kpi/period-service", () => ({
  listReviewCycles: listReviewCyclesMock,
  generateReviewCycles: generateReviewCyclesMock,
}));

vi.mock("@/lib/kra-kpi/kpi-service", () => ({
  listTargetUnits: listTargetUnitsMock,
  addTargetUnit: addTargetUnitMock,
  removeTargetUnit: removeTargetUnitMock,
  updateTargetUnit: updateTargetUnitMock,
}));

vi.mock("@/lib/kra-kpi/target-service", () => ({
  allocateToTargetUnits: allocateToTargetUnitsMock,
}));

function tenantSession(role: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_USER" = "TENANT_ADMIN") {
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
  assessmentPeriodFindFirstMock.mockResolvedValue({ id: "period-1" });
  kpiDefinitionFindFirstMock.mockResolvedValue({ id: "kpi-1" });
});

describe("R2.1 route contracts", () => {
  test("all routes return 403 when the session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const reviewCyclesRoute = await import("@/app/api/tenant/kra-kpi/periods/[id]/review-cycles/route");
    const targetUnitsRoute = await import("@/app/api/tenant/kra-kpi/kpis/[id]/target-units/route");
    const allocateRoute = await import("@/app/api/tenant/kra-kpi/kpis/[id]/allocate-to-targets/route");

    const reviewGet = await reviewCyclesRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "period-1" }),
    });
    const reviewPost = await reviewCyclesRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "period-1" }),
    });
    const targetGet = await targetUnitsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "kpi-1" }),
    });
    const targetPost = await targetUnitsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ unitId: "unit-1" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );
    const allocatePost = await allocateRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ periodId: "period-1", targetValue: 100 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );

    expect(reviewGet.status).toBe(403);
    expect(reviewPost.status).toBe(403);
    expect(targetGet.status).toBe(403);
    expect(targetPost.status).toBe(403);
    expect(allocatePost.status).toBe(403);
  });

  test("review-cycle GET returns 404 when the period is not found in the tenant", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    assessmentPeriodFindFirstMock.mockResolvedValue(null);

    const reviewCyclesRoute = await import("@/app/api/tenant/kra-kpi/periods/[id]/review-cycles/route");
    const res = await reviewCyclesRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing-period" }),
    });

    expect(res.status).toBe(404);
    expect(listReviewCyclesMock).not.toHaveBeenCalled();
  });

  test("review-cycle GET returns the current envelope on success", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    listReviewCyclesMock.mockResolvedValue([{ id: "cycle-1", cycleNumber: 1 }]);

    const reviewCyclesRoute = await import("@/app/api/tenant/kra-kpi/periods/[id]/review-cycles/route");
    const res = await reviewCyclesRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "period-1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cycles: [{ id: "cycle-1", cycleNumber: 1 }] });
  });

  test("review-cycle POST maps permission and not-found errors to 403 and 404", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));
    generateReviewCyclesMock.mockResolvedValueOnce({
      status: "error",
      code: "PERMISSION_DENIED",
      message: "Insufficient permissions.",
    });

    const reviewCyclesRoute = await import("@/app/api/tenant/kra-kpi/periods/[id]/review-cycles/route");
    const forbiddenRes = await reviewCyclesRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "period-1" }),
    });
    expect(forbiddenRes.status).toBe(403);

    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_ADMIN"));
    generateReviewCyclesMock.mockResolvedValueOnce({
      status: "error",
      code: "PERIOD_NOT_FOUND",
      message: "Assessment period not found.",
    });
    const missingRes = await reviewCyclesRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "missing-period" }),
    });
    expect(missingRes.status).toBe(404);
  });

  test("target-units GET returns 404 when the KPI is not found in the tenant", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    kpiDefinitionFindFirstMock.mockResolvedValue(null);

    const targetUnitsRoute = await import("@/app/api/tenant/kra-kpi/kpis/[id]/target-units/route");
    const res = await targetUnitsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing-kpi" }),
    });

    expect(res.status).toBe(404);
    expect(listTargetUnitsMock).not.toHaveBeenCalled();
  });

  test("target-units POST returns 201 on success and 409 on duplicates", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_ADMIN"));
    addTargetUnitMock.mockResolvedValueOnce({ status: "success", message: "Target unit added." });
    addTargetUnitMock.mockResolvedValueOnce({
      status: "error",
      code: "DUPLICATE_TARGET_UNIT",
      message: "This unit is already a target for this KPI.",
    });

    const targetUnitsRoute = await import("@/app/api/tenant/kra-kpi/kpis/[id]/target-units/route");
    const createRes = await targetUnitsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ unitId: "unit-1", targetShare: 25 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );
    const duplicateRes = await targetUnitsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ unitId: "unit-1", targetShare: 25 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );

    expect(createRes.status).toBe(201);
    expect(duplicateRes.status).toBe(409);
  });

  test("target-units PATCH and DELETE map errors to 404 and 403", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_ADMIN"));
    updateTargetUnitMock.mockResolvedValueOnce({
      status: "error",
      code: "KPI_NOT_FOUND",
      message: "KPI not found.",
    });
    removeTargetUnitMock.mockResolvedValueOnce({
      status: "error",
      code: "PERMISSION_DENIED",
      message: "Insufficient permissions.",
    });

    const targetUnitsRoute = await import("@/app/api/tenant/kra-kpi/kpis/[id]/target-units/route");
    const patchRes = await targetUnitsRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ unitId: "unit-1", targetShare: 50 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );
    const deleteRes = await targetUnitsRoute.DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({ unitId: "unit-1" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );

    expect(patchRes.status).toBe(404);
    expect(deleteRes.status).toBe(403);
  });

  test("allocate-to-targets validates required input and maps typed service errors", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_ADMIN"));
    allocateToTargetUnitsMock.mockResolvedValueOnce({
      status: "error",
      code: "PERIOD_NOT_FOUND",
      message: "Period not found.",
    });
    allocateToTargetUnitsMock.mockResolvedValueOnce({
      status: "success",
      message: "3 allocation(s) created.",
    });

    const allocateRoute = await import("@/app/api/tenant/kra-kpi/kpis/[id]/allocate-to-targets/route");
    const missingPeriodRes = await allocateRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ targetValue: 100 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );
    const missingResourceRes = await allocateRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ periodId: "missing-period", targetValue: 100 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );
    const successRes = await allocateRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ periodId: "period-1", targetValue: 100 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );

    expect(missingPeriodRes.status).toBe(400);
    expect(missingResourceRes.status).toBe(404);
    expect(successRes.status).toBe(200);
  });
});
