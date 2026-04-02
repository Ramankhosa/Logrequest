import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const kpiDefinitionFindFirstMock = vi.fn();
const previewSubmissionRewardsMock = vi.fn();
const runDuplicateDetectionMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    kpiDefinition: {
      findFirst: kpiDefinitionFindFirstMock,
    },
  },
}));

vi.mock("@/lib/kra-kpi/reward-service", () => ({
  previewSubmissionRewards: previewSubmissionRewardsMock,
}));

vi.mock("@/lib/kra-kpi/duplicate-detection-service", () => ({
  runDuplicateDetection: runDuplicateDetectionMock,
}));

function tenantSession() {
  return {
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      role: "TENANT_USER",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("My achievement preview route", () => {
  test("requires an authenticated tenant session", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const route = await import("@/app/api/tenant/kra-kpi/my/achievement-preview/route");
    const response = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
  });

  test("returns 404 when the KPI is not available in the tenant period", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    kpiDefinitionFindFirstMock.mockResolvedValue(null);

    const route = await import("@/app/api/tenant/kra-kpi/my/achievement-preview/route");
    const response = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          periodId: "period-1",
          kpiDefinitionId: "kpi-1",
          achievementFormData: {},
          contributors: [],
          systemMetrics: {},
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(kpiDefinitionFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "kpi-1",
        kraDefinition: {
          tenantId: "tenant-1",
          periodId: "period-1",
        },
      },
      select: {
        title: true,
        achievementFormConfig: true,
      },
    });
  });

  test("returns normalized preview data and duplicate warnings for the form", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    kpiDefinitionFindFirstMock.mockResolvedValue({
      title: "Journal KPI",
      achievementFormConfig: {
        fields: [],
      },
    });
    previewSubmissionRewardsMock.mockResolvedValue({
      normalizedFormData: {
        journalQuartile: "Q1",
        authorshipCase: "CASE_1",
      },
      normalizedContributors: [
        {
          id: "draft-1",
          type: "INTERNAL",
          userId: "user-1",
          contributorRoleId: "role-1",
          creditPercent: 35,
          isExcludedFromReward: false,
          selectorTags: [],
          rewardBucket: "FIRST_AUTHOR",
          exclusionReason: null,
        },
      ],
      derivedAuthorshipCase: "CASE_1",
      warnings: ["Author counts are still being validated."],
      errors: [],
      rationale: ["Derived from author roles"],
      counts: {
        internal: 1,
        external: 0,
        eligible: 1,
        excluded: 0,
      },
      rewardPreview: {
        components: [
          {
            componentCode: "Q1_CASE_1_INCENTIVE",
            componentName: "Q1 Case 1 Incentive",
            benefitTypeName: "Incentive",
            unit: "Rs.",
            totalAmount: 30000,
            contributors: [
              {
                contributorId: "draft-1",
                userId: "user-1",
                contributorRoleId: "role-1",
                amount: 10500,
                blocked: false,
                reason: null,
              },
            ],
          },
        ],
      },
    });
    runDuplicateDetectionMock.mockResolvedValue({
      checked: true,
      hasDuplicates: true,
      matches: [
        {
          achievementId: "ach-2",
          matchedField: "doi",
          matchedValue: "10.1000/example",
          reportedByName: "Faculty A",
          reportedByUserId: "user-2",
          sameReporter: false,
          achievementState: "SUBMITTED",
          achievementTitle: "Another Journal",
          periodId: "period-1",
          samePeriod: true,
          similarity: "EXACT",
          matchType: "POLICY_WARNING",
          note: "Possible duplicate DOI match.",
          relatedKpiTitle: "Journal KPI",
        },
      ],
    });

    const payload = {
      periodId: "period-1",
      kpiDefinitionId: "kpi-1",
      achievementId: "ach-1",
      actualValue: 1,
      reportingDate: "2026-04-02T00:00:00.000Z",
      achievementFormData: {
        paperTitle: "Sample Paper",
      },
      contributors: [
        {
          id: "draft-1",
          type: "INTERNAL",
          userId: "user-1",
          contributorRoleId: "role-1",
          creditPercent: 0,
          isExcludedFromReward: false,
          selectorTags: [],
        },
      ],
      systemMetrics: {},
    };

    const route = await import("@/app/api/tenant/kra-kpi/my/achievement-preview/route");
    const response = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    expect(previewSubmissionRewardsMock).toHaveBeenCalledWith("kpi-1", "tenant-1", {
      achievementId: "ach-1",
      actualValue: 1,
      actualDate: undefined,
      computedScore: undefined,
      effectiveScore: undefined,
      reportingDate: new Date("2026-04-02T00:00:00.000Z"),
      achievementFormData: {
        paperTitle: "Sample Paper",
      },
      contributors: payload.contributors,
      manualTierCode: undefined,
      systemMetrics: {},
    });
    expect(runDuplicateDetectionMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      periodId: "period-1",
      kpiDefinitionId: "kpi-1",
      achievementId: "ach-1",
      achievementFormData: {
        journalQuartile: "Q1",
        authorshipCase: "CASE_1",
      },
      formConfig: {
        fields: [],
      },
      contributorUserIds: ["user-1"],
    });

    const body = await response.json();
    expect(body.status).toBe("success");
    expect(body.kpiTitle).toBe("Journal KPI");
    expect(body.rewardPreview.derivedAuthorshipCase).toBe("CASE_1");
    expect(body.duplicateCheckResult.matches[0].note).toBe("Possible duplicate DOI match.");
  });
});
