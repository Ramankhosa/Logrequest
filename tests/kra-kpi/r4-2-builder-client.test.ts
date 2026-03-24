import { describe, expect, test } from "vitest";
import {
  applyCopyDependencies,
  applyCopySelectionToDraft,
  applyTemplateToDraftPayload,
  createEmptyBuilderPayload,
} from "@/lib/kra-kpi/kpi-builder-client";

describe("R4.2 builder client helpers", () => {
  test("createEmptyBuilderPayload seeds a clean builder draft", () => {
    const payload = createEmptyBuilderPayload("kra-1", "unit-1");

    expect(payload.definition.kraDefinitionId).toBe("kra-1");
    expect(payload.definition.startingUnitId).toBe("unit-1");
    expect(payload.definition.participantMode).toBe("SINGLE_OWNER");
    expect(payload.rewardTiers).toEqual([]);
    expect(payload.rewardComponents).toEqual([]);
  });

  test("applyTemplateToDraftPayload rebinds the template to the active KRA and unit", () => {
    const templatePayload = createEmptyBuilderPayload("template-kra", "template-unit");
    templatePayload.definition.title = "Template Title";
    templatePayload.rewardTiers.push({
      refKey: "Q1_REF",
      tierSetKey: "PRIMARY",
      code: "Q1",
      name: "Q1 Tier",
      priority: 0,
      matchMode: "HIGHEST_MATCH",
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true,
      rules: [],
    });

    const payload = applyTemplateToDraftPayload({
      templatePayload,
      kraDefinitionId: "kra-1",
      startingUnitId: "unit-1",
      titleOverride: "Applied Title",
    });

    expect(payload.definition.kraDefinitionId).toBe("kra-1");
    expect(payload.definition.startingUnitId).toBe("unit-1");
    expect(payload.definition.title).toBe("Applied Title");
    expect(payload.rewardTiers[0]?.refKey).toBe("Q1_REF");
  });

  test("applyCopyDependencies auto-selects required sections", () => {
    const resolved = applyCopyDependencies(
      {
        basics: false,
        fields: false,
        participantPolicy: false,
        externalContributorPolicy: false,
        duplicateCheckPolicy: false,
        roles: false,
        stages: false,
        tiers: false,
        rewardComponents: false,
        distributions: true,
      },
      {
        fields: true,
        roles: true,
        stages: true,
        rewardComponents: true,
        distributions: true,
      },
    );

    expect(resolved.distributions).toBe(true);
    expect(resolved.rewardComponents).toBe(true);
    expect(resolved.tiers).toBe(true);
    expect(resolved.fields).toBe(true);
    expect(resolved.roles).toBe(true);
    expect(resolved.stages).toBe(true);
  });

  test("applyCopySelectionToDraft carries tier refs and strips runtime ids", () => {
    const source = createEmptyBuilderPayload("kra-source", "unit-source");
    source.definition.id = "kpi-source";
    source.definition.title = "Source KPI";
    source.rewardTiers = [
      {
        id: "tier-db-id",
        refKey: "Q1_WINDOW_1",
        tierSetKey: "PRIMARY",
        code: "Q1",
        name: "Q1 Tier",
        priority: 0,
        matchMode: "HIGHEST_MATCH",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-06-30T00:00:00.000Z"),
        isActive: true,
        rules: [],
      },
    ];
    source.rewardComponents = [
      {
        id: "component-db-id",
        rewardTierRef: "Q1_WINDOW_1",
        rewardTierCode: "Q1",
        stageDefinitionId: null,
        parentComponentCode: null,
        benefitTypeCode: "MONETARY",
        code: "Q1_MONETARY",
        name: "Q1 Monetary",
        trigger: "FINAL_VERIFY",
        amountMode: "FIXED_POOL",
        amountValue: 1000,
        amountFieldKey: null,
        distributionMode: "DIRECT_OWNER",
        singleEligibleHandling: "FULL_TO_SINGLE",
        emptyShareHandling: "ROLLOVER_TO_MATCHED",
        isActive: true,
        sortOrder: 0,
        distributions: [],
      },
    ];

    const next = applyCopySelectionToDraft({
      source,
      target: null,
      selection: {
        basics: true,
        fields: true,
        participantPolicy: true,
        externalContributorPolicy: true,
        duplicateCheckPolicy: true,
        roles: true,
        stages: true,
        tiers: true,
        rewardComponents: true,
        distributions: true,
      },
      targetKraDefinitionId: "kra-target",
      startingUnitId: "unit-target",
      titleOverride: "Copied KPI",
    });

    expect(next.definition.id).toBeUndefined();
    expect(next.definition.kraDefinitionId).toBe("kra-target");
    expect(next.definition.startingUnitId).toBe("unit-target");
    expect(next.definition.title).toBe("Copied KPI");
    expect(next.rewardTiers[0]?.id).toBeUndefined();
    expect(next.rewardTiers[0]?.refKey).toBe("Q1_WINDOW_1");
    expect(next.rewardComponents[0]?.id).toBeUndefined();
    expect(next.rewardComponents[0]?.rewardTierRef).toBe("Q1_WINDOW_1");
  });
});
