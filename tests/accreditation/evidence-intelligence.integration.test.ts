import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CriterionDataType,
  SuggestionStatus,
  TenantFeatureCode,
  TenantServiceCode,
} from "@prisma/client";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTenantAccreditationBody,
  createTenantBodyVersion,
  createTenantVersionBlock,
  createTenantVersionProfile,
} from "@/lib/accreditation/service";
import {
  addAssessmentWorkspaceEvidenceVersion,
  createAssessmentWorkspace,
  createAssessmentWorkspaceEvidence,
  linkAssessmentWorkspaceEvidence,
  setBlockEntryResponse,
} from "@/lib/accreditation/workspace-service";
import {
  extractEvidenceVersionForCopilot,
  generateEntryReviewSuggestion,
  getEvidenceVersionExtractionDetails,
  listEvidenceVersionChunks,
} from "@/lib/accreditation/accreditation-copilot-service";
import {
  cleanupTrackedData,
  createTenantActor,
  enableTenantFeature,
  enableTenantService,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

async function createWorkspaceFixture(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

  await enableTenantService({
    tenantId: tenant.id,
    serviceCode: TenantServiceCode.ACCREDITATION,
    actorUserId: actor.id,
  });
  await enableTenantFeature({
    tenantId: tenant.id,
    featureCode: TenantFeatureCode.ACCREDITATION_COPILOT,
    actorUserId: actor.id,
  });

  const bodyResult = await createTenantAccreditationBody(
    tenant.id,
    {
      code: `EVID_${Date.now()}`,
      name: "Evidence Intelligence Body",
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(bodyResult).toMatchObject({ status: "success" });
  if (bodyResult.status !== "success") {
    throw new Error(bodyResult.message);
  }

  const versionResult = await createTenantBodyVersion(
    tenant.id,
    bodyResult.body.id,
    {
      versionCode: `EVID_2026_${Date.now()}`,
      versionName: "Evidence Intelligence Version",
      scoreBase: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(versionResult).toMatchObject({ status: "success" });
  if (versionResult.status !== "success") {
    throw new Error(versionResult.message);
  }

  const profileResult = await createTenantVersionProfile(
    tenant.id,
    versionResult.version.id,
    {
      profileCode: "UNIVERSITY",
      profileName: "University",
      isDefault: true,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(profileResult).toMatchObject({ status: "success" });
  if (profileResult.status !== "success") {
    throw new Error(profileResult.message);
  }

  const blockResult = await createTenantVersionBlock(
    tenant.id,
    versionResult.version.id,
    {
      blockCode: "CR1",
      title: "Research Committee Evidence",
      dataType: CriterionDataType.QUALITATIVE,
      maxScore: 15,
      isLeaf: true,
      sortOrder: 0,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(blockResult).toMatchObject({ status: "success" });
  if (blockResult.status !== "success") {
    throw new Error(blockResult.message);
  }

  const workspaceResult = await createAssessmentWorkspace(
    tenant.id,
    {
      versionId: versionResult.version.id,
      profileId: profileResult.profile.id,
      title: "Evidence Intelligence Workspace",
      periodStart: new Date("2024-01-01T00:00:00.000Z"),
      periodEnd: new Date("2024-12-31T00:00:00.000Z"),
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(workspaceResult).toMatchObject({ status: "success" });
  if (workspaceResult.status !== "success") {
    throw new Error(workspaceResult.message);
  }

  const entry = await prisma.blockEntry.findFirstOrThrow({
    where: {
      workspaceId: workspaceResult.workspace.id,
      blockId: blockResult.block.id,
    },
  });

  return {
    tenant,
    actor,
    workspace: workspaceResult.workspace,
    entry,
  };
}

describe("evidence intelligence copilot", () => {
  test("extracts chunked evidence, persists normalized citations, and marks suggestions stale when evidence changes", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture(tracker);
      const tempDir = await mkdtemp(join(tmpdir(), "logrequest-evidence-"));
      const filePath = join(tempDir, "research-committee-minutes.txt");

      try {
        await writeFile(
          filePath,
          [
            "The research committee met on 10 January 2024 and approved six new seed proposals.",
            "Minutes confirm the institution maintains an annual review process, external member participation, and published action items.",
            "The committee also documented faculty mentoring and quarterly monitoring of funded projects.",
          ].join("\n\n"),
          "utf8",
        );

        const evidence = await createAssessmentWorkspaceEvidence(
          fixture.workspace.id,
          fixture.tenant.id,
          {
            title: "Research Committee Minutes",
            docType: "MINUTES",
          },
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(evidence).toMatchObject({ status: "success" });
        if (evidence.status !== "success") {
          throw new Error(evidence.message);
        }

        const version = await addAssessmentWorkspaceEvidenceVersion(
          evidence.evidence.id,
          fixture.tenant.id,
          {
            fileName: "research-committee-minutes.txt",
            fileUrl: filePath,
            fileType: "text/plain",
            isFinal: true,
          },
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(version).toMatchObject({ status: "success" });
        if (version.status !== "success") {
          throw new Error(version.message);
        }

        const link = await linkAssessmentWorkspaceEvidence(
          evidence.evidence.id,
          fixture.tenant.id,
          { entryId: fixture.entry.id },
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(link).toMatchObject({ status: "success" });

        const response = await setBlockEntryResponse(
          fixture.entry.id,
          fixture.tenant.id,
          {
            year: 2024,
            textValue:
              "The institution maintains a documented annual research committee review process with monitored action items.",
          },
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(response).toMatchObject({ status: "success" });

        const extractResult = await extractEvidenceVersionForCopilot(
          version.version.id,
          fixture.tenant.id,
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(extractResult).toMatchObject({ status: "success" });
        if (extractResult.status !== "success") {
          throw new Error(extractResult.message);
        }
        expect(extractResult.extraction.chunkCount).toBeGreaterThan(0);
        expect(extractResult.extraction.engineVersion).toBeTruthy();

        const extractionDetail = await getEvidenceVersionExtractionDetails(
          version.version.id,
          fixture.tenant.id,
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(extractionDetail).toMatchObject({ status: "success" });
        if (extractionDetail.status !== "success") {
          throw new Error(extractionDetail.message);
        }
        expect(extractionDetail.extraction?.status).toBe("SUCCESS");

        const chunkList = await listEvidenceVersionChunks(
          version.version.id,
          fixture.tenant.id,
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(chunkList).toMatchObject({ status: "success" });
        if (chunkList.status !== "success") {
          throw new Error(chunkList.message);
        }
        expect(chunkList.chunks.length).toBeGreaterThan(0);
        expect(chunkList.chunks[0]?.plainText).toContain("research committee");

        const suggestion = await generateEntryReviewSuggestion(
          fixture.entry.id,
          fixture.tenant.id,
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(suggestion).toMatchObject({ status: "success" });
        if (suggestion.status !== "success") {
          throw new Error(suggestion.message);
        }
        expect(
          suggestion.suggestion.citations.some((citation) => citation.type === "evidence_chunk"),
        ).toBe(true);

        const normalizedCitations = await prisma.evidenceSuggestionCitation.findMany({
          where: {
            suggestionId: suggestion.suggestion.id,
          },
        });
        expect(normalizedCitations.some((citation) => citation.chunkId !== null)).toBe(true);
        expect(
          normalizedCitations.some((citation) => citation.evidenceVersionId === version.version.id),
        ).toBe(true);

        await writeFile(
          filePath,
          [
            "Updated committee minutes show eight new proposals, revised monitoring intervals, and stronger evidence tracking.",
            "The committee now records explicit follow-up ownership for every action item.",
          ].join("\n\n"),
          "utf8",
        );

        const reextractResult = await extractEvidenceVersionForCopilot(
          version.version.id,
          fixture.tenant.id,
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(reextractResult).toMatchObject({ status: "success" });

        const staleSuggestion = await prisma.accreditationAssistantSuggestion.findUniqueOrThrow({
          where: { id: suggestion.suggestion.id },
        });
        expect(staleSuggestion.status).toBe(SuggestionStatus.STALE);
        expect(staleSuggestion.staleReason).toBe("evidence_reprocessed");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
