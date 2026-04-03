import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();

const listAssessmentWorkspaceSectionsMock = vi.fn();
const bulkAssignAssessmentWorkspaceSectionsMock = vi.fn();
const freezeAssessmentWorkspaceMock = vi.fn();
const unfreezeAssessmentWorkspaceMock = vi.fn();
const createAssessmentWorkspaceDiscussionThreadMock = vi.fn();
const addAssessmentWorkspaceDiscussionMessageMock = vi.fn();
const previewAssessmentWorkspaceReuseMock = vi.fn();
const applyAssessmentWorkspaceReuseMock = vi.fn();
const getAssessmentWorkspaceSubmissionManifestMock = vi.fn();
const deleteAssessmentWorkspaceEvidenceVersionMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/accreditation/workspace-service", () => ({
  listAssessmentWorkspaceSections: listAssessmentWorkspaceSectionsMock,
  bulkAssignAssessmentWorkspaceSections: bulkAssignAssessmentWorkspaceSectionsMock,
  freezeAssessmentWorkspace: freezeAssessmentWorkspaceMock,
  unfreezeAssessmentWorkspace: unfreezeAssessmentWorkspaceMock,
  createAssessmentWorkspaceDiscussionThread: createAssessmentWorkspaceDiscussionThreadMock,
  addAssessmentWorkspaceDiscussionMessage: addAssessmentWorkspaceDiscussionMessageMock,
  previewAssessmentWorkspaceReuse: previewAssessmentWorkspaceReuseMock,
  applyAssessmentWorkspaceReuse: applyAssessmentWorkspaceReuseMock,
  getAssessmentWorkspaceSubmissionManifest: getAssessmentWorkspaceSubmissionManifestMock,
  deleteAssessmentWorkspaceEvidenceVersion: deleteAssessmentWorkspaceEvidenceVersionMock,
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
});

describe("accreditation workspace routes", () => {
  test("sections routes require a tenant accreditation session and forward params/body", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    const route = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/sections/route"
    );

    const denied = await route.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    listAssessmentWorkspaceSectionsMock.mockResolvedValue({
      status: "success",
      sections: [],
    });
    bulkAssignAssessmentWorkspaceSectionsMock.mockResolvedValue({
      status: "success",
      assignmentCount: 2,
    });

    const getResponse = await route.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(getResponse.status).toBe(200);
    expect(listAssessmentWorkspaceSectionsMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );

    const invalidPost = await route.POST(new Request("http://localhost", { method: "POST", body: "not-json" }), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(invalidPost.status).toBe(400);

    const postResponse = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignments: [{ sectionCriterionId: "section-1", userId: "user-2", role: "REVIEWER" }],
        }),
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(postResponse.status).toBe(200);
    expect(bulkAssignAssessmentWorkspaceSectionsMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      {
        assignments: [{ sectionCriterionId: "section-1", userId: "user-2", role: "REVIEWER" }],
      },
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("freeze and unfreeze routes pass parsed bodies and default to empty payloads", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    freezeAssessmentWorkspaceMock.mockResolvedValue({ status: "success" });
    unfreezeAssessmentWorkspaceMock.mockResolvedValue({ status: "success" });

    const freezeRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/freeze/route"
    );
    const unfreezeRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/unfreeze/route"
    );

    const freezeWithNoBody = await freezeRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(freezeWithNoBody.status).toBe(200);
    expect(freezeAssessmentWorkspaceMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      {},
      "user-1",
      "TENANT_OWNER",
    );

    const unfreezeWithReason = await unfreezeRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Need to update evidence." }),
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(unfreezeWithReason.status).toBe(200);
    expect(unfreezeAssessmentWorkspaceMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      { reason: "Need to update evidence." },
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("discussion routes forward mention data and reject invalid JSON", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));
    createAssessmentWorkspaceDiscussionThreadMock.mockResolvedValue({
      status: "success",
      thread: { id: "thread-1" },
    });
    addAssessmentWorkspaceDiscussionMessageMock.mockResolvedValue({
      status: "success",
      discussionMessage: { id: "message-1" },
    });

    const discussionsRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/discussions/route"
    );
    const messagesRoute = await import(
      "@/app/api/tenant/accreditation/discussions/[id]/messages/route"
    );

    const invalidDiscussion = await discussionsRoute.POST(
      new Request("http://localhost", { method: "POST", body: "bad-json" }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(invalidDiscussion.status).toBe(400);

    const discussionResponse = await discussionsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "SECTION",
          sectionCriterionId: "section-1",
          title: "Need a recheck",
          body: "Please verify this count.",
          mentionedUserIds: ["user-2", "user-3"],
        }),
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(discussionResponse.status).toBe(200);
    expect(createAssessmentWorkspaceDiscussionThreadMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      expect.objectContaining({
        mentionedUserIds: ["user-2", "user-3"],
      }),
      "user-1",
      "TENANT_USER",
    );

    const messageResponse = await messagesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: "Acknowledged",
          mentionedUserIds: ["user-2"],
        }),
      }),
      { params: Promise.resolve({ id: "thread-1" }) },
    );
    expect(messageResponse.status).toBe(200);
    expect(addAssessmentWorkspaceDiscussionMessageMock).toHaveBeenCalledWith(
      "thread-1",
      "tenant-1",
      {
        body: "Acknowledged",
        mentionedUserIds: ["user-2"],
      },
      "user-1",
      "TENANT_USER",
    );
  });

  test("reuse routes forward source workspace payloads and surface service errors", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    previewAssessmentWorkspaceReuseMock.mockResolvedValueOnce({
      status: "success",
      preview: { willCopy: [], willSkip: [], conflicts: [] },
    });
    applyAssessmentWorkspaceReuseMock.mockResolvedValueOnce({
      status: "error",
      message: "Workspace is read-only.",
    });

    const previewRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/reuse/preview/route"
    );
    const applyRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/reuse/apply/route"
    );

    const previewResponse = await previewRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: "workspace-source",
          sectionCriterionIds: ["section-1"],
        }),
      }),
      { params: Promise.resolve({ id: "workspace-target" }) },
    );
    expect(previewResponse.status).toBe(200);
    expect(previewAssessmentWorkspaceReuseMock).toHaveBeenCalledWith(
      "workspace-target",
      "tenant-1",
      {
        sourceWorkspaceId: "workspace-source",
        sectionCriterionIds: ["section-1"],
      },
      "user-1",
      "TENANT_OWNER",
    );

    const applyResponse = await applyRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: "workspace-source",
        }),
      }),
      { params: Promise.resolve({ id: "workspace-target" }) },
    );
    expect(applyResponse.status).toBe(400);
    expect(applyAssessmentWorkspaceReuseMock).toHaveBeenCalledWith(
      "workspace-target",
      "tenant-1",
      { sourceWorkspaceId: "workspace-source" },
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("submission manifest and evidence-version delete routes map session and bodies correctly", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    getAssessmentWorkspaceSubmissionManifestMock.mockResolvedValue({
      status: "success",
      manifest: { workspaceId: "workspace-1" },
    });
    deleteAssessmentWorkspaceEvidenceVersionMock.mockResolvedValue({
      status: "success",
      message: "Evidence version deleted.",
    });

    const manifestRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/submission-manifest/route"
    );
    const evidenceVersionRoute = await import(
      "@/app/api/tenant/accreditation/evidence-versions/[id]/route"
    );

    const manifestResponse = await manifestRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(manifestResponse.status).toBe(200);
    expect(getAssessmentWorkspaceSubmissionManifestMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );

    const invalidDelete = await evidenceVersionRoute.DELETE(
      new Request("http://localhost", { method: "DELETE", body: "bad-json" }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(invalidDelete.status).toBe(400);

    const deleteResponse = await evidenceVersionRoute.DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Wrong draft uploaded." }),
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleteAssessmentWorkspaceEvidenceVersionMock).toHaveBeenCalledWith(
      "version-1",
      "tenant-1",
      { reason: "Wrong draft uploaded." },
      "user-1",
      "TENANT_OWNER",
    );
  });
});
