import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Role } from "@prisma/client";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";
import { createOrgUnitType } from "@/lib/org-structure/service";

const getServerSessionMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

type ActorContext = {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
};

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

function csvFile(content: string) {
  return new File([content], "structure.csv", { type: "text/csv" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Structure Upload Route Integration", () => {
  test("4.9 preview validates type_key against existing unit types", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createTenantActor(tracker, "TENANT_ADMIN");
      const context: ActorContext = {
        tenantId: tenant.id,
        actorUserId: actor.id,
        actorRole: "TENANT_ADMIN",
      };
      getServerSessionMock.mockResolvedValue({
        user: {
          id: actor.id,
          tenantId: tenant.id,
          role: "TENANT_ADMIN",
        },
      });

      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      const route = await import("@/app/api/tenant/structure/upload/route");
      const formData = new FormData();
      formData.set("action", "preview");
      formData.set(
        "file",
        csvFile(
          "type_key,unit_code,unit_name,parent_code\nDEPT,CSE,Computer Science,UNIV",
        ),
      );

      const res = await route.POST(
        new Request("http://localhost", { method: "POST", body: formData }),
      );
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.rows[0].errors.join(" ")).toContain("Unit type");
    });
  });
});

