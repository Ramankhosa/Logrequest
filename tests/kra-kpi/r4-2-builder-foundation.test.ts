import { describe, expect, test } from "vitest";
import { kpiBuilderPayloadSchema } from "@/lib/kra-kpi/builder-shared";
import {
  applyAchievementFieldDefaults,
  buildFormDataValidator,
  getRenderableAchievementFields,
  isAchievementFieldRequired,
  type AchievementFieldConfig,
} from "@/lib/kra-kpi/shared";

describe("R4.2 builder foundation schemas", () => {
  test("parses a minimal builder payload and applies contributor config defaults", () => {
    const parsed = kpiBuilderPayloadSchema.safeParse({
      definition: {
        kraDefinitionId: "kra-1",
        title: "Minimal KPI",
        measurementType: "NUMERIC",
        weightage: 10,
        allocationType: "INDIVIDUAL",
        startingUnitId: "unit-1",
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.contributorConfig).toEqual({
      allowExternalContributors: true,
      duplicateCheckFields: [],
      creditSumMode: "MUST_EQUAL_100",
    });
    expect(parsed.data?.definition.participantMode).toBe("SINGLE_OWNER");
    expect(parsed.data?.definition.rewardRecurrencePolicy).toBe("RECURRING");
  });

  test("accepts contributor-based reward rules and declaration form fields", () => {
    const parsed = kpiBuilderPayloadSchema.safeParse({
      definition: {
        kraDefinitionId: "kra-1",
        title: "Attested Team KPI",
        measurementType: "NUMERIC",
        weightage: 15,
        allocationType: "BOTH",
        startingUnitId: "unit-1",
        achievementFormConfig: {
          fields: [
            {
              key: "attestation",
              label: "I confirm this submission is accurate",
              type: "DECLARATION",
              required: true,
              sortOrder: 0,
            },
          ],
        },
      },
      rewardTiers: [
        {
          code: "TEAM_LEAD",
          name: "Lead Team Tier",
          tierSetKey: "PRIMARY",
          priority: 0,
          matchMode: "HIGHEST_MATCH",
          isActive: true,
          rules: [
            {
              source: "CONTRIBUTOR_TAG",
              operator: "has_any",
              value: ["FIRST_AUTHOR"],
              sortOrder: 0,
            },
            {
              source: "CONTRIBUTOR_COUNT",
              operator: "gte",
              value: 2,
              sortOrder: 1,
            },
          ],
        },
      ],
      rewardComponents: [],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.definition.achievementFormConfig?.fields[0]?.type).toBe("DECLARATION");
    expect(parsed.data?.rewardTiers[0]?.rules.map((rule) => rule.source)).toEqual([
      "CONTRIBUTOR_TAG",
      "CONTRIBUTOR_COUNT",
    ]);
  });

  test("supports template-style fields with bindings, visibility rules, and required rules", () => {
    const parsed = kpiBuilderPayloadSchema.safeParse({
      definition: {
        kraDefinitionId: "kra-1",
        title: "Publication KPI",
        measurementType: "NUMERIC",
        weightage: 20,
        allocationType: "BOTH",
        startingUnitId: "unit-1",
        achievementFormConfig: {
          fields: [
            {
              key: "publicationType",
              label: "Publication Type",
              type: "SELECT",
              required: true,
              options: ["JOURNAL", "CONFERENCE"],
              sortOrder: 0,
            },
            {
              key: "journalTier",
              label: "Journal Tier",
              type: "SELECT",
              required: false,
              options: ["Q1", "Q2", "Q3", "Q4"],
              sortOrder: 1,
              binding: "CATEGORY_FIELD",
              visibilityRules: [
                {
                  fieldKey: "publicationType",
                  operator: "eq",
                  value: "JOURNAL",
                },
              ],
              requiredRules: [
                {
                  fieldKey: "publicationType",
                  operator: "eq",
                  value: "JOURNAL",
                },
              ],
            },
            {
              key: "publicationDate",
              label: "Publication Date",
              type: "DATE",
              required: true,
              sortOrder: 2,
              binding: "POLICY_DATE_FIELD",
            },
          ],
        },
      },
      rewardTiers: [],
      rewardComponents: [],
    });

    expect(parsed.success).toBe(true);
    expect(
      parsed.data?.definition.achievementFormConfig?.fields.find(
        (field) => field.key === "publicationDate",
      )?.binding,
    ).toBe("POLICY_DATE_FIELD");
  });
});

describe("R4.2 dynamic validator extensions", () => {
  function validate(fields: AchievementFieldConfig[], payload: Record<string, unknown>) {
    return buildFormDataValidator(fields).safeParse(payload);
  }

  test("enforces number ranges and conditional required rules", () => {
    const fields: AchievementFieldConfig[] = [
      {
        key: "publicationType",
        label: "Publication Type",
        type: "SELECT",
        required: true,
        options: ["JOURNAL", "CONFERENCE"],
        sortOrder: 0,
      },
      {
        key: "journalTier",
        label: "Journal Tier",
        type: "SELECT",
        required: false,
        options: ["Q1", "Q2", "Q3", "Q4"],
        sortOrder: 1,
        requiredRules: [
          {
            fieldKey: "publicationType",
            operator: "eq",
            value: "JOURNAL",
          },
        ],
      },
      {
        key: "pages",
        label: "Pages",
        type: "NUMBER",
        required: false,
        sortOrder: 2,
        validation: {
          min: 1,
          max: 50,
        },
      },
    ];

    const missingTier = validate(fields, {
      publicationType: "JOURNAL",
      pages: 10,
    });
    expect(missingTier.success).toBe(false);
    expect(missingTier.error?.issues.map((issue) => issue.message)).toContain(
      "Journal Tier is required",
    );

    const outOfRange = validate(fields, {
      publicationType: "CONFERENCE",
      pages: 51,
    });
    expect(outOfRange.success).toBe(false);
    expect(outOfRange.error?.issues.map((issue) => issue.message)).toContain(
      "Pages must be at most 50",
    );

    const valid = validate(fields, {
      publicationType: "CONFERENCE",
      pages: 20,
    });
    expect(valid.success).toBe(true);
  });

  test("requires visible declaration acknowledgements and ignores hidden declarations", () => {
    const fields: AchievementFieldConfig[] = [
      {
        key: "publicationType",
        label: "Publication Type",
        type: "SELECT",
        required: true,
        options: ["JOURNAL", "CONFERENCE"],
        sortOrder: 0,
      },
      {
        key: "attestation",
        label: "I confirm the journal details are accurate",
        type: "DECLARATION",
        required: true,
        sortOrder: 1,
        visibilityRules: [
          {
            fieldKey: "publicationType",
            operator: "eq",
            value: "JOURNAL",
          },
        ],
      },
    ];

    const hidden = validate(fields, {
      publicationType: "CONFERENCE",
    });
    expect(hidden.success).toBe(true);

    const unchecked = validate(fields, {
      publicationType: "JOURNAL",
      attestation: false,
    });
    expect(unchecked.success).toBe(false);
    expect(unchecked.error?.issues.map((issue) => issue.message)).toContain(
      "I confirm the journal details are accurate must be acknowledged",
    );

    const checked = validate(fields, {
      publicationType: "JOURNAL",
      attestation: true,
    });
    expect(checked.success).toBe(true);
  });
});

describe("R4.2 application field helpers", () => {
  const fields: AchievementFieldConfig[] = [
    {
      key: "publicationType",
      label: "Publication Type",
      type: "SELECT",
      required: true,
      options: ["JOURNAL", "CONFERENCE"],
      sortOrder: 0,
      defaultValue: "JOURNAL",
    },
    {
      key: "journalTier",
      label: "Journal Tier",
      type: "SELECT",
      required: false,
      options: ["Q1", "Q2", "Q3", "Q4"],
      sortOrder: 1,
      visibilityRules: [
        {
          fieldKey: "publicationType",
          operator: "eq",
          value: "JOURNAL",
        },
      ],
      requiredRules: [
        {
          fieldKey: "publicationType",
          operator: "eq",
          value: "JOURNAL",
        },
      ],
    },
  ];

  test("applies builder defaults before rendering", () => {
    expect(applyAchievementFieldDefaults(fields, {})).toEqual({
      publicationType: "JOURNAL",
    });
  });

  test("filters hidden fields until visibility rules match", () => {
    expect(
      getRenderableAchievementFields(fields, { publicationType: "CONFERENCE" }).map(
        (field) => field.key,
      ),
    ).toEqual(["publicationType"]);

    expect(
      getRenderableAchievementFields(fields, { publicationType: "JOURNAL" }).map(
        (field) => field.key,
      ),
    ).toEqual(["publicationType", "journalTier"]);
  });

  test("treats required-rules as front-end required markers", () => {
    expect(isAchievementFieldRequired(fields[1]!, { publicationType: "CONFERENCE" })).toBe(false);
    expect(isAchievementFieldRequired(fields[1]!, { publicationType: "JOURNAL" })).toBe(true);
  });
});
