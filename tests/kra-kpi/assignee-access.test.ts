import type {
  AssessmentPeriodState,
  KpiAllocationType,
  TargetAllocationState,
} from "@prisma/client";
import {
  canCascade,
  canRecord,
  hasReviewRole,
  mustCascade,
  showBothChoiceUI,
} from "@/lib/kra-kpi/assignee-access";
import { buildFormDataValidator, type AchievementFieldConfig } from "@/lib/kra-kpi/shared";

const baseContext = {
  userId: "user-1",
  headOfUnits: [{ unitId: "unit-1", unitName: "CSE", unitCode: "CSE", scope: "NODE" as const }],
  memberOfUnits: [{ unitId: "unit-1", unitName: "CSE", unitCode: "CSE" }],
};

const nonHeadContext = {
  userId: "user-2",
  headOfUnits: [],
  memberOfUnits: [{ unitId: "unit-1", unitName: "CSE", unitCode: "CSE" }],
};

function allocation(input: Partial<{
  assignedToUnitId: string | null;
  assignedToUserId: string | null;
  allocationType: KpiAllocationType;
  state: TargetAllocationState;
  childCount: number;
  parentAllocationId: string | null;
}> = {}) {
  return {
    assignedToUnitId: "unit-1",
    assignedToUserId: null,
    allocationType: "DEPARTMENT" as KpiAllocationType,
    state: "ACTIVE" as TargetAllocationState,
    childCount: 0,
    parentAllocationId: null,
    ...input,
  };
}

describe("assignee access helpers", () => {
  test.each([
    ["OPEN", false],
    ["IN_PROGRESS", true],
    ["UNDER_REVIEW", true],
    ["CLOSED", false],
    ["ARCHIVED", false],
  ] satisfies [AssessmentPeriodState, boolean][])(
    "department head record permission respects period state %s",
    (periodState, expected) => {
      const result = canRecord(
        allocation({ allocationType: "DEPARTMENT" }),
        baseContext,
        periodState,
      );
      expect(result).toBe(expected);
    },
  );

  test("department allocation can be recorded by the head of the assigned unit", () => {
    expect(
      canRecord(
        allocation({ allocationType: "DEPARTMENT" }),
        baseContext,
        "IN_PROGRESS",
      ),
    ).toBe(true);
  });

  test("department allocation cannot be recorded by non-head users", () => {
    expect(
      canRecord(
        allocation({ allocationType: "DEPARTMENT" }),
        nonHeadContext,
        "IN_PROGRESS",
      ),
    ).toBe(false);
  });

  test("individual department allocation requires cascade before recording", () => {
    expect(
      canRecord(
        allocation({ allocationType: "INDIVIDUAL" }),
        baseContext,
        "IN_PROGRESS",
      ),
    ).toBe(false);
    expect(
      mustCascade(
        allocation({ allocationType: "INDIVIDUAL", childCount: 0 }),
        baseContext,
      ),
    ).toBe(true);
  });

  test("individual department allocation stops requiring cascade after children exist", () => {
    expect(
      mustCascade(
        allocation({ allocationType: "INDIVIDUAL", childCount: 2 }),
        baseContext,
      ),
    ).toBe(false);
  });

  test("both allocation shows record-or-distribute choice before cascade", () => {
    const alloc = allocation({ allocationType: "BOTH", childCount: 0 });

    expect(canRecord(alloc, baseContext, "IN_PROGRESS")).toBe(true);
    expect(canCascade(alloc, baseContext)).toBe(true);
    expect(showBothChoiceUI(alloc, baseContext)).toBe(true);
  });

  test("both allocation removes parent recording and choice UI after cascade", () => {
    const alloc = allocation({ allocationType: "BOTH", childCount: 2 });

    expect(canRecord(alloc, baseContext, "IN_PROGRESS")).toBe(false);
    expect(canCascade(alloc, baseContext)).toBe(true);
    expect(showBothChoiceUI(alloc, baseContext)).toBe(false);
  });

  test("locked allocations can still be recorded but cannot be cascaded", () => {
    const alloc = allocation({
      allocationType: "BOTH",
      state: "LOCKED",
    });

    expect(canRecord(alloc, baseContext, "IN_PROGRESS")).toBe(true);
    expect(canCascade(alloc, baseContext)).toBe(false);
    expect(showBothChoiceUI(alloc, baseContext)).toBe(false);
  });

  test("direct individual allocation can only be recorded by the assignee", () => {
    const alloc = allocation({
      assignedToUnitId: null,
      assignedToUserId: "user-1",
      allocationType: "INDIVIDUAL",
    });

    expect(canRecord(alloc, baseContext, "IN_PROGRESS")).toBe(true);
    expect(canRecord(alloc, nonHeadContext, "IN_PROGRESS")).toBe(false);
  });

  test("department allocations cannot be cascaded when allocation type is DEPARTMENT", () => {
    expect(
      canCascade(
        allocation({ allocationType: "DEPARTMENT" }),
        baseContext,
      ),
    ).toBe(false);
  });

  test("only unit heads can cascade eligible allocations", () => {
    const alloc = allocation({ allocationType: "INDIVIDUAL" });

    expect(canCascade(alloc, baseContext)).toBe(true);
    expect(canCascade(alloc, nonHeadContext)).toBe(false);
  });

  test("review queue visibility is limited to users who head at least one unit", () => {
    expect(hasReviewRole(baseContext)).toBe(true);
    expect(hasReviewRole(nonHeadContext)).toBe(false);
  });
});

describe("dynamic achievement form validation", () => {
  function validate(fields: AchievementFieldConfig[], payload: Record<string, unknown>) {
    return buildFormDataValidator(fields).safeParse(payload);
  }

  test("accepts valid typed payloads across supported field kinds", () => {
    const fields: AchievementFieldConfig[] = [
      { key: "title", label: "Title", type: "TEXT", required: true, sortOrder: 0 },
      { key: "score", label: "Score", type: "NUMBER", required: true, sortOrder: 1 },
      { key: "proof", label: "Proof", type: "URL", required: true, sortOrder: 2 },
      { key: "ownerEmail", label: "Owner Email", type: "EMAIL", required: true, sortOrder: 3 },
      {
        key: "status",
        label: "Status",
        type: "SELECT",
        required: true,
        options: ["Filed", "Granted"],
        sortOrder: 4,
      },
      {
        key: "indexing",
        label: "Indexing",
        type: "MULTI_SELECT",
        required: true,
        options: ["Scopus", "Web of Science"],
        sortOrder: 5,
      },
      {
        key: "doi",
        label: "DOI",
        type: "TEXT",
        required: false,
        pattern: "^10\\.[0-9]{4,}/.+$",
        sortOrder: 6,
      },
      { key: "isLead", label: "Lead Author", type: "BOOLEAN", required: false, sortOrder: 7 },
      { key: "publishedOn", label: "Published On", type: "DATE", required: false, sortOrder: 8 },
    ];

    const result = validate(fields, {
      title: "Paper A",
      score: 12,
      proof: "https://example.com/paper",
      ownerEmail: "editor@example.com",
      status: "Filed",
      indexing: ["Scopus"],
      doi: "10.1234/demo-paper",
      isLead: true,
      publishedOn: "2026-01-15",
      extra: "allowed",
    });

    expect(result.success).toBe(true);
  });

  test("rejects invalid select, multiselect, url, email, and pattern values", () => {
    const fields: AchievementFieldConfig[] = [
      {
        key: "status",
        label: "Status",
        type: "SELECT",
        required: true,
        options: ["Filed", "Granted"],
        sortOrder: 0,
      },
      {
        key: "indexing",
        label: "Indexing",
        type: "MULTI_SELECT",
        required: true,
        options: ["Scopus", "Web of Science"],
        sortOrder: 1,
      },
      { key: "proof", label: "Proof", type: "URL", required: true, sortOrder: 2 },
      { key: "ownerEmail", label: "Owner Email", type: "EMAIL", required: true, sortOrder: 3 },
      {
        key: "doi",
        label: "DOI",
        type: "TEXT",
        required: false,
        pattern: "^10\\.[0-9]{4,}/.+$",
        sortOrder: 4,
      },
    ];

    const result = validate(fields, {
      status: "Rejected",
      indexing: ["Scopus", "PubMed"],
      proof: "not-a-url",
      ownerEmail: "bad-email",
      doi: "bad-doi",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Status must be one of the allowed options",
        "Indexing contains an invalid selection",
        "Proof must be a valid URL",
        "Owner Email must be a valid email",
        "DOI has an invalid format",
      ]),
    );
  });

  test("enforces required fields and minimum multiselect selection", () => {
    const fields: AchievementFieldConfig[] = [
      { key: "title", label: "Title", type: "TEXT", required: true, sortOrder: 0 },
      {
        key: "indexing",
        label: "Indexing",
        type: "MULTI_SELECT",
        required: true,
        options: ["Scopus", "Web of Science"],
        sortOrder: 1,
      },
    ];

    const result = validate(fields, {
      title: "",
      indexing: [],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Title is required",
        "Indexing requires at least one selection",
      ]),
    );
  });
});
