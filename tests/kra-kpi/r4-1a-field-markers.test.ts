import { describe, expect, test } from "vitest";
import {
  achievementFieldSchema,
  achievementFormConfigSchema,
  buildFormDataValidator,
} from "@/lib/kra-kpi/shared";

describe("R4.1a achievement field markers", () => {
  test("VALUE_FIELD marker validates", () => {
    const parsed = achievementFieldSchema.safeParse({
      key: "amount",
      label: "Amount",
      type: "NUMBER",
      required: true,
      sortOrder: 0,
      marker: "VALUE_FIELD",
    });
    expect(parsed.success).toBe(true);
  });

  test("invalid marker string is rejected", () => {
    const parsed = achievementFieldSchema.safeParse({
      key: "amount",
      label: "Amount",
      type: "NUMBER",
      required: true,
      sortOrder: 0,
      marker: "NOT_A_MARKER",
    });
    expect(parsed.success).toBe(false);
  });

  test("omitted marker remains backward compatible", () => {
    const parsed = achievementFormConfigSchema.safeParse({
      fields: [
        { key: "title", label: "Title", type: "TEXT", required: true, sortOrder: 0 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test("buildFormDataValidator ignores marker for validation shape", () => {
    const fields = [
      {
        key: "n",
        label: "N",
        type: "NUMBER" as const,
        required: false,
        sortOrder: 0,
        marker: "VALUE_FIELD" as const,
      },
    ];
    const v = buildFormDataValidator(fields);
    const ok = v.safeParse({ n: 3 });
    expect(ok.success).toBe(true);
  });
});
